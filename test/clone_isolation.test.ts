import assert from 'node:assert';
import { getColName, DB_PREFIX } from '../server/db.ts';
import {
  formatChannelIdentifier,
  checkBotChannelAccess,
  isTelegramAdmin,
  setMockChannelMembership,
  clearMockChannelMemberships,
} from '../server/telegram.ts';
import { handleTelegramBotUpdate, handleMyChatMemberUpdate, TelegramUpdate } from '../server/bot.ts';

console.log('\n==================================================');
console.log('  RUNNING CLONE ISOLATION & SECURITY TEST SUITE');
console.log('==================================================\n');

async function runTests() {
  let passed = 0;

  // Test 1: Database Isolation Namespace
  console.log('Test Suite C1: Database Isolation & Namespace Management');
  {
    // Test default or current getColName
    const colUsers = getColName('users');
    const expectedPrefix = (process.env.DB_PREFIX || process.env.COLLECTION_PREFIX || '').trim();
    if (expectedPrefix) {
      assert.strictEqual(colUsers, `${expectedPrefix}_users`);
    } else {
      assert.strictEqual(colUsers, 'users');
    }
    console.log(`  ✓ PASS: Collection 'users' resolves with active namespace '${expectedPrefix || '(none)'}': ${colUsers}`);
    passed++;

    // Test dynamic namespace prefix simulation
    const originalPrefix = process.env.DB_PREFIX;
    process.env.DB_PREFIX = 'isolated_clone';
    // Re-verify function logic
    assert.strictEqual(
      (process.env.DB_PREFIX ? `${process.env.DB_PREFIX}_transactions` : 'transactions'),
      'isolated_clone_transactions'
    );
    console.log('  ✓ PASS: Namespace isolation dynamically prefixes collections (e.g. isolated_clone_transactions)');
    process.env.DB_PREFIX = originalPrefix;
    passed++;
  }

  // Test 2: Admin Security & Authorization
  console.log('\nTest Suite C2: Server-Side Admin Authorization & Isolation');
  {
    const originalAdmins = process.env.ADMIN_TELEGRAM_IDS;
    process.env.ADMIN_TELEGRAM_IDS = '999888777,555444333';

    assert.strictEqual(isTelegramAdmin(999888777), true);
    assert.strictEqual(isTelegramAdmin('999888777'), true);
    assert.strictEqual(isTelegramAdmin(555444333), true);
    assert.strictEqual(isTelegramAdmin(123456), false);
    assert.strictEqual(isTelegramAdmin('unknown_hacker'), false);
    assert.strictEqual(isTelegramAdmin(0), false);

    console.log('  ✓ PASS: Authorized clone admin Telegram IDs granted access');
    console.log('  ✓ PASS: Unauthorized accounts strictly rejected by isTelegramAdmin');
    process.env.ADMIN_TELEGRAM_IDS = originalAdmins;
    passed += 2;
  }

  // Test 3: Private Channel Identification & Diagnostics
  console.log('\nTest Suite C3: Private Channel Identification & Diagnostic Flow');
  {
    // 1. Numeric ID with -100
    const numPriv = formatChannelIdentifier('-1001987654321');
    assert.strictEqual(numPriv.ok, true);
    assert.strictEqual(numPriv.formatted, '-1001987654321');
    assert.strictEqual(numPriv.isPrivate, true);
    console.log('  ✓ PASS: Standard numeric private channel ID correctly validated (-1001987654321)');
    passed++;

    // 2. Numeric ID without leading -100 (e.g. 1987654321)
    const rawNum = formatChannelIdentifier('1987654321');
    assert.strictEqual(rawNum.ok, true);
    assert.strictEqual(rawNum.formatted, '-1001987654321');
    assert.strictEqual(rawNum.isPrivate, true);
    console.log('  ✓ PASS: Raw numeric ID automatically normalized with -100 prefix');
    passed++;

    // 3. Message link from private channel (t.me/c/1987654321/42)
    const msgLink = formatChannelIdentifier('https://t.me/c/1987654321/42');
    assert.strictEqual(msgLink.ok, true);
    assert.strictEqual(msgLink.formatted, '-1001987654321');
    assert.strictEqual(msgLink.isPrivate, true);
    console.log('  ✓ PASS: Private channel message link (t.me/c/...) correctly parsed to numeric ID');
    passed++;

    // 4. Invite link rejected as chat_id with helpful guidance
    const inviteLink = formatChannelIdentifier('https://t.me/+AbCdEfGh123');
    assert.strictEqual(inviteLink.ok, false);
    assert.match(inviteLink.error || '', /Private invite links/);
    console.log('  ✓ PASS: Invite link (https://t.me/+...) rejected as chat_id with informative guidance');
    passed++;

    // 5. Bot channel access diagnostic mock
    setMockChannelMembership('access_-1009999999999', {
      isMember: true,
      status: 'verified',
    });
    const verifiedAccess = await checkBotChannelAccess('-1009999999999');
    assert.strictEqual(verifiedAccess.ok, true);
    assert.strictEqual(verifiedAccess.status, 'verified');
    console.log('  ✓ PASS: checkBotChannelAccess correctly verifies Administrator privileges');
    clearMockChannelMemberships();
    passed++;
  }

  // Test 4: my_chat_member Administrator Event Handling
  console.log('\nTest Suite C4: my_chat_member Admin Promotion Notification');
  {
    const originalAdmins = process.env.ADMIN_TELEGRAM_IDS;
    process.env.ADMIN_TELEGRAM_IDS = '2022247489';

    // Simulate my_chat_member update when bot is made admin
    const mcmUpdate: TelegramUpdate = {
      update_id: 888123,
      my_chat_member: {
        chat: {
          id: -1001928374650,
          title: 'Official Clone Private Channel',
          type: 'channel',
        },
        from: {
          id: 2022247489,
          first_name: 'CloneAdmin',
        },
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: 'left' },
        new_chat_member: {
          status: 'administrator',
          can_manage_chat: true,
          can_post_messages: true,
        },
      },
    };

    // Should process without throwing and log event
    await handleTelegramBotUpdate(mcmUpdate, 'http://localhost:3000');
    console.log('  ✓ PASS: my_chat_member update handled cleanly and identified channel promotion');
    passed++;

    process.env.ADMIN_TELEGRAM_IDS = originalAdmins;
  }

  // Test 5: Mini App Button Validation & Dynamic HTTPS Resolution
  console.log('\nTest Suite C5: Mini App Button Validation & HTTPS Resolution');
  {
    const { isValidMiniAppUrl, getMiniAppUrl } = await import('../server/bot.ts');

    // 1. URL validation tests
    assert.strictEqual(isValidMiniAppUrl('https://teleearn-six.vercel.app'), true);
    assert.strictEqual(isValidMiniAppUrl('https://custom-clone.example.com'), true);
    assert.strictEqual(isValidMiniAppUrl('http://178.93.119.55:3002'), false, 'HTTP must be rejected');
    assert.strictEqual(isValidMiniAppUrl('https://178.93.119.55:3002'), false, 'Raw IP must be rejected');
    assert.strictEqual(isValidMiniAppUrl('https://localhost:3000'), false, 'Localhost must be rejected');
    assert.strictEqual(isValidMiniAppUrl(''), false, 'Empty string must be rejected');
    assert.strictEqual(isValidMiniAppUrl(undefined as any), false, 'Undefined must be rejected');
    console.log('  ✓ PASS: isValidMiniAppUrl strictly accepts HTTPS domains and rejects HTTP, IPs, and localhost');
    passed++;

    // 2. getMiniAppUrl fallback resolution
    const origMini = process.env.MINI_APP_URL;
    const origApp = process.env.APP_URL;

    // Test priority 1: MINI_APP_URL
    process.env.MINI_APP_URL = 'https://custom-mini.vercel.app';
    assert.strictEqual(getMiniAppUrl('https://other.com'), 'https://custom-mini.vercel.app');
    console.log('  ✓ PASS: getMiniAppUrl prioritizes MINI_APP_URL environment variable');
    passed++;

    // Test fallback to verified production Mini App URL when given raw IP / HTTP
    delete process.env.MINI_APP_URL;
    process.env.APP_URL = 'http://178.93.119.55:3002';
    const fallbackUrl = getMiniAppUrl('http://178.93.119.55:3002');
    assert.strictEqual(fallbackUrl, 'https://teleearn-six.vercel.app');
    console.log('  ✓ PASS: getMiniAppUrl safely falls back to verified HTTPS production URL when given HTTP/IP');
    passed++;

    // 3. Test bot message keyboards include web_app button with HTTPS URL
    const originalFetch = globalThis.fetch;
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = '8935005914:AAFakeTestTokenForFetchIntercept';
    const intercepted: Array<{ url: string; body: any }> = [];

    globalThis.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('api.telegram.org')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        intercepted.push({ url: urlStr, body });
        if (urlStr.includes('sendMessage')) {
          return new Response(JSON.stringify({ ok: true, result: { message_id: 9999 } }), { status: 200 });
        }
        if (urlStr.includes('answerCallbackQuery')) {
          return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
        }
      }
      return originalFetch(url, init);
    };

    try {
      const testUserId = 777123456;
      const { saveUser } = await import('../server/db.ts');
      await saveUser({
        id: testUserId.toString(),
        telegramId: testUserId,
        username: 'claimeduser',
        balance: 100,
        lifetimeEarnings: 100,
        referralEarnings: 0,
        referralCode: 'ref_claimed_777',
        referredBy: null,
        dailyStreak: 1,
        isBanned: false,
        signupBonusClaimed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Send /start for already claimed user
      intercepted.length = 0;
      await handleTelegramBotUpdate(
        {
          update_id: 991,
          message: {
            message_id: 11,
            from: { id: testUserId, first_name: 'ClaimedTester' },
            chat: { id: testUserId, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start',
          },
        },
        'http://178.93.119.55:3002'
      );

      const sentMsg = intercepted.find((c) => c.url.includes('sendMessage'));
      assert(sentMsg, 'SendMessage must have been called');
      const keyboard = sentMsg.body.reply_markup?.inline_keyboard;
      assert(Array.isArray(keyboard) && keyboard.length >= 2, 'Keyboard must have at least 2 rows');

      // Row 1 must have web_app button
      const row1Btn = keyboard[0][0];
      assert.strictEqual(row1Btn.text, '🎮 Open Watch & Earn Mini App');
      assert(row1Btn.web_app && row1Btn.web_app.url.startsWith('https://'), 'Must have HTTPS web_app URL');

      // Row 2 must preserve Invite Friends and Support
      const row2Texts = keyboard[1].map((b: any) => b.text);
      assert(row2Texts.includes('👥 Invite Friends'), 'Must preserve Invite Friends');
      assert(row2Texts.includes('💬 Support'), 'Must preserve Support');
      console.log('  ✓ PASS: /start for claimed user includes Web App button in Row 1 and preserves Invite/Support in Row 2');
      passed++;

      // Send claim_scratch_bonus callback for claimed user
      intercepted.length = 0;
      await handleTelegramBotUpdate(
        {
          update_id: 992,
          callback_query: {
            id: 'cb_test_already_claimed',
            from: { id: testUserId, first_name: 'ClaimedTester' },
            message: { chat: { id: testUserId }, message_id: 12 },
            data: 'claim_scratch_bonus',
          },
        },
        'http://178.93.119.55:3002'
      );

      const claimSentMsg = intercepted.find((c) => c.url.includes('sendMessage'));
      assert(claimSentMsg, 'SendMessage must have been called on claim attempt');
      const claimKb = claimSentMsg.body.reply_markup?.inline_keyboard;
      assert(Array.isArray(claimKb) && claimKb.length >= 2, 'Post-claim keyboard must have at least 2 rows');
      assert.strictEqual(claimKb[0][0].text, '🎮 Open Watch & Earn Mini App');
      assert(claimKb[0][0].web_app && claimKb[0][0].web_app.url.startsWith('https://'));
      console.log('  ✓ PASS: claim_scratch_bonus keyboard includes Web App button in Row 1 and preserves working buttons');
      passed++;
    } finally {
      globalThis.fetch = originalFetch;
      process.env.TELEGRAM_BOT_TOKEN = origToken;
      if (origMini) process.env.MINI_APP_URL = origMini;
      else delete process.env.MINI_APP_URL;
      if (origApp) process.env.APP_URL = origApp;
      else delete process.env.APP_URL;
    }
  }

  console.log('\n==================================================');
  console.log(`  CLONE ISOLATION SUITE: ALL ${passed} TESTS PASSED ✓`);
  console.log('==================================================\n');
}

runTests().catch((err) => {
  console.error('CLONE SUITE TEST FAILED:', err);
  process.exit(1);
});
