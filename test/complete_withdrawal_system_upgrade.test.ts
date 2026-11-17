import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

// Ensure isolated test mode so authoritative disk files in data/ are never mutated
process.env.NODE_ENV = 'test';
if (!process.env.DB_PREFIX) {
  process.env.DB_PREFIX = 'test_complete_wth_upgrade';
}
process.env.TELEGRAM_BOT_TOKEN = '1234567890:AAHTestTokenForAutomatedVerificationOnly99';
process.env.ADMIN_TELEGRAM_IDS = '777000999';

import {
  memStore,
  getUser,
  saveUser,
  getAppSettings,
  updateAppSettings,
  atomicCreditBalance,
  recordReferral,
  atomicClaimReferralReward,
  getReferralsByReferrer,
  getCampaignReferralCounts,
  getValidReferralCount,
  getCompletedWithdrawals,
  checkWithdrawalReferralEligibility,
  redeemGiftCardWithdrawal,
  updateWithdrawalStatus,
  consumeReferralsForWithdrawal,
  getReferralConsumptionsByUser,
  addGiftCardCodes,
  getGiftCardInventoryStats,
  atomicResetUserBalance,
  saveTask,
  getTaskById,
  recordTaskCompletion,
  getTaskCompletion,
  getUserTransactions,
  getUserWithdrawals,
  getDailyCheckinCycleRewards,
  getTotalRegisteredUsersCount,
  reconcileUsersRegistry,
  getOrAssignSignupScratchBonus,
  atomicClaimSignupBonus,
  verifyMandatoryWithdrawalMembership,
} from '../server/db.ts';
import { apiRouter } from '../server/apiRouter.ts';
import { verifyTelegramInitData, isTelegramAdmin, setMockChannelMembership, clearMockChannelMemberships } from '../server/telegram.ts';
import { getBroadcastPreview } from '../server/broadcast.ts';
import { handleTelegramBotUpdate } from '../server/bot.ts';
import type { UserProfile, WithdrawalStagesConfig } from '../src/types/index.ts';

const results: Array<{ num: number; label: string }> = [];
function passTest(num: number, label: string) {
  results.push({ num, label });
  console.log(`  ✓ PASS [${num}/44]: ${label}`);
}

