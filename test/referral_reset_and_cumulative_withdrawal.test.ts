import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

// Ensure isolated test mode so authoritative disk files in data/ are never mutated
process.env.NODE_ENV = 'test';
if (!process.env.DB_PREFIX) {
  process.env.DB_PREFIX = 'test_ref_upgrade_suite';
}
process.env.TELEGRAM_BOT_TOKEN = '1234567890:AAHTestTokenForAutomatedVerificationOnly99';
process.env.ADMIN_TELEGRAM_IDS = '777000999';

import {
  memStore,
  getUser,
  saveUser,
  getAppSettings,
  updateAppSettings,
  recordReferral,
  atomicClaimReferralReward,
  getReferralsByReferrer,
  getAllReferrals,
  getCampaignReferralCounts,
  getValidReferralCount,
  getCompletedWithdrawals,
  checkWithdrawalReferralEligibility,
  redeemGiftCardWithdrawal,
  updateWithdrawalStatus,
  addGiftCardCodes,
  getGiftCardInventoryStats,
  getBulkBalanceResetPreview,
  atomicResetAllUserBalances,
  saveTask,
  getTaskById,
  recordTaskCompletion,
  getTaskCompletion,
  getUserTransactions,
  getUserWithdrawals,
  getDailyCheckinCycleRewards,
  getCurrentReferralCampaignId,
  getRecordCampaignId,
} from '../server/db.ts';
import { apiRouter } from '../server/apiRouter.ts';
import { setMockChannelMembership, clearMockChannelMemberships } from '../server/telegram.ts';
import type { UserProfile } from '../src/types/index.ts';

let passed = 0;
function pass(label: string) {
  passed++;
  console.log(`  ✓ PASS [${passed}]: ${label}`);
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
    dailyStreak: 3,
    lastCheckinAt: now,
    isBanned: false,
    signupBonusClaimed: true,
    createdAt: now,
    updatedAt: now,
  };
  return await saveUser(user);
}

