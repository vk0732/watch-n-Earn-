import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

async function runMigration() {
  console.log('=== WATCH-N-EARN: SUPABASE DATA MIGRATION ===');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.');
    console.log('Usage:');
    console.log('  SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=ey... npx tsx scripts/migrate_to_supabase.ts');
    process.exit(1);
  }

  const backupFile = path.resolve(process.cwd(), 'backups/production_backup_1792147955860.json');
  if (!fs.existsSync(backupFile)) {
    console.error(`Backup file not found at: ${backupFile}`);
    process.exit(1);
  }

  const backupRaw = fs.readFileSync(backupFile, 'utf8');
  const backup = JSON.parse(backupRaw);
  const cols = backup.collections;

  console.log(`Loaded backup timestamp: ${backup.backupTimestamp}`);
  console.log(`Source project: ${backup.projectId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Migrate Users
  const users = cols.users || [];
  console.log(`\nMigrating ${users.length} users...`);
  const userRows = users.map((u: any) => ({
    id: u.id,
    telegram_id: u.telegramId,
    username: u.username || '',
    first_name: u.firstName || '',
    balance: Math.max(0, Number(u.balance) || 0),
    lifetime_earnings: Math.max(0, Number(u.lifetimeEarnings) || 0),
    referral_earnings: Math.max(0, Number(u.referralEarnings) || 0),
    referral_code: u.referralCode || null,
    referred_by: u.referredBy || null,
    daily_streak: u.dailyStreak || 0,
    last_daily_checkin: u.lastDailyCheckIn || null,
    is_banned: Boolean(u.isBanned),
    is_duplicate_account: Boolean(u.isDuplicateAccount),
    signup_bonus_claimed: Boolean(u.signupBonusClaimed),
    device_id: u.deviceId || null,
    device_fingerprint_hash: u.deviceFingerprintHash || null,
    last_ip: u.lastIp || null,
    created_at: u.createdAt || new Date().toISOString(),
    updated_at: u.updatedAt || new Date().toISOString(),
  }));

  const { error: userErr } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
  if (userErr) {
    console.error('Failed migrating users:', userErr.message);
  } else {
    console.log(`✓ Successfully migrated ${users.length} users.`);
  }

  // 2. Migrate Gift Card Codes
  const giftCards = cols.gift_card_codes || [];
  console.log(`\nMigrating ${giftCards.length} gift card codes...`);
  const gcRows = giftCards.map((g: any) => ({
    id: g.id,
    code: g.code,
    denomination: g.denomination || 10,
    status: g.status || 'available',
    assigned_user_id: g.assignedUserId || null,
    assigned_telegram_id: g.assignedTelegramId || null,
    assigned_username: g.assignedUsername || null,
    assigned_withdrawal_id: g.assignedWithdrawalId || null,
    redeemed_at: g.redeemedAt || null,
    created_at: g.createdAt || new Date().toISOString(),
    created_by: g.createdBy || 'admin',
    notes: g.notes || null,
  }));

  const { error: gcErr } = await supabase.from('gift_card_codes').upsert(gcRows, { onConflict: 'id' });
  if (gcErr) {
    console.error('Failed migrating gift card codes:', gcErr.message);
  } else {
    console.log(`✓ Successfully migrated ${giftCards.length} gift card codes.`);
  }

  // 3. Migrate Withdrawals
  const withdrawals = cols.withdrawals || [];
  console.log(`\nMigrating ${withdrawals.length} withdrawals...`);
  const wthRows = withdrawals.map((w: any) => ({
    id: w.id,
    user_id: w.userId,
    user_telegram_id: w.userTelegramId || 0,
    username: w.username || '',
    amount: w.amount || 10,
    status: w.status || 'success',
    payout_mode: w.payoutMode || 'gift_card',
    gift_card_code: w.giftCardCode || null,
    gift_card_denomination: w.giftCardDenomination || null,
    gift_card_id: w.giftCardId || null,
    gift_card_redeemed_at: w.giftCardRedeemedAt || null,
    idempotency_key: w.idempotencyKey || null,
    provider_response: w.providerResponse || null,
    failure_reason: w.failureReason || null,
    created_at: w.createdAt || new Date().toISOString(),
    processed_at: w.processedAt || new Date().toISOString(),
  }));

  const { error: wthErr } = await supabase.from('withdrawals').upsert(wthRows, { onConflict: 'id' });
  if (wthErr) {
    console.error('Failed migrating withdrawals:', wthErr.message);
  } else {
    console.log(`✓ Successfully migrated ${withdrawals.length} withdrawals.`);
  }

  // 4. Migrate Transactions
  const transactions = cols.transactions || [];
  console.log(`\nMigrating ${transactions.length} transactions...`);
  const txRows = transactions.map((t: any) => ({
    id: t.id,
    user_id: t.userId,
    type: t.type,
    amount: t.amount,
    balance_after: t.balanceAfter || 0,
    description: t.description || '',
    reference_id: t.referenceId || null,
    created_at: t.createdAt || new Date().toISOString(),
  }));

  const { error: txErr } = await supabase.from('transactions').upsert(txRows, { onConflict: 'id' });
  if (txErr) {
    console.error('Failed migrating transactions:', txErr.message);
  } else {
    console.log(`✓ Successfully migrated ${transactions.length} transactions.`);
  }

  // 5. Migrate Referrals
  const referrals = cols.referrals || [];
  console.log(`\nMigrating ${referrals.length} referrals...`);
  const refRows = referrals.map((r: any) => ({
    id: r.id,
    referrer_id: r.referrerId,
    referee_id: r.refereeId,
    referee_username: r.refereeUsername || '',
    reward_amount: r.rewardAmount || 10,
    status: r.status || 'credited',
    created_at: r.createdAt || new Date().toISOString(),
  }));

  const { error: refErr } = await supabase.from('referrals').upsert(refRows, { onConflict: 'id' });
  if (refErr) {
    console.error('Failed migrating referrals:', refErr.message);
  } else {
    console.log(`✓ Successfully migrated ${referrals.length} referrals.`);
  }

  console.log('\n=== MIGRATION COMPLETE ===');
}

runMigration().catch((err) => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
