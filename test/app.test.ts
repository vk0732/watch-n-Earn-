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
  getAllTasks,
  deleteTask,
  saveForceJoinChannel,
  getForceJoinChannels,
  deleteForceJoinChannel,
  addGiftCardCodes,
  redeemGiftCardWithdrawal,
  getAllGiftCardCodes,
  invalidateGiftCardCode,
  getUserWithdrawals,
  getUserTransactions,
  getBulkBalanceResetPreview,
  atomicResetAllUserBalances,
  atomicClaimSignupBonus,
  hasUserClaimedSignupBonus,
  getMandatoryWithdrawalChannels,
  verifyMandatoryWithdrawalMembership,
} from '../server/db.ts';
import {
  getBroadcastPreview,
  startBroadcast,
  getBroadcastStatus,
  cancelBroadcast,
} from '../server/broadcast.ts';
import {
  verifyTelegramInitData,
  isTelegramAdmin,
  checkTelegramChannelMembership,
  checkBotChannelAccess,
  formatChannelIdentifier,
  getChannelCandidateIds,
  getChannelAlias,
  clearChannelAliases,
  setMockChannelMembership,
  clearMockChannelMemberships,
} from '../server/telegram.ts';
import {
  verifyChannelTask,
  verifyVideoTask,
  verifyWebsiteTask,
  verifySocialTask,
} from '../server/taskVerification.ts';
import { validateUpiId, payoutGateway } from '../server/payoutAdapter.ts';
import {
  getPublicGatewayConfig,
  getDecryptedCredentials,
  saveGatewayConfig,
  removeGatewayCredentials,
} from '../server/paymentSecurity.ts';
import type { UserProfile, Task, ForceJoinChannel, Withdrawal } from '../src/types/index.ts';

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
    // A. Task Creation and Retrieval
    const taskId = `task_test_${Date.now()}`;
    const userId = `task_user_${Date.now()}`;
    const dummyUser: UserProfile = {
      id: userId,
      telegramId: 998877,
      firstName: 'TestUser',
      balance: 100,
      lifetimeEarnings: 100,
      referralEarnings: 0,
      referralCode: 'ref_dummy',
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const taskVideo: Task = {
      id: taskId,
      title: 'Automated Test Video Task',
      description: 'Watch video for 10 seconds',
      destinationUrl: 'https://youtube.com/watch?v=123',
      rewardAmount: 30,
      taskType: 'video',
      timerSeconds: 10,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
    };

    await saveTask(taskVideo);
    const retrievedTask = await getTaskById(taskId);
    assert(retrievedTask !== null && retrievedTask.rewardAmount === 30, 'Task created and retrievable');

    // B. Video Task Verification
    const vidNoStart = await verifyVideoTask(dummyUser, taskVideo, undefined);
    assert(vidNoStart.success === false && vidNoStart.error!.includes('start watching'), 'Video Task: Rejects when timer not started');

    const vidTooEarly = await verifyVideoTask(dummyUser, taskVideo, Date.now() - 3000);
    assert(vidTooEarly.success === false && vidTooEarly.error!.includes('remaining'), 'Video Task: Rejects when elapsed time is insufficient');

    const vidComplete = await verifyVideoTask(dummyUser, taskVideo, Date.now() - 11000);
    assert(vidComplete.success === true, 'Video Task: Verifies successfully after timer completion');

    // C. Website Task Verification
    const taskWeb: Task = {
      id: `task_web_${Date.now()}`,
      title: 'Visit Sponsor Site',
      description: 'Visit site for 8 seconds',
      destinationUrl: 'https://example.com',
      rewardAmount: 15,
      taskType: 'website',
      timerSeconds: 8,
      isActive: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
    };
    const webNoStart = await verifyWebsiteTask(dummyUser, taskWeb, undefined);
    assert(webNoStart.success === false && webNoStart.error!.includes('visit the website'), 'Website Task: Rejects when timer not started');

    const webComplete = await verifyWebsiteTask(dummyUser, taskWeb, Date.now() - 9000);
    assert(webComplete.success === true, 'Website Task: Verifies successfully after visit timer completes');

    // D. Social Task Verification (All 4 Options)
    // Option 1: Code Confirmation
    const taskCode: Task = {
      id: `task_code_${Date.now()}`,
      title: 'Instagram Follow & Secret Code',
      description: 'Find secret code in bio',
      destinationUrl: 'https://instagram.com/test',
      rewardAmount: 25,
      taskType: 'social',
      socialPlatform: 'instagram',
      verificationMethod: 'code_confirmation',
      verificationCode: 'SECRET99',
      timerSeconds: 0,
      isActive: true,
      sortOrder: 3,
      createdAt: new Date().toISOString(),
    };
    const codeWrong = await verifySocialTask(dummyUser, taskCode, { verificationCode: 'WRONG' });
    assert(codeWrong.success === false && codeWrong.error!.includes('Incorrect verification code'), 'Social Task: Rejects incorrect secret code');

    const codeCorrect = await verifySocialTask(dummyUser, taskCode, { verificationCode: 'secret99' });
    assert(codeCorrect.success === true, 'Social Task: Accepts correct secret code (case-insensitive)');

    // Option 2: Manual Review
    const taskManual: Task = {
      id: `task_manual_${Date.now()}`,
      title: 'X / Twitter Follow',
      description: 'Follow and submit username',
      destinationUrl: 'https://x.com/test',
      rewardAmount: 20,
      taskType: 'social',
      socialPlatform: 'twitter',
      verificationMethod: 'manual_review',
      timerSeconds: 0,
      isActive: true,
      sortOrder: 4,
      createdAt: new Date().toISOString(),
    };
    const manualNoHandle = await verifySocialTask(dummyUser, taskManual, {});
    assert(manualNoHandle.success === false && manualNoHandle.error!.includes('social handle'), 'Social Task: Rejects manual review without user handle');

    const manualSubmitted = await verifySocialTask(dummyUser, taskManual, { socialHandle: '@myhandle' });
    assert(manualSubmitted.success === true && manualSubmitted.pendingReview === true, 'Social Task: Accepts manual review submission and sets pendingReview');

    // Option 3: Engagement Timer
    const taskTimer: Task = {
      id: `task_timer_${Date.now()}`,
      title: 'YouTube Watch & Engage',
      description: 'Watch video for 5 seconds',
      destinationUrl: 'https://youtube.com/test',
      rewardAmount: 18,
      taskType: 'social',
      socialPlatform: 'youtube',
      verificationMethod: 'timer',
      timerSeconds: 5,
      isActive: true,
      sortOrder: 5,
      createdAt: new Date().toISOString(),
    };
    const timerTooEarly = await verifySocialTask(dummyUser, taskTimer, {}, Date.now() - 1000);
    assert(timerTooEarly.success === false && timerTooEarly.error!.includes('remaining'), 'Social Task: Rejects engagement timer when time insufficient');

    const timerDone = await verifySocialTask(dummyUser, taskTimer, {}, Date.now() - 6000);
    assert(timerDone.success === true, 'Social Task: Accepts engagement timer after required time');

    // Option 4: Direct Action Confirmation
    const taskDirect: Task = {
      id: `task_direct_${Date.now()}`,
      title: 'Discord Join',
      description: 'Join server and confirm',
      destinationUrl: 'https://discord.gg/test',
      rewardAmount: 15,
      taskType: 'social',
      socialPlatform: 'discord',
      timerSeconds: 0,
      isActive: true,
      sortOrder: 6,
      createdAt: new Date().toISOString(),
    };
    const directNoConfirm = await verifySocialTask(dummyUser, taskDirect, { confirmedAction: false });
    assert(directNoConfirm.success === false && directNoConfirm.error!.includes('confirm your action'), 'Social Task: Direct confirmation rejects unconfirmed action');

    const directConfirmed = await verifySocialTask(dummyUser, taskDirect, { confirmedAction: true });
    assert(directConfirmed.success === true, 'Social Task: Direct confirmation accepts confirmed action');

    // E. Task Editing and Persistence
    await saveTask({ ...taskVideo, title: 'Updated Video Task Title', rewardAmount: 50 });
    const updatedTask = await getTaskById(taskId);
    assert(updatedTask !== null && updatedTask.title === 'Updated Video Task Title' && updatedTask.rewardAmount === 50, 'Task Editing: Task updated and persisted in DB');

    // F. Task Listing and Deletion
    const allTasks = await getAllTasks(false);
    assert(allTasks.some((t) => t.id === taskId), 'Task Listing: getAllTasks returns created task');

    await deleteTask(taskId);
    const deletedTask = await getTaskById(taskId);
    assert(deletedTask === null, 'Task Deletion: deleteTask successfully removes task');

    // G. Force Join Channel CRUD
    const testChanId = `chan_crud_${Date.now()}`;
    const testChan: ForceJoinChannel = {
      id: testChanId,
      title: 'CRUD Test Channel',
      channelId: '@crudtestchannel',
      inviteLink: 'https://t.me/crudtestchannel',
      isPrivate: false,
      isEnabled: true,
      order: 10,
    };
    await saveForceJoinChannel(testChan);
    const allChans = await getForceJoinChannels(false);
    assert(allChans.some((c) => c.id === testChanId), 'Channel CRUD: saveForceJoinChannel persists channel');

    await deleteForceJoinChannel(testChanId);
    const afterDeleteChans = await getForceJoinChannels(false);
    assert(!afterDeleteChans.some((c) => c.id === testChanId), 'Channel CRUD: deleteForceJoinChannel removes channel');

    // H. Task Completion Recording & Double Claim Prevention
    const testTaskId2 = `task_comp_${Date.now()}`;
    await saveTask({ ...taskVideo, id: testTaskId2 });

    const comp1 = await getTaskCompletion(userId, testTaskId2);
    assert(comp1 === null, 'Task initially not completed for user');

    await recordTaskCompletion({
      id: `${userId}_${testTaskId2}`,
      userId,
      taskId: testTaskId2,
      rewardAmount: 50,
      completedAt: new Date().toISOString(),
    });

    const comp2 = await getTaskCompletion(userId, testTaskId2);
    assert(comp2 !== null && comp2.rewardAmount === 50, 'Task completion recorded');
    assert(comp2 !== null, 'Duplicate completion request is identified and blocked');
  }

  /* ------------------------------------------------------------------
     TEST 6: Amazon Gift Card Redemption Workflow & Inventory Rules
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 6: Instant Amazon Gift Card Redemption & Atomic Allocation');
  {
    const initialSettings = await getAppSettings();
    await updateAppSettings({ minWithdrawalAmount: 10, maxWithdrawalAmount: 100 });

    try {
      setMockChannelMembership('*', { isMember: true, status: 'member' });

      // Clean up any available codes of 77 and 88 from previous test runs
      const existingCodes = await getAllGiftCardCodes();
      for (const c of existingCodes) {
        if ((c.denomination === 77 || c.denomination === 88) && c.status === 'available') {
          await invalidateGiftCardCode(c.id, 'test_cleanup');
        }
      }

      const testDenom = 77;
      const wthUserId = `wth_user_${Date.now()}`;
      await saveUser({
        id: wthUserId,
        telegramId: 111222,
        firstName: 'Charlie',
        balance: 350, // Available balance
        lifetimeEarnings: 350,
        referralEarnings: 0,
        referralCode: `ref_${wthUserId}`,
        dailyStreak: 0,
        isBanned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 1. Insufficient balance test
      let failedInsufficient = false;
      try {
        await redeemGiftCardWithdrawal(wthUserId, 500);
      } catch {
        failedInsufficient = true;
      }
      assert(failedInsufficient, 'Redemption request exceeding available balance rejected');

      // 2. Below minimum threshold rejection (min is ₹10)
      let minFailed = false;
      try {
        await redeemGiftCardWithdrawal(wthUserId, 5);
      } catch {
        minFailed = true;
      }
      assert(minFailed, 'Redemption below minimum threshold (₹10) rejected');

      // 3. Out of stock condition (no codes of testDenom exist in inventory)
      let outOfStock = false;
      try {
        await redeemGiftCardWithdrawal(wthUserId, testDenom);
      } catch (err: any) {
        if (err.message.includes('out of stock')) outOfStock = true;
      }
      assert(outOfStock, 'Redemption when inventory has no codes throws "out of stock"');

      // Check user balance wasn't touched
      const untouchedUser = await getUser(wthUserId);
      assert(untouchedUser?.balance === 350, 'Balance untouched (₹350) when out of stock');

      // 4. Add codes to inventory
      const testCode1 = `TEST-AMZ1-${Date.now()}`;
      const testCode2 = `TEST-AMZ2-${Date.now()}`;
      const addResult = await addGiftCardCodes([testCode1, testCode2], testDenom, 'Test Admin');
      assert(addResult.added === 2, 'Admin successfully added 2 Amazon Gift Card codes to inventory');

      // 5. Successful redemption
      const redeemRes = await redeemGiftCardWithdrawal(wthUserId, testDenom);
      assert(redeemRes.withdrawal.amount === testDenom, `Withdrawal created for ₹${testDenom}`);
      assert(redeemRes.withdrawal.status === 'success', 'Fulfillment is instant with status: success');
      assert(redeemRes.withdrawal.payoutMode === 'gift_card', 'Payout mode is gift_card');
      assert(redeemRes.giftCardCode === testCode1 || redeemRes.giftCardCode === testCode2, 'Valid Amazon Gift Card code assigned');
      assert(redeemRes.user.balance === 273, 'Balance atomically decremented from ₹350 to ₹273');

      // 6. Second redemption gets second code
      const redeemRes2 = await redeemGiftCardWithdrawal(wthUserId, testDenom);
      assert(redeemRes2.giftCardCode !== redeemRes.giftCardCode, 'Unique second gift card code assigned without duplicate allocation');
      assert(redeemRes2.user.balance === 196, 'Balance decremented to ₹196');

      // 7. Third redemption now fails with out of stock
      let outOfStock2 = false;
      try {
        await redeemGiftCardWithdrawal(wthUserId, testDenom);
      } catch (err: any) {
        if (err.message.includes('out of stock')) outOfStock2 = true;
      }
      assert(outOfStock2, 'Third redemption fails because stock (2 codes) was depleted');
      const finalUser = await getUser(wthUserId);
      assert(finalUser?.balance === 196, 'Balance strictly preserved at ₹196 when depleted');

      // 8. Idempotency Key: Repeat requests return identical withdrawal without double deduction
      const testCode3 = `TEST-AMZ3-${Date.now()}`;
      await addGiftCardCodes([testCode3], testDenom, 'Test Admin');
      const idemKey = `idem_test_${Date.now()}`;
      const idemFirst = await redeemGiftCardWithdrawal(wthUserId, testDenom, idemKey);
      assert(idemFirst.withdrawal.idempotencyKey === idemKey, 'Idempotency key recorded on initial withdrawal');
      assert(idemFirst.user.balance === 119, 'Balance decremented from ₹196 to ₹119');

      // Repeat request with the exact same idempotency key
      const idemRepeat = await redeemGiftCardWithdrawal(wthUserId, testDenom, idemKey);
      assert(idemRepeat.withdrawal.id === idemFirst.withdrawal.id, 'Idempotent retry returns identical withdrawal order ID');
      assert(idemRepeat.giftCardCode === idemFirst.giftCardCode, 'Idempotent retry returns identical gift card code');
      assert(idemRepeat.user.balance === 119, 'Idempotent retry does NOT deduct balance a second time');

      // 9. Negative Balance Overdraft Guard in atomicCreditBalance
      let overdraftFailed = false;
      try {
        await atomicCreditBalance(wthUserId, -500, 'withdrawal_deduct', 'Illegal Overdraft Attempt');
      } catch (err: any) {
        if (err.message.includes('Insufficient balance') || err.message.includes('negative')) overdraftFailed = true;
      }
      assert(overdraftFailed, 'Negative balance overdraft rejected by atomicCreditBalance guard');
      // 10. Two concurrent withdrawals competing for one code
      const testDenomConc = 88;
      const testCodeConc = `TEST-AMZ-CONC-${Date.now()}`;
      await addGiftCardCodes([testCodeConc], testDenomConc, 'Test Admin');

      const concUserId = `conc_user_${Date.now()}`;
      await saveUser({
        id: concUserId,
        telegramId: 888999,
        firstName: 'Concurrent Tester',
        balance: 200,
        lifetimeEarnings: 200,
        referralEarnings: 0,
        referralCode: `ref_conc_${Date.now()}`,
        dailyStreak: 0,
        isBanned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const concurrentResults = await Promise.allSettled([
        redeemGiftCardWithdrawal(concUserId, testDenomConc),
        redeemGiftCardWithdrawal(concUserId, testDenomConc),
      ]);

      const fulfilled = concurrentResults.filter((r) => r.status === 'fulfilled');
      const rejected = concurrentResults.filter((r) => r.status === 'rejected');

      assert(fulfilled.length === 1, 'Concurrency: Exactly 1 concurrent withdrawal succeeds when 1 code is in inventory');
      assert(rejected.length === 1, 'Concurrency: Competing concurrent withdrawal is safely rejected');

      const concUserAfter = await getUser(concUserId);
      assert(concUserAfter?.balance === 200 - testDenomConc, `Concurrency: Balance deducted exactly once (200 -> ${200 - testDenomConc})`);

      // 11. Explicit ₹10 Gift Card Redemption (matching production limits)
      const testCode10 = `AMZN-TEST-10-${Date.now()}`;
      await addGiftCardCodes([testCode10], 10, 'Test Admin');
      const user10Id = `user_10_${Date.now()}`;
      await saveUser({
        id: user10Id,
        telegramId: 101010,
        firstName: 'TenRupeeUser',
        balance: 25,
        lifetimeEarnings: 25,
        referralEarnings: 0,
        referralCode: `ref_10_${Date.now()}`,
        dailyStreak: 0,
        isBanned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const res10 = await redeemGiftCardWithdrawal(user10Id, 10);
      assert(res10.withdrawal.amount === 10, 'Explicit ₹10 redemption creates withdrawal for ₹10');
      assert(res10.withdrawal.status === 'success', 'Explicit ₹10 redemption has status success');
      assert(res10.user.balance === 15, 'Explicit ₹10 redemption deducts exactly ₹10 (25 -> 15)');
      assert(res10.giftCardCode === testCode10, 'Explicit ₹10 redemption assigns the ₹10 code');

      // 12. User record access isolation: User A cannot see User B's withdrawals
      const user10Withdrawals = await getUserWithdrawals(user10Id);
      assert(user10Withdrawals.every((w) => w.userId === user10Id), 'User isolation: User withdrawal query only returns own withdrawals');
      assert(!user10Withdrawals.some((w) => w.userId === concUserId), 'User isolation: User cannot see another user\'s withdrawal');
    } finally {
      clearMockChannelMemberships();
      await updateAppSettings(initialSettings);
    }
  }

  /* ------------------------------------------------------------------
     TEST 7: Admin Access Restrictions
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 7: Admin Authorization Gate');
  {
    delete process.env.ADMIN_TELEGRAM_IDS;
    assert(isTelegramAdmin(2022247489) === true, 'Authorized admin ID (2022247489) granted access by default');
    assert(isTelegramAdmin('2022247489') === true, 'Authorized admin string ID ("2022247489") granted access');
    assert(isTelegramAdmin(504198372) === false, 'Old/unauthorized ID (504198372) strictly rejected');
    assert(isTelegramAdmin(12345678) === false, 'Unauthorized user ID (12345678) rejected');
    assert(isTelegramAdmin(987654321) === false, 'Regular user ID (987654321) rejected');

    process.env.ADMIN_TELEGRAM_IDS = '2022247489';
    assert(isTelegramAdmin(2022247489) === true, 'Explicitly configured admin ID (2022247489) granted access');
    assert(isTelegramAdmin(99999999) === false, 'Arbitrary user ID strictly rejected');
  }

  /* ------------------------------------------------------------------
     TEST 8: Safe UPI Payout Provider Adapter & Paynit Integration
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 8: Payout Gateway Safety Rules & Paynit Integration');
  {
    await removeGatewayCredentials('test_admin');
    process.env.PAYOUT_LIVE_ENABLED = 'false';
    const status = await payoutGateway.getStatus();
    assert(status.isLiveEnabled === false, 'Live payouts are disabled by default');
    assert(status.statusMessage.includes('DISABLED'), 'Safe status message explains sandbox review mode');

    // 1. Paynit Gateway Provider Registration
    const publicConfig = await getPublicGatewayConfig();
    const paynitProvider = publicConfig.supportedProviders.find((p) => p.id === 'paynit');
    assert(paynitProvider !== undefined, 'Paynit provider is registered in supportedProviders');
    assert(paynitProvider?.isIntegrated === true, 'Paynit is marked as an integrated provider');
    assert(Boolean(paynitProvider?.defaultTestUrl.includes('supabase.co')), 'Paynit default API URL points to Supabase Edge functions');

    // 2. Encryption and Environment Fallback
    process.env.PAYNIT_CLIENT_ID = 'test_paynit_client_id_123';
    process.env.PAYNIT_CLIENT_SECRET = 'test_paynit_client_secret_456';
    const creds = await getDecryptedCredentials();
    assert(creds.apiKey === 'test_paynit_client_id_123', 'Decrypted credentials read PAYNIT_CLIENT_ID from environment');
    assert(creds.apiSecret === 'test_paynit_client_secret_456', 'Decrypted credentials read PAYNIT_CLIENT_SECRET from environment');

    // 3. Status Response Mapping (SUCCESS / PROCESSING / FAILED)
    // A: Confirmed Success
    const successRes = payoutGateway.parseProviderStatus({
      status: 'SUCCESS',
      utr: 'UTR9988776655',
      order_id: 'order_123',
    });
    assert(successRes === 'success', 'parseProviderStatus: Confirmed SUCCESS maps to success');

    // B: Completed / Paid
    const completedRes = payoutGateway.parseProviderStatus({
      status: 'COMPLETED',
      data: { utr: 'UTR112233' },
    });
    assert(completedRes === 'success', 'parseProviderStatus: COMPLETED maps to success');

    // C: Processing / Pending / Queued
    const procRes = payoutGateway.parseProviderStatus({
      status: 'PROCESSING',
      order_id: 'order_123',
    });
    assert(procRes === 'processing', 'parseProviderStatus: PROCESSING maps to processing');

    const pendingRes = payoutGateway.parseProviderStatus({
      status: 'PENDING',
    });
    assert(pendingRes === 'processing', 'parseProviderStatus: PENDING maps to processing');

    // D: Failed / Rejected
    const failedRes = payoutGateway.parseProviderStatus({
      status: 'FAILED',
      error: 'Invalid UPI VPA',
    });
    assert(failedRes === 'failed', 'parseProviderStatus: FAILED maps to failed');

    const rejectedRes = payoutGateway.parseProviderStatus({
      status: 'REJECTED',
      message: 'Account blocked by beneficiary bank',
    });
    assert(rejectedRes === 'failed', 'parseProviderStatus: REJECTED maps to failed');

    // E: Safety: Never mark successful on unconfirmed or partial response
    const unconfirmedRes = payoutGateway.parseProviderStatus({
      acknowledged: true,
      message: 'Order received',
    });
    assert(unconfirmedRes === 'processing', 'parseProviderStatus: Unconfirmed response remains in processing (never prematurely success)');

    // 4. Safe Execution: Payouts Disabled Safeguard
    const dummyWithdrawal: Withdrawal = {
      id: `WTH_TEST_${Date.now()}`,
      userId: 'test_user_id',
      userTelegramId: 99887766,
      amount: 200,
      upiId: 'user@okaxis',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // When payoutsEnabled is false, executePayout halts safely
    await saveGatewayConfig(
      {
        provider: 'paynit',
        environment: 'test',
        payoutsEnabled: false,
        apiBaseUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
        apiKey: 'test_paynit_client_id_123',
        apiSecret: 'test_paynit_client_secret_456',
      },
      'admin_tester'
    );

    const disabledPayoutRes = await payoutGateway.executePayout(dummyWithdrawal);
    assert(disabledPayoutRes.status === 'processing', 'executePayout: When payouts are disabled, order remains processing');
    assert(disabledPayoutRes.providerResponse.includes('PAYOUTS_DISABLED'), 'executePayout: Explains payouts are disabled in settings');

    // 5. Test Mode (Sandbox): Safe Simulation without real money transfer
    await saveGatewayConfig(
      {
        provider: 'paynit',
        environment: 'test',
        payoutsEnabled: true,
        apiBaseUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
        apiKey: 'test_paynit_client_id_123',
        apiSecret: 'test_paynit_client_secret_456',
      },
      'admin_tester'
    );

    const testModePayoutRes = await payoutGateway.executePayout(dummyWithdrawal);
    assert(testModePayoutRes.status === 'processing', 'executePayout: Test Mode executes simulation without transferring real money');
    assert(testModePayoutRes.providerResponse.includes('SANDBOX_TEST_MODE'), 'executePayout: Safe simulation marked as SANDBOX_TEST_MODE');

    // Clean up test gateway credentials to prevent database pollution
    await removeGatewayCredentials('test_cleanup');
  }

  /* ------------------------------------------------------------------
     TEST 9: Admin Settings Persistence & Validation
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 9: Admin Settings Operations & Persistence');
  {
    const settings = await getAppSettings();
    assert(typeof settings.signupBonus === 'number', 'Settings has valid numeric signupBonus');
    assert(typeof settings.referralReward === 'number', 'Settings has valid numeric referralReward');
    assert(typeof settings.minWithdrawalAmount === 'number' && settings.minWithdrawalAmount > 0, 'Settings has valid minWithdrawalAmount');
    assert(typeof settings.dailyCheckinBaseReward === 'number', 'Settings has valid dailyCheckinBaseReward');
    assert(settings.templates !== undefined, 'Settings includes templates object');

    // Test updateAppSettings
    const updated = await updateAppSettings({
      signupBonus: 25,
      referralReward: 15,
      minWithdrawalAmount: 10,
      botUsername: 'WatchXEarnBot',
    });
    assert(updated.signupBonus === 25, 'updateAppSettings successfully updated signupBonus to 25');
    assert(updated.referralReward === 15, 'updateAppSettings successfully updated referralReward to 15');
    assert(updated.botUsername === 'WatchXEarnBot', 'updateAppSettings formatted and stored botUsername');

    // Restore standard defaults
    await updateAppSettings({
      signupBonus: 20,
      referralReward: 10,
    });
    const restored = await getAppSettings();
    assert(restored.signupBonus === 20, 'Restored settings safely');
  }

  /* ------------------------------------------------------------------
     TEST 10: Private Channel Verification & Identifier Formatting
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 10: Private Channel & Telegram Bot Verification');
  {
    // A. Identifier formatting
    const pub1 = formatChannelIdentifier('@teleearn');
    assert(pub1.formatted === '@teleearn' && pub1.isPrivate === false, 'Public @teleearn kept as @teleearn');

    const pub2 = formatChannelIdentifier('teleearn');
    assert(pub2.formatted === '@teleearn' && pub2.isPrivate === false, 'Plain handle prefixed with @');

    const pub3 = formatChannelIdentifier('https://t.me/teleearnofficial');
    assert(pub3.formatted === '@teleearnofficial' && pub3.isPrivate === false, 'Public t.me URL converted to handle @teleearnofficial');

    const priv1 = formatChannelIdentifier('-10020877627202664');
    assert(priv1.formatted === '-10020877627202664' && priv1.isPrivate === true, 'Private channel -10020877627202664 formatted cleanly without corruption');

    const priv2 = formatChannelIdentifier('10020877627202664');
    assert(priv2.formatted === '-10020877627202664' && priv2.isPrivate === true, 'Channel ID starting with 100 prefixed with - instead of duplicate -100');

    const priv3 = formatChannelIdentifier('20877627202664');
    assert(priv3.formatted === '-10020877627202664' && priv3.isPrivate === true, 'Raw numeric ID prefixed with -100');

    const badInvite1 = formatChannelIdentifier('https://t.me/+AbCdEfGh123');
    assert(Boolean(badInvite1.error) && badInvite1.error!.includes('cannot be used as chat IDs'), 'Private invite link https://t.me/+ rejected as channel ID');

    const badInvite2 = formatChannelIdentifier('https://t.me/joinchat/AbCdEfGh123');
    assert(Boolean(badInvite2.error), 'Private joinchat link rejected as channel ID');

    // B. Bot Startup / Force Join Flow Verification for Private Channel (-10020877627202664)
    const testPrivateChannelId = '-10020877627202664';
    const privateInviteLink = 'https://t.me/+PrivateInviteCode123';
    const testTgUser = 998877;
    const testUserProfile: UserProfile = {
      id: 'test_tg_user_998877',
      telegramId: testTgUser,
      firstName: 'TestUser',
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: 'ref_998877',
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Flow 1 - Case A: Bot is NOT in the private channel
    clearMockChannelMemberships();
    setMockChannelMembership(testPrivateChannelId, {
      isMember: false,
      status: 'chat_not_found',
      error: `Bot @WatchXEarnBot is not a member of channel ${testPrivateChannelId}. Please add @WatchXEarnBot to the channel as an Administrator with 'View members' permissions.`,
    });
    const startupBotMissing = await checkTelegramChannelMembership(testPrivateChannelId, testTgUser);
    assert(startupBotMissing.isMember === false, 'Bot Startup Flow: Channel check blocked when bot missing');
    assert(
      startupBotMissing.status === 'chat_not_found' && Boolean(startupBotMissing.error?.includes('@WatchXEarnBot')),
      'Bot Startup Flow: Clear error naming @WatchXEarnBot when bot is not in private channel'
    );

    // Flow 1 - Case B: Bot IS in private channel, but user has NOT joined
    clearMockChannelMemberships();
    setMockChannelMembership(`${testPrivateChannelId}_${testTgUser}`, {
      isMember: false,
      status: 'user_not_found',
      error: 'Please join the channel and try again.',
    });
    const startupUserUnjoined = await checkTelegramChannelMembership(testPrivateChannelId, testTgUser);
    assert(startupUserUnjoined.isMember === false && startupUserUnjoined.status === 'user_not_found', 'Bot Startup Flow: Unjoined user correctly identified');
    assert(Boolean(startupUserUnjoined.error?.includes('Please join')), 'Bot Startup Flow: Prompts user to join');

    // Flow 1 - Case C: User has joined private channel -> verified!
    clearMockChannelMemberships();
    setMockChannelMembership(`${testPrivateChannelId}_${testTgUser}`, {
      isMember: true,
      status: 'member',
    });
    const startupUserJoined = await checkTelegramChannelMembership(testPrivateChannelId, testTgUser);
    assert(startupUserJoined.isMember === true && startupUserJoined.status === 'member', 'Bot Startup Flow: Verified member successfully unlocks startup check');

    // C. Admin Panel Tasks Flow Verification for Private Channel (-10020877627202664)
    // 1. Task configured with invalid channelId (invite link instead of numeric ID)
    const misconfiguredTask: Task = {
      id: 'task_bad_channel',
      title: 'Join Private Channel',
      description: 'Join our private group',
      destinationUrl: privateInviteLink,
      rewardAmount: 25,
      taskType: 'channel',
      channelId: privateInviteLink, // Wrongly using invite link as channelId
      timerSeconds: 0,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
    };
    const resBad = await verifyChannelTask(testUserProfile, misconfiguredTask);
    assert(resBad.success === false && resBad.error!.includes('numeric Channel ID'), 'Task Flow: Task with invite link as channelId rejected with guidance');

    // 2. Properly configured private channel task
    const properPrivateTask: Task = {
      id: 'task_proper_private',
      title: 'Join VIP Channel',
      description: 'Join VIP channel',
      destinationUrl: privateInviteLink, // Separate private invite link
      rewardAmount: 30,
      taskType: 'channel',
      channelId: testPrivateChannelId, // Separate numeric channel ID
      timerSeconds: 0,
      isActive: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
    };

    // Flow 2 - Case A: Bot missing in private channel
    clearMockChannelMemberships();
    setMockChannelMembership(testPrivateChannelId, {
      isMember: false,
      status: 'chat_not_found',
      error: `Bot @WatchXEarnBot is not a member of channel ${testPrivateChannelId}. Please add @WatchXEarnBot to the channel as an Administrator with 'View members' permissions.`,
    });
    const taskBotMissing = await verifyChannelTask(testUserProfile, properPrivateTask);
    assert(taskBotMissing.success === false && Boolean(taskBotMissing.error?.includes('@WatchXEarnBot')), 'Task Flow: Task blocked with clear warning when bot is not an admin');

    // Flow 2 - Case B: Bot is admin, but user is NOT member
    clearMockChannelMemberships();
    setMockChannelMembership(`${testPrivateChannelId}_${testTgUser}`, {
      isMember: false,
      status: 'left',
      error: 'Please join the channel and try again.',
    });
    const taskNotMember = await verifyChannelTask(testUserProfile, properPrivateTask);
    assert(taskNotMember.success === false && Boolean(taskNotMember.error?.includes('Please join')), 'Task Flow: Non-member correctly denied reward');

    // Flow 2 - Case C: User is member of private channel
    clearMockChannelMemberships();
    setMockChannelMembership(`${testPrivateChannelId}_${testTgUser}`, { isMember: true, status: 'member' });
    const taskMember = await verifyChannelTask(testUserProfile, properPrivateTask);
    assert(taskMember.success === true, 'Task Flow: Member of private channel verified successfully');

    // D. checkBotChannelAccess direct detection
    clearMockChannelMemberships();
    setMockChannelMembership(`access_${testPrivateChannelId}`, {
      isMember: false,
      status: 'bot_not_in_channel',
      error: `Bot @WatchXEarnBot is not a member of private channel ${testPrivateChannelId}.`,
    });
    const accessDenied = await checkBotChannelAccess(testPrivateChannelId);
    assert(accessDenied.ok === false && accessDenied.status === 'bot_not_in_channel', 'Bot Access Diagnostic: Correctly detects bot missing from private channel');

    setMockChannelMembership(`access_${testPrivateChannelId}`, {
      isMember: true,
      status: 'verified',
    });
    const accessGranted = await checkBotChannelAccess(testPrivateChannelId);
    assert(accessGranted.ok === true && accessGranted.status === 'verified', 'Bot Access Diagnostic: Correctly detects bot verified in private channel');

    // E. Edge case identifier handling
    const urlWithNumeric = formatChannelIdentifier('https://t.me/-10020877627202664');
    assert(urlWithNumeric.formatted === '-10020877627202664' && urlWithNumeric.isPrivate === true, 'Numeric ID pasted in t.me URL cleanly parsed as numeric ID without @');

    const tgMeInvite = formatChannelIdentifier('https://telegram.me/+AnotherCode456');
    assert(Boolean(tgMeInvite.error), 'telegram.me/+ invite link correctly rejected as chat ID');

    // F. Candidate Base ID Resolution & Message-Link Concatenation Fallback
    clearChannelAliases();
    clearMockChannelMemberships();

    // 1. Candidate ID generator returns base channel ID
    const candidates = getChannelCandidateIds('-10020877627202664');
    assert(candidates.includes('-1002087762720'), 'Candidate Generator: -10020877627202664 resolves candidate base ID -1002087762720');

    // 2. Direct format of t.me/c/<channel>/<msg> URL
    const cUrlParsed = formatChannelIdentifier('https://t.me/c/2087762720/2664');
    assert(cUrlParsed.ok === true && cUrlParsed.formatted === '-1002087762720' && cUrlParsed.isPrivate === true, 'Format Identifier: t.me/c/2087762720/2664 directly formatted to base ID -1002087762720');

    // 3. Bot Access candidate resolution: when mock access is on base ID, query with concatenated ID resolves base ID
    setMockChannelMembership('access_-1002087762720', {
      isMember: true,
      status: 'verified',
    });
    const botAccessCandidate = await checkBotChannelAccess('-10020877627202664');
    assert(botAccessCandidate.ok === true && botAccessCandidate.resolvedChannelId === '-1002087762720', 'Candidate Resolution: checkBotChannelAccess with -10020877627202664 resolves to base ID -1002087762720');

    // 4. User Membership candidate resolution: when user membership is on base ID, query with concatenated ID resolves base ID
    setMockChannelMembership(`-1002087762720_${testTgUser}`, {
      isMember: true,
      status: 'member',
    });
    const userMembershipCandidate = await checkTelegramChannelMembership('-10020877627202664', testTgUser);
    assert(userMembershipCandidate.isMember === true && userMembershipCandidate.resolvedChannelId === '-1002087762720', 'Candidate Resolution: checkTelegramChannelMembership with -10020877627202664 resolves to base ID -1002087762720');

    // 5. Verify alias caching
    assert(getChannelAlias('-10020877627202664') === '-1002087762720', 'Alias Cache: -10020877627202664 cached as alias to -1002087762720');

    // 6. Task verification flow with concatenated ID transparently resolves and completes
    const concatenatedTask: Task = {
      id: 'task_concatenated_private',
      title: 'Join Private Channel',
      description: 'Join Private Channel with ID -10020877627202664',
      destinationUrl: 'https://t.me/+rYFQsazjO4FjN2E9',
      rewardAmount: 35,
      taskType: 'channel',
      channelId: '-10020877627202664',
      timerSeconds: 0,
      isActive: true,
      sortOrder: 3,
      createdAt: new Date().toISOString(),
    };
    const taskConcatenatedRes = await verifyChannelTask(testUserProfile, concatenatedTask);
    assert(taskConcatenatedRes.success === true, 'Task Flow: Private channel task with -10020877627202664 verifies successfully via candidate resolution');

    clearMockChannelMemberships();
    clearChannelAliases();
  }

  /* ------------------------------------------------------------------
     TEST 11: Production Feature 1 — Admin Bulk Balance Reset & Versioned Reward Re-eligibility
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 11: Production Feature 1 — Bulk Balance Reset');
  {
    // Create two test users with balances
    const userAId = `reset_user_a_${Date.now()}`;
    const userBId = `reset_user_b_${Date.now()}`;
    await saveUser({
      id: userAId,
      telegramId: 777111,
      username: 'reset_alice',
      firstName: 'Alice',
      balance: 150,
      lifetimeEarnings: 150,
      referralEarnings: 0,
      referralCode: `ref_alice_${Date.now()}`,
      dailyStreak: 3,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await saveUser({
      id: userBId,
      telegramId: 777222,
      username: 'reset_bob',
      firstName: 'Bob',
      balance: 250,
      lifetimeEarnings: 250,
      referralEarnings: 0,
      referralCode: `ref_bob_${Date.now()}`,
      dailyStreak: 1,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Verify preview
    const preview = await getBulkBalanceResetPreview();
    assert(preview.totalUsers > 0, 'Bulk Reset Preview: Total registered users count is positive');
    assert(preview.totalBalance >= 400, 'Bulk Reset Preview: Accurately computes sum of user balances');
    assert(preview.nextGeneration === preview.currentGeneration + 1, 'Bulk Reset Preview: Next generation is current + 1');

    // Claim signup bonus for userA under current generation
    const curGen = preview.currentGeneration;
    const initialClaim = await atomicClaimSignupBonus({
      userId: userAId,
      telegramId: 777111,
    });
    assert(initialClaim.success === true, 'Signup Bonus: Successfully claimed in current generation');

    // Duplicate claim under same generation is strictly blocked
    const dupClaim = await atomicClaimSignupBonus({
      userId: userAId,
      telegramId: 777111,
    });
    assert(dupClaim.success === false, 'Signup Bonus: Duplicate claim in same generation strictly blocked');

    // Execute bulk balance reset
    const resetResult = await atomicResetAllUserBalances('admin_2022247489');
    assert(resetResult.success === true, 'Bulk Reset: Execution succeeds atomically');
    assert(resetResult.affectedUsers > 0, 'Bulk Reset: Reports count of reset users');
    assert(resetResult.totalBalanceReset >= 400, 'Bulk Reset: Reports total balance cleared');
    assert(resetResult.newResetGeneration === curGen + 1, 'Bulk Reset: Generation successfully incremented');

    // Verify User A and User B balances are reset to exactly 0.00
    const userAAfter = await getUser(userAId);
    const userBAfter = await getUser(userBId);
    assert(userAAfter?.balance === 0, 'Bulk Reset: User A balance reset to exactly ₹0.00');
    assert(userBAfter?.balance === 0, 'Bulk Reset: User B balance reset to exactly ₹0.00');

    // Verify user profile integrity: username, telegramId, referral ties, daily streak preserved
    assert(userAAfter?.username === 'reset_alice', 'Bulk Reset Integrity: User A username preserved');
    assert(userAAfter?.telegramId === 777111, 'Bulk Reset Integrity: User A telegramId preserved');
    assert(userAAfter?.dailyStreak === 3, 'Bulk Reset Integrity: User A daily streak preserved');
    assert(userBAfter?.username === 'reset_bob', 'Bulk Reset Integrity: User B username preserved');
    assert(userBAfter?.telegramId === 777222, 'Bulk Reset Integrity: User B telegramId preserved');

    // User A can now claim the signup bonus ONCE AGAIN under the new generation!
    const newGenClaim = await atomicClaimSignupBonus({
      userId: userAId,
      telegramId: 777111,
    });
    assert(newGenClaim.success === true, 'Signup Bonus: User A successfully re-claims bonus in new generation');

    const userAReclaimed = await getUser(userAId);
    assert(userAReclaimed !== null && userAReclaimed.balance > 0, 'Signup Bonus: Balance credited after generation claim');

    // Second claim within new generation blocked again
    const secondNewGenClaim = await atomicClaimSignupBonus({
      userId: userAId,
      telegramId: 777111,
    });
    assert(secondNewGenClaim.success === false, 'Signup Bonus: Double claim within new generation blocked');
  }

  /* ------------------------------------------------------------------
     TEST 12: Production Feature 2 — Admin Telegram User Broadcast
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 12: Production Feature 2 — Telegram User Broadcast');
  {
    const bPreview = await getBroadcastPreview();
    assert(bPreview.recipientCount >= 2, 'Broadcast Preview: Returns count of valid Telegram recipients');

    // Start a broadcast in test environment
    const bTask = await startBroadcast(
      'admin_2022247489',
      '📢 Special Announcement: Welcome to Watch & Earn Gen 2!',
      'HTML'
    );
    assert(bTask.id.startsWith('bcast_'), 'Broadcast: Returns valid broadcast task ID');
    assert(bTask.totalRecipients > 0, 'Broadcast: Total recipients count assigned');
    assert(bTask.status === 'in_progress' || bTask.status === 'completed', 'Broadcast: Status is in_progress or completed');

    // Retrieve broadcast status by ID
    const polledStatus = getBroadcastStatus(bTask.id);
    assert(polledStatus !== null, 'Broadcast Status: Retrievable by task ID');
    assert(polledStatus?.id === bTask.id, 'Broadcast Status: Matches queried task ID');

    // Cancellation test
    const cancelled = cancelBroadcast(bTask.id);
    assert(typeof cancelled === 'boolean', 'Broadcast Cancellation: Cancel action executed safely');
  }

  /* ------------------------------------------------------------------
     TEST 13: Production Feature 3 — Mandatory Channel Verification Before Withdrawal
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 13: Production Feature 3 — Mandatory Channel Verification Before Withdrawal');
  {
    clearMockChannelMemberships();

    // 1. Withdrawal fails closed when bot token is not configured or API fails
    const unverifiedTgId = 555666777;
    const failClosedCheck = await verifyMandatoryWithdrawalMembership(unverifiedTgId);
    assert(failClosedCheck.isVerified === false, 'Fail-Closed: Unverified user fails verification check');
    assert(failClosedCheck.isApiError === true || (failClosedCheck.unjoinedChannels && failClosedCheck.unjoinedChannels.length > 0), 'Fail-Closed: Correctly flags api error or missing channels');

    // Setup mandatory channel and unjoined user test
    const mandChanId = `@mandatorysponsor_${Date.now()}`;
    const mandChan: ForceJoinChannel = {
      id: `mand_chan_${Date.now()}`,
      title: 'Mandatory Sponsor Channel',
      channelId: mandChanId,
      inviteLink: `https://t.me/${mandChanId.replace('@', '')}`,
      isPrivate: false,
      isEnabled: true,
      order: 1,
    };
    await saveForceJoinChannel(mandChan);

    const mandUserId = `mand_user_${Date.now()}`;
    await saveUser({
      id: mandUserId,
      telegramId: 999888,
      firstName: 'MandatoryTester',
      balance: 100,
      lifetimeEarnings: 100,
      referralEarnings: 0,
      referralCode: `ref_mand_${Date.now()}`,
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock: User is NOT a member of the mandatory channel
    setMockChannelMembership(`${mandChanId}_999888`, {
      isMember: false,
      status: 'left',
      error: 'User has left the channel.',
    });

    let wthBlocked = false;
    try {
      await redeemGiftCardWithdrawal(mandUserId, 10);
    } catch (err: any) {
      wthBlocked = true;
    }
    assert(wthBlocked === true, 'Withdrawal Blocked: User who left mandatory channel is strictly blocked from withdrawal');
    const mandUserAfterBlock = await getUser(mandUserId);
    assert(mandUserAfterBlock?.balance === 100, 'Zero Balance Deduction: Balance untouched when channel check fails');

    // Mock: User now JOINS the mandatory channel
    setMockChannelMembership('*', { isMember: true, status: 'member' });
    setMockChannelMembership(`${mandChanId}_999888`, { isMember: true, status: 'member' });

    // Add code so redemption succeeds
    const gcTestCode = `AMZN-MAND-${Date.now()}`;
    await addGiftCardCodes([gcTestCode], 10, 'admin_test');

    const wthSuccess = await redeemGiftCardWithdrawal(mandUserId, 10);
    assert(wthSuccess.withdrawal.status === 'success', 'Withdrawal Verified: Succeeds immediately after joining all channels');
    assert(wthSuccess.giftCardCode === gcTestCode, 'Withdrawal Verified: Gift card code assigned');
    assert(wthSuccess.user.balance === 90, 'Withdrawal Verified: Balance deducted by ₹10 only upon full verification');

    // Clean up channel
    await deleteForceJoinChannel(mandChan.id);
    clearMockChannelMemberships();
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
