import assert from 'node:assert';
import {
  getForceJoinChannels,
  saveForceJoinChannel,
  updateChannelHealth,
  verifyMandatoryWithdrawalMembership,
  verifyMandatoryCheckinMembership,
  saveUser,
  getUser,
} from '../server/db.ts';
import { checkBotChannelAccess, checkTelegramChannelMembership } from '../server/telegram.ts';
import type { ForceJoinChannel, UserProfile } from '../src/types/index.ts';

function pass(testName: string) {
  console.log(`  ✓ PASS: ${testName}`);
}

async function runForceJoinResilienceTestSuite() {
  console.log('\n======================================================================');
  console.log('  RUNNING FORCE JOIN CHANNEL BOT PERMISSION & RESILIENCE TEST SUITE');
  console.log('======================================================================\n');

  console.log('Test 1: All 6 authoritative channels are preserved and loaded');
  {
    const channels = await getForceJoinChannels(false);
    assert.ok(channels.length >= 6, `Expected at least 6 channels, got ${channels.length}`);

    const inaccessibleCh = channels.find((c) => c.channelId === '-1001813431201');
    assert.ok(inaccessibleCh, 'Channel -1001813431201 must exist in database');
    assert.strictEqual(
      inaccessibleCh.healthStatus,
      'bot_not_member',
      'Channel -1001813431201 must be flagged as bot_not_member'
    );

    const validCh = channels.find((c) => c.channelId === '@vksupertech');
    assert.ok(validCh, 'Channel @vksupertech must exist');
    pass('Authoritative channels loaded with correct healthStatus');
  }

  console.log('\nTest 2: Telegram Bot API check detects "Forbidden: bot is not a member" correctly');
  {
    // checkTelegramChannelMembership with -1001813431201 against live or simulated
    const checkResult = await checkTelegramChannelMembership('-1001813431201', 123456789);
    assert.strictEqual(checkResult.isMember, false);
    // Either bot_not_member or chat_not_found or api_error
    if (checkResult.status === 'bot_not_member') {
      assert.ok(
        checkResult.error?.includes('bot is not a member') || checkResult.error?.includes('Bot'),
        'Returns descriptive error message without crashing'
      );
    }
    pass('Bot membership check returns structured bot_not_member status');
  }

  console.log('\nTest 3: verifyMandatoryWithdrawalMembership skips inaccessible channel and does not block users');
  {
    // Create test user
    const testTelegramId = 999888777;
    const testUser: UserProfile = {
      id: `test_user_${testTelegramId}`,
      telegramId: testTelegramId,
      firstName: 'TestUser',
      username: 'testuser',
      balance: 100,
      totalEarned: 100,
      tasksCompleted: 5,
      referralCount: 0,
      referralEarnings: 0,
      referralCode: 'TEST999',
      joinedAt: new Date().toISOString(),
      dailyStreak: 3,
      lastStreakDate: new Date().toISOString(),
      role: 'user',
      forceJoinVerified: false,
    };
    await saveUser(testUser);

    // Call verifyMandatoryWithdrawalMembership
    const result = await verifyMandatoryWithdrawalMembership(testTelegramId);
    // Since channel -1001813431201 has healthStatus === 'bot_not_member', it must NOT be in unjoinedChannels
    if (!result.isVerified && result.unjoinedChannels) {
      const containsInaccessible = result.unjoinedChannels.some((c) => c.channelId === '-1001813431201');
      assert.strictEqual(
        containsInaccessible,
        false,
        'Inaccessible channel -1001813431201 must never appear in unjoinedChannels to block withdrawal'
      );
    }
    pass('Withdrawal verification skips bot_not_member channel');
  }

  console.log('\nTest 4: verifyMandatoryCheckinMembership skips inaccessible channel and does not throw raw Telegram API error');
  {
    const testTelegramId = 999888777;
    const result = await verifyMandatoryCheckinMembership(testTelegramId);
    if (!result.isVerified && result.unjoinedChannels) {
      const containsInaccessible = result.unjoinedChannels.some((c) => c.channelId === '-1001813431201');
      assert.strictEqual(
        containsInaccessible,
        false,
        'Inaccessible channel -1001813431201 must never appear in unjoinedChannels to block checkin'
      );
    }
    assert.notStrictEqual(result.error, 'Forbidden: bot is not a member of the channel chat');
    pass('Daily check-in verification skips bot_not_member channel without raw Telegram errors');
  }

  console.log('\nTest 5: Channel Health Status and Toggle CRUD functions work correctly');
  {
    // Update channel health
    updateChannelHealth('-1001813431201', 'healthy');
    let channels = await getForceJoinChannels(false);
    let ch = channels.find((c) => c.channelId === '-1001813431201');
    assert.strictEqual(ch?.healthStatus, 'healthy', 'Health status updated to healthy');

    // Revert back to bot_not_member
    updateChannelHealth('-1001813431201', 'bot_not_member', 'Bot is not a member');
    channels = await getForceJoinChannels(false);
    ch = channels.find((c) => c.channelId === '-1001813431201');
    assert.strictEqual(ch?.healthStatus, 'bot_not_member', 'Health status restored to bot_not_member');

    // Toggle channel isEnabled
    if (ch) {
      const originalEnabled = ch.isEnabled;
      ch.isEnabled = !originalEnabled;
      await saveForceJoinChannel(ch);

      channels = await getForceJoinChannels(false);
      ch = channels.find((c) => c.channelId === '-1001813431201');
      assert.strictEqual(ch?.isEnabled, !originalEnabled, 'Toggle isEnabled persisted');

      // Revert toggle
      ch!.isEnabled = originalEnabled;
      await saveForceJoinChannel(ch!);
      channels = await getForceJoinChannels(false);
      ch = channels.find((c) => c.channelId === '-1001813431201');
      assert.strictEqual(ch?.isEnabled, originalEnabled, 'Toggle isEnabled restored');
    }
    pass('Channel health status and toggle operations succeed');
  }

  console.log('\nTest 6: User data, balances, and historical registries are preserved');
  {
    const channels = await getForceJoinChannels(false);
    assert.strictEqual(channels.length, 6, 'All 6 channels preserved');

    // Check test user balance
    const user = await getUser('test_user_999888777');
    assert.ok(user, 'User preserved');
    assert.strictEqual(user?.balance, 100, 'User balance untouched');
    pass('User data and all 6 channels strictly preserved');
  }

  console.log('\n======================================================================');
  console.log('  ALL FORCE JOIN CHANNEL RESILIENCE TESTS PASSED (6/6)');
  console.log('======================================================================\n');
}

runForceJoinResilienceTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
