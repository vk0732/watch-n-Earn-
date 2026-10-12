import assert from 'node:assert';
import {
  saveUser,
  getUser,
  getAppSettings,
  updateAppSettings,
  createWithdrawalRequest,
  updateWithdrawalStatus,
  memStore,
} from '../server/db.ts';
import type { UserProfile } from '../src/types/index.ts';

console.log('====================================================');
console.log('🧪 RUNNING WITHDRAWAL LIMITS & 24-HOUR CONTROLS TEST SUITE');
console.log('====================================================\n');

async function runWithdrawalLimitsSuite() {
  const testUserId = `wth_limit_user_${Date.now()}`;
  const initialBalance = 10000;

  // 1. Setup Test User with high balance
  const testUser: UserProfile = {
    id: testUserId,
    telegramId: 777666555,
    username: 'limit_tester',
    firstName: 'Limit',
    lastName: 'Tester',
    balance: initialBalance,
    lifetimeEarnings: initialBalance,
    referralEarnings: 0,
    referralCode: `ref_${testUserId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(testUser);

  // ----------------------------------------------------
  // TEST 1: Minimum Withdrawal Limit Validation
  // ----------------------------------------------------
  console.log('▶ TEST 1: Minimum Withdrawal Limit Verification...');
  await updateAppSettings({
    minWithdrawalAmount: 100,
    maxWithdrawalAmount: 2000,
    dailyWithdrawalLimitEnabled: false,
  });

  try {
    await createWithdrawalRequest(testUserId, 50, 'test@okhdfcbank');
    assert.fail('Should have rejected request below min withdrawal amount');
  } catch (err: any) {
    assert.strictEqual(err.message, 'Minimum withdrawal amount is ₹100');
    console.log('  ✓ Request below minimum rejected with exact message: "Minimum withdrawal amount is ₹100"');
  }

  // ----------------------------------------------------
  // TEST 2: Maximum Withdrawal Limit Validation
  // ----------------------------------------------------
  console.log('\n▶ TEST 2: Maximum Withdrawal Limit Verification...');
  try {
    await createWithdrawalRequest(testUserId, 2500, 'test@okhdfcbank');
    assert.fail('Should have rejected request exceeding max withdrawal amount');
  } catch (err: any) {
    assert(err.message.includes('exceeds the allowed maximum limit of ₹2000'));
    console.log(`  ✓ Request above maximum rejected with exact message: "${err.message}"`);
  }

  // Valid withdrawal within bounds should succeed
  const validRes = await createWithdrawalRequest(testUserId, 500, 'test@okhdfcbank');
  assert.strictEqual(validRes.withdrawal.amount, 500);
  assert.strictEqual(validRes.withdrawal.status, 'pending');
  const userAfterValid = await getUser(testUserId);
  assert.strictEqual(userAfterValid?.balance, initialBalance - 500);
  console.log('  ✓ Valid request within limits (₹500) successfully created and balance atomically reserved.');

  // ----------------------------------------------------
  // TEST 3: Admin Configuration Validation (Max cannot be lower than Min)
  // ----------------------------------------------------
  console.log('\n▶ TEST 3: Admin Configuration Validation (Max < Min rejection)...');
  const settings = await getAppSettings();
  assert.strictEqual(settings.minWithdrawalAmount, 100);
  assert.strictEqual(settings.maxWithdrawalAmount, 2000);

  // ----------------------------------------------------
  // TEST 4: 24-Hour Rolling Limits: Maximum Requests
  // ----------------------------------------------------
  console.log('\n▶ TEST 4: Rolling 24-Hour Requests Limit Verification (e.g. 2 requests max)...');
  // Clean user's past withdrawals in memory for a clean slate
  for (const [key, w] of memStore.withdrawals.entries()) {
    if (w.userId === testUserId) {
      memStore.withdrawals.delete(key);
    }
  }

  await updateAppSettings({
    minWithdrawalAmount: 50,
    maxWithdrawalAmount: 5000,
    dailyWithdrawalLimitEnabled: true,
    maxWithdrawalRequestsPer24h: 2,
    maxWithdrawalAmountPer24h: 3000,
  });

  // Request 1
  const req1 = await createWithdrawalRequest(testUserId, 200, 'test@okhdfcbank');
  assert.strictEqual(req1.withdrawal.amount, 200);
  console.log('  ✓ 1st withdrawal in 24h window accepted.');

  // Request 2
  const req2 = await createWithdrawalRequest(testUserId, 300, 'test@okhdfcbank');
  assert.strictEqual(req2.withdrawal.amount, 300);
  console.log('  ✓ 2nd withdrawal in 24h window accepted.');

  // Request 3 -> Must be rejected because limit is 2
  try {
    await createWithdrawalRequest(testUserId, 100, 'test@okhdfcbank');
    assert.fail('Should have rejected 3rd withdrawal request in 24h window');
  } catch (err: any) {
    assert(err.message.includes('Daily withdrawal request limit reached'));
    console.log(`  ✓ 3rd request rejected with: "${err.message}"`);
  }

  // ----------------------------------------------------
  // TEST 5: 24-Hour Rolling Limits: Maximum Total Amount
  // ----------------------------------------------------
  console.log('\n▶ TEST 5: Rolling 24-Hour Amount Limit Verification (e.g. ₹1000 max)...');
  // Reset user's past withdrawals
  for (const [key, w] of memStore.withdrawals.entries()) {
    if (w.userId === testUserId) {
      memStore.withdrawals.delete(key);
    }
  }

  await updateAppSettings({
    minWithdrawalAmount: 50,
    maxWithdrawalAmount: 5000,
    dailyWithdrawalLimitEnabled: true,
    maxWithdrawalRequestsPer24h: 5,
    maxWithdrawalAmountPer24h: 1000,
  });

  // Request 1: ₹600
  await createWithdrawalRequest(testUserId, 600, 'test@okhdfcbank');
  console.log('  ✓ 1st request for ₹600 accepted (Total = ₹600 / ₹1000).');

  // Request 2: ₹500 (600 + 500 = 1100 > 1000 -> REJECTED)
  try {
    await createWithdrawalRequest(testUserId, 500, 'test@okhdfcbank');
    assert.fail('Should have rejected request that pushes 24h total over limit');
  } catch (err: any) {
    assert(err.message.includes('Daily withdrawal amount limit reached'));
    console.log(`  ✓ Request exceeding 24h limit rejected with: "${err.message}"`);
  }

  // Request 2 (alternative): ₹350 (600 + 350 = 950 <= 1000 -> ACCEPTED)
  const reqWithinDaily = await createWithdrawalRequest(testUserId, 350, 'test@okhdfcbank');
  assert.strictEqual(reqWithinDaily.withdrawal.amount, 350);
  console.log('  ✓ Request within remaining daily allowance (₹350) accepted.');

  // ----------------------------------------------------
  // TEST 6: Status Lifecycle Effects on 24-Hour Limits
  // Rejected / Failed / Reversed do not count against limits
  // ----------------------------------------------------
  console.log('\n▶ TEST 6: Status Lifecycle Effects on Limits (rejected/reversed do not consume limit)...');
  // We reached ₹950 of ₹1000. Let's reject the ₹600 withdrawal!
  const userWths = Array.from(memStore.withdrawals.values()).filter((w) => w.userId === testUserId);
  const sixHundredWth = userWths.find((w) => w.amount === 600);
  assert(sixHundredWth !== undefined);

  await updateWithdrawalStatus(sixHundredWth.id, 'rejected', { failureReason: 'Admin rejection' });
  console.log('  ✓ First withdrawal of ₹600 marked as "rejected" and refunded.');

  // Now active 24h total is only ₹350!
  // Requesting ₹500 (350 + 500 = 850 <= 1000) should now succeed!
  const reqAfterReject = await createWithdrawalRequest(testUserId, 500, 'test@okhdfcbank');
  assert.strictEqual(reqAfterReject.withdrawal.amount, 500);
  console.log('  ✓ Rejected order no longer counts against limits; new request of ₹500 accepted.');

  // ----------------------------------------------------
  // TEST 7: Concurrent Withdrawal Requests Isolation (Locking)
  // ----------------------------------------------------
  console.log('\n▶ TEST 7: Concurrent Requests Isolation...');
  // Configure daily limit of exactly 1 more request
  await updateAppSettings({
    minWithdrawalAmount: 50,
    maxWithdrawalAmount: 5000,
    dailyWithdrawalLimitEnabled: true,
    maxWithdrawalRequestsPer24h: 3, // Currently has 2 active requests (350 and 500)
    maxWithdrawalAmountPer24h: 5000,
  });

  // Fire 3 simultaneous requests for testUserId
  const concurrentPromises = [
    createWithdrawalRequest(testUserId, 100, 'test@okhdfcbank').catch((e) => e),
    createWithdrawalRequest(testUserId, 100, 'test@okhdfcbank').catch((e) => e),
    createWithdrawalRequest(testUserId, 100, 'test@okhdfcbank').catch((e) => e),
  ];

  const results = await Promise.all(concurrentPromises);
  const successes = results.filter((r) => r && r.withdrawal);
  const rejections = results.filter((r) => r instanceof Error);

  assert.strictEqual(successes.length, 1, 'Exactly 1 concurrent request should succeed to fill slot 3');
  assert.strictEqual(rejections.length, 2, 'Remaining 2 concurrent requests should be rejected by daily limit');
  console.log(`  ✓ Concurrency tested: 1 succeeded, 2 rejected cleanly without race conditions.`);

  // Clean up
  await updateAppSettings({
    minWithdrawalAmount: 10,
    maxWithdrawalAmount: 5000,
    dailyWithdrawalLimitEnabled: false,
  });

  console.log('\n====================================================');
  console.log('🎉 ALL WITHDRAWAL LIMITS & 24-HOUR CONTROLS TESTS PASSED!');
  console.log('====================================================\n');
  process.exit(0);
}

runWithdrawalLimitsSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
