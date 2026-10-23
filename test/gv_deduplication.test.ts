import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  memStore,
  saveUser,
  getUser,
  addGiftCardCodes,
  redeemGiftCardWithdrawal,
  getAllGiftCardCodes,
  getGiftCardInventoryStats,
  getGiftCardAuditReport,
  reconcileGVRegistry,
  isCodeAssignedInAnyWithdrawal,
} from '../server/db.ts';
import type { UserProfile, GiftCardCode, Withdrawal } from '../src/types/index.ts';

function assertExact(actual: any, expected: any, msg: string) {
  assert.strictEqual(actual, expected, msg);
}

function assertTruthy(val: any, msg: string) {
  assert.ok(val, msg);
}

function pass(testName: string) {
  console.log(`  ✓ PASS: ${testName}`);
}

async function runGVDeduplicationTests() {
  console.log('\n==================================================');
  console.log('  RUNNING GV DEDUPLICATION & ZERO-REUSE TEST SUITE');
  console.log('==================================================\n');

  const runId = Date.now().toString(36).toUpperCase();

  // Disable channel requirement & referral requirement for isolated unit tests
  memStore.settings.withdrawalReferralRequirementEnabled = false;

  console.log('Test Suite D1: Single-Assignment & Out-of-Stock Protection');
  {
    const userAId = `test_user_a_${runId}`;
    const userA: UserProfile = {
      id: userAId,
      telegramId: 9001001,
      username: 'user_a',
      firstName: 'Alice',
      balance: 5000,
      totalEarned: 5000,
      referralCode: `ref_${userAId}`,
      referralCount: 5,
      completedTaskIds: [],
      dailyStreak: 1,
      lastDailyCheckIn: '',
      signupBonusClaimed: true,
      pendingSignupBonus: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(userA);

    const userBId = `test_user_b_${runId}`;
    const userB: UserProfile = {
      id: userBId,
      telegramId: 9001002,
      username: 'user_b',
      firstName: 'Bob',
      balance: 5000,
      totalEarned: 5000,
      referralCode: `ref_${userBId}`,
      referralCount: 5,
      completedTaskIds: [],
      dailyStreak: 1,
      lastDailyCheckIn: '',
      signupBonusClaimed: true,
      pendingSignupBonus: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(userB);

    // Import exactly ONE unique test gift card code
    const DENOM_1 = 991;
    const testCode1 = `TEST-CODE-AAA-${runId}-111`;
    const importRes = await addGiftCardCodes([testCode1], DENOM_1, 'TestAdmin');
    assertExact(importRes.added, 1, 'Exactly one code added');
    pass('Imported 1 isolated test code');

    // 1. User A redeems the single available code
    const wthA = await redeemGiftCardWithdrawal(userAId, DENOM_1);
    assertExact(wthA.giftCardCode, testCode1, 'User A received the exact code');
    assertExact(wthA.withdrawal.amount, DENOM_1, `Withdrawal amount is ${DENOM_1}`);
    assertExact(wthA.user.balance, 5000 - DENOM_1, `User A balance deducted to ${5000 - DENOM_1}`);
    pass(`User A claimed code successfully (balance 5000 -> ${5000 - DENOM_1})`);

    // Verify code is now in assignedGVCodes
    assertTruthy(memStore.assignedGVCodes.has(testCode1), 'Code recorded in assignedGVCodes set');
    assertTruthy(isCodeAssignedInAnyWithdrawal(testCode1), 'isCodeAssignedInAnyWithdrawal returns true');
    pass('Code is permanently recorded in assigned registry');

    // 2. User B attempts to redeem - MUST FAIL because stock (1 code) is depleted!
    let failedAsExpected = false;
    try {
      await redeemGiftCardWithdrawal(userBId, DENOM_1);
    } catch (err: any) {
      failedAsExpected = true;
      assertTruthy(err.message.includes('out of stock'), 'Error message says out of stock');
    }
    assertTruthy(failedAsExpected, 'User B request failed when stock is 0');

    // Verify User B balance was strictly UNTOUCHED
    const freshUserB = await getUser(userBId);
    assertExact(freshUserB?.balance, 5000, 'User B balance untouched at 5000 on out-of-stock');
    pass('User B strictly blocked with out-of-stock and zero balance deduction');

    // Verify code was NEVER reassigned
    const withdrawalsForCode = Array.from(memStore.withdrawals.values()).filter(
      (w) => (w.giftCardCode || '').trim().toUpperCase() === testCode1
    );
    assertExact(withdrawalsForCode.length, 1, 'Code belongs to exactly 1 withdrawal');
    pass('Code belongs to exactly 1 withdrawal, never given to User B');
  }

  console.log('\nTest Suite D2: Concurrent Allocation & Race Condition Prevention');
  {
    // Add exactly ONE code for two competing concurrent requests
    const DENOM_2 = 992;
    const concCode = `TEST-CONC-RACE-${runId}-222`;
    await addGiftCardCodes([concCode], DENOM_2, 'TestAdmin');

    const userCId = `test_user_c_${runId}`;
    const userC: UserProfile = {
      id: userCId,
      telegramId: 9001003,
      username: 'user_c',
      firstName: 'Charlie',
      balance: 1000,
      totalEarned: 1000,
      referralCode: `ref_${userCId}`,
      referralCount: 5,
      completedTaskIds: [],
      dailyStreak: 1,
      lastDailyCheckIn: '',
      signupBonusClaimed: true,
      pendingSignupBonus: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(userC);

    const userDId = `test_user_d_${runId}`;
    const userD: UserProfile = {
      id: userDId,
      telegramId: 9001004,
      username: 'user_d',
      firstName: 'Dave',
      balance: 1000,
      totalEarned: 1000,
      referralCode: `ref_${userDId}`,
      referralCount: 5,
      completedTaskIds: [],
      dailyStreak: 1,
      lastDailyCheckIn: '',
      signupBonusClaimed: true,
      pendingSignupBonus: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(userD);

    // Launch concurrent withdrawals simultaneously
    const results = await Promise.allSettled([
      redeemGiftCardWithdrawal(userCId, DENOM_2),
      redeemGiftCardWithdrawal(userDId, DENOM_2),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    assertExact(successes.length, 1, 'Exactly one concurrent withdrawal succeeded');
    assertExact(failures.length, 1, 'Compete concurrent withdrawal rejected');
    pass('Concurrent race condition: Exactly 1 withdrawal succeeded, other cleanly rejected');

    const concWithdrawals = Array.from(memStore.withdrawals.values()).filter(
      (w) => (w.giftCardCode || '').trim().toUpperCase() === concCode
    );
    assertExact(concWithdrawals.length, 1, 'Concurrent code assigned to exactly 1 withdrawal');
    pass('Single code assigned once under high concurrency');
  }

  console.log('\nTest Suite D3: Repeated Clicks & Persistent Idempotency');
  {
    const DENOM_3 = 993;
    const idemCode = `TEST-IDEM-CODE-${runId}-333`;
    await addGiftCardCodes([idemCode], DENOM_3, 'TestAdmin');

    const userAId = `test_user_a_${runId}`;
    const idemKey = `idem_key_${runId}_123`;
    const firstRedeem = await redeemGiftCardWithdrawal(userAId, DENOM_3, idemKey);
    assertExact(firstRedeem.giftCardCode, idemCode, 'First attempt receives code');
    const balAfterFirst = firstRedeem.user.balance;

    // Retry with identical idempotencyKey
    const retryRedeem = await redeemGiftCardWithdrawal(userAId, DENOM_3, idemKey);
    assertExact(retryRedeem.withdrawal.id, firstRedeem.withdrawal.id, 'Idempotent retry returns identical order');
    assertExact(retryRedeem.giftCardCode, idemCode, 'Idempotent retry returns identical code');
    assertExact(retryRedeem.user.balance, balAfterFirst, 'Idempotent retry does NOT deduct balance a second time');
    pass('Idempotent retry returns identical order & code without double deduction or code reuse');
  }

  console.log('\nTest Suite D4: Stale Firestore Overwrite Protection');
  {
    const DENOM_4 = 994;
    const staleCode = `TEST-STALE-OVERWRITE-${runId}-444`;
    await addGiftCardCodes([staleCode], DENOM_4, 'TestAdmin');

    const userBId = `test_user_b_${runId}`;
    const userAId = `test_user_a_${runId}`;

    // User redeems code
    const rRes = await redeemGiftCardWithdrawal(userBId, DENOM_4);
    assertExact(rRes.giftCardCode, staleCode, 'Redeemed stale test code');

    // Find doc in memStore
    const gcDoc = Array.from(memStore.giftCardCodes.values()).find(
      (c) => (c.code || '').trim().toUpperCase() === staleCode
    );
    assertTruthy(gcDoc, 'Found gcDoc');
    assertExact(gcDoc?.status, 'redeemed', 'Status is redeemed in memStore');

    // Simulate stale database read where Firestore returns 'available' for this document
    const staleDoc: GiftCardCode = {
      ...gcDoc!,
      status: 'available',
      assignedUserId: null,
      assignedWithdrawalId: null,
    };

    // If an external sync mistakenly tried to set it to available:
    memStore.giftCardCodes.set(staleDoc.id, staleDoc);

    // Call getAllGiftCardCodes / reconcileGVRegistry
    reconcileGVRegistry();
    const refreshed = memStore.giftCardCodes.get(staleDoc.id);
    assertExact(refreshed?.status, 'redeemed', 'Reconciliation locks status as redeemed');

    // Verify it cannot be redeemed again
    let failedStale = false;
    try {
      await redeemGiftCardWithdrawal(userAId, DENOM_4);
    } catch (e: any) {
      failedStale = true;
    }
    assertTruthy(failedStale, 'Stale code cannot be reassigned to user A');
    pass('Stale Firestore document safely reconciled and locked as redeemed');
  }

  console.log('\nTest Suite D5: Audit & Conflict Reporting');
  {
    const audit = await getGiftCardAuditReport();
    assertTruthy(audit.totalCodes >= 4, 'Audit reports total codes');
    assertTruthy(audit.uniqueAssignedCodesCount >= 3, 'Audit reports assigned codes count');
    assertTruthy(Array.isArray(audit.flaggedHistoricalDuplicates), 'Audit returns flagged conflicts array');
    pass('Audit report returns complete reconciliation details');
  }

  console.log('\n==================================================');
  console.log('  GV DEDUPLICATION SUITE: ALL TESTS PASSED ✓');
  console.log('==================================================\n');
}

runGVDeduplicationTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
