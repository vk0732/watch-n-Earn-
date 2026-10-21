import assert from 'node:assert';
import {
  getUser,
  getAppSettings,
  getForceJoinChannels,
  saveForceJoinChannel,
  deleteForceJoinChannel,
} from '../server/db.ts';
import { handleTelegramBotUpdate } from '../server/bot.ts';
import type { TelegramUpdate } from '../server/bot.ts';

async function runVerification() {
  console.log('====================================================');
  console.log('🚀 LIVE VERIFICATION: BOT FLOW & CHANNEL ISOLATION');
  console.log('====================================================\n');

  // Ensure a test token that triggers fetch (not mock placeholder)
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    process.env.TELEGRAM_BOT_TOKEN = '8935005914:AAFakeTestTokenWithoutPlaceholderString';
  }

  // Intercept global fetch so bot sends mock responses rather than calling Telegram network API for test user
  const originalFetch = globalThis.fetch;
  const interceptedCalls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('api.telegram.org')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      interceptedCalls.push({ url: urlStr, body });

      if (urlStr.includes('getChatMember')) {
        return new Response(JSON.stringify({ ok: true, result: { status: 'member' } }), { status: 200 });
      }
      if (urlStr.includes('sendMessage')) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 888888 } }), { status: 200 });
      }
      if (urlStr.includes('answerCallbackQuery')) {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }
      if (urlStr.includes('deleteMessage')) {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    // ----------------------------------------------------
    // TEST 1: Confirm active Force Join channels is 0
    // ----------------------------------------------------
    console.log('▶ TEST 1: Check active channels count in repository...');
    const activeChannels = await getForceJoinChannels(true);
    console.log(`  Active channels count: ${activeChannels.length}`);
    console.log('  Active channels:', JSON.stringify(activeChannels, null, 2));
    assert.strictEqual(activeChannels.length, 0, 'Active channels MUST be 0 by default');

    const allChannels = await getForceJoinChannels(false);
    console.log(`  Total channels count (including disabled): ${allChannels.length}`);
    assert.strictEqual(allChannels.length, 0, 'Total channels MUST be 0 by default');
    console.log('  ✓ Verified: Zero force join channels configured in repository.\n');

    // ----------------------------------------------------
    // TEST 2: Confirm AppSettings has no TeleEarn references
    // ----------------------------------------------------
    console.log('▶ TEST 2: Check AppSettings configuration...');
    const settings = await getAppSettings();
    console.log(`  payoutChannelId: "${settings.payoutChannelId}"`);
    assert(
      !settings.payoutChannelId || !settings.payoutChannelId.toLowerCase().includes('teleearn'),
      'payoutChannelId MUST NOT contain TeleEarn'
    );
    console.log('  ✓ Verified: Settings contain no stale TeleEarn channel ID.\n');

    const testUserId = 777123456;
    const testChatId = testUserId;
    const appUrl = 'https://watchvearn-clone.test';

    // ----------------------------------------------------
    // TEST 3: /start command does NOT mention TeleEarn channels
    // ----------------------------------------------------
    console.log('▶ TEST 3: Send /start to bot...');
    interceptedCalls.length = 0;
    const startUpdate: TelegramUpdate = {
      update_id: 2001,
      message: {
        message_id: 201,
        from: {
          id: testUserId,
          first_name: 'CloneTester',
          username: 'clonetester',
        },
        chat: { id: testChatId, type: 'private' },
        text: '/start',
      },
    };

    await handleTelegramBotUpdate(startUpdate, appUrl);
    const startMsg = interceptedCalls.find((c) => c.url.includes('sendMessage'));
    assert(startMsg, 'Bot MUST reply to /start with sendMessage');
    console.log(`  Bot start message text:\n${startMsg.body.text}`);
    assert(!startMsg.body.text.includes('TeleEarnOfficial'), 'MUST NOT contain @TeleEarnOfficial');
    assert(!startMsg.body.text.includes('TeleEarnPayouts'), 'MUST NOT contain @TeleEarnPayouts');
    console.log('  ✓ Verified: /start contains no stale channel references.\n');

    // ----------------------------------------------------
    // TEST 4: scratch_signup callback when 0 channels configured
    // ----------------------------------------------------
    console.log('▶ TEST 4: Send scratch_signup callback to bot...');
    interceptedCalls.length = 0;
    const scratchUpdate: TelegramUpdate = {
      update_id: 2002,
      callback_query: {
        id: 'cb_scratch_test',
        from: {
          id: testUserId,
          first_name: 'CloneTester',
          username: 'clonetester',
        },
        message: {
          chat: { id: testChatId },
          message_id: 201,
        },
        data: 'scratch_signup',
      },
    };

    await handleTelegramBotUpdate(scratchUpdate, appUrl);
    const scratchMsg = interceptedCalls.find((c) => c.url.includes('sendMessage'));
    assert(scratchMsg, 'Bot MUST reply to scratch_signup with sendMessage');
    console.log(`  Scratch message text:\n${scratchMsg.body.text}`);

    assert(!scratchMsg.body.text.includes('TeleEarnOfficial'), 'MUST NOT contain @TeleEarnOfficial');
    assert(!scratchMsg.body.text.includes('TeleEarnPayouts'), 'MUST NOT contain @TeleEarnPayouts');
    assert(!scratchMsg.body.text.includes('Join our official sponsor channel(s)'), 'MUST NOT ask user to join nonexistent channels');

    const inlineKeyboard: any[][] = scratchMsg.body.reply_markup?.inline_keyboard || [];
    const buttonTexts = inlineKeyboard.flat().map((b: any) => b.text);
    console.log('  Attached buttons:', buttonTexts);

    const hasTeleEarn = buttonTexts.some((t: string) => t.toLowerCase().includes('teleearn'));
    assert(!hasTeleEarn, 'Attached buttons MUST NOT contain TeleEarn');
    const hasClaimBtn = buttonTexts.some((t: string) => t.includes('Claim') && t.includes('Bonus'));
    assert(hasClaimBtn, 'Must offer direct Claim Bonus button');
    console.log('  ✓ Verified: scratch_signup provides clean direct claim button without sponsor channels.\n');

    // ----------------------------------------------------
    // TEST 5: claim_scratch_bonus succeeds immediately when 0 channels configured
    // ----------------------------------------------------
    console.log('▶ TEST 5: Send claim_scratch_bonus callback to bot...');
    interceptedCalls.length = 0;
    const claimUpdate: TelegramUpdate = {
      update_id: 2003,
      callback_query: {
        id: 'cb_claim_test',
        from: {
          id: testUserId,
          first_name: 'CloneTester',
          username: 'clonetester',
        },
        message: {
          chat: { id: testChatId },
          message_id: 202,
        },
        data: 'claim_scratch_bonus',
      },
    };

    await handleTelegramBotUpdate(claimUpdate, appUrl);
    const claimSuccessMsg = interceptedCalls.find((c) => c.url.includes('sendMessage'));
    assert(claimSuccessMsg, 'Bot MUST reply with success message');
    console.log(`  Claim response message:\n${claimSuccessMsg.body.text}`);
    assert(claimSuccessMsg.body.text.includes('Signup Bonus Successfully Claimed'), 'MUST confirm bonus claimed');

    const user = await getUser(testUserId.toString());
    assert(user !== null, 'User profile must exist');
    assert(user!.balance > 0, `User balance must be positive, got ₹${user!.balance}`);
    assert.strictEqual(user!.signupBonusClaimed, true, 'signupBonusClaimed MUST be true');
    console.log(`  ✓ Verified: User balance credited with ₹${user!.balance} without any channel join blockage.\n`);

    // ----------------------------------------------------
    // TEST 6: verify_channels callback succeeds when 0 channels configured
    // ----------------------------------------------------
    console.log('▶ TEST 6: Send verify_channels callback to bot...');
    interceptedCalls.length = 0;
    const verifyUpdate: TelegramUpdate = {
      update_id: 2004,
      callback_query: {
        id: 'cb_verify_test',
        from: {
          id: testUserId,
          first_name: 'CloneTester',
          username: 'clonetester',
        },
        message: {
          chat: { id: testChatId },
          message_id: 203,
        },
        data: 'verify_channels',
      },
    };

    await handleTelegramBotUpdate(verifyUpdate, appUrl);
    const verifyMsg = interceptedCalls.find((c) => c.url.includes('sendMessage'));
    assert(verifyMsg, 'Bot MUST reply to verify_channels');
    console.log(`  Verify response text:\n${verifyMsg.body.text}`);
    assert(verifyMsg.body.text.includes('Channels Verified'), 'MUST confirm Channels Verified');
    console.log('  ✓ Verified: verify_channels succeeds cleanly with zero channels configured.\n');

    // ----------------------------------------------------
    // TEST 7: Admin channels CRUD remains fully operational
    // ----------------------------------------------------
    console.log('▶ TEST 7: Admin channel CRUD verification...');
    const customChannel = {
      id: `chan_custom_${Date.now()}`,
      title: 'Official Community Updates',
      username: 'mycustomchannel',
      channelId: '@mycustomchannel',
      inviteLink: 'https://t.me/mycustomchannel',
      isPrivate: false,
      isEnabled: true,
      order: 1,
    };

    await saveForceJoinChannel(customChannel);
    let channelsAfterAdd = await getForceJoinChannels(true);
    assert.strictEqual(channelsAfterAdd.length, 1, 'Repository must return exactly 1 channel after save');
    assert.strictEqual(channelsAfterAdd[0].channelId, '@mycustomchannel');
    console.log('  ✓ Custom channel saved and retrieved via repository.');

    await deleteForceJoinChannel(customChannel.id);
    let channelsAfterDelete = await getForceJoinChannels(true);
    assert.strictEqual(channelsAfterDelete.length, 0, 'Repository must return 0 channels after delete');
    console.log('  ✓ Custom channel deleted and repository cleanly updated.\n');

    console.log('====================================================');
    console.log('🎉 ALL 7 LIVE VERIFICATION TESTS PASSED PERFECTLY!');
    console.log('====================================================');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  }

  process.exit(0);
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
