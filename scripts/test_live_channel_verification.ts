import assert from 'node:assert';
import {
  saveUser,
  getUser,
  memStore,
  saveForceJoinChannel,
  deleteForceJoinChannel,
  getForceJoinChannels,
} from '../server/db.ts';
import {
  setMockChannelMembership,
  clearMockChannelMemberships,
  checkTelegramChannelMembership,
} from '../server/telegram.ts';
import { handleTelegramBotUpdate } from '../server/bot.ts';
import type { TelegramUpdate } from '../server/bot.ts';
import type { UserProfile } from '../src/types/index.ts';

console.log('====================================================');
console.log('🧪 RUNNING TELEGRAM LIVE CHANNEL MEMBERSHIP VERIFICATION TEST SUITE');
console.log('====================================================\n');

async function runLiveMembershipTests() {
  const telegramId = 888777666;
  const userId = telegramId.toString();
  const chatId = telegramId;
  const appUrl = 'https://teleearn-preview.app';

  // Register a test channel for the verification suite
  const testChannel = {
    id: 'chan_test_suite_sponsor',
    title: 'Test Suite Channel',
    username: 'test_suite_sponsor',
    channelId: '@test_suite_sponsor',
    inviteLink: 'https://t.me/test_suite_sponsor',
    isPrivate: false,
    isEnabled: true,
    order: 1,
  };
  await saveForceJoinChannel(testChannel);

  // Retrieve all enabled channels
  const activeChannels = await getForceJoinChannels(true);
  console.log(`  Found ${activeChannels.length} active force-join channel(s) configured.`);

  function mockAllChannelsMembership(isMember: boolean, status: string, error?: string) {
    for (const ch of activeChannels) {
      setMockChannelMembership(`${ch.channelId}_${telegramId}`, { isMember, status, error });
      setMockChannelMembership(ch.channelId, { isMember, status, error });
    }
  }

  // Seed user
  const initialUser: UserProfile = {
    id: userId,
    telegramId,
    username: 'live_test_user',
    firstName: 'Live',
    lastName: 'Tester',
    balance: 50,
    lifetimeEarnings: 50,
    referralEarnings: 0,
    referralCode: `ref_${telegramId}_abc`,
    dailyStreak: 0,
    isBanned: false,
    forceJoinVerified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(initialUser);

  // Helper to create Telegram callback query update for "Verify Now"
  function createVerifyCallbackUpdate(queryId: string): TelegramUpdate {
    return {
      update_id: Math.floor(Math.random() * 100000),
      callback_query: {
        id: queryId,
        from: {
          id: telegramId,
          first_name: 'Live',
          username: 'live_test_user',
        },
        message: {
          chat: { id: chatId },
          message_id: 101,
        },
        data: 'verify_channels',
      },
    };
  }

  // ----------------------------------------------------
  // TEST 1: User joins channel -> Verify Now -> Access Granted
  // ----------------------------------------------------
  console.log('▶ TEST 1: User joins channel -> Verify Now -> Access granted...');
  mockAllChannelsMembership(true, 'member');

  await handleTelegramBotUpdate(createVerifyCallbackUpdate('query_1'), appUrl);

  let user = await getUser(userId);
  assert.strictEqual(user?.forceJoinVerified, true, 'User forceJoinVerified should be true in DB');
  console.log('  ✓ Access granted: User forceJoinVerified = true in database.');

  // ----------------------------------------------------
  // TEST 2: User leaves channel -> Verify Now -> Access Denied & Join Button Shown
  // ----------------------------------------------------
  console.log('\n▶ TEST 2: User leaves channel -> Verify Now -> Access denied & join prompt shown...');
  // Simulate user leaving channel (status 'left')
  mockAllChannelsMembership(false, 'left', 'Please join the channel and try again.');

  // Verify status check function itself reflects this
  const liveCheck = await checkTelegramChannelMembership(activeChannels[0]?.channelId || '@test_suite_sponsor', telegramId);
  assert.strictEqual(liveCheck.isMember, false, 'Live getChatMember returns not member');
  assert.strictEqual(liveCheck.status, 'left', 'Status is left');

  // Trigger "Verify Now" button again
  await handleTelegramBotUpdate(createVerifyCallbackUpdate('query_2'), appUrl);

  user = await getUser(userId);
  assert.strictEqual(user?.forceJoinVerified, false, 'User forceJoinVerified MUST be revoked to false in DB');
  console.log('  ✓ Access denied: forceJoinVerified revoked to false immediately.');

  // ----------------------------------------------------
  // TEST 3: User rejoins channel -> Verify Now -> Access Granted Again
  // ----------------------------------------------------
  console.log('\n▶ TEST 3: User rejoins channel -> Verify Now -> Access granted again...');
  mockAllChannelsMembership(true, 'member');

  await handleTelegramBotUpdate(createVerifyCallbackUpdate('query_3'), appUrl);

  user = await getUser(userId);
  assert.strictEqual(user?.forceJoinVerified, true, 'User forceJoinVerified restored to true in DB');
  console.log('  ✓ Access granted again: forceJoinVerified restored to true in DB.');

  // ----------------------------------------------------
  // TEST 4: Repeated verification calls never use stale cached status
  // ----------------------------------------------------
  console.log('\n▶ TEST 4: Repeated rapid verification calls always query live status...');
  // User leaves again
  mockAllChannelsMembership(false, 'left', 'Please join the channel and try again.');

  for (let i = 1; i <= 2; i++) {
    await handleTelegramBotUpdate(createVerifyCallbackUpdate(`query_rapid_${i}`), appUrl);
    user = await getUser(userId);
    assert.strictEqual(user?.forceJoinVerified, false, `Iteration ${i}: Must be false`);
  }
  console.log('  ✓ Verified repeated verification queries: Never trusted old true status.');

  // ----------------------------------------------------
  // TEST 5: Status 'kicked' or 'restricted' with is_member=false are rejected
  // ----------------------------------------------------
  console.log('\n▶ TEST 5: Kicked or restricted (is_member=false) treated as not joined...');
  mockAllChannelsMembership(false, 'kicked', 'Please join the channel and try again.');
  await handleTelegramBotUpdate(createVerifyCallbackUpdate('query_kicked'), appUrl);
  user = await getUser(userId);
  assert.strictEqual(user?.forceJoinVerified, false, 'Kicked status must deny access');

  // Creator and Administrator granted
  mockAllChannelsMembership(true, 'administrator');
  await handleTelegramBotUpdate(createVerifyCallbackUpdate('query_admin'), appUrl);
  user = await getUser(userId);
  assert.strictEqual(user?.forceJoinVerified, true, 'Administrator status must grant access');
  console.log('  ✓ Administrator / Member statuses verified successfully.');

  // ----------------------------------------------------
  // TEST 6: Telegram API Error -> Safe handling, no access granted from old result
  // ----------------------------------------------------
  console.log('\n▶ TEST 6: Telegram API error -> Does not grant access based on old result...');
  // First ensure user was revoked
  user!.forceJoinVerified = false;
  await saveUser(user!);

  mockAllChannelsMembership(false, 'api_error', 'Telegram API error: Bad Request: chat not found');
  await handleTelegramBotUpdate(createVerifyCallbackUpdate('query_error'), appUrl);
  user = await getUser(userId);
  assert.strictEqual(user?.forceJoinVerified, false, 'API error must not grant access');
  console.log('  ✓ Safe API error handling: user remains unverified.');

  // Clean up mock overrides and test channel
  clearMockChannelMemberships();
  await deleteForceJoinChannel(testChannel.id);

  console.log('\n====================================================');
  console.log('🎉 ALL LIVE CHANNEL MEMBERSHIP TESTS PASSED PERFECTLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runLiveMembershipTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
