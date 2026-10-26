import assert from 'node:assert';
import {
  memStore,
  saveUser,
  getUser,
  getUserByTelegramId,
  getTotalRegisteredUsersCount,
  reconcileUsersRegistry,
  getDashboardStats,
  searchUsers,
  getBulkBalanceResetPreview,
  atomicResetAllUserBalances,
} from '../server/db.ts';
import type { UserProfile } from '../src/types/index.ts';

function pass(testName: string) {
  console.log(`  ✓ PASS: ${testName}`);
}

async function runTotalUsersPersistenceTestSuite() {
  console.log('\n======================================================================');
  console.log('  RUNNING P0 TOTAL USERS & HISTORICAL DATA PERSISTENCE TEST SUITE');
  console.log('======================================================================\n');

  // Step 1: Ensure registry is loaded
  await reconcileUsersRegistry();

  console.log('Test 1: Verify Master Authoritative Count is at least 1,143');
  {
    const count = getTotalRegisteredUsersCount();
    console.log(`    Current registered users count: ${count}`);
    assert.ok(count >= 1143, `Expected at least 1,143 historical registered users, got ${count}`);
    pass('Authoritative count matches or exceeds 1,143 historical registered users');
  }

  console.log('\nTest 2: Verify Historical Telegram User Retrieval without Null');
  {
    // Check known user from live dump (e.g., VK SUPERTECH 2022247489)
    const testTelegramId = 2022247489;
    const user = await getUserByTelegramId(testTelegramId);
    assert.ok(user, `Historical user with telegramId ${testTelegramId} must be retrievable`);
    assert.strictEqual(user.telegramId, testTelegramId, 'User Telegram ID must match');
    assert.ok(user.id, 'User must have a non-empty user ID');
    pass(`Successfully retrieved historical user ${user.username || user.firstName} (${user.id})`);
  }

  console.log('\nTest 3: Verify Idempotent Registration (Repeat /start does not duplicate count)');
  {
    const initialCount = getTotalRegisteredUsersCount();
    // Existing user calls saveUser again (e.g. repeated /start or sync)
    const existingUser = await getUserByTelegramId(2022247489);
    assert.ok(existingUser, 'Existing user must exist');
    await saveUser({
      ...existingUser,
      updatedAt: new Date().toISOString(),
    });

    const countAfter = getTotalRegisteredUsersCount();
    assert.strictEqual(countAfter, initialCount, `Total count must remain identical on repeat sync. Expected ${initialCount}, got ${countAfter}`);
    pass('Repeat sync/start does not increment total user count');
  }

  console.log('\nTest 4: Verify Genuine New Registration Increments Count by Exactly 1');
  {
    const initialCount = getTotalRegisteredUsersCount();
    const testNewTelegramId = 999000000 + Math.floor(Math.random() * 900000);
    const newUserId = `user_${testNewTelegramId}`;

    const newUser: UserProfile = {
      id: newUserId,
      telegramId: testNewTelegramId,
      username: `test_user_${testNewTelegramId}`,
      firstName: 'IntegrationTestUser',
      balance: 10,
      totalEarned: 10,
      referralCode: `ref_${testNewTelegramId}`,
      referralCount: 0,
      completedTaskIds: [],
      dailyStreak: 0,
      lastDailyCheckIn: '',
      signupBonusClaimed: true,
      pendingSignupBonus: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveUser(newUser);

    const countAfter = getTotalRegisteredUsersCount();
    assert.strictEqual(countAfter, initialCount + 1, `Total count must increment by exactly 1. Expected ${initialCount + 1}, got ${countAfter}`);

    // Verify it can be retrieved by telegram ID immediately
    const retrieved = await getUserByTelegramId(testNewTelegramId);
    assert.ok(retrieved, 'Newly registered user must be immediately retrievable by Telegram ID');
    assert.strictEqual(retrieved.id, newUserId, 'Retrieved ID must match newly created ID');
    pass('New user registration increments total count by exactly 1 and is indexed');
  }

  console.log('\nTest 5: Verify Cold-Start Hydration from Authoritative Disk Registry');
  {
    const expectedCount = getTotalRegisteredUsersCount();
    assert.ok(expectedCount >= 1143, 'Expected count should be >= 1143');

    // Simulate process crash / cold-start: wipe memory
    memStore.users = new Map();
    memStore.telegramIdToUserId = new Map();
    memStore.lastVerifiedUserCount = 0;

    // Verify memory was cleared
    assert.strictEqual(memStore.users.size, 0, 'Memory store should be cleared for test');

    // Now re-hydrate from authoritative disk
    await reconcileUsersRegistry();

    const restoredCount = getTotalRegisteredUsersCount();
    assert.strictEqual(restoredCount, expectedCount, `Re-hydrated count must match authoritative count. Expected ${expectedCount}, got ${restoredCount}`);
    assert.ok(memStore.users.size >= 1143, 'In-memory map must be re-hydrated with all users');
    pass('Cold-start recovery restores all registered users and prevents false zero');
  }

  console.log('\nTest 6: Verify Dashboard Stats Source of Truth (Never Returns Zero)');
  {
    const dashStats = await getDashboardStats();
    assert.ok(dashStats.totalUsers >= 1143, `Dashboard stats totalUsers must be >= 1143, got ${dashStats.totalUsers}`);
    assert.notStrictEqual(dashStats.totalUsers, 0, 'Dashboard stats totalUsers must never be 0');
    pass(`Dashboard stats returns real count (${dashStats.totalUsers}) and never resets to 0`);
  }

  console.log('\nTest 7: Verify Search Users Across Restored Database');
  {
    // Search with empty query should return up to default limit but indicate total count
    const topUsers = await searchUsers('', 50);
    assert.ok(topUsers.length > 0, 'Search should return users');
    assert.ok(topUsers.length <= 50, 'Search should respect pagination limit');

    // Search for a specific existing user
    const found = await searchUsers('2022247489', 10);
    assert.ok(found.length >= 1, 'Search by Telegram ID string must find the user');
    assert.strictEqual(found[0].telegramId, 2022247489, 'Found user must match searched Telegram ID');
    pass('searchUsers efficiently queries restored user registry');
  }

  console.log('\nTest 8: Verify Bulk Balance Reset Preserves All User Accounts and Total Count');
  {
    const beforeCount = getTotalRegisteredUsersCount();
    const preview = await getBulkBalanceResetPreview();
    assert.strictEqual(typeof preview.totalUsers, 'number', 'Preview should return numeric users with balance');
    assert.strictEqual(typeof preview.totalBalance, 'number', 'Preview should return numeric total balance');

    // Execute bulk balance reset
    const result = await atomicResetAllUserBalances('test_admin_runner');
    assert.strictEqual(result.success, true, 'Reset should succeed');
    assert.strictEqual(typeof result.affectedUsers, 'number', 'Result should report affected users');

    const afterCount = getTotalRegisteredUsersCount();
    assert.strictEqual(afterCount, beforeCount, `Bulk balance reset must NEVER reduce or reset user count. Expected ${beforeCount}, got ${afterCount}`);
    pass('Bulk balance reset zeroes balances while preserving all 1,143+ user accounts');
  }

  console.log('\n======================================================================');
  console.log('  ALL TOTAL USERS & HISTORICAL DATA PERSISTENCE TESTS PASSED (8/8)  ');
  console.log('======================================================================\n');
}

runTotalUsersPersistenceTestSuite().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
