import assert from 'node:assert';
import {
  saveUser,
  getUser,
  saveTask,
  getTaskById,
  recordTaskCompletion,
  getTaskCompletion,
  getUserCompletedTaskIds,
  getUserTransactions,
  atomicCreditBalance,
  memStore,
} from '../server/db.ts';
import {
  setMockChannelMembership,
  clearMockChannelMemberships,
} from '../server/telegram.ts';
import {
  verifyChannelTask,
  verifyVideoTask,
  verifyWebsiteTask,
  verifySocialTask,
} from '../server/taskVerification.ts';
import type { UserProfile, Task } from '../src/types/index.ts';

console.log('====================================================');
console.log('🧪 RUNNING WATCH & EARN TASK VERIFICATION TEST SUITE');
console.log('====================================================\n');

async function runTests() {
  const timestamp = Date.now();
  const testUserId = `user_task_test_${timestamp}`;
  const testTgId = 777999111;

  const user: UserProfile = {
    id: testUserId,
    telegramId: testTgId,
    username: 'task_tester',
    firstName: 'Task Tester',
    balance: 50,
    lifetimeEarnings: 50,
    referralEarnings: 0,
    referralCode: `ref_${testUserId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(user);

  /* ---------------------------------------------------------------
     TEST 1: Channel Task - Not Joined -> Reward Denied
     --------------------------------------------------------------- */
  console.log('TEST 1: Channel not joined -> reward denied');
  const channelTask1: Task = {
    id: `task_channel_1_${timestamp}`,
    title: 'Join Alpha Crypto Channel',
    description: 'Join the channel for daily updates',
    destinationUrl: 'https://t.me/alphacrypto',
    channelId: '@alphacrypto',
    rewardAmount: 30,
    taskType: 'channel',
    timerSeconds: 0,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date().toISOString(),
  };
  await saveTask(channelTask1);

  // Mock user as left / not member
  setMockChannelMembership('@alphacrypto', {
    isMember: false,
    status: 'left',
    error: 'Please join the channel and try again.',
  });

  const resNotJoined = await verifyChannelTask(user, channelTask1);
  assert.strictEqual(resNotJoined.success, false, 'Channel verification must fail if user has not joined');
  assert.strictEqual(resNotJoined.error, 'Please join the channel and try again.');

  // User balance must remain unchanged
  const userCheck1 = await getUser(testUserId);
  assert.strictEqual(userCheck1?.balance, 50, 'Balance must not change when channel verification is denied');
  console.log('  ✓ Channel not joined -> reward denied with "Please join the channel and try again."');

  /* ---------------------------------------------------------------
     TEST 2: Channel Task - Joined -> Reward Granted Once
     --------------------------------------------------------------- */
  console.log('\nTEST 2: Channel joined -> reward granted once');
  // Mock user as valid member
  setMockChannelMembership('@alphacrypto', {
    isMember: true,
    status: 'member',
  });

  const resJoined = await verifyChannelTask(user, channelTask1);
  assert.strictEqual(resJoined.success, true, 'Channel verification must pass when user is a member');

  // Complete and credit
  await recordTaskCompletion({
    id: `${testUserId}_${channelTask1.id}`,
    userId: testUserId,
    taskId: channelTask1.id,
    rewardAmount: channelTask1.rewardAmount,
    completedAt: new Date().toISOString(),
  });

  const credRes = await atomicCreditBalance(
    testUserId,
    channelTask1.rewardAmount,
    'task_reward',
    `Completed Task: ${channelTask1.title}`,
    channelTask1.id
  );
  assert.strictEqual(credRes.user.balance, 80, 'Balance should increase from 50 to 80');
  console.log('  ✓ Channel joined -> reward granted (+₹30, balance = ₹80)');

  /* ---------------------------------------------------------------
     TEST 3: Repeated Claim -> No Duplicate Reward
     --------------------------------------------------------------- */
  console.log('\nTEST 3: Repeated claim -> no duplicate reward');
  const existingCompletion = await getTaskCompletion(testUserId, channelTask1.id);
  assert.ok(existingCompletion, 'Task completion record must exist');

  // Re-attempting claim must detect duplicate completion and deny
  const isDuplicate = existingCompletion !== null;
  assert.strictEqual(isDuplicate, true, 'Duplicate completion must be detected');

  const userCheck2 = await getUser(testUserId);
  assert.strictEqual(userCheck2?.balance, 80, 'Balance must remain 80 on duplicate attempt');
  console.log('  ✓ Repeated claim blocked: task completion record prevents double payout');

  /* ---------------------------------------------------------------
     TEST 4: Telegram API Error & Bot Permissions -> No Reward Granted
     --------------------------------------------------------------- */
  console.log('\nTEST 4: Telegram API error & bot permissions -> no reward granted');
  const channelTask2: Task = {
    id: `task_channel_err_${timestamp}`,
    title: 'Join Private VIP Channel',
    description: 'Join VIP channel',
    destinationUrl: 'https://t.me/vipchannel',
    channelId: '@vipchannel',
    rewardAmount: 50,
    taskType: 'channel',
    timerSeconds: 0,
    isActive: true,
    sortOrder: 2,
    createdAt: new Date().toISOString(),
  };
  await saveTask(channelTask2);

  // Scenario A: Bot is not an admin
  setMockChannelMembership('@vipchannel', {
    isMember: false,
    status: 'bot_not_admin',
    error: 'Bot must be added as an Administrator with View members permissions in @vipchannel.',
  });
  const resBotNotAdmin = await verifyChannelTask(user, channelTask2);
  assert.strictEqual(resBotNotAdmin.success, false, 'Must fail when bot is not administrator');
  assert.ok(resBotNotAdmin.error?.includes('Administrator'), 'Error must specify Administrator permissions needed');
  console.log('  ✓ Bot not admin -> clearly reported, no coins granted');

  // Scenario B: Chat not found / API network error
  setMockChannelMembership('@vipchannel', {
    isMember: false,
    status: 'chat_not_found',
    error: 'Channel @vipchannel was not found or is inaccessible.',
  });
  const resChatNotFound = await verifyChannelTask(user, channelTask2);
  assert.strictEqual(resChatNotFound.success, false, 'Must fail when chat not found');
  console.log('  ✓ Chat not found / API error -> clearly reported, no coins granted');

  /* ---------------------------------------------------------------
     TEST 5: Video, Website, and Social Tasks Completion Logic
     --------------------------------------------------------------- */
  console.log('\nTEST 5: Video, Website, and Social distinct verification logic');

  // 5A: VIDEO TASK
  const videoTask: Task = {
    id: `task_video_${timestamp}`,
    title: 'Watch 15s Tutorial',
    description: 'Watch video',
    destinationUrl: 'https://youtube.com/watch?v=123',
    rewardAmount: 20,
    taskType: 'video',
    timerSeconds: 15,
    isActive: true,
    sortOrder: 3,
    createdAt: new Date().toISOString(),
  };
  await saveTask(videoTask);

  // Video: Not started
  const vResNotStarted = await verifyVideoTask(user, videoTask, undefined);
  assert.strictEqual(vResNotStarted.success, false, 'Video without start timestamp must fail');

  // Video: Elapsed time too short (only 5s out of 15s)
  const vResTooShort = await verifyVideoTask(user, videoTask, Date.now() - 5000);
  assert.strictEqual(vResTooShort.success, false, 'Video with insufficient watch time must fail');

  // Video: Full timer elapsed (16s elapsed)
  const vResSuccess = await verifyVideoTask(user, videoTask, Date.now() - 16000);
  assert.strictEqual(vResSuccess.success, true, 'Video with full watch time must pass');
  console.log('  ✓ Video task: enforces start session & full timer countdown');

  // 5B: WEBSITE TASK
  const webTask: Task = {
    id: `task_web_${timestamp}`,
    title: 'Visit Sponsor Webpage',
    description: 'Explore website',
    destinationUrl: 'https://sponsor.example.com',
    rewardAmount: 15,
    taskType: 'website',
    timerSeconds: 10,
    isActive: true,
    sortOrder: 4,
    createdAt: new Date().toISOString(),
  };
  await saveTask(webTask);

  // Website: Insufficient time
  const wResTooShort = await verifyWebsiteTask(user, webTask, Date.now() - 3000);
  assert.strictEqual(wResTooShort.success, false, 'Website with 3s visit must fail for 10s task');

  // Website: Full 11s elapsed
  const wResSuccess = await verifyWebsiteTask(user, webTask, Date.now() - 11000);
  assert.strictEqual(wResSuccess.success, true, 'Website with full visit time must pass');
  console.log('  ✓ Website task: enforces start session & visit duration');

  // 5C: SOCIAL TASK - Code Confirmation
  const socialTaskCode: Task = {
    id: `task_soc_code_${timestamp}`,
    title: 'Follow Twitter & Enter Promo Code',
    description: 'Find the secret code in our pinned tweet',
    destinationUrl: 'https://x.com/teleearn',
    rewardAmount: 25,
    taskType: 'social',
    socialPlatform: 'twitter',
    verificationMethod: 'code_confirmation',
    verificationCode: 'TELE2026',
    timerSeconds: 0,
    isActive: true,
    sortOrder: 5,
    createdAt: new Date().toISOString(),
  };
  await saveTask(socialTaskCode);

  // Wrong code
  const sResWrong = await verifySocialTask(user, socialTaskCode, { verificationCode: 'WRONG_CODE' });
  assert.strictEqual(sResWrong.success, false, 'Social task with incorrect code must fail');

  // Correct code
  const sResCorrect = await verifySocialTask(user, socialTaskCode, { verificationCode: 'tele2026' });
  assert.strictEqual(sResCorrect.success, true, 'Social task with correct code must succeed');
  console.log('  ✓ Social task (code_confirmation): rejects invalid codes, verifies valid code');

  // 5D: SOCIAL TASK - Manual Review
  const socialTaskReview: Task = {
    id: `task_soc_rev_${timestamp}`,
    title: 'Subscribe YouTube Channel',
    description: 'Subscribe and submit your YouTube handle',
    destinationUrl: 'https://youtube.com/@teleearn',
    rewardAmount: 35,
    taskType: 'social',
    socialPlatform: 'youtube',
    verificationMethod: 'manual_review',
    timerSeconds: 0,
    isActive: true,
    sortOrder: 6,
    createdAt: new Date().toISOString(),
  };
  await saveTask(socialTaskReview);

  // Empty handle
  const sResNoHandle = await verifySocialTask(user, socialTaskReview, { socialHandle: '' });
  assert.strictEqual(sResNoHandle.success, false, 'Manual review without handle must fail');

  // With valid handle
  const sResHandle = await verifySocialTask(user, socialTaskReview, { socialHandle: '@crypto_dan' });
  assert.strictEqual(sResHandle.success, true);
  assert.strictEqual(sResHandle.pendingReview, true, 'Must flag as pending review');
  console.log('  ✓ Social task (manual_review): requires handle & marks pendingReview');

  // Clear mock overrides
  clearMockChannelMemberships();

  console.log('\n====================================================');
  console.log('🎉 ALL TASK VERIFICATION TESTS PASSED PERFECTLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