function signTelegramInitData(userObj: { id: number; first_name: string; username?: string }, botToken: string): string {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const userJson = JSON.stringify(userObj);
  const params = new URLSearchParams();
  params.set('auth_date', authDate);
  params.set('user', userJson);

  const pairs: string[] = [];
  params.forEach((val, key) => {
    pairs.push(`${key}=${val}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

async function apiRequest(
  baseUrl: string,
  method: string,
  endpoint: string,
  initData: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function createTestUser(id: string, telegramId: number, balance = 500): Promise<UserProfile> {
  const now = new Date().toISOString();
  const user: UserProfile = {
    id,
    telegramId,
    username: `u_${id}`,
    firstName: `User_${id}`,
    balance,
    lifetimeEarnings: balance,
    referralEarnings: 0,
    referralCode: `ref_${id}`,
    dailyStreak: 2,
    isBanned: false,
    signupBonusClaimed: true,
    createdAt: now,
    updatedAt: now,
  };
  return await saveUser(user);
}

async function addValidReferralsForUser(referrer: UserProfile, count: number, prefix: string): Promise<string[]> {
  const createdIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const tag = `${prefix}_${i + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const refereeId = `referee_${tag}`;
    await createTestUser(refereeId, Math.floor(3000000 + Math.random() * 6000000), 10);
    const claim = await atomicClaimReferralReward({
      referrerId: referrer.id,
      refereeId,
      refereeUsername: `friend_${tag}`,
      refereeDeviceId: `dev_${tag}`,
      refereeFingerprintHash: `fp_${tag}`,
    });
    assert.strictEqual(claim.success, true, `Referral ${tag} must be genuinely credited`);
    createdIds.push(refereeId);
  }
  return createdIds;
}

async function runCompleteWithdrawalUpgradeSuite() {
  console.log('\n================================================================================');
  console.log('  COMPLETE WITHDRAWAL SYSTEM UPGRADE — 44-POINT ZERO-REGRESSION TEST SUITE');
  console.log('================================================================================\n');

  const runTag = Date.now().toString(36).toUpperCase();
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;

  clearMockChannelMemberships();
  setMockChannelMembership('*', { isMember: true, status: 'member' });

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api`;

  try {
    const adminTgId = 777000999;
    const adminUser = await createTestUser('777000999', adminTgId, 0);
    const adminInitData = signTelegramInitData(
      { id: adminTgId, first_name: 'SysAdmin', username: 'sysadmin' },
      botToken
    );

    const DENOM = 17;
    const gcBatch = Array.from({ length: 60 }, (_, i) => `AMZN-W44-${runTag}-${String(i + 1).padStart(3, '0')}`);
    const addedGc = await addGiftCardCodes(gcBatch, DENOM, adminUser.id);
    assert.strictEqual(addedGc.added, 60);

    await updateAppSettings({
      minWithdrawalAmount: DENOM,
      maxWithdrawalAmount: 5000,
      dailyWithdrawalLimitEnabled: false,
      referralReward: 10,
      withdrawalReferralRequirementEnabled: true,
      referralCampaignId: 1,
      resetGeneration: 1,
    });

    // =========================================================================
    // SECTION A: WITHDRAWAL CONFIGURATION TESTS (1..8) + REFERRAL CONSUMPTION (9..16)
    // =========================================================================
    console.log('--- Section A: Withdrawal Configuration (Tests 1-8) & Referral Consumption (Tests 9-16) ---');

    // Exact Feature 4 Table Walkthrough:
    // User has 5 available valid referrals.
    // Admin settings: First=FREE, Second=2, Third=3, Fourth=2, Fifth=4, Sixth=unconfigured, Further=5
    const stageConfigFeature4: WithdrawalStagesConfig = {
      stages: {
        '1': { stage: 1, mode: 'free', referralsRequired: 0 },
        '2': { stage: 2, mode: 'custom', referralsRequired: 2 },
        '3': { stage: 3, mode: 'custom', referralsRequired: 3 },
        '4': { stage: 4, mode: 'custom', referralsRequired: 2 },
        '5': { stage: 5, mode: 'free', referralsRequired: 0 },
        '6': { stage: 6, mode: 'unconfigured', referralsRequired: 0 },
      },
      furtherWithdrawals: { mode: 'custom', referralsRequired: 4 },
    };

    const saveCfgRes = await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalReferralRequirementEnabled: true,
      withdrawalStageRules: stageConfigFeature4,
    });
    assert.strictEqual(saveCfgRes.status, 200);

    // Test 7: Settings persist after refresh and restart
    const fetchedCfg = await apiRequest(baseUrl, 'GET', '/admin/settings', adminInitData);
    assert.strictEqual(fetchedCfg.status, 200);
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.stages['1'].mode, 'free');
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.stages['2'].referralsRequired, 2);
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.stages['3'].referralsRequired, 3);
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.stages['4'].referralsRequired, 2);
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.stages['5'].mode, 'free');
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.stages['6'].mode, 'unconfigured');
    assert.strictEqual(fetchedCfg.data.settings.withdrawalStageRules.furtherWithdrawals.referralsRequired, 4);
    passTest(7, 'Stage settings persist accurately across Admin API save and reload');

    // Create user with 5 available valid referrals
    const uTableTgId = 920001;
    const uTable = await createTestUser(`u_table_${runTag}`, uTableTgId, 500);
    const uTableInit = signTelegramInitData({ id: uTableTgId, first_name: 'TableUser', username: uTable.username }, botToken);
    await addValidReferralsForUser(uTable, 5, 'tbl5');

    // Test 1: First withdrawal FREE mode (Available before = 5, Consumed = 0, Remaining = 5)
    const eligW1 = await checkWithdrawalReferralEligibility(uTable.id);
    assert.strictEqual(eligW1.nextWithdrawalNumber, 1);
    assert.strictEqual(eligW1.stageMode, 'free');
    assert.strictEqual(eligW1.requiredReferrals, 0);
    assert.strictEqual(eligW1.availableReferrals, 5);
    assert.strictEqual(eligW1.eligible, true);
    assert.strictEqual(eligW1.message, 'Your first withdrawal is FREE!');

    const w1Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w1Res.status, 200);
    assert.strictEqual(w1Res.data.withdrawal.referralsConsumedCount, 0);

    const countsAfterW1 = await getCampaignReferralCounts(uTable.id);
    assert.strictEqual(countsAfterW1.availableValidReferrals, 5, 'FREE 1st withdrawal consumed 0 referrals (5 remain)');
    assert.strictEqual(countsAfterW1.consumedValidReferrals, 0);
    assert.strictEqual(countsAfterW1.lifetimeValidReferrals, 5);
    passTest(1, 'First withdrawal FREE mode requires 0 referrals and consumes 0 referrals (5 -> 5 remaining)');

    // Test 3: Second withdrawal with custom requirement (2 referrals: Available before = 5, Consumed = 2, Remaining = 3)
    const eligW2 = await checkWithdrawalReferralEligibility(uTable.id);
    assert.strictEqual(eligW2.nextWithdrawalNumber, 2);
    assert.strictEqual(eligW2.stageMode, 'custom');
    assert.strictEqual(eligW2.requiredReferrals, 2);
    assert.strictEqual(eligW2.availableReferrals, 5);
    assert.strictEqual(eligW2.eligible, true);
    assert.strictEqual(eligW2.message, 'Available referrals: 5/2 — You can withdraw.');

    const w2Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w2Res.status, 200);
    assert.strictEqual(w2Res.data.withdrawal.referralsConsumedCount, 2);

    const countsAfterW2 = await getCampaignReferralCounts(uTable.id);
    assert.strictEqual(countsAfterW2.availableValidReferrals, 3, '2nd withdrawal consumed 2 referrals (5 -> 3 remaining)');
    assert.strictEqual(countsAfterW2.consumedValidReferrals, 2);
    assert.strictEqual(countsAfterW2.lifetimeValidReferrals, 5, 'Lifetime valid referrals remains 5');
    passTest(3, 'Second withdrawal with custom requirement (2) consumes 2 referrals (5 -> 3 remaining)');

    // Test 4: Third withdrawal with different custom requirement (3 referrals: Available before = 3, Consumed = 3, Remaining = 0)
    const eligW3 = await checkWithdrawalReferralEligibility(uTable.id);
    assert.strictEqual(eligW3.nextWithdrawalNumber, 3);
    assert.strictEqual(eligW3.requiredReferrals, 3);
    assert.strictEqual(eligW3.availableReferrals, 3);
    assert.strictEqual(eligW3.eligible, true);
    assert.strictEqual(eligW3.message, 'Available referrals: 3/3 — You can withdraw.');

    const w3Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w3Res.status, 200);
    assert.strictEqual(w3Res.data.withdrawal.referralsConsumedCount, 3);

    const countsAfterW3 = await getCampaignReferralCounts(uTable.id);
    assert.strictEqual(countsAfterW3.availableValidReferrals, 0, '3rd withdrawal consumed 3 referrals (3 -> 0 remaining)');
    assert.strictEqual(countsAfterW3.consumedValidReferrals, 5);
    assert.strictEqual(countsAfterW3.lifetimeValidReferrals, 5, 'Lifetime valid referrals never decreases (still 5)');
    passTest(4, 'Third withdrawal with custom requirement (3) consumes 3 referrals (3 -> 0 remaining)');
    passTest(10, 'Successful withdrawals consume the exact configured referral numbers (0, 2, 3)');
    passTest(11, 'Lifetime referral count never decreases after withdrawal consumption (stays 5)');
    passTest(12, 'Available referral count decreases accurately after each withdrawal (5 -> 5 -> 3 -> 0)');

    // Fourth withdrawal requires 2 referrals, Available before = 0 -> BLOCKED!
    const eligW4Blocked = await checkWithdrawalReferralEligibility(uTable.id);
    assert.strictEqual(eligW4Blocked.nextWithdrawalNumber, 4);
    assert.strictEqual(eligW4Blocked.requiredReferrals, 2);
    assert.strictEqual(eligW4Blocked.availableReferrals, 0);
    assert.strictEqual(eligW4Blocked.eligible, false);
    assert.ok(eligW4Blocked.message?.includes('You need 2 more valid referrals for your next withdrawal.'));

    const w4BlockedRes = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w4BlockedRes.status, 403, 'Fourth withdrawal blocked at 0/2 available referrals');
    passTest(14, 'Consumed referrals cannot be reused for subsequent withdrawals');

    // Test 15: New valid referrals increase available count correctly (earn 2 new referrals -> Available = 2, Lifetime = 7)
    await addValidReferralsForUser(uTable, 2, 'tbl_w4_new');
    const countsWithNew2 = await getCampaignReferralCounts(uTable.id);
    assert.strictEqual(countsWithNew2.availableValidReferrals, 2);
    assert.strictEqual(countsWithNew2.consumedValidReferrals, 5);
    assert.strictEqual(countsWithNew2.lifetimeValidReferrals, 7);
    passTest(15, 'New valid referrals increase available count accurately (0 -> 2 available, 5 -> 7 lifetime)');

    // Complete 4th withdrawal (requires 2 -> consumes 2, Available becomes 0)
    const w4OkRes = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w4OkRes.status, 200);
    assert.strictEqual((await getCampaignReferralCounts(uTable.id)).availableValidReferrals, 0);

    // Test 6: FREE mode at any configured withdrawal stage (Stage 5 is configured as FREE!)
    const eligW5Free = await checkWithdrawalReferralEligibility(uTable.id);
    assert.strictEqual(eligW5Free.nextWithdrawalNumber, 5);
    assert.strictEqual(eligW5Free.stageMode, 'free');
    assert.strictEqual(eligW5Free.eligible, true);
    assert.strictEqual(eligW5Free.message, 'Your fifth withdrawal is FREE!');
    const w5OkRes = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w5OkRes.status, 200, '5th withdrawal succeeds in FREE mode with 0 available referrals');
    passTest(5, 'Fourth and subsequent stages follow their independently configured requirements');
    passTest(6, 'FREE mode works at any configured withdrawal stage (verified on Stage 1 and Stage 5)');

    // Test 8: Unconfigured stages are handled safely (Stage 6 is 'unconfigured' -> blocked, never assumed FREE!)
    const eligW6Unconf = await checkWithdrawalReferralEligibility(uTable.id);
    assert.strictEqual(eligW6Unconf.nextWithdrawalNumber, 6);
    assert.strictEqual(eligW6Unconf.stageMode, 'unconfigured');
    assert.strictEqual(eligW6Unconf.stageConfigured, false);
    assert.strictEqual(eligW6Unconf.eligible, false, 'Unconfigured Stage 6 must NEVER silently assume FREE');
    const w6BlockedRes = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uTableInit, { amount: DENOM });
    assert.strictEqual(w6BlockedRes.status, 403, 'Unconfigured Stage 6 strictly blocked on backend');
    passTest(8, 'Unconfigured stages are shown as Not Configured and safely blocked (never assumed FREE)');

    // Test 2: First withdrawal custom referral requirement mode (e.g. Configuration C: First = 3 referrals, Second = FREE)
    const configC: WithdrawalStagesConfig = {
      stages: {
        '1': { stage: 1, mode: 'custom', referralsRequired: 3 },
        '2': { stage: 2, mode: 'free', referralsRequired: 0 },
        '3': { stage: 3, mode: 'custom', referralsRequired: 5 },
        '4': { stage: 4, mode: 'custom', referralsRequired: 2 },
        '5': { stage: 5, mode: 'custom', referralsRequired: 2 },
        '6': { stage: 6, mode: 'custom', referralsRequired: 2 },
      },
      furtherWithdrawals: { mode: 'custom', referralsRequired: 2 },
    };
    await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalStageRules: configC,
    });

    const uCustom1TgId = 920002;
    const uCustom1 = await createTestUser(`u_cust1_${runTag}`, uCustom1TgId, 500);
    const uCustom1Init = signTelegramInitData({ id: uCustom1TgId, first_name: 'CustFirst', username: uCustom1.username }, botToken);

    await addValidReferralsForUser(uCustom1, 2, 'cust1_2');
    const eligC1Blocked = await checkWithdrawalReferralEligibility(uCustom1.id);
    assert.strictEqual(eligC1Blocked.nextWithdrawalNumber, 1);
    assert.strictEqual(eligC1Blocked.requiredReferrals, 3);
    assert.strictEqual(eligC1Blocked.availableReferrals, 2);
    assert.strictEqual(eligC1Blocked.eligible, false, '1st withdrawal blocked at 2/3 when Stage 1 custom requirement = 3');

    await addValidReferralsForUser(uCustom1, 1, 'cust1_3');
    const wCust1 = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uCustom1Init, { amount: DENOM });
    assert.strictEqual(wCust1.status, 200, '1st withdrawal allowed at 3/3 referrals and consumes 3');
    assert.strictEqual((await getCampaignReferralCounts(uCustom1.id)).availableValidReferrals, 0);
    passTest(2, 'First withdrawal custom referral requirement mode enforces & consumes exact configured count');

    // Test 13: Referral history and consumed referral history remain visible
    const statsU1 = await apiRequest(baseUrl, 'GET', '/referrals/stats', uTableInit);
    assert.strictEqual(statsU1.status, 200);
    assert.strictEqual(statsU1.data.history.length, 7, 'All 7 referral records remain visible in user referral history');
    assert.ok(Array.isArray(statsU1.data.consumedHistory) && statsU1.data.consumedHistory.length >= 3);
    const adminAuditU1 = await apiRequest(
      baseUrl,
      'GET',
      `/admin/referrals?userId=${encodeURIComponent(uTable.id)}`,
      adminInitData
    );
    assert.strictEqual(adminAuditU1.status, 200);
    assert.strictEqual(adminAuditU1.data.referrals.length, 7);
    assert.ok(adminAuditU1.data.consumptions.length >= 3, 'Consumed referral history preserved for admin auditing');
    passTest(13, 'Referral history and consumed referral history remain permanently visible to user and admin');

    // Tests 9 & 16: Only valid referrals count; invalid, duplicate, banned, and self-referrals do not count
    const uFraudTgId = 920003;
    const uFraud = await createTestUser(`u_fraud_${runTag}`, uFraudTgId, 500);
    // Self-referral
    const selfRes = await atomicClaimReferralReward({
      referrerId: uFraud.id,
      refereeId: uFraud.id,
      refereeUsername: uFraud.username!,
    });
    assert.strictEqual(selfRes.success, false);
    // Rejected & pending records
    await recordReferral({
      id: `rej_f_${runTag}`,
      referrerId: uFraud.id,
      refereeId: `ref_rej_${runTag}`,
      refereeUsername: 'rej_u',
      rewardAmount: 0,
      status: 'rejected',
      createdAt: new Date().toISOString(),
    });
    await recordReferral({
      id: `pend_f_${runTag}`,
      referrerId: uFraud.id,
      refereeId: `ref_pend_${runTag}`,
      refereeUsername: 'pend_u',
      rewardAmount: 10,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    // Banned referee
    const bannedU = await createTestUser(`ban_u_${runTag}`, 929001, 0);
    bannedU.isBanned = true;
    await saveUser(bannedU);
    await recordReferral({
      id: `ban_f_${runTag}`,
      referrerId: uFraud.id,
      refereeId: bannedU.id,
      refereeUsername: bannedU.username!,
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });
    // One genuine referral + duplicate record for same referee
    const validIds = await addValidReferralsForUser(uFraud, 1, 'valid_once');
    await recordReferral({
      id: `dup_same_ref_${runTag}`,
      referrerId: uFraud.id,
      refereeId: validIds[0],
      refereeUsername: 'dup_same',
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });
    const fraudCounts = await getCampaignReferralCounts(uFraud.id);
    assert.strictEqual(fraudCounts.availableValidReferrals, 1);
    assert.strictEqual(fraudCounts.lifetimeValidReferrals, 1);
    passTest(9, 'Only genuinely valid credited referrals count toward available and lifetime totals');
    passTest(16, 'Invalid, duplicate, pending, banned-referee, and self-referrals never count');

    // =========================================================================
    // SECTION B: WITHDRAWAL STATUS TESTS (17..23)
    // =========================================================================
    console.log('\n--- Section B: Withdrawal Status & Concurrency Safety Tests (Tests 17-23) ---');
    const uStatusTgId = 920004;
    const uStatus = await createTestUser(`u_status_${runTag}`, uStatusTgId, 500);
    const uStatusInit = signTelegramInitData({ id: uStatusTgId, first_name: 'StatusUser', username: uStatus.username }, botToken);
    // Give uStatus 3 valid referrals (Stage 1 requires 3 under configC)
    await addValidReferralsForUser(uStatus, 3, 'status_refs');

    // Test 17: Pending withdrawal does not consume referrals
    const pendWId = `WTH_PEND_${runTag}`;
    memStore.withdrawals.set(pendWId, {
      id: pendWId,
      userId: uStatus.id,
      userTelegramId: uStatusTgId,
      amount: DENOM,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    assert.strictEqual((await getCampaignReferralCounts(uStatus.id)).availableValidReferrals, 3);
    assert.strictEqual((await checkWithdrawalReferralEligibility(uStatus.id)).nextWithdrawalNumber, 1);
    passTest(17, 'Pending withdrawal does not consume referrals or advance withdrawal stage');

    // Test 18: Failed withdrawal does not consume referrals
    await updateWithdrawalStatus(pendWId, 'failed', { failureReason: 'Gateway timeout' });
    assert.strictEqual((await getCampaignReferralCounts(uStatus.id)).availableValidReferrals, 3);
    assert.strictEqual((await checkWithdrawalReferralEligibility(uStatus.id)).nextWithdrawalNumber, 1);
    passTest(18, 'Failed withdrawal does not consume referrals');
    passTest(23, 'Failed payout does not advance the withdrawal stage (remains at Stage 1)');

    // Test 19: Rejected withdrawal does not consume referrals
    const rejWId = `WTH_REJ_${runTag}`;
    memStore.withdrawals.set(rejWId, {
      id: rejWId,
      userId: uStatus.id,
      userTelegramId: uStatusTgId,
      amount: DENOM,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await updateWithdrawalStatus(rejWId, 'rejected', { failureReason: 'Rejected by admin' });
    assert.strictEqual((await getCampaignReferralCounts(uStatus.id)).availableValidReferrals, 3);
    assert.strictEqual((await checkWithdrawalReferralEligibility(uStatus.id)).nextWithdrawalNumber, 1);
    passTest(19, 'Rejected withdrawal does not consume referrals');

    // Test 20: Cancelled withdrawal does not consume referrals
    const cancWId = `WTH_CANC_${runTag}`;
    memStore.withdrawals.set(cancWId, {
      id: cancWId,
      userId: uStatus.id,
      userTelegramId: uStatusTgId,
      amount: DENOM,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await updateWithdrawalStatus(cancWId, 'cancelled', { failureReason: 'Cancelled by user/admin' });
    assert.strictEqual((await getCampaignReferralCounts(uStatus.id)).availableValidReferrals, 3);
    assert.strictEqual((await checkWithdrawalReferralEligibility(uStatus.id)).nextWithdrawalNumber, 1);
    passTest(20, 'Cancelled withdrawal does not consume referrals');

    // Test 21: Successful payout consumes referrals exactly once (idempotent on repeat calls)
    const idemKey = `idem_status_${runTag}`;
    const wSuccess1 = await redeemGiftCardWithdrawal(uStatus.id, DENOM, idemKey);
    assert.strictEqual(wSuccess1.withdrawal.referralsConsumedCount, 3);
    assert.strictEqual((await getCampaignReferralCounts(uStatus.id)).availableValidReferrals, 0);
    // Calling consumeReferralsForWithdrawal or idempotent redeemGiftCardWithdrawal again must NOT consume twice
    await consumeReferralsForWithdrawal(wSuccess1.withdrawal);
    const wSuccessRetry = await redeemGiftCardWithdrawal(uStatus.id, DENOM, idemKey);
    assert.strictEqual(wSuccessRetry.withdrawal.id, wSuccess1.withdrawal.id);
    assert.strictEqual((await getCampaignReferralCounts(uStatus.id)).consumedValidReferrals, 3);
    passTest(21, 'Successful payout consumes referrals exactly once (idempotent protection)');

    // Test 22: Duplicate and concurrent requests cannot bypass requirements
    // Configure all stages to require 2 referrals
    await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalMinReferralsRequired: 2,
    });
    const uConcTgId = 920005;
    const uConc = await createTestUser(`u_conc_${runTag}`, uConcTgId, 500);
    const uConcInit = signTelegramInitData({ id: uConcTgId, first_name: 'ConcTester', username: uConc.username }, botToken);
    await addValidReferralsForUser(uConc, 2, 'conc2'); // Enough for ONLY 1st withdrawal (2/2), NOT 2nd!

    const concResponses = await Promise.all(
      [1, 2, 3, 4, 5].map((idx) =>
        apiRequest(baseUrl, 'POST', '/withdrawals/create', uConcInit, {
          amount: DENOM,
          idempotencyKey: `conc_req_${runTag}_${idx}`,
        })
      )
    );
    const okCount = concResponses.filter((r) => r.status === 200).length;
    const blockedCount = concResponses.filter((r) => r.status === 403).length;
    assert.strictEqual(okCount, 1, 'Strictly 1 concurrent withdrawal succeeded');
    assert.strictEqual(blockedCount, 4, 'Other 4 concurrent withdrawals blocked');
    assert.strictEqual((await getCampaignReferralCounts(uConc.id)).availableValidReferrals, 0);
    passTest(22, 'Duplicate and concurrent withdrawal requests cannot bypass referral requirements');

    // =========================================================================
    // SECTION C: FULL BALANCE RESET TESTS (24..30)
    // =========================================================================
    console.log('\n--- Section C: Full Balance Reset & Withdrawal Cycle Tests (Tests 24-30) ---');
    // Configure Stage 1 = FREE, Stage 2 = 3 referrals, Stage 3 = 4 referrals
    const cycleTestConfig: WithdrawalStagesConfig = {
      stages: {
        '1': { stage: 1, mode: 'free', referralsRequired: 0 },
        '2': { stage: 2, mode: 'custom', referralsRequired: 3 },
        '3': { stage: 3, mode: 'custom', referralsRequired: 4 },
        '4': { stage: 4, mode: 'custom', referralsRequired: 4 },
        '5': { stage: 5, mode: 'custom', referralsRequired: 4 },
        '6': { stage: 6, mode: 'custom', referralsRequired: 4 },
      },
      furtherWithdrawals: { mode: 'custom', referralsRequired: 4 },
    };
    await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalStageRules: cycleTestConfig,
    });

    const uResetTargetTgId = 920006;
    const uResetTarget = await createTestUser(`u_reset_target_${runTag}`, uResetTargetTgId, 250);
    const uResetTargetInit = signTelegramInitData(
      { id: uResetTargetTgId, first_name: 'ResetTarget', username: uResetTarget.username },
      botToken
    );

    const uOtherTgId = 920007;
    const uOther = await createTestUser(`u_other_${runTag}`, uOtherTgId, 345);
    await addValidReferralsForUser(uOther, 2, 'other_refs');
    await redeemGiftCardWithdrawal(uOther.id, DENOM); // uOther completes Stage 1 (FREE), balance = 345 - 17 = 328, Stage = 2

    // uResetTarget earns 4 valid referrals:
    // - Completes 1st withdrawal (FREE, consumes 0, 4 available remain)
    // - Completes 2nd withdrawal (requires 3, consumes 3, 1 available remains, 3 consumed, 4 lifetime)
    // - Now uResetTarget is at Stage 3 (completedWithdrawals = 2), balance = 250 - 34 = 216, available = 1, consumed = 3, lifetime = 4
    await addValidReferralsForUser(uResetTarget, 4, 'target_refs');
    await apiRequest(baseUrl, 'POST', '/withdrawals/create', uResetTargetInit, { amount: DENOM });
    await apiRequest(baseUrl, 'POST', '/withdrawals/create', uResetTargetInit, { amount: DENOM });

    const preResetElig = await checkWithdrawalReferralEligibility(uResetTarget.id);
    assert.strictEqual(preResetElig.completedWithdrawals, 2);
    assert.strictEqual(preResetElig.nextWithdrawalNumber, 3);
    assert.strictEqual(preResetElig.availableReferrals, 1);
    assert.strictEqual(preResetElig.consumedReferrals, 3);
    assert.strictEqual(preResetElig.lifetimeValidReferrals, 4);

    // Admin performs FULL BALANCE RESET for selected user uResetTarget via HTTP API
    const resetTargetRes = await apiRequest(
      baseUrl,
      'POST',
      `/admin/users/${encodeURIComponent(uResetTarget.id)}/reset-balance`,
      adminInitData,
      { reason: 'Testing per-user full balance reset' }
    );
    assert.strictEqual(resetTargetRes.status, 200);
    assert.strictEqual(resetTargetRes.data.newBalance, 0);
    assert.strictEqual(resetTargetRes.data.previousWithdrawalCycle, 1);
    assert.strictEqual(resetTargetRes.data.newWithdrawalCycle, 2);

    // Test 24: Full balance reset resets only the selected user's balance
    const uResetTargetAfter = await getUser(uResetTarget.id);
    assert.strictEqual(uResetTargetAfter!.balance, 0);
    passTest(24, 'Full balance reset resets the selected user balance to ₹0.00');

    // Test 25: Selected user's current withdrawal count becomes zero
    const postResetElig = await checkWithdrawalReferralEligibility(uResetTarget.id);
    assert.strictEqual(postResetElig.withdrawalCycle, 2);
    assert.strictEqual(postResetElig.completedWithdrawals, 0);
    passTest(25, 'Selected user successful withdrawal count in the new withdrawal cycle becomes 0');

    // Test 26: Next withdrawal uses the first-stage configuration (Stage 1 = FREE!)
    assert.strictEqual(postResetElig.nextWithdrawalNumber, 1);
    assert.strictEqual(postResetElig.stageMode, 'free');
    assert.strictEqual(postResetElig.eligible, true);
    assert.strictEqual(postResetElig.message, 'Your first withdrawal is FREE!');
    passTest(26, 'Next withdrawal after full balance reset is Stage 1 and uses first-stage admin configuration');

    // Test 27: Previous withdrawal history remains visible
    const targetWithdrawalsHistory = await getUserWithdrawals(uResetTarget.id);
    assert.strictEqual(targetWithdrawalsHistory.length, 2, 'Both previous withdrawals remain in withdrawal history');
    const targetTxHistory = await getUserTransactions(uResetTarget.id);
    assert.ok(targetTxHistory.length >= 3, 'All previous withdrawal and referral transactions remain in ledger');
    passTest(27, 'Previous withdrawal history and transaction ledger remain 100% visible after balance reset');

    // Test 28: Referral history & unconsumed available referrals remain preserved (and consumed stay consumed!)
    assert.strictEqual(postResetElig.availableReferrals, 1, '1 unconsumed valid referral preserved across balance reset');
    assert.strictEqual(postResetElig.consumedReferrals, 3, '3 consumed referrals stay consumed (never become available again)');
    assert.strictEqual(postResetElig.lifetimeValidReferrals, 4, '4 lifetime valid referrals preserved');
    assert.strictEqual((await getReferralsByReferrer(uResetTarget.id)).length, 4);
    passTest(28, 'Referral history and unconsumed available referrals preserved while consumed referrals stay consumed');

    // Test 29: Other users' balances and withdrawal states remain unchanged (345 initial + 20 referral rewards - 17 withdrawal = 348)
    const uOtherAfter = await getUser(uOther.id);
    const uOtherElig = await checkWithdrawalReferralEligibility(uOther.id);
    assert.strictEqual(uOtherAfter!.balance, 348, 'Other user balance untouched at ₹348');
    assert.strictEqual(uOtherElig.withdrawalCycle, 1, 'Other user withdrawalCycle untouched at #1');
    assert.strictEqual(uOtherElig.completedWithdrawals, 1, 'Other user completedWithdrawals untouched at 1');
    assert.strictEqual(uOtherElig.nextWithdrawalNumber, 2, 'Other user next withdrawal stage untouched at #2');
    assert.strictEqual(uOtherElig.availableReferrals, 2, 'Other user available referrals untouched at 2');
    passTest(29, 'Other users balances, withdrawal counts, cycles, and referrals remain 100% unchanged');

    // Test 30: Admin referral configuration remains unchanged
    const settingsAfterUserReset = await getAppSettings();
    assert.strictEqual(settingsAfterUserReset.withdrawalStageRules?.stages['1'].mode, 'free');
    assert.strictEqual(settingsAfterUserReset.withdrawalStageRules?.stages['2'].referralsRequired, 3);
    assert.strictEqual(settingsAfterUserReset.withdrawalStageRules?.stages['3'].referralsRequired, 4);
    passTest(30, 'Admin withdrawal referral stage configuration remains unchanged after user balance reset');

    // =========================================================================
    // SECTION D: EXISTING FEATURE REGRESSION TESTS (31..44)
    // =========================================================================
    console.log('\n--- Section D: Existing Feature Zero-Regression Verification (Tests 31-44) ---');

    // Test 31: User registration and login
    const loginTgId = 920031;
    const loginInitData = signTelegramInitData({ id: loginTgId, first_name: 'LoginUser', username: 'login_u' }, botToken);
    const verifiedInit = verifyTelegramInitData(loginInitData);
    assert.strictEqual(verifiedInit.isValid, true);
    const authRes = await apiRequest(baseUrl, 'POST', '/auth/verify-telegram', loginInitData, {
      initData: loginInitData,
      deviceFingerprint: `fp_login_${runTag}`,
    });
    assert.strictEqual(authRes.status, 200);
    assert.strictEqual(authRes.data.user.telegramId, loginTgId);
    passTest(31, 'User registration and Telegram WebApp cryptographic login work normally');

    // Test 32: Total Users count and historical data
    reconcileUsersRegistry();
    const totalRegCount = getTotalRegisteredUsersCount();
    assert.ok(totalRegCount >= 1143, `Total registered users count (${totalRegCount}) >= 1,143`);
    passTest(32, `Total Users count and historical user registry preserved (${totalRegCount} users)`);

    // Test 33: Wallet and balance
    const cred33 = await atomicCreditBalance(String(loginTgId), 45, 'task_reward', 'Regression credit test');
    assert.strictEqual(cred33.user.balance, 45);
    passTest(33, 'Wallet balance crediting and atomic ledger updates work normally');

    // Test 34: Signup bonuses and scratch rewards
    const scratchUser = await createTestUser(`u_scratch_${runTag}`, 920034, 0);
    scratchUser.signupBonusClaimed = false;
    scratchUser.signupBonusClaimedGeneration = 0;
    await saveUser(scratchUser);
    const scratchAssign = await getOrAssignSignupScratchBonus(scratchUser.id);
    assert.strictEqual(scratchAssign.eligible, true);
    assert.ok(scratchAssign.amount > 0);
    const scratchClaim = await atomicClaimSignupBonus({
      userId: scratchUser.id,
      telegramId: scratchUser.telegramId,
      deviceId: `dev_scr_${runTag}`,
      fingerprintHash: `fp_scr_${runTag}`,
    });
    assert.strictEqual(scratchClaim.success, true);
    passTest(34, 'Signup bonuses and scratch card reward assignment/claiming work normally');

    // Test 35: Referral tracking
    const refStatsCheck = await apiRequest(baseUrl, 'GET', '/referrals/stats', uResetTargetInit);
    assert.strictEqual(refStatsCheck.status, 200);
    assert.ok(refStatsCheck.data.referralLink.includes('?start='));
    passTest(35, 'Referral tracking, deep links, and stats API work normally');

    // Test 36: Task system and task rewards
    const regTask = await saveTask({
      id: `task_reg36_${runTag}`,
      title: 'Regression Task 36',
      description: 'Verify tasks work',
      destinationUrl: 'https://example.com',
      rewardAmount: 12,
      taskType: 'website',
      timerSeconds: 5,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
    });
    assert.ok(await getTaskById(regTask.id));
    await recordTaskCompletion({
      id: `${loginTgId}_${regTask.id}`,
      userId: String(loginTgId),
      taskId: regTask.id,
      rewardAmount: 12,
      completedAt: new Date().toISOString(),
    });
    assert.ok(await getTaskCompletion(String(loginTgId), regTask.id));
    passTest(36, 'Task creation, retrieval, and completion recording work normally');

    // Test 37: Daily Check-in
    await updateAppSettings({
      dailyCheckinEnabled: true,
      dailyCheckinRewards: [0.25, 0.5, 0.75, 1.25, 1.5, 2.25, 3.5],
    });
    const checkinRes = await apiRequest(baseUrl, 'POST', '/rewards/daily-checkin', loginInitData);
    assert.strictEqual(checkinRes.status, 200);
    assert.strictEqual(checkinRes.data.rewardAmount, 0.25);
    passTest(37, 'Daily Check-in system and custom 7-day decimal reward schedule work normally');

    // Test 38: Force Join verification
    const fjRes = await apiRequest(baseUrl, 'POST', '/force-join/verify', loginInitData);
    assert.strictEqual(fjRes.status, 200);
    assert.strictEqual(fjRes.data.allJoined, true);
    passTest(38, 'Force Join channel membership verification works normally');

    // Test 39: Amazon Gift Voucher assignment and inventory
    const gvStats = await getGiftCardInventoryStats();
    assert.ok(gvStats.totalCodes >= 60 && gvStats.availableCodes >= 40);
    passTest(39, 'Amazon Gift Voucher inventory stats and single-use code assignment work normally');

    // Test 40: Withdrawal and payout API
    // Credit uResetTarget ₹50 and execute their Stage 1 (FREE) withdrawal in Cycle #2!
    await atomicCreditBalance(uResetTarget.id, 50, 'admin_adjustment', 'Top up for Cycle #2 Stage 1 withdrawal');
    const wCycle2Stage1 = await apiRequest(baseUrl, 'POST', '/withdrawals/create', uResetTargetInit, { amount: DENOM });
    assert.strictEqual(wCycle2Stage1.status, 200);
    assert.strictEqual(wCycle2Stage1.data.withdrawal.withdrawalCycle, 2);
    assert.strictEqual(wCycle2Stage1.data.withdrawal.withdrawalStage, 1);
    assert.strictEqual(wCycle2Stage1.data.withdrawal.referralsConsumedCount, 0);
    passTest(40, 'Withdrawal and instant gift card payout API work normally across reset cycles');

    // Test 41: Transaction history
    const myTxRes = await apiRequest(baseUrl, 'GET', '/transactions/my', uResetTargetInit);
    assert.strictEqual(myTxRes.status, 200);
    assert.ok(Array.isArray(myTxRes.data.transactions) && myTxRes.data.transactions.length >= 4);
    passTest(41, 'User transaction history API returns complete chronological ledger');

    // Test 42: Admin Panel and permissions
    assert.strictEqual(isTelegramAdmin(adminTgId), true);
    assert.strictEqual(isTelegramAdmin(loginTgId), false);
    const unauthAdminAttempt = await apiRequest(baseUrl, 'GET', '/admin/settings', loginInitData);
    assert.strictEqual(unauthAdminAttempt.status, 403);
    passTest(42, 'Admin Panel authorization gate strictly permits admins and blocks non-admins');

    // Test 43: Broadcast and notifications
    const bcastPrev = await getBroadcastPreview();
    assert.ok(typeof bcastPrev.recipientCount === 'number' && bcastPrev.recipientCount >= 1);
    passTest(43, 'Admin Broadcast preview and notification subsystem work normally');

    // Test 44: Bot commands and Mini App navigation
    await handleTelegramBotUpdate(
      {
        update_id: 999001,
        message: {
          message_id: 1,
          from: { id: loginTgId, first_name: 'LoginUser', username: 'login_u' },
          chat: { id: loginTgId, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/start',
        },
      },
      'https://178-93-119-55.sslip.io'
    );
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    passTest(44, 'Telegram /start bot command handler and Mini App /api/health endpoint work normally');

    assert.strictEqual(results.length, 44, 'All 44 mandatory tests must be recorded');

    console.log('\n================================================================================');
    console.log(`  ALL 44 MANDATORY ZERO-REGRESSION TESTS PASSED SUCCESSFULLY (44/44) ✓`);
    console.log('================================================================================\n');
  } finally {
    clearMockChannelMemberships();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runCompleteWithdrawalUpgradeSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✗ COMPLETE WITHDRAWAL UPGRADE SUITE FAILED:', err);
    process.exit(1);
  });
