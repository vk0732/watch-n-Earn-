-- ============================================================================
-- WATCH-N-EARN: FINANCIAL LEDGER & ATOMIC GIFT CARD REDEMPTION SCHEMA
-- Database: PostgreSQL (Supabase)
-- Version: 2026-10-16
-- ============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT DEFAULT '',
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  lifetime_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (lifetime_earnings >= 0),
  referral_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (referral_earnings >= 0),
  referral_code TEXT,
  referred_by TEXT,
  daily_streak INT NOT NULL DEFAULT 0,
  last_daily_checkin TEXT,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate_account BOOLEAN NOT NULL DEFAULT FALSE,
  signup_bonus_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  device_id TEXT,
  device_fingerprint_hash TEXT,
  last_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TRANSACTIONS TABLE (IMMUTABLE FINANCIAL LEDGER)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL,
  description TEXT NOT NULL,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. GIFT CARD INVENTORY TABLE
CREATE TABLE IF NOT EXISTS gift_card_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  denomination NUMERIC(12, 2) NOT NULL CHECK (denomination > 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed', 'invalidated')),
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_telegram_id BIGINT,
  assigned_username TEXT,
  assigned_withdrawal_id TEXT,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT DEFAULT 'admin',
  notes TEXT
);

-- 4. WITHDRAWALS TABLE
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_telegram_id BIGINT NOT NULL,
  username TEXT DEFAULT '',
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'rejected', 'reversed')),
  payout_mode TEXT NOT NULL DEFAULT 'gift_card',
  gift_card_code TEXT,
  gift_card_denomination NUMERIC(12, 2),
  gift_card_id TEXT REFERENCES gift_card_codes(id) ON DELETE SET NULL,
  gift_card_redeemed_at TIMESTAMPTZ,
  idempotency_key TEXT,
  provider_response TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. BONUS CLAIMS TABLE
