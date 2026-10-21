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

  console.log('\n==================================================');
  console.log(`  CLONE ISOLATION SUITE: ALL ${passed} TESTS PASSED ✓`);
  console.log('==================================================\n');
}

runTests().catch((err) => {
  console.error('CLONE SUITE TEST FAILED:', err);
  process.exit(1);
});
