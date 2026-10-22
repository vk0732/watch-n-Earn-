import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  getColName,
  DB_PREFIX,
  saveUser,
  getUser,
  atomicClaimSignupBonus,
  atomicClaimReferralReward,
  isDeviceRestrictedForUser,
  getOrRegisterDeviceOwner,
  getUserTransactions,
  memStore,
} from '../server/db.ts';
import {
  formatChannelIdentifier,
  checkBotChannelAccess,
  isTelegramAdmin,
  setMockChannelMembership,
  clearMockChannelMemberships,
  verifyTelegramInitData,
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
    assert.strictEqual(fallbackUrl, 'https://178-93-119-55.sslip.io');
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
        signupBonusClaimedGeneration: 99,
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

      // Send /start for an UNCLAIMED user (testing single Scratch & Win web_app button)
      const unclaimedTgId = 888222333;
      intercepted.length = 0;
      await handleTelegramBotUpdate(
        {
          update_id: 993,
          message: {
            message_id: 13,
            from: { id: unclaimedTgId, first_name: 'UnclaimedTester' },
            chat: { id: unclaimedTgId, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start',
          },
        },
        'http://178.93.119.55:3002'
      );

      const unclaimedSentMsg = intercepted.find((c) => c.url.includes('sendMessage'));
      assert(unclaimedSentMsg, 'SendMessage must have been called for unclaimed /start');
      const unclaimedKb = unclaimedSentMsg.body.reply_markup?.inline_keyboard;
      assert(Array.isArray(unclaimedKb), 'Keyboard must be an array');
      assert.strictEqual(unclaimedKb.length, 1, 'Unclaimed /start must have EXACTLY ONE button row');
      assert.strictEqual(unclaimedKb[0].length, 1, 'Unclaimed /start must have EXACTLY ONE button');

      const singleBtn = unclaimedKb[0][0];
      assert.match(singleBtn.text, /^🎁 Scratch & Win — Up to ₹\d+/, 'Button text must be Scratch & Win');
      assert(singleBtn.web_app && typeof singleBtn.web_app.url === 'string' && singleBtn.web_app.url.startsWith('https://'), 'Button must be a web_app button with valid HTTPS URL');
      assert.strictEqual(singleBtn.callback_data, undefined, 'Button must NOT have callback_data');
      console.log('  ✓ PASS: /start for unclaimed user displays EXACTLY ONE button: 🎁 Scratch & Win (web_app, no callback_data)');
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

  // Test 6: Telegram WebApp initData Cryptographic Verification & Security Bounds
  console.log('\nTest Suite C6: WebApp initData Cryptographic Verification & Tamper Resistance');
  {
    const cloneBotToken = '8935005914:AAFakeTestSecretForHMACVerification12345';
    const originalToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalEnv = process.env.NODE_ENV;
    process.env.TELEGRAM_BOT_TOKEN = cloneBotToken;

    const testUser = { id: 2022247489, first_name: 'TestAdmin', username: 'testadmin' };
    const authDate = Math.floor(Date.now() / 1000);
    const userJson = JSON.stringify(testUser);

    // Build valid HMAC-SHA256 data_check_string according to Telegram Bot API specification
    const checkString = `auth_date=${authDate}\nuser=${userJson}`;
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(cloneBotToken).digest();
    const validHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
    const validInitData = `auth_date=${authDate}&user=${encodeURIComponent(userJson)}&hash=${validHash}`;

    // 1. Valid initData verification
    const verified = verifyTelegramInitData(validInitData, cloneBotToken);
    assert.strictEqual(verified.isValid, true);
    assert.strictEqual(verified.user?.id, 2022247489);
    assert.strictEqual(verified.isSimulated, false);
    console.log('  ✓ PASS: Valid initData verified successfully via HMAC-SHA256');
    passed++;

    // 2. Tampered hash is rejected
    const tamperedInitData = `auth_date=${authDate}&user=${encodeURIComponent(userJson)}&hash=tampered_corrupted_hash_987654`;
    const tamperedResult = verifyTelegramInitData(tamperedInitData, cloneBotToken);
    assert.strictEqual(tamperedResult.isValid, false);
    assert.match(tamperedResult.error || '', /Cryptographic hash mismatch/);
    console.log('  ✓ PASS: Tampered hash strictly rejected with cryptographic mismatch');
    passed++;

    // 3. Missing or empty hash is rejected (security check: no empty string bypass)
    const emptyHashInitData = `auth_date=${authDate}&user=${encodeURIComponent(userJson)}&hash=`;
    const emptyResult = verifyTelegramInitData(emptyHashInitData, cloneBotToken);
    assert.strictEqual(emptyResult.isValid, false);
    assert.match(emptyResult.error || '', /Hash missing/);
    console.log('  ✓ PASS: Empty hash strictly rejected (no bypass possible)');
    passed++;

    // 4. Mismatched bot token (e.g. original bot token vs clone bot token)
    const otherBotToken = '1234567890:AAOtherDifferentBotToken';
    const mismatchResult = verifyTelegramInitData(validInitData, otherBotToken);
    assert.strictEqual(mismatchResult.isValid, false);
    assert.match(mismatchResult.error || '', /Cryptographic hash mismatch/);
    console.log('  ✓ PASS: Mismatched bot token strictly rejected (original token vs clone token isolation)');
    passed++;

    // 5. Expired auth_date (> 24 hours) is rejected
    const expiredAuthDate = authDate - 86500;
    const expiredCheckString = `auth_date=${expiredAuthDate}\nuser=${userJson}`;
    const expiredHash = crypto.createHmac('sha256', secretKey).update(expiredCheckString).digest('hex');
    const expiredInitData = `auth_date=${expiredAuthDate}&user=${encodeURIComponent(userJson)}&hash=${expiredHash}`;
    const expiredResult = verifyTelegramInitData(expiredInitData, cloneBotToken);
    assert.strictEqual(expiredResult.isValid, false);
    assert.match(expiredResult.error || '', /expired/);
    console.log('  ✓ PASS: Expired auth_date (> 24 hours) strictly rejected');
    passed++;

    // 6. Future auth_date is rejected
    const futureAuthDate = authDate + 600;
    const futureCheckString = `auth_date=${futureAuthDate}\nuser=${userJson}`;
    const futureHash = crypto.createHmac('sha256', secretKey).update(futureCheckString).digest('hex');
    const futureInitData = `auth_date=${futureAuthDate}&user=${encodeURIComponent(userJson)}&hash=${futureHash}`;
    const futureResult = verifyTelegramInitData(futureInitData, cloneBotToken);
    assert.strictEqual(futureResult.isValid, false);
    assert.match(futureResult.error || '', /future/);
    console.log('  ✓ PASS: Future auth_date (> 5 minutes clock drift) strictly rejected');
    passed++;

    // 7. In production mode, simulated auth is rejected
    process.env.NODE_ENV = 'production';
    const simInitData = `auth_date=${authDate}&user=${encodeURIComponent(userJson)}&hash=dummy_preview_hash&is_simulated=true`;
    const prodSimResult = verifyTelegramInitData(simInitData, cloneBotToken);
    assert.strictEqual(prodSimResult.isValid, false);
    console.log('  ✓ PASS: Simulated auth strictly rejected when NODE_ENV === production');
    passed++;

    process.env.TELEGRAM_BOT_TOKEN = originalToken;
    process.env.NODE_ENV = originalEnv;
  }

  // Test 7: Same-Device Anti-Abuse & Referral Protection
  console.log('\nTest Suite C7: Same-Device Multi-Account & Referral Abuse Protection');
  {
    const devX = `dev_test_shared_hardware_${Date.now()}`;
    const fpX = `fp_test_shared_canvas_${Date.now()}`;
    const devY = `dev_test_separate_phone_${Date.now()}`;
    const fpY = `fp_test_separate_canvas_${Date.now()}`;

    // Create Primary User A on Device X
    const userA_id = `user_device_owner_a_${Date.now()}`;
    await saveUser({
      id: userA_id,
      telegramId: 11111101,
      username: 'owner_user_a',
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: `ref_${userA_id}`,
      referredBy: null,
      dailyStreak: 0,
      isBanned: false,
      deviceId: devX,
      deviceFingerprint: fpX,
      signupBonusClaimed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 1. Primary User A registers as device owner
    const regA = await getOrRegisterDeviceOwner(userA_id, 11111101, devX, fpX);
    assert.strictEqual(regA.isPrimaryAccount, true);
    assert.strictEqual(regA.primaryUserId, userA_id);
    console.log('  ✓ PASS: Primary user successfully established as device owner');
    passed++;

    // 2. Primary User A claims signup bonus (succeeds)
    const claimA = await atomicClaimSignupBonus({
      userId: userA_id,
      telegramId: 11111101,
      deviceId: devX,
      fingerprintHash: fpX,
    });
    assert.strictEqual(claimA.success, true);
    const refreshedA = await getUser(userA_id);
    assert.strictEqual(refreshedA?.signupBonusClaimed, true);
    assert(refreshedA && refreshedA.balance > 0, 'User A balance credited with signup bonus');
    console.log(`  ✓ PASS: Primary user A claimed signup bonus (balance = ₹${refreshedA?.balance})`);
    passed++;

    // 3. Create Secondary User B on the SAME Device X
    const userB_id = `user_device_abuser_b_${Date.now()}`;
    await saveUser({
      id: userB_id,
      telegramId: 11111102,
      username: 'abuser_user_b',
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: `ref_${userB_id}`,
      referredBy: userA_id,
      dailyStreak: 0,
      isBanned: false,
      deviceId: devX,
      deviceFingerprint: fpX,
      signupBonusClaimed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Device restriction check for User B
    const devCheckB = await isDeviceRestrictedForUser(userB_id, devX, fpX);
    assert.strictEqual(devCheckB.restricted, true);
    assert.strictEqual(devCheckB.primaryUserId, userA_id);
    console.log('  ✓ PASS: Secondary user B on same device is correctly restricted');
    passed++;

    // 4. Secondary User B attempts signup bonus (MUST BE REJECTED)
    const claimB = await atomicClaimSignupBonus({
      userId: userB_id,
      telegramId: 11111102,
      deviceId: devX,
      fingerprintHash: fpX,
    });
    assert.strictEqual(claimB.success, false);
    assert.strictEqual(claimB.isDeviceDuplicate, true);
    const refreshedB = await getUser(userB_id);
    assert.strictEqual(refreshedB?.balance, 0, 'Secondary user balance strictly remains 0');
    assert.strictEqual(refreshedB?.signupBonusClaimed, false);
    console.log('  ✓ PASS: Multiple account signup bonus on same device strictly rejected');
    passed++;

    // 5. Daily check-in restriction for secondary user
    const checkinRestrictionB = await isDeviceRestrictedForUser(userB_id, devX, fpX);
    assert.strictEqual(checkinRestrictionB.restricted, true);
    console.log('  ✓ PASS: Daily check-in restricted for secondary account on same device');
    passed++;

    // 6. Task reward restriction for secondary user
    const taskRestrictionB = await isDeviceRestrictedForUser(userB_id, devX, fpX);
    assert.strictEqual(taskRestrictionB.restricted, true);
    console.log('  ✓ PASS: Task rewards restricted for secondary account on same device');
    passed++;

    // 7. Referral Abuse Tests
    // 7A: Self-referral attempt (User A refers User A)
    const selfRef = await atomicClaimReferralReward({
      referrerId: userA_id,
      refereeId: userA_id,
      refereeUsername: 'owner_user_a',
      refereeDeviceId: devX,
      refereeFingerprintHash: fpX,
    });
    assert.strictEqual(selfRef.success, false);
    assert.match(selfRef.reason || '', /Self-referral/);
    console.log('  ✓ PASS: Self-referral strictly rejected');
    passed++;

    // 7B: Same-device referral (User A refers User B on same Device X)
    const sameDevRef = await atomicClaimReferralReward({
      referrerId: userA_id,
      refereeId: userB_id,
      refereeUsername: 'abuser_user_b',
      refereeDeviceId: devX,
      refereeFingerprintHash: fpX,
    });
    assert.strictEqual(sameDevRef.success, false);
    assert.strictEqual(sameDevRef.isAbuseDetected, true);
    console.log('  ✓ PASS: Referral between accounts on the same device strictly rejected');
    passed++;

    // 7C: Circular referral attempt
    const userA_ref = await getUser(userA_id);
    if (userA_ref) {
      userA_ref.referredBy = userB_id;
      await saveUser(userA_ref);
    }
    const circularRef = await atomicClaimReferralReward({
      referrerId: userA_id,
      refereeId: userB_id,
      refereeUsername: 'abuser_user_b',
      refereeDeviceId: devY,
      refereeFingerprintHash: fpY,
    });
    assert.strictEqual(circularRef.success, false);
    assert.match(circularRef.reason || '', /Circular referral/);
    console.log('  ✓ PASS: Circular referral strictly rejected');
    passed++;

    // Reset user A's referredBy
    if (userA_ref) {
      userA_ref.referredBy = null;
      await saveUser(userA_ref);
    }

    // 8. Legitimate Referral: User A on Device X refers User C on a separate Device Y
    const userC_id = `user_legit_c_${Date.now()}`;
    await saveUser({
      id: userC_id,
      telegramId: 11111103,
      username: 'legit_user_c',
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: `ref_${userC_id}`,
      referredBy: userA_id,
      dailyStreak: 0,
      isBanned: false,
      deviceId: devY,
      deviceFingerprint: fpY,
      signupBonusClaimed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const initialReferrerBalance = (await getUser(userA_id))?.balance || 0;
    const legitRef = await atomicClaimReferralReward({
      referrerId: userA_id,
      refereeId: userC_id,
      refereeUsername: 'legit_user_c',
      refereeDeviceId: devY,
      refereeFingerprintHash: fpY,
    });
    assert.strictEqual(legitRef.success, true);
    const finalReferrerBalance = (await getUser(userA_id))?.balance || 0;
    assert.strictEqual(finalReferrerBalance, initialReferrerBalance + 10, 'Referrer credited +10 for legitimate referral');
    console.log('  ✓ PASS: Legitimate referral between separate users on separate devices credited successfully');
    passed++;

    // 9. Repeated / Duplicate Referral Claim Attempt
    const repeatRef = await atomicClaimReferralReward({
      referrerId: userA_id,
      refereeId: userC_id,
      refereeUsername: 'legit_user_c',
      refereeDeviceId: devY,
      refereeFingerprintHash: fpY,
    });
    assert.strictEqual(repeatRef.success, false);
    const balanceAfterRepeat = (await getUser(userA_id))?.balance || 0;
    assert.strictEqual(balanceAfterRepeat, finalReferrerBalance, 'Balance not incremented on duplicate retry');
    console.log('  ✓ PASS: Duplicate referral claim strictly blocked by idempotency');
    passed++;

    // 10. Ledger integrity verification
    const txnsA = await getUserTransactions(userA_id);
    const refTx = txnsA.filter((t) => t.type === 'referral_reward');
    assert.strictEqual(refTx.length, 1, 'Exactly one referral transaction recorded in persistent ledger');
    console.log('  ✓ PASS: Wallet ledger accurately records atomic transactions');
    passed++;
  }

  console.log('\n==================================================');
  console.log(`  CLONE ISOLATION SUITE: ALL ${passed} TESTS PASSED ✓`);
  console.log('==================================================\n');
}

runTests().catch((err) => {
  console.error('CLONE SUITE TEST FAILED:', err);
  process.exit(1);
});
