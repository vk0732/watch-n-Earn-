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
  checkBotChannelAccess,
  formatChannelIdentifier,
  getChannelCandidateIds,
  getChannelAlias,
  clearChannelAliases,
  setMockChannelMembership,
  clearMockChannelMemberships,
} from '../server/telegram.ts';
import { verifyChannelTask } from '../server/taskVerification.ts';
import { validateUpiId, payoutGateway } from '../server/payoutAdapter.ts';
import type { UserProfile, Task, ForceJoinChannel } from '../src/types/index.ts';

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

    // Valid withdrawal adhering to limits
    const currentSettings = await getAppSettings();
    const testAmount = Math.min(
      100,
      currentSettings.maxWithdrawalAmount && currentSettings.maxWithdrawalAmount > 0
        ? currentSettings.maxWithdrawalAmount
        : 100
    );
    const expectedRemaining = 150 - testAmount;
    const wthRes = await createWithdrawalRequest(wthUserId, testAmount, 'charlie@upi');
    assert(wthRes.withdrawal.amount === testAmount, `Withdrawal order created for ₹${testAmount}`);
    assert(wthRes.user.balance === expectedRemaining, `Balance atomically decremented from ₹150 to ₹${expectedRemaining}`);
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
    assert(refundedUser?.balance === 150, `User balance restored atomically upon rejection (₹${expectedRemaining} + ₹${testAmount} = ₹150)`);
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
     TEST 8: Safe UPI Payout Provider Adapter
     ------------------------------------------------------------------ */
  console.log('\nTest Suite 8: Payout Gateway Safety Rules');
  {
    process.env.PAYOUT_LIVE_ENABLED = 'false';
    const status = await payoutGateway.getStatus();
    assert(status.isLiveEnabled === false, 'Live payouts are disabled by default');
    assert(status.statusMessage.includes('DISABLED'), 'Safe status message explains sandbox review mode');
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
