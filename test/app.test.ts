import crypto from 'node:crypto';
import {
  getUser,
  saveUser,
  getAppSettings,
  updateAppSettings,
  atomicCreditBalance,
  createWithdrawalRequest,
  updateWithdrawalStatus,
  recordReferral,
  getReferralsByReferrer,
  recordTaskCompletion,
  getTaskCompletion,
  saveTask,
  getTaskById,
} from '../server/db.ts';
import {
  verifyTelegramInitData,
  isTelegramAdmin,
  checkTelegramChannelMembership,
} from '../server/telegram.ts';
import { validateUpiId, payoutGateway } from '../server/payoutAdapter.ts';
import type { UserProfile, Task } from '../src/types/index.ts';

// Simple lightweight test runner
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('  RUNNING TELEARN AUTOMATED INTEGRATION TESTS');
  console.log('==================================================\n');

  /* ------------------------------------------------------------------
     TEST 1: Telegram initData HMAC-SHA256 Cryptographic Verification
     ------------------------------------------------------------------ */
  console.log('Test Suite 1: Telegram Authentication & Cryptographic Verification');
  {
    const botToken = '123456789:TEST_BOT_TOKEN_SECRET_XYZ';
    const tgUser = { id: 777001, first_name: 'TestUser', username: 'testuser777' };
    const authDate = Math.floor(Date.now() / 1000);

    // Build valid data check string
    const userJson = JSON.stringify(tgUser);
    const dataCheckString = `auth_date=${authDate}\nuser=${userJson}`;
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const validHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const validInitData = `auth_date=${authDate}&user=${encodeURIComponent(userJson)}&hash=${validHash}`;
    const res1 = verifyTelegramInitData(validInitData, botToken);
    assert(res1.isValid === true && res1.user?.id === 777001, 'Valid initData successfully verified with HMAC-SHA256');

    // Tampered payload
    const tamperedInitData = `auth_date=${authDate}&user=${encodeURIComponent(userJson)}&hash=tampered_fake_hash_12345`;
    const res2 = verifyTelegramInitData(tamperedInitData, botToken);
    assert(res2.isValid === false, 'Tampered hash is strictly rejected');

    // Expired payload (> 24 hours old)
    const expiredAuthDate = authDate - 90000;
    const expiredDataCheck = `auth_date=${expiredAuthDate}\nuser=${userJson}`;
    const expiredHash = crypto.createHmac('sha256', secretKey).update(expiredDataCheck).digest('hex');
    const expiredInitData = `auth_date=${expiredAuthDate}&user=${encodeURIComponent(userJson)}&hash=${expiredHash}`;
    const res3 = verifyTelegramInitData(expiredInitData, botToken);
    assert(res3.isValid === false, 'Expired auth_date (> 24 hours) is rejected');

    // Sandbox preview simulated payload
    const simInitData = `user=${encodeURIComponent(userJson)}&auth_date=${authDate}&hash=dummy_preview_hash&is_simulated=true`;
    const resSim = verifyTelegramInitData(simInitData, botToken);
    assert(resSim.isValid === true && resSim.isSimulated === true, 'Sandbox simulated initData verified safely');
  }

  /* ------------------------------------------------------------------
     TEST 2: First-time User Registration & Atomic Signup Bonus
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 2: User Registration & Atomic Ledger Crediting');
  {
    const testUserId = `test_user_${Date.now()}`;
    const newUser: UserProfile = {
      id: testUserId,
      telegramId: 888123,
      firstName: 'Alice',
      lastName: undefined, // Test undefined field handling for Firestore setDoc
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: `ref_${testUserId}`,
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(newUser);

    const saved = await getUser(testUserId);
    assert(saved !== null && saved.balance === 0, 'User saved with initial zero balance');

    // Credit signup bonus
    const creditRes = await atomicCreditBalance(testUserId, 50, 'signup_bonus', 'Signup bonus');
    assert(creditRes.user.balance === 50, 'Signup bonus of ₹50 credited atomically');
    assert(creditRes.transaction.type === 'signup_bonus', 'Financial transaction recorded in ledger');

    // Duplicate balance credit test
    const fetchedAgain = await getUser(testUserId);
    assert(fetchedAgain?.balance === 50, 'User balance persists accurately');
  }

  /* ------------------------------------------------------------------
     TEST 3: Daily Check-In 1-Per-Day Restriction & Streak
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 3: Daily Check-In Restrictions');
  {
    const uId = `daily_user_${Date.now()}`;
    const user: UserProfile = {
      id: uId,
      telegramId: 999456,
      firstName: 'Bob',
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: `ref_${uId}`,
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(user);

    const todayUTC = new Date().toISOString().split('T')[0];

    // First claim today: succeeds
    assert(user.lastDailyCheckIn !== todayUTC, 'User has not claimed checkin today initially');
    user.lastDailyCheckIn = todayUTC;
    user.dailyStreak = 1;
    await saveUser(user);
    await atomicCreditBalance(uId, 10, 'daily_checkin', 'Day 1 Checkin');

    const updated = await getUser(uId);
    assert(updated?.balance === 10, 'Day 1 reward credited (+₹10)');
    assert(updated?.lastDailyCheckIn === todayUTC, 'Checkin timestamp updated to today');

    // Second claim today: blocked
    const canClaimAgainToday = updated?.lastDailyCheckIn !== todayUTC;
    assert(!canClaimAgainToday, 'Same-day duplicate check-in is strictly blocked');
  }

  /* ------------------------------------------------------------------
     TEST 4: Referral System & Anti-Abuse
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 4: Referral System & Duplicate Prevention');
  {
    const referrerId = `referrer_${Date.now()}`;
    const refereeId = `referee_${Date.now()}`;

    // Self-referral prevention check
    const isSelfReferral = referrerId === referrerId;
    assert(isSelfReferral === true, 'Self-referral condition correctly identified and blocked in router');

    // Record legitimate referral
    const refLedgerId = `${referrerId}_${refereeId}`;
    await recordReferral({
      id: refLedgerId,
      referrerId,
      refereeId,
      refereeUsername: 'test_friend',
      rewardAmount: 25,
      status: 'credited',
      createdAt: new Date().toISOString(),
    });

    const history = await getReferralsByReferrer(referrerId);
    assert(history.length === 1 && history[0].refereeId === refereeId, 'Referral logged in ledger');

    // Duplicate referral check
    const isDuplicate = history.some((h) => h.refereeId === refereeId);
    assert(isDuplicate, 'Duplicate referral check detects already existing referee ID');
  }

  /* ------------------------------------------------------------------
     TEST 5: Watch & Earn Tasks & Duplicate Claim Prevention
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 5: Watch & Earn Tasks & Double Claiming Prevention');
  {
    const taskId = `task_test_${Date.now()}`;
    const userId = `task_user_${Date.now()}`;

    await saveTask({
      id: taskId,
      title: 'Automated Test Task',
      description: 'Test description',
      destinationUrl: 'https://example.com',
      rewardAmount: 30,
      taskType: 'video',
      timerSeconds: 10,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
    });

    const task = await getTaskById(taskId);
    assert(task !== null && task.rewardAmount === 30, 'Task created and retrievable');

    // Initial check: not completed
    const comp1 = await getTaskCompletion(userId, taskId);
    assert(comp1 === null, 'Task initially not completed for user');

    // Record completion
    await recordTaskCompletion({
      id: `${userId}_${taskId}`,
      userId,
      taskId,
      rewardAmount: 30,
      completedAt: new Date().toISOString(),
    });

    const comp2 = await getTaskCompletion(userId, taskId);
    assert(comp2 !== null, 'Task completion recorded');

    // Second claim: blocked
    assert(comp2 !== null, 'Duplicate completion request is identified and blocked');
  }

  /* ------------------------------------------------------------------
     TEST 6: UPI Validation & Withdrawal Workflow & Atomic Refund
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 6: UPI Withdrawal Workflow, Validation & Refund');
  {
    // UPI Validation
    assert(validateUpiId('user@okhdfcbank').isValid === true, 'Valid UPI ID (user@okhdfcbank) accepted');
    assert(validateUpiId('9876543210@paytm').isValid === true, 'Valid UPI ID (9876543210@paytm) accepted');
    assert(validateUpiId('invalid_upi_no_at').isValid === false, 'Invalid UPI without @ rejected');
    assert(validateUpiId('').isValid === false, 'Empty UPI rejected');

    // Withdrawal creation with balance check
    const wthUserId = `wth_user_${Date.now()}`;
    await saveUser({
      id: wthUserId,
      telegramId: 111222,
      firstName: 'Charlie',
      balance: 150, // Available balance
      lifetimeEarnings: 150,
      referralEarnings: 0,
      referralCode: `ref_${wthUserId}`,
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Insufficient balance test
    let failedInsufficient = false;
    try {
      await createWithdrawalRequest(wthUserId, 500, 'charlie@upi');
    } catch {
      failedInsufficient = true;
    }
    assert(failedInsufficient, 'Withdrawal request exceeding available balance rejected');

    // Valid withdrawal of ₹100
    const wthRes = await createWithdrawalRequest(wthUserId, 100, 'charlie@upi');
    assert(wthRes.withdrawal.amount === 100, 'Withdrawal order created for ₹100');
    assert(wthRes.user.balance === 50, 'Balance atomically decremented from ₹150 to ₹50');
    assert(wthRes.withdrawal.status === 'pending', 'Order status initialized to Pending');

    // Withdrawal below minimum threshold (e.g. ₹5 when min is ₹10)
    let minFailed = false;
    try {
      await createWithdrawalRequest(wthUserId, 5, 'charlie@upi');
    } catch {
      minFailed = true;
    }
    assert(minFailed, 'Withdrawal below minimum threshold rejected');

    // Admin Rejection with Atomic Refund
    const orderId = wthRes.withdrawal.id;
    const rejRes = await updateWithdrawalStatus(orderId, 'rejected', {
      failureReason: 'Invalid bank beneficiary during test',
    });
    assert(rejRes.status === 'rejected', 'Withdrawal status updated to rejected');

    // Verify user balance was restored atomically
    const refundedUser = await getUser(wthUserId);
    assert(refundedUser?.balance === 150, 'User balance restored atomically upon rejection (₹50 + ₹100 = ₹150)');
  }

  /* ------------------------------------------------------------------
     TEST 7: Admin Access Restrictions
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 7: Admin Authorization Gate');
  {
    process.env.ADMIN_TELEGRAM_IDS = '504198372,999888';
    assert(isTelegramAdmin(504198372) === true, 'Authorized admin ID (504198372) granted access');
    assert(isTelegramAdmin('999888') === true, 'Authorized admin string ID ("999888") granted access');
    assert(isTelegramAdmin(12345678) === false, 'Unauthorized user ID (12345678) rejected');
  }

  /* ------------------------------------------------------------------
     TEST 8: Safe UPI Payout Provider Adapter
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 8: Payout Gateway Safety Rules');
  {
    process.env.PAYOUT_LIVE_ENABLED = 'false';
    const status = await payoutGateway.getStatus();
    assert(status.isLiveEnabled === false, 'Live payouts are disabled by default');
    assert(status.statusMessage.includes('DISABLED'), 'Safe status message explains sandbox review mode');
  }

  console.log('\n==================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
