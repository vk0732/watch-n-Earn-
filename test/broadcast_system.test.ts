import fs from 'node:fs';
import path from 'node:path';
import { saveUser, memStore } from '../server/db.ts';
import {
  getBroadcastEligibleUsers,
  getBroadcastPreview,
  startBroadcast,
  getBroadcastStatus,
  getLatestBroadcast,
  BROADCAST_BATCH_SIZE,
} from '../server/broadcast.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function waitForBroadcastCompletion(broadcastId: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = getBroadcastStatus(broadcastId);
    if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Broadcast ${broadcastId} timed out after ${timeoutMs}ms`);
}

async function runBroadcastTests() {
  process.env.NODE_ENV = 'test';
  const dataDir = path.join(process.cwd(), 'data');
  const backupFiles = new Map<string, Buffer | null>();
  for (const fname of ['authoritative_users.json', 'authoritative_store.json', 'user_count_journal.json']) {
    const fpath = path.join(dataDir, fname);
    backupFiles.set(fpath, fs.existsSync(fpath) ? fs.readFileSync(fpath) : null);
  }

  try {
    console.log('\n======================================================');
    console.log('  BROADCAST SYSTEM VERIFICATION SUITE (@WatchVEarnBot)');
    console.log('======================================================\n');

    // Isolate in-memory user store for deterministic broadcast testing
    memStore.users.clear();
    memStore.telegramIdToUserId.clear();

    /* ------------------------------------------------------------------
       STEP 1: Small-Group Test First (5 Users — HTML, Markdown, Plain Text)
       ------------------------------------------------------------------ */
    console.log('Suite 1: Small-Group Broadcast Verification (5 Users — HTML, Markdown & Plain Text)');
    const smallGroupIds = [710001, 710002, 710003, 710004, 710005];
    for (const tgId of smallGroupIds) {
      memStore.users.set(`user_${tgId}`, {
        id: `user_${tgId}`,
        telegramId: tgId,
        username: `small_group_${tgId}`,
        firstName: `User${tgId}`,
        balance: 10,
        lifetimeEarnings: 10,
        referralEarnings: 0,
        referralCode: `REF_${tgId}`,
        dailyStreak: 1,
        isBanned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      memStore.telegramIdToUserId.set(tgId, `user_${tgId}`);
    }

    const recordedPayloads: Array<{ chat_id: number; text: string; parse_mode?: string }> = [];
    const smallGroupFetch = (async (_url: any, init?: any) => {
      const body = JSON.parse(init.body);
      recordedPayloads.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: recordedPayloads.length } }),
      } as any;
    }) as typeof fetch;

    // 1A. HTML format small-group test
    const htmlTask = await startBroadcast(
      'admin_test',
      '<b>Hello Small Group!</b> Welcome to Watch & Earn.',
      'HTML',
      {
        targetTelegramIds: smallGroupIds,
        customFetch: smallGroupFetch,
        pacingMs: 1,
      }
    );
    const doneHtml = await waitForBroadcastCompletion(htmlTask.id);
    assert(doneHtml.status === 'completed', 'Small-group HTML broadcast completed');
    assert(doneHtml.sentCount === 5, 'Small-group HTML broadcast delivered to all 5 users');
    assert(doneHtml.remainingCount === 0, 'Small-group HTML broadcast remainingCount is 0');
    assert(
      recordedPayloads.length === 5 && recordedPayloads.every((p) => p.parse_mode === 'HTML'),
      'Small-group HTML broadcast passed parse_mode="HTML" on all 5 requests'
    );

    // 1B. Markdown format small-group test
    recordedPayloads.length = 0;
    const mdTask = await startBroadcast(
      'admin_test',
      '*Hello Small Group!* _Markdown announcement_',
      'Markdown',
      {
        targetTelegramIds: smallGroupIds,
        customFetch: smallGroupFetch,
        pacingMs: 1,
      }
    );
    const doneMd = await waitForBroadcastCompletion(mdTask.id);
    assert(doneMd.status === 'completed' && doneMd.sentCount === 5, 'Small-group Markdown broadcast delivered to all 5 users');
    assert(
      recordedPayloads.length === 5 && recordedPayloads.every((p) => p.parse_mode === 'Markdown'),
      'Small-group Markdown broadcast passed parse_mode="Markdown" on all 5 requests'
    );

    // 1C. Plain Text ('None') format small-group test
    recordedPayloads.length = 0;
    const plainTask = await startBroadcast(
      'admin_test',
      'Plain text announcement without formatting tags',
      'None',
      {
        targetTelegramIds: smallGroupIds,
        customFetch: smallGroupFetch,
        pacingMs: 1,
      }
    );
    const donePlain = await waitForBroadcastCompletion(plainTask.id);
    assert(donePlain.status === 'completed' && donePlain.sentCount === 5, 'Small-group Plain Text broadcast delivered to all 5 users');
    assert(
      recordedPayloads.length === 5 && recordedPayloads.every((p) => p.parse_mode === undefined),
      'Small-group Plain Text broadcast omitted parse_mode cleanly'
    );

    /* ------------------------------------------------------------------
       STEP 2: Remove 50-User Limit & Full Database Fetch + Automatic Batch Processing (>1,200 Users)
       ------------------------------------------------------------------ */
    console.log('\nSuite 2: Full User List Fetch (>1,200 Users, No 50-User Cap) & Single-Click Batch Delivery');
    memStore.users.clear();
    memStore.telegramIdToUserId.clear();

    const TOTAL_ACTIVE_USERS = 1260; // 25x larger than the old 50-user cap
    const TOTAL_BANNED_USERS = 4;

    for (let i = 1; i <= TOTAL_ACTIVE_USERS; i++) {
      const tgId = 8000000 + i;
      memStore.users.set(`user_${tgId}`, {
        id: `user_${tgId}`,
        telegramId: tgId,
        username: `active_user_${i}`,
        firstName: `Active${i}`,
        balance: 0,
        lifetimeEarnings: 0,
        referralEarnings: 0,
        referralCode: `REF_ACT_${i}`,
        dailyStreak: 0,
        isBanned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      memStore.telegramIdToUserId.set(tgId, `user_${tgId}`);
    }

    // Add duplicate record with same telegramId (8000001) under a legacy ID key to verify deduplication
    memStore.users.set('8000001', {
      id: '8000001',
      telegramId: 8000001,
      username: 'duplicate_record_1',
      firstName: 'Dup1',
      balance: 0,
      lifetimeEarnings: 0,
      referralEarnings: 0,
      referralCode: 'REF_DUP_1',
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Add banned users who must be excluded from eligible recipients but counted in totalRegisteredUsers
    for (let b = 1; b <= TOTAL_BANNED_USERS; b++) {
      const tgId = 9000000 + b;
      memStore.users.set(`user_${tgId}`, {
        id: `user_${tgId}`,
        telegramId: tgId,
        username: `banned_user_${b}`,
        firstName: `Banned${b}`,
        balance: 0,
        lifetimeEarnings: 0,
        referralEarnings: 0,
        referralCode: `REF_BAN_${b}`,
        dailyStreak: 0,
        isBanned: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      memStore.telegramIdToUserId.set(tgId, `user_${tgId}`);
    }

    const eligibleList = await getBroadcastEligibleUsers();
    const preview = await getBroadcastPreview();

    assert(
      eligibleList.length >= TOTAL_ACTIVE_USERS,
      `50-user limit removed: getBroadcastEligibleUsers() fetched ${eligibleList.length} eligible users (expected >= ${TOTAL_ACTIVE_USERS})`
    );
    assert(
      preview.recipientCount === eligibleList.length,
      `getBroadcastPreview().recipientCount (${preview.recipientCount}) matches full eligible list`
    );
    assert(
      (preview.totalRegisteredUsers || 0) >= TOTAL_ACTIVE_USERS + TOTAL_BANNED_USERS,
      `getBroadcastPreview().totalRegisteredUsers (${preview.totalRegisteredUsers}) includes all registered accounts`
    );

    /* ------------------------------------------------------------------
       STEP 3: Single-Click Full Campaign with Rate Limit (429), Retries, Blocked Users & Final Report
       ------------------------------------------------------------------ */
    console.log('\nSuite 3: Rate Limits (429), Retries, Blocked Users, Duplicate Prevention & Live/Final Stats');

    const perChatCallCount = new Map<number, number>();
    const blockedSet = new Set<number>([8000010, 8000020, 8000030, 8000040]); // 4 blocked users
    const rateLimitedOnceSet = new Set<number>([8000050, 8000060, 8000070]); // 3 users hit 429 once then succeed
    const tempServerErrOnceSet = new Set<number>([8000080, 8000090]); // 2 users hit 502 once then succeed
    const permanentFailSet = new Set<number>([8000100, 8000110]); // 2 users fail all 3 attempts
    const entityParseFallbackUser = 8000120; // 1 user fails HTML parse then succeeds on plain text fallback

    const fullCampaignFetch = (async (_url: any, init?: any) => {
      const body = JSON.parse(init.body);
      const chatId = Number(body.chat_id);
      const prevCalls = perChatCallCount.get(chatId) || 0;
      perChatCallCount.set(chatId, prevCalls + 1);

      // Simulate 403 Blocked / Deactivated user
      if (blockedSet.has(chatId)) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            ok: false,
            error_code: 403,
            description: 'Forbidden: bot was blocked by the user',
          }),
        } as any;
      }

      // Simulate HTTP 429 Too Many Requests on first attempt
      if (rateLimitedOnceSet.has(chatId) && prevCalls === 0) {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 1',
            parameters: { retry_after: 1 },
          }),
        } as any;
      }

      // Simulate temporary 502 Bad Gateway on first attempt
      if (tempServerErrOnceSet.has(chatId) && prevCalls === 0) {
        return {
          ok: false,
          status: 502,
          json: async () => ({
            ok: false,
            error_code: 502,
            description: 'Bad Gateway',
          }),
        } as any;
      }

      // Simulate permanent failure across all retries
      if (permanentFailSet.has(chatId)) {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            ok: false,
            error_code: 500,
            description: 'Internal Server Error',
          }),
        } as any;
      }

      // Simulate HTML entity parse error on first attempt (with parse_mode), succeeding on plain-text fallback
      if (chatId === entityParseFallbackUser && body.parse_mode) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities: Unsupported start tag",
          }),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: prevCalls + 1 } }),
      } as any;
    }) as typeof fetch;

    const fullTask = await startBroadcast(
      'admin_2022247489',
      '<b>🚀 Major Campaign Update!</b> Open @WatchVEarnBot now.',
      'HTML',
      {
        customFetch: fullCampaignFetch,
        pacingMs: 0,
        rateLimitDelayMultiplierMs: 10,
      }
    );

    const completedFullTask = await waitForBroadcastCompletion(fullTask.id, 30000);
    const latestTask = getLatestBroadcast();

    const expectedTotalRecipients = eligibleList.length;
    const expectedBlocked = blockedSet.size; // 4
    const expectedFailed = permanentFailSet.size; // 2
    const expectedSent = expectedTotalRecipients - expectedBlocked - expectedFailed;
    const expectedBatches = Math.ceil(expectedTotalRecipients / BROADCAST_BATCH_SIZE);

    assert(completedFullTask.status === 'completed', 'Full single-click broadcast status is completed');
    assert(latestTask?.id === completedFullTask.id, 'getLatestBroadcast() returns the completed campaign report');
    assert(
      completedFullTask.totalRecipients === expectedTotalRecipients,
      `Targeted all ${expectedTotalRecipients} eligible users in one click`
    );
    assert(
      completedFullTask.sentCount === expectedSent,
      `Live/Final Stat — Total messages sent is ${completedFullTask.sentCount} (expected ${expectedSent})`
    );
    assert(
      completedFullTask.blockedCount === expectedBlocked,
      `Live/Final Stat — Blocked users tracked accurately (${completedFullTask.blockedCount} === ${expectedBlocked})`
    );
    assert(
      completedFullTask.failedCount === expectedFailed,
      `Live/Final Stat — Failed messages tracked accurately (${completedFullTask.failedCount} === ${expectedFailed})`
    );
    assert(
      completedFullTask.remainingCount === 0,
      `Live/Final Stat — Remaining recipients is 0 upon completion`
    );
    assert(
      (completedFullTask.totalRegisteredUsers || 0) >= TOTAL_ACTIVE_USERS + TOTAL_BANNED_USERS,
      `Live/Final Stat — Total registered users reported (${completedFullTask.totalRegisteredUsers})`
    );
    assert(
      completedFullTask.totalBatches === expectedBatches && completedFullTask.completedBatches === expectedBatches,
      `Automatic background batch processing completed all ${completedFullTask.completedBatches}/${expectedBatches} batches`
    );
    assert(
      (completedFullTask.rateLimitHits || 0) === rateLimitedOnceSet.size,
      `Telegram 429 rate limits detected and recovered (${completedFullTask.rateLimitHits} hits)`
    );
    assert(
      (completedFullTask.retryCount || 0) >= rateLimitedOnceSet.size + tempServerErrOnceSet.size,
      `Automatic retries executed for 429s and temporary 5xx errors (retryCount=${completedFullTask.retryCount})`
    );
    assert(
      perChatCallCount.get(8000001) === 1,
      'Duplicate prevention: User 8000001 with duplicate DB entries received exactly 1 message'
    );
    assert(
      Boolean(completedFullTask.completedAt) && typeof completedFullTask.durationMs === 'number',
      'Final Broadcast Completion Report includes completedAt timestamp and durationMs'
    );
  } finally {
    // Restore any pre-existing disk files in data/
    for (const [fpath, content] of backupFiles.entries()) {
      if (content === null) {
        if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
      } else {
        fs.writeFileSync(fpath, content);
      }
    }
  }

  console.log('\n======================================================');
  console.log(`  BROADCAST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBroadcastTests().catch((err) => {
  console.error('Fatal broadcast test error:', err);
  process.exit(1);
});