CREATE TABLE IF NOT EXISTS bonus_claims (
  id TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  device_fingerprint_hash TEXT,
  ip_hash TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'claimed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. REFERRALS TABLE
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_username TEXT,
  reward_amount NUMERIC(12, 2) NOT NULL DEFAULT 10.00,
  status TEXT NOT NULL DEFAULT 'credited',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. TASK COMPLETIONS TABLE
CREATE TABLE IF NOT EXISTS task_completions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  reward_amount NUMERIC(12, 2) NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. APP SETTINGS TABLE
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY DEFAULT 'general',
  settings_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PERFORMANCE & INTEGRITY INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_ref_id ON transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_idempotency ON withdrawals(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gift_cards_status_denom ON gift_card_codes(status, denomination) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON task_completions(user_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Allow service_role full bypass
CREATE POLICY service_role_all_users ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_txs ON transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_gcs ON gift_card_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_wths ON withdrawals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_claims ON bonus_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_refs ON referrals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_completions ON task_completions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_settings ON app_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- ATOMIC STORED PROCEDURE: REDEEM AMAZON GIFT CARD
-- Guarantees:
-- 1. Dual row-level lock (user row FOR UPDATE + gift card row FOR UPDATE SKIP LOCKED)
-- 2. Strict balance deduction: fails if user.balance < denomination
-- 3. Inventory allocation: allocates exactly 1 available code matching denomination
-- 4. Single ACID transaction: code update, balance deduction, withdrawal, transaction
-- 5. Persistent idempotency: identical retry returns existing withdrawal & code
-- ============================================================================
CREATE OR REPLACE FUNCTION redeem_gift_card_atomic(
  p_user_id TEXT,
  p_denomination NUMERIC,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_user RECORD;
  v_existing_w RECORD;
  v_gc RECORD;
  v_order_id TEXT;
  v_tx_id TEXT;
  v_new_balance NUMERIC;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Persistent Idempotency Check
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing_w FROM withdrawals
    WHERE user_id = p_user_id AND idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_user FROM users WHERE id = p_user_id;
      RETURN jsonb_build_object(
        'is_idempotent', true,
        'withdrawal_id', v_existing_w.id,
        'gift_card_code', v_existing_w.gift_card_code,
        'amount', v_existing_w.amount,
        'balance_after', v_user.balance,
        'status', v_existing_w.status,
        'created_at', v_existing_w.created_at
      );
    END IF;
  END IF;

  -- 2. Lock User Row for atomic update
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_user.is_banned THEN
    RAISE EXCEPTION 'Account suspended';
  END IF;

  IF v_user.balance < p_denomination THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Requested: %', v_user.balance, p_denomination;
  END IF;

  -- 3. Lock exactly ONE available gift card code matching denomination
  SELECT * INTO v_gc FROM gift_card_codes
  WHERE status = 'available' AND denomination = p_denomination
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card temporarily out of stock';
  END IF;

  -- 4. Calculate new balance
  v_new_balance := ROUND(v_user.balance - p_denomination, 2);
  v_order_id := 'WTH-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 4));
  v_tx_id := 'tx_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '_' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 5);

  -- 5. Mark Code as Redeemed
  UPDATE gift_card_codes
  SET status = 'redeemed',
      assigned_user_id = v_user.id,
      assigned_telegram_id = v_user.telegram_id,
      assigned_username = COALESCE(v_user.username, ''),
      assigned_withdrawal_id = v_order_id,
      redeemed_at = v_now
  WHERE id = v_gc.id;

  -- 6. Deduct User Balance
  UPDATE users
  SET balance = v_new_balance,
      updated_at = v_now
  WHERE id = v_user.id;

  -- 7. Insert Withdrawal Record
  INSERT INTO withdrawals (
    id, user_id, user_telegram_id, username, amount, status,
    payout_mode, gift_card_code, gift_card_denomination, gift_card_id,
    gift_card_redeemed_at, idempotency_key, created_at, processed_at
  ) VALUES (
    v_order_id, v_user.id, v_user.telegram_id, COALESCE(v_user.username, ''),
    p_denomination, 'success', 'gift_card', v_gc.code, v_gc.denomination,
    v_gc.id, v_now, NULLIF(TRIM(p_idempotency_key), ''), v_now, v_now
  );

  -- 8. Insert Transaction Ledger Entry
  INSERT INTO transactions (
    id, user_id, type, amount, balance_after, description, reference_id, created_at
  ) VALUES (
    v_tx_id, v_user.id, 'withdrawal_deduct', -p_denomination, v_new_balance,
    'Amazon Gift Card ₹' || p_denomination || ' Code Redeemed (' || v_order_id || ')',
    v_order_id, v_now
  );

  RETURN jsonb_build_object(
    'is_idempotent', false,
    'withdrawal_id', v_order_id,
    'transaction_id', v_tx_id,
    'gift_card_code', v_gc.code,
    'amount', p_denomination,
    'balance_after', v_new_balance,
    'status', 'success',
    'created_at', v_now
  );
END;
$$;

-- ============================================================================
-- ATOMIC STORED PROCEDURE: CREDIT BALANCE (REWARD / BONUS / REFUND)
-- Guarantees:
-- 1. Row-level lock on users table
-- 2. Inserts ledger transaction in same atomic transaction
-- 3. Balance never goes negative
-- ============================================================================
CREATE OR REPLACE FUNCTION credit_user_balance_atomic(
  p_user_id TEXT,
  p_amount NUMERIC,
  p_type TEXT,
  p_description TEXT,
  p_reference_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_user RECORD;
  v_tx_id TEXT;
  v_new_balance NUMERIC;
  v_new_lifetime NUMERIC;
  v_new_referral NUMERIC;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Row level lock
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_user.is_banned THEN
    RAISE EXCEPTION 'User account is suspended';
  END IF;

  v_new_balance := ROUND(v_user.balance + p_amount, 2);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Current balance is %, cannot deduct %', v_user.balance, ABS(p_amount);
  END IF;

  v_new_lifetime := CASE WHEN p_amount > 0 THEN ROUND(v_user.lifetime_earnings + p_amount, 2) ELSE v_user.lifetime_earnings END;
  v_new_referral := CASE WHEN p_type = 'referral_reward' THEN ROUND(v_user.referral_earnings + p_amount, 2) ELSE v_user.referral_earnings END;

  v_tx_id := 'tx_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '_' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 5);

  UPDATE users
  SET balance = v_new_balance,
      lifetime_earnings = v_new_lifetime,
      referral_earnings = v_new_referral,
      updated_at = v_now
  WHERE id = v_user.id;

  INSERT INTO transactions (
    id, user_id, type, amount, balance_after, description, reference_id, created_at
  ) VALUES (
    v_tx_id, v_user.id, p_type, p_amount, v_new_balance, p_description, p_reference_id, v_now
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'user_id', v_user.id,
    'balance_after', v_new_balance,
    'amount', p_amount
  );
END;
$$;