async function runMandatorySuite() {
  console.log('\n================================================================================');
  console.log('  MANDATORY 13-SCENARIO SUITE: REFERRAL RESET + CUMULATIVE WITHDRAWAL RULE');
  console.log('================================================================================\n');

  const runTag = Date.now().toString(36).toUpperCase();
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;

  clearMockChannelMemberships();
  setMockChannelMembership('*', { isMember: true, status: 'member' });

  // Start ephemeral Express server to verify direct HTTP API behavior & anti-bypass controls
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api`;

  try {
    // Seed admin user
    const adminTgId = 777000999;
    const adminUser = await createTestUser('777000999', adminTgId, 0);
    const adminInitData = signTelegramInitData(
      { id: adminTgId, first_name: 'SysAdmin', username: 'sysadmin' },
      botToken
    );

    // Seed dedicated test gift card codes of denomination ₹13 (isolated from other tests)
    const DENOM = 13;
    const gcBatch = Array.from({ length: 40 }, (_, i) => `AMZN-M13-${runTag}-${String(i + 1).padStart(3, '0')}`);
    const addedGc = await addGiftCardCodes(gcBatch, DENOM, adminUser.id);
    assert.strictEqual(addedGc.added, 40, 'Seeded 40 isolated gift card codes');

    // Baseline settings: Campaign #1, R = 3, minWithdrawalAmount = 13
    await updateAppSettings({
      minWithdrawalAmount: DENOM,
      maxWithdrawalAmount: 5000,
      dailyWithdrawalLimitEnabled: false,
      referralReward: 10,
      withdrawalReferralRequirementEnabled: true,
      withdrawalMinReferralsRequired: 3,
      referralCampaignId: 1,
      resetGeneration: 1,
      dailyCheckinEnabled: true,
      dailyCheckinRewards: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 5.0],
    });

    // =========================================================================
    // SCENARIOS 5, 6, 7, 8 (PART A): Full 3-Referral Example (0..9 Table)
    // =========================================================================
    console.log('--- Scenarios 5, 6, 7, 8 (Part A): Full 3-Referral Cumulative Example (R = 3, V = 0..9) ---');
    const u3TgId = 910001;
    const u3 = await createTestUser(`u3_${runTag}`, u3TgId, 500);
    const u3InitData = signTelegramInitData({ id: u3TgId, first_name: 'ThreeRefUser', username: u3.username }, botToken);

    const addValidReferrals = async (referrer: UserProfile, count: number, labelPrefix: string) => {
      const createdIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const idx = `${labelPrefix}_${i + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const refereeId = `referee_${idx}`;
        await createTestUser(refereeId, Math.floor(2000000 + Math.random() * 7000000), 10);
        const claim = await atomicClaimReferralReward({
          referrerId: referrer.id,
          refereeId,
          refereeUsername: `friend_${idx}`,
          refereeDeviceId: `dev_${idx}`,
          refereeFingerprintHash: `fp_${idx}`,
        });
        assert.strictEqual(claim.success, true, `Referral ${idx} must be genuinely credited`);
        createdIds.push(refereeId);
      }
      return createdIds;
    };

    // V = 0, 1, 2 -> First withdrawal NOT allowed
    for (const vExpected of [0, 1, 2]) {
      if (vExpected > 0) {
        await addValidReferrals(u3, 1, `c1_step_${vExpected}`);
      }
      const elig = await checkWithdrawalReferralEligibility(u3.id);
      assert.strictEqual(elig.currentReferrals, vExpected);
      assert.strictEqual(elig.requiredReferrals, 3);
      assert.strictEqual(elig.eligible, false, `V=${vExpected} must block 1st withdrawal`);

      // Direct HTTP API attempt must also return 403
      const httpAttempt = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
      assert.strictEqual(httpAttempt.status, 403, `Direct API withdrawal blocked at V=${vExpected}`);
      assert.strictEqual(httpAttempt.data.referralRequirementFailed, true);
    }
    pass('R=3: Withdrawals strictly blocked at 0, 1, and 2 valid referrals (DB + HTTP API)');

    // V = 3 -> First withdrawal ALLOWED (Scenario 5)
    const c1ThirdRefIds = await addValidReferrals(u3, 1, 'c1_step_3');
    const eligAt3 = await checkWithdrawalReferralEligibility(u3.id);
    assert.strictEqual(eligAt3.currentReferrals, 3);
    assert.strictEqual(eligAt3.requiredReferrals, 3);
    assert.strictEqual(eligAt3.eligible, true);
    assert.ok(eligAt3.message?.includes('First withdrawal: 3/3 valid referrals'));

    const w1Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
    assert.strictEqual(w1Res.status, 200, 'First withdrawal succeeds at 3/3 referrals');
    assert.strictEqual(w1Res.data.withdrawal.status, 'success');
    pass('Scenario 5 — R=3: First withdrawal allowed at exactly 3/3 valid referrals');

    // After 1st withdrawal (W=1): V = 3, 4, 5 -> Second withdrawal BLOCKED (Scenario 6)
    for (const vExpected of [3, 4, 5]) {
      if (vExpected > 3) {
        await addValidReferrals(u3, 1, `c1_step_${vExpected}`);
      }
      const elig = await checkWithdrawalReferralEligibility(u3.id);
      assert.strictEqual(elig.completedWithdrawals, 1);
      assert.strictEqual(elig.currentReferrals, vExpected);
      assert.strictEqual(elig.requiredReferrals, 6, 'Second withdrawal must require (1+1)*3 = 6');
      assert.strictEqual(elig.eligible, false, `Second withdrawal must be locked at ${vExpected}/6`);
      assert.ok(elig.message?.includes(`Second withdrawal: ${vExpected}/6 valid referrals`));

      const blockedRes = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
      assert.strictEqual(blockedRes.status, 403, `Second withdrawal blocked at ${vExpected}/6`);
    }
    pass('Scenario 6 — R=3: Second withdrawal blocked at 3/6, 4/6, and 5/6 valid referrals');

    // V = 6 -> Second withdrawal ALLOWED (Scenario 7)
    await addValidReferrals(u3, 1, 'c1_step_6');
    const eligAt6 = await checkWithdrawalReferralEligibility(u3.id);
    assert.strictEqual(eligAt6.currentReferrals, 6);
    assert.strictEqual(eligAt6.requiredReferrals, 6);
    assert.strictEqual(eligAt6.eligible, true);

    const w2Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
    assert.strictEqual(w2Res.status, 200, 'Second withdrawal succeeds at 6/6 referrals');
    pass('Scenario 7 — R=3: Second withdrawal allowed at 6/6 valid referrals');

    // V = 7, 8 -> Third withdrawal BLOCKED; V = 9 -> Third withdrawal ALLOWED (Scenario 8)
    for (const vExpected of [6, 7, 8]) {
      if (vExpected > 6) {
        await addValidReferrals(u3, 1, `c1_step_${vExpected}`);
      }
      const elig = await checkWithdrawalReferralEligibility(u3.id);
      assert.strictEqual(elig.completedWithdrawals, 2);
      assert.strictEqual(elig.currentReferrals, vExpected);
      assert.strictEqual(elig.requiredReferrals, 9, 'Third withdrawal must require (2+1)*3 = 9');
      assert.strictEqual(elig.eligible, false, `Third withdrawal blocked at ${vExpected}/9`);

      const blockedRes = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
      assert.strictEqual(blockedRes.status, 403);
    }

    await addValidReferrals(u3, 1, 'c1_step_9');
    const eligAt9 = await checkWithdrawalReferralEligibility(u3.id);
    assert.strictEqual(eligAt9.currentReferrals, 9);
    assert.strictEqual(eligAt9.requiredReferrals, 9);
    assert.strictEqual(eligAt9.eligible, true);

    const w3Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
    assert.strictEqual(w3Res.status, 200, 'Third withdrawal succeeds at 9/9 referrals');
    pass('Scenario 8 — R=3: Third withdrawal blocked at 7/9 & 8/9 and allowed at 9/9 valid referrals');

    // =========================================================================
    // 2-REFERRAL EXAMPLE VERIFICATION (R = 2 -> 2, 4, 6)
    // =========================================================================
    console.log('\n--- Additional Verification: Full 2-Referral Cumulative Example (R = 2 -> 2, 4, 6) ---');
    const saveR2 = await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalReferralRequirementEnabled: true,
      withdrawalMinReferralsRequired: 2,
    });
    assert.strictEqual(saveR2.status, 200);

    const u2TgId = 910002;
    const u2 = await createTestUser(`u2_${runTag}`, u2TgId, 500);
    const u2InitData = signTelegramInitData({ id: u2TgId, first_name: 'TwoRefUser', username: u2.username }, botToken);

    // 1st requires 2 (blocked at 1, allowed at 2)
    await addValidReferrals(u2, 1, 'r2_1');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).eligible, false);
    await addValidReferrals(u2, 1, 'r2_2');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).requiredReferrals, 2);
    assert.strictEqual((await apiRequest(baseUrl, 'POST', '/withdrawals/create', u2InitData, { amount: DENOM })).status, 200);

    // 2nd requires 4 (blocked at 3, allowed at 4)
    await addValidReferrals(u2, 1, 'r2_3');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).eligible, false);
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).requiredReferrals, 4);
    await addValidReferrals(u2, 1, 'r2_4');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).eligible, true);
    assert.strictEqual((await apiRequest(baseUrl, 'POST', '/withdrawals/create', u2InitData, { amount: DENOM })).status, 200);

    // 3rd requires 6 (blocked at 5, allowed at 6)
    await addValidReferrals(u2, 1, 'r2_5');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).eligible, false);
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).requiredReferrals, 6);
    await addValidReferrals(u2, 1, 'r2_6');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u2.id)).eligible, true);
    assert.strictEqual((await apiRequest(baseUrl, 'POST', '/withdrawals/create', u2InitData, { amount: DENOM })).status, 200);
    pass('R=2 Example Verified: 1st at 2/2, 2nd at 4/4 (blocked at 3/4), 3rd at 6/6 (blocked at 5/6)');

    // Restore R = 3
    await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalMinReferralsRequired: 3,
    });

    // =========================================================================
    // SCENARIOS 1, 2, 3, 4 & FEATURE 3: REFERRAL RESET + HISTORY + MILESTONES
    // =========================================================================
    console.log('\n--- Scenarios 1, 2, 3, 4: Referral Campaign Reset, History Preservation & Milestone Reset ---');
    const u3BeforeReset = await getUser(u3.id);
    const balanceBeforeReferralOnlyReset = u3BeforeReset!.balance;
    const txBeforeReset = await getUserTransactions(u3.id);
    const refTxCountBefore = txBeforeReset.filter((t) => t.type === 'referral_reward').length;
    assert.strictEqual(refTxCountBefore, 9, 'User u3 has 9 referral reward transactions before reset');

    // Preview before reset via Admin API
    const previewRes = await apiRequest(baseUrl, 'GET', '/admin/bulk-balance-reset/preview', adminInitData);
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewRes.data.currentReferralCampaignId, 1);
    assert.strictEqual(previewRes.data.nextReferralCampaignId, 2);
    assert.ok(previewRes.data.activeCampaignValidReferrals >= 15);

    // Wrong confirmation phrase must be rejected
    const badResetRes = await apiRequest(baseUrl, 'POST', '/admin/bulk-balance-reset', adminInitData, {
      confirmPhrase: 'WRONG PHRASE',
      resetBalances: false,
      resetReferrals: true,
    });
    assert.strictEqual(badResetRes.status, 400, 'Reset rejected with wrong confirmation phrase');

    // Execute REFERRAL-ONLY Reset via Admin API (resetBalances: false, resetReferrals: true)
    const resetRes = await apiRequest(baseUrl, 'POST', '/admin/bulk-balance-reset', adminInitData, {
      confirmPhrase: 'RESET REFERRALS',
      resetBalances: false,
      resetReferrals: true,
    });
    assert.strictEqual(resetRes.status, 200, 'Referral-only campaign reset succeeded');
    assert.strictEqual(resetRes.data.resetBalances, false);
    assert.strictEqual(resetRes.data.resetReferrals, true);
    assert.strictEqual(resetRes.data.previousReferralCampaignId, 1);
    assert.strictEqual(resetRes.data.newReferralCampaignId, 2);

    // SCENARIO 1: Current campaign referral count & milestone become 0, balance UNTOUCHED
    const countsAfterReset = await getCampaignReferralCounts(u3.id);
    assert.strictEqual(countsAfterReset.referralCampaignId, 2, 'Active campaign is now #2');
    assert.strictEqual(countsAfterReset.currentCampaignValidReferrals, 0, 'Current campaign referral count reset to 0');
    assert.strictEqual(countsAfterReset.lifetimeValidReferrals, 9, 'Lifetime valid referrals remain 9');

    const eligAfterReset = await checkWithdrawalReferralEligibility(u3.id);
    assert.strictEqual(eligAfterReset.completedWithdrawals, 0, 'Campaign #2 completed withdrawals reset to 0');
    assert.strictEqual(eligAfterReset.lifetimeCompletedWithdrawals, 3, 'Lifetime completed withdrawals remain 3');
    assert.strictEqual(eligAfterReset.currentReferrals, 0);
    assert.strictEqual(eligAfterReset.requiredReferrals, 3, 'New campaign starts milestone tracking from 1st withdrawal (3 referrals), NOT 12!');
    assert.strictEqual(eligAfterReset.eligible, false);

    const u3AfterRefReset = await getUser(u3.id);
    assert.strictEqual(
      u3AfterRefReset!.balance,
      balanceBeforeReferralOnlyReset,
      'User wallet balance strictly UNCHANGED during referral-only reset'
    );
    pass('Scenario 1 — Referral progress & campaign withdrawal milestones reset to 0 while balance remains untouched');

    // SCENARIO 2: Old referral history remains permanently visible in User Stats & Admin Audit
    const userStatsRes = await apiRequest(baseUrl, 'GET', '/referrals/stats', u3InitData);
    assert.strictEqual(userStatsRes.status, 200);
    assert.strictEqual(userStatsRes.data.currentCampaignValidReferrals, 0);
    assert.strictEqual(userStatsRes.data.lifetimeValidReferrals, 9);
    assert.strictEqual(userStatsRes.data.totalReferrals, 9);
    assert.strictEqual(userStatsRes.data.history.length, 9, 'All 9 historical referral records remain visible');
    assert.ok(
      userStatsRes.data.history.every((r: any) => r.referralCampaignId === 1 && r.isCurrentCampaign === false),
      'All old referrals cleanly tagged as Campaign #1 history'
    );

    const adminAuditRes = await apiRequest(
      baseUrl,
      'GET',
      `/admin/referrals?userId=${encodeURIComponent(u3.id)}`,
      adminInitData
    );
    assert.strictEqual(adminAuditRes.status, 200);
    assert.strictEqual(adminAuditRes.data.referrals.length, 9, 'Admin audit endpoint sees all 9 historical referrals');

    const txAfterReset = await getUserTransactions(u3.id);
    assert.strictEqual(
      txAfterReset.filter((t) => t.type === 'referral_reward').length,
      9,
      'All 9 referral reward transactions permanently preserved'
    );
    const wthHistoryAfterReset = await getUserWithdrawals(u3.id);
    assert.strictEqual(wthHistoryAfterReset.length, 3, 'All 3 historical withdrawal records permanently preserved');
    pass('Scenario 2 — All old referral records, timestamps, IDs, transactions, and withdrawals remain visible');

    // SCENARIO 3: Old referrals do NOT count toward new campaign & CANNOT be counted twice
    const oldRefereeId = c1ThirdRefIds[0];
    const reClaimAttempt = await atomicClaimReferralReward({
      referrerId: u3.id,
      refereeId: oldRefereeId,
      refereeUsername: 'old_friend_replay',
      refereeDeviceId: `dev_replay_${runTag}`,
      refereeFingerprintHash: `fp_replay_${runTag}`,
    });
    assert.strictEqual(reClaimAttempt.success, false, 'Re-claiming an old campaign referee after reset MUST be rejected');

    // Even if a duplicate record with old refereeId were somehow inserted in Campaign #2, earliestCampaignByReferee blocks double-counting!
    await recordReferral({
      id: `synthetic_dup_old_ref_${runTag}`,
      referrerId: u3.id,
      refereeId: oldRefereeId,
      refereeUsername: 'old_friend_synthetic',
      rewardAmount: 10,
      status: 'credited',
      referralCampaignId: 2,
      createdAt: new Date().toISOString(),
    });
    const countsAfterReplayCheck = await getCampaignReferralCounts(u3.id);
    assert.strictEqual(
      countsAfterReplayCheck.currentCampaignValidReferrals,
      0,
      'Old referee from Campaign #1 can NEVER count in Campaign #2'
    );
    memStore.referrals.delete(`synthetic_dup_old_ref_${runTag}`);
    pass('Scenario 3 — Old referrals do not count toward Campaign #2 and cannot be counted twice');

    // SCENARIO 4: New valid referrals increase Campaign #2 count independently & unlock Campaign #2 1st withdrawal at 3
    await addValidReferrals(u3, 3, 'c2_fresh');
    const countsInC2 = await getCampaignReferralCounts(u3.id);
    assert.strictEqual(countsInC2.currentCampaignValidReferrals, 3, '3 new referrals counted in Campaign #2');
    assert.strictEqual(countsInC2.lifetimeValidReferrals, 12, 'Lifetime valid referrals is 9 + 3 = 12');

    const eligInC2 = await checkWithdrawalReferralEligibility(u3.id);
    assert.strictEqual(eligInC2.eligible, true, 'First withdrawal in Campaign #2 unlocked at 3 new referrals');
    assert.strictEqual(eligInC2.requiredReferrals, 3);

    const wC2Res = await apiRequest(baseUrl, 'POST', '/withdrawals/create', u3InitData, { amount: DENOM });
    assert.strictEqual(wC2Res.status, 200, 'Campaign #2 first withdrawal succeeds at 3/3 new referrals');
    const eligInC2AfterW1 = await checkWithdrawalReferralEligibility(u3.id);
    assert.strictEqual(eligInC2AfterW1.completedWithdrawals, 1);
    assert.strictEqual(eligInC2AfterW1.requiredReferrals, 6, 'Campaign #2 second withdrawal now requires 6');
    pass('Scenario 4 — New valid referrals advance Campaign #2 independently (3/3 -> 1st withdrawal, next requires 6)');

    // =========================================================================
    // SCENARIO 9: Failed, Rejected, Pending, Processing & Reversed Withdrawals
    // =========================================================================
    console.log('\n--- Scenario 9: Non-Successful Withdrawals Never Advance Milestones ---');
    const u9TgId = 910009;
    const u9 = await createTestUser(`u9_${runTag}`, u9TgId, 500);
    await addValidReferrals(u9, 3, 'u9_refs');

    const activeCamp = getCurrentReferralCampaignId(await getAppSettings());
    const nonSuccessStatuses: Array<'pending' | 'processing' | 'failed' | 'rejected' | 'reversed'> = [
      'pending',
      'processing',
      'failed',
      'rejected',
      'reversed',
    ];
    for (const st of nonSuccessStatuses) {
      const wid = `WTH_NONSUCCESS_${st}_${runTag}`;
      memStore.withdrawals.set(wid, {
        id: wid,
        userId: u9.id,
        userTelegramId: u9TgId,
        amount: DENOM,
        status: st,
        referralCampaignId: activeCamp,
        createdAt: new Date().toISOString(),
      });
    }

    // Also test a withdrawal that transitions to 'reversed' via updateWithdrawalStatus
    const w9Real = await redeemGiftCardWithdrawal(u9.id, DENOM);
    assert.strictEqual((await getCompletedWithdrawals(u9.id, activeCamp)).length, 1);
    await updateWithdrawalStatus(w9Real.withdrawal.id, 'reversed', { failureReason: 'Simulated reversal' });

    const completedAfterReversal = await getCompletedWithdrawals(u9.id, activeCamp);
    assert.strictEqual(completedAfterReversal.length, 0, 'Pending/processing/failed/rejected/reversed withdrawals yield 0 completed');

    const elig9 = await checkWithdrawalReferralEligibility(u9.id);
    assert.strictEqual(elig9.completedWithdrawals, 0);
    assert.strictEqual(elig9.requiredReferrals, 3, 'Threshold stays at 3 (milestone was NOT consumed)');
    assert.strictEqual(elig9.eligible, true, 'User with 3 referrals remains eligible for 1st withdrawal');
    pass('Scenario 9 — Pending, processing, failed, rejected, and reversed withdrawals never advance or consume milestones');

    // =========================================================================
    // SCENARIO 10: Duplicate, Self, Rejected, Pending, Banned & Device-Dup Referrals
    // =========================================================================
    console.log('\n--- Scenario 10: Invalid, Duplicate, Self & Banned Referrals Never Count ---');
    const u10TgId = 910010;
    const u10 = await createTestUser(`u10_${runTag}`, u10TgId, 500);

    // 1. Self-referral via atomicClaimReferralReward
    const selfClaim = await atomicClaimReferralReward({
      referrerId: u10.id,
      refereeId: u10.id,
      refereeUsername: u10.username,
    });
    assert.strictEqual(selfClaim.success, false, 'Self-referral claim rejected');

    // 2. Synthetic self-referral record in store
    await recordReferral({
      id: `ref_self_${runTag}`,
      referrerId: u10.id,
      refereeId: u10.id,
      refereeUsername: u10.username!,
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });

    // 3. Rejected & duplicate-device & pending referral records
    for (const badStatus of ['rejected', 'rejected_duplicate', 'pending'] as const) {
      await recordReferral({
        id: `ref_bad_${badStatus}_${runTag}`,
        referrerId: u10.id,
        refereeId: `bad_referee_${badStatus}_${runTag}`,
        refereeUsername: `bad_${badStatus}`,
        rewardAmount: 0,
        status: badStatus,
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Banned referee user
    const bannedRefUser = await createTestUser(`banned_ref_${runTag}`, 919991, 0);
    bannedRefUser.isBanned = true;
    await saveUser(bannedRefUser);
    await recordReferral({
      id: `ref_banned_${runTag}`,
      referrerId: u10.id,
      refereeId: bannedRefUser.id,
      refereeUsername: bannedRefUser.username!,
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });

    // 5. Duplicate-account flagged referee user
    const dupFlagUser = await createTestUser(`dup_flag_ref_${runTag}`, 919992, 0);
    dupFlagUser.isDuplicateAccount = true;
    await saveUser(dupFlagUser);
    await recordReferral({
      id: `ref_dupflag_${runTag}`,
      referrerId: u10.id,
      refereeId: dupFlagUser.id,
      refereeUsername: dupFlagUser.username!,
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });

    // 6. Duplicate referral records for the SAME valid referee (must count as 1, not 2!)
    const singleValidReferee = await createTestUser(`single_valid_ref_${runTag}`, 919993, 10);
    await recordReferral({
      id: `ref_valid_once_a_${runTag}`,
      referrerId: u10.id,
      refereeId: singleValidReferee.id,
      refereeUsername: singleValidReferee.username!,
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });
    await recordReferral({
      id: `ref_valid_once_b_${runTag}`,
      referrerId: u10.id,
      refereeId: singleValidReferee.id,
      refereeUsername: singleValidReferee.username!,
      rewardAmount: 10,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });

    const u10ValidCount = await getValidReferralCount(u10.id);
    assert.strictEqual(u10ValidCount, 1, 'Out of self/rejected/pending/banned/dup-account/duplicate-record, ONLY 1 unique valid referral counts');
    assert.strictEqual((await checkWithdrawalReferralEligibility(u10.id)).eligible, false);
    pass('Scenario 10 — Duplicate, self, rejected, pending, banned, and duplicate-device referrals never count');

    // =========================================================================
    // SCENARIO 11: Concurrent Simultaneous Withdrawal Requests Cannot Bypass Rule
    // =========================================================================
    console.log('\n--- Scenario 11: Concurrent Simultaneous Withdrawal Requests Anti-Bypass ---');
    const u11TgId = 910011;
    const u11 = await createTestUser(`u11_${runTag}`, u11TgId, 500);
    const u11InitData = signTelegramInitData({ id: u11TgId, first_name: 'ConcUser', username: u11.username }, botToken);
    await addValidReferrals(u11, 3, 'u11_3refs'); // Enough for ONLY 1 withdrawal (3/3), NOT 2nd (3/6)!
    const u11BalanceBefore = (await getUser(u11.id))!.balance;

    // Fire 5 simultaneous HTTP POST /api/withdrawals/create requests with distinct idempotency keys
    const concurrentHttp = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        apiRequest(baseUrl, 'POST', '/withdrawals/create', u11InitData, {
          amount: DENOM,
          idempotencyKey: `conc_http_${runTag}_${n}`,
        })
      )
    );
    const http200 = concurrentHttp.filter((r) => r.status === 200);
    const http403 = concurrentHttp.filter((r) => r.status === 403 && r.data.referralRequirementFailed === true);

    assert.strictEqual(http200.length, 1, 'Exactly 1 of 5 simultaneous HTTP withdrawal requests succeeded');
    assert.strictEqual(http403.length, 4, 'Remaining 4 simultaneous HTTP withdrawal requests blocked by referral threshold');

    const u11After = await getUser(u11.id);
    assert.strictEqual(u11After!.balance, u11BalanceBefore - DENOM, 'Balance deducted exactly once under concurrency');
    assert.strictEqual((await getCompletedWithdrawals(u11.id)).length, 1);
    pass('Scenario 11 — 5 simultaneous withdrawal requests allowed strictly 1 withdrawal and blocked 4 (no race bypass)');

    // =========================================================================
    // SCENARIO 12: Dynamic Admin Referral Requirement Updates + Reset Modes
    // =========================================================================
    console.log('\n--- Scenario 12: Dynamic Admin Threshold Changes (2, 4, 5) & Combined/Balance-Only Reset Modes ---');
    // User u11 currently has W=1 completed withdrawal and V=3 valid referrals in Campaign #2.
    // Change R -> 5: required becomes (1 + 1) * 5 = 10
    const setR5 = await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalMinReferralsRequired: 5,
    });
    assert.strictEqual(setR5.status, 200);
    const eligR5 = await checkWithdrawalReferralEligibility(u11.id);
    assert.strictEqual(eligR5.perWithdrawalRequirement, 5);
    assert.strictEqual(eligR5.requiredReferrals, 10, 'With W=1 and R=5, required cumulative referrals is 10');
    assert.strictEqual(eligR5.eligible, false);

    // Change R -> 4: required becomes (1 + 1) * 4 = 8
    await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalMinReferralsRequired: 4,
    });
    const eligR4 = await checkWithdrawalReferralEligibility(u11.id);
    assert.strictEqual(eligR4.requiredReferrals, 8, 'With W=1 and R=4, required cumulative referrals is 8');

    // Restore R -> 3
    await apiRequest(baseUrl, 'POST', '/admin/settings', adminInitData, {
      withdrawalMinReferralsRequired: 3,
    });
    const eligR3 = await checkWithdrawalReferralEligibility(u11.id);
    assert.strictEqual(eligR3.requiredReferrals, 6, 'With W=1 and R=3, required cumulative referrals is 6');
    pass('Scenario 12a — Admin changes to R (3, 4, 5) immediately update cumulative thresholds consistently');

    // =========================================================================
    // SCENARIO 13: Unrelated Data Safety (Balances, Tasks, Check-In, GV Stock, Tx History)
    // =========================================================================
    console.log('\n--- Scenario 13: Strict Data Safety Verification Across Operations ---');
    const safetyTask = await saveTask({
      id: `task_safe_${runTag}`,
      title: 'Safety Verification Task',
      description: 'Must remain intact across referral resets',
      destinationUrl: 'https://example.com/watch',
      rewardAmount: 7.5,
      taskType: 'video',
      timerSeconds: 10,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
    });
    await recordTaskCompletion({
      id: `${u11.id}_${safetyTask.id}`,
      userId: u11.id,
      taskId: safetyTask.id,
      rewardCredited: 7.5,
      completedAt: new Date().toISOString(),
    });

    const gvStatsBefore = await getGiftCardInventoryStats();
    const checkinCycleBefore = getDailyCheckinCycleRewards(await getAppSettings());
    const u11SnapshotBalance = (await getUser(u11.id))!.balance;
    const u11SnapshotStreak = (await getUser(u11.id))!.dailyStreak;
    const u11TxCountBefore = (await getUserTransactions(u11.id)).length;

    // Execute another referral-only reset (Campaign #2 -> Campaign #3)
    const resetToC3 = await atomicResetAllUserBalances(adminUser.id, {
      resetBalances: false,
      resetReferrals: true,
    });
    assert.strictEqual(resetToC3.newReferralCampaignId, 3);
    assert.strictEqual(resetToC3.resetBalances, false);

    // Verify all unrelated data is 100% unchanged!
    const u11PostReset = await getUser(u11.id);
    assert.strictEqual(u11PostReset!.balance, u11SnapshotBalance, 'Balance unchanged after referral reset');
    assert.strictEqual(u11PostReset!.dailyStreak, u11SnapshotStreak, 'Daily check-in streak unchanged');
    assert.ok(await getTaskById(safetyTask.id), 'Task configuration unchanged');
    assert.ok(await getTaskCompletion(u11.id, safetyTask.id), 'Task completion record unchanged');
    assert.deepStrictEqual(
      getDailyCheckinCycleRewards(await getAppSettings()),
      checkinCycleBefore,
      'Daily check-in reward schedule unchanged'
    );
    const gvStatsAfter = await getGiftCardInventoryStats();
    assert.strictEqual(gvStatsAfter.available, gvStatsBefore.available, 'Available GV stock unchanged');
    assert.strictEqual(gvStatsAfter.redeemed, gvStatsBefore.redeemed, 'Redeemed GV count unchanged');
    assert.strictEqual((await getUserTransactions(u11.id)).length, u11TxCountBefore, 'Transaction history count unchanged');

    // Also verify Balance-Only Reset preserves referral campaign progress, and Combined Reset resets both
    await addValidReferrals(u11, 2, 'c3_refs');
    assert.strictEqual(await getValidReferralCount(u11.id), 2);

    const balOnlyRes = await apiRequest(baseUrl, 'POST', '/admin/bulk-balance-reset', adminInitData, {
      confirmPhrase: 'RESET ALL BALANCES',
      resetBalances: true,
      resetReferrals: false,
    });
    assert.strictEqual(balOnlyRes.status, 200);
    assert.strictEqual(balOnlyRes.data.newReferralCampaignId, 3, 'Balance-only reset kept Campaign #3 intact');
    assert.strictEqual(await getValidReferralCount(u11.id), 2, 'Balance-only reset kept current campaign referrals = 2');
    assert.strictEqual((await getUser(u11.id))!.balance, 0, 'Balance-only reset zeroed balance');

    // Combined Reset (both balances + referrals)
    await saveUser({ ...(await getUser(u11.id))!, balance: 75 });
    const bothRes = await apiRequest(baseUrl, 'POST', '/admin/bulk-balance-reset', adminInitData, {
      confirmPhrase: 'RESET BALANCES AND REFERRALS',
      resetBalances: true,
      resetReferrals: true,
    });
    assert.strictEqual(bothRes.status, 200);
    assert.strictEqual(bothRes.data.newReferralCampaignId, 4, 'Combined reset advanced to Campaign #4');
    assert.strictEqual((await getUser(u11.id))!.balance, 0, 'Combined reset zeroed balance');
    assert.strictEqual(await getValidReferralCount(u11.id), 0, 'Combined reset zeroed Campaign #4 referrals');
    assert.strictEqual(
      (await getCampaignReferralCounts(u11.id)).lifetimeValidReferrals,
      5,
      'All 5 lifetime valid referrals for u11 remain preserved in history after combined reset'
    );

    pass('Scenario 13 & All Reset Modes — Balances, tasks, check-in, GV inventory, and transaction history remain 100% safe');

    console.log('\n================================================================================');
    console.log(`  ALL 13 MANDATORY SCENARIOS PASSED SUCCESSFULLY (${passed} ASSERTION GROUPS) ✓`);
    console.log('================================================================================\n');
  } finally {
    clearMockChannelMemberships();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runMandatorySuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✗ MANDATORY SUITE FAILED:', err);
    process.exit(1);
  });
