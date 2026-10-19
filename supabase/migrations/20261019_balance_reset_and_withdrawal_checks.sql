-- ============================================================================
-- WATCH-N-EARN: BULK BALANCE RESET & VERSIONED REWARD ELIGIBILITY SCHEMA
-- Database: PostgreSQL (Supabase)
-- Version: 2026-10-19
-- ============================================================================

-- 1. Add reset generation tracking columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_bonus_claimed_generation INT DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_balance_reset_at TIMESTAMPTZ;

-- 2. Add generation column to bonus_claims
ALTER TABLE bonus_claims ADD COLUMN IF NOT EXISTS generation INT DEFAULT 1;

-- 3. Performance indexes
CREATE INDEX IF NOT EXISTS idx_users_signup_generation ON users(signup_bonus_claimed_generation);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_user_gen ON bonus_claims(user_id, generation);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_device_gen ON bonus_claims(device_id, generation);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_fp_gen ON bonus_claims(device_fingerprint_hash, generation);

-- ============================================================================
-- ATOMIC STORED PROCEDURE: BULK RESET ALL USER BALANCES
-- Guarantees:
-- 1. Sets balance = 0.00 for all existing users with balance > 0
-- 2. Never deletes users, Telegram IDs, usernames, referrals, tasks, withdrawals or codes
-- 3. Inserts an immutable transaction ledger adjustment for each affected user
-- 4. Inserts an audit log record
-- 5. Updates app_settings resetGeneration
-- 6. Returns accurate count and total balance reset
-- ============================================================================
CREATE OR REPLACE FUNCTION bulk_reset_user_balances_atomic(
  p_admin_id TEXT,
  p_new_generation INT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected_count INT := 0;
  v_total_balance_reset NUMERIC(12, 2) := 0.00;
  v_user RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_tx_id TEXT;
  v_audit_id TEXT;
BEGIN
  -- 1. Calculate totals across all users with positive balances
  SELECT COUNT(*), COALESCE(SUM(balance), 0.00)
  INTO v_affected_count, v_total_balance_reset
  FROM users
  WHERE balance > 0;

  -- 2. For each user with balance > 0, insert a ledger entry recording the reset
  FOR v_user IN SELECT id, balance FROM users WHERE balance > 0 FOR UPDATE
  LOOP
    v_tx_id := 'tx_reset_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '_' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 5);
    
    INSERT INTO transactions (
      id, user_id, type, amount, balance_after, description, reference_id, created_at
    ) VALUES (
      v_tx_id, v_user.id, 'admin_adjustment', -v_user.balance, 0.00,
      'Bulk balance reset by admin (Generation ' || p_new_generation || ')',
      'reset_gen_' || p_new_generation, v_now
    );
  END LOOP;

  -- 3. Reset all user balances to 0.00
  UPDATE users
  SET balance = 0.00,
      last_balance_reset_at = v_now,
      updated_at = v_now
  WHERE balance > 0;

  -- 4. Update app_settings with the new generation
  UPDATE app_settings
  SET settings_json = jsonb_set(
        COALESCE(settings_json, '{}'::jsonb),
        '{resetGeneration}',
        to_jsonb(p_new_generation)
      ),
      updated_at = v_now
  WHERE id = 'general';

  -- 5. Insert an audit log entry
  v_audit_id := 'audit_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '_' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 4);
  INSERT INTO transactions (
    id, user_id, type, amount, balance_after, description, reference_id, created_at
  ) VALUES (
    v_audit_id, p_admin_id, 'admin_adjustment', 0.00, 0.00,
    'BULK_BALANCE_RESET executed by admin ' || p_admin_id || ': ' || v_affected_count || ' users reset, total ₹' || v_total_balance_reset || ' (Generation ' || p_new_generation || ')',
    'audit_reset_gen_' || p_new_generation, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'affected_users', v_affected_count,
    'total_balance_reset', v_total_balance_reset,
    'new_generation', p_new_generation,
    'reset_at', v_now
  );
END;
$$;
