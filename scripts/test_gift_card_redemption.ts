import assert from 'node:assert';
import {
  saveUser,
  getUser,
  getAppSettings,
  updateAppSettings,
  addGiftCardCodes,
  getAllGiftCardCodes,
  getGiftCardInventoryStats,
  invalidateGiftCardCode,
  deleteGiftCardCode,
  redeemGiftCardWithdrawal,
  getUserWithdrawals,
  memStore,
} from '../server/db.ts';
import type { UserProfile } from '../src/types/index.ts';

console.log('====================================================');
console.log('🧪 RUNNING AMAZON GIFT CARD INVENTORY & REDEMPTION TEST SUITE');
console.log('====================================================\n');

async function runGiftCardTestSuite() {
  // ----------------------------------------------------
  // TEST 1: Admin Inventory Import & Duplicate Prevention
  // ----------------------------------------------------
  console.log('▶ TEST 1: Admin Gift Card Import & Duplicate Prevention...');

  // Clear in-memory gift cards for test isolation
  memStore.giftCardCodes.clear();

  // Import batch 1: 3 codes of ₹10
  const import1 = await addGiftCardCodes(
    ['AMZN-TEST-1001', 'AMZN-TEST-1002', 'AMZN-TEST-1003'],
    10,
    'admin_test'
  );
  assert.strictEqual(import1.added, 3, 'Should add 3 unique codes');
  assert.strictEqual(import1.duplicates, 0, 'Should have 0 duplicates');
  console.log('  ✓ Batch 1: Added 3 ₹10 codes successfully.');

  // Import batch 2: Try importing duplicates (including case-variation) and new code
  const import2 = await addGiftCardCodes(
    `amzn-test-1001\nAMZN-TEST-1002\nAMZN-TEST-1004\n\n`,
    10,
    'admin_test'
  );
  assert.strictEqual(import2.added, 1, 'Should add only 1 new code (AMZN-TEST-1004)');
  assert.strictEqual(import2.duplicates, 2, 'Should skip 2 duplicates (1001 and 1002)');
  console.log('  ✓ Batch 2: Correctly skipped 2 duplicate codes and imported 1 new code.');

  // Import batch 3: Denomination ₹50 code
  const import3 = await addGiftCardCodes(['AMZN-TEST-5001'], 50, 'admin_test');
  assert.strictEqual(import3.added, 1);

  // Verify inventory statistics
  const stats = await getGiftCardInventoryStats();
  assert.strictEqual(stats.totalCodes, 5);
  assert.strictEqual(stats.availableCodes, 5);
  assert.strictEqual(stats.availableByDenomination[10], 4);
  assert.strictEqual(stats.availableByDenomination[50], 1);
  assert.strictEqual(stats.totalAvailableValue, 4 * 10 + 50); // 90
  console.log(`  ✓ Stats Verified: 4 available ₹10 codes, 1 available ₹50 code. Total value = ₹${stats.totalAvailableValue}.`);

  // ----------------------------------------------------
  // TEST 2: Invalidation of Unredeemed Code
  // ----------------------------------------------------
  console.log('\n▶ TEST 2: Invalidation of Unredeemed Code...');
  const allCodes = await getAllGiftCardCodes();
  const codeToInvalidate = allCodes.find((c) => c.code === 'AMZN-TEST-1004')!;
  assert(codeToInvalidate, 'Code 1004 should exist');

  await invalidateGiftCardCode(codeToInvalidate.id, 'Test invalidation');
  const statsAfterInval = await getGiftCardInventoryStats();
  assert.strictEqual(statsAfterInval.availableByDenomination[10], 3, 'Available ₹10 codes should drop from 4 to 3');
  assert.strictEqual(statsAfterInval.invalidatedCodes, 1, 'Invalidated count should be 1');
  console.log('  ✓ Code successfully invalidated and excluded from available inventory.');

  // ----------------------------------------------------
  // TEST 3: Configurable Min/Max Dynamic Settings
  // ----------------------------------------------------
  console.log('\n▶ TEST 3: Dynamic Minimum and Maximum Withdrawal Settings...');
  // Configure admin settings: Min ₹10, Max ₹10 (per user's specific scenario)
  await updateAppSettings({
    minWithdrawalAmount: 10,
    maxWithdrawalAmount: 10,
    dailyWithdrawalLimitEnabled: false,
  });

  const currentSettings = await getAppSettings();
  assert.strictEqual(currentSettings.minWithdrawalAmount, 10);
  assert.strictEqual(currentSettings.maxWithdrawalAmount, 10);
  console.log('  ✓ App settings confirmed: minWithdrawalAmount = ₹10, maxWithdrawalAmount = ₹10.');

  // ----------------------------------------------------
  // TEST 4: Successful ₹10 Instant Amazon Gift Card Redemption
  // ----------------------------------------------------
  console.log('\n▶ TEST 4: Successful ₹10 Instant Amazon Gift Card Redemption...');
  const userAId = `test_user_gc_A_${Date.now()}`;
  const initialBalanceA = 50;

  const userA: UserProfile = {
    id: userAId,
    telegramId: 111222333,
    username: 'alice_earner',
    firstName: 'Alice',
    balance: initialBalanceA,
    lifetimeEarnings: initialBalanceA,
    referralEarnings: 0,
    referralCode: `ref_${userAId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(userA);

  const redemptionA = await redeemGiftCardWithdrawal(userAId, 10);
  assert.strictEqual(redemptionA.withdrawal.amount, 10);
  assert.strictEqual(redemptionA.withdrawal.status, 'success');
  assert.strictEqual(redemptionA.withdrawal.payoutMode, 'gift_card');
  assert.strictEqual(redemptionA.withdrawal.giftCardDenomination, 10);
  assert(redemptionA.giftCardCode.startsWith('AMZN-TEST-'), 'Should assign an imported code');
  assert.strictEqual(redemptionA.user.balance, initialBalanceA - 10, 'Balance should be decremented by ₹10');

  // Verify transaction ledger
  assert.strictEqual(redemptionA.transaction.type, 'withdrawal_deduct');
  assert.strictEqual(redemptionA.transaction.amount, -10);
  assert.strictEqual(redemptionA.transaction.balanceAfter, 40);

  // Verify assigned code in user history
  const userAWithdrawals = await getUserWithdrawals(userAId);
  assert.strictEqual(userAWithdrawals.length, 1);
  assert.strictEqual(userAWithdrawals[0].giftCardCode, redemptionA.giftCardCode);
  assert.strictEqual(userAWithdrawals[0].giftCardDenomination, 10);
  console.log(`  ✓ Redemption A succeeded: Assigned code ${redemptionA.giftCardCode}, balance updated to ₹${redemptionA.user.balance}.`);

  // Verify inventory reflects the redeemed code
  const statsAfterRedeem = await getGiftCardInventoryStats();
  assert.strictEqual(statsAfterRedeem.availableByDenomination[10], 2, 'Available ₹10 codes should now be 2');
  assert.strictEqual(statsAfterRedeem.redeemedCodes, 1, 'Redeemed count should be 1');
  console.log('  ✓ Inventory stats correctly decremented available and incremented redeemed.');

  // ----------------------------------------------------
  // TEST 5: Second User Redemption & Code Exclusivity (No Duplicate Assignment)
  // ----------------------------------------------------
  console.log('\n▶ TEST 5: Second User Redemption & Code Exclusivity...');
  const userBId = `test_user_gc_B_${Date.now()}`;
  const userB: UserProfile = {
    id: userBId,
    telegramId: 444555666,
    username: 'bob_earner',
    firstName: 'Bob',
    balance: 30,
    lifetimeEarnings: 30,
    referralEarnings: 0,
    referralCode: `ref_${userBId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(userB);

  const redemptionB = await redeemGiftCardWithdrawal(userBId, 10);
  assert.notStrictEqual(redemptionB.giftCardCode, redemptionA.giftCardCode, 'User B must NOT get User A code');
  assert.strictEqual(redemptionB.user.balance, 20);
  console.log(`  ✓ User B received distinct code: ${redemptionB.giftCardCode}. No duplicate code assignment.`);

  // ----------------------------------------------------
  // TEST 6: Out-of-Stock Protection & Balance Safety
  // ----------------------------------------------------
  console.log('\n▶ TEST 6: Out-of-Stock Protection & Zero Balance Deduction...');
  // Redeem the last available ₹10 code (we had 1 left)
  const redemptionC = await redeemGiftCardWithdrawal(userBId, 10);
  assert.strictEqual(redemptionC.user.balance, 10);

  // Now inventory of ₹10 codes is completely exhausted (0 available)
  const statsExhausted = await getGiftCardInventoryStats();
  assert.strictEqual(statsExhausted.availableByDenomination[10] || 0, 0, 'No ₹10 codes remaining');

  // Next redemption attempt MUST throw 'Gift card temporarily out of stock'
  const userABalanceBefore = (await getUser(userAId))!.balance;
  try {
    await redeemGiftCardWithdrawal(userAId, 10);
    assert.fail('Should have failed due to out of stock');
  } catch (err: any) {
    assert.strictEqual(err.message, 'Gift card temporarily out of stock');
    console.log('  ✓ Threw expected exact error: "Gift card temporarily out of stock"');
  }

  // Verify balance was NOT deducted
  const userABalanceAfter = (await getUser(userAId))!.balance;
  assert.strictEqual(userABalanceAfter, userABalanceBefore, 'Balance must remain unchanged on out of stock failure');
  console.log(`  ✓ Balance safety verified: User balance remained strictly ₹${userABalanceAfter}.`);

  // ----------------------------------------------------
  // TEST 7: Insufficient Balance Protection
  // ----------------------------------------------------
  console.log('\n▶ TEST 7: Insufficient Balance Protection...');
  // Add a new code so stock is not the blocker
  await addGiftCardCodes(['AMZN-TEST-NEW-1005'], 10, 'admin_test');

  const poorUserId = `test_user_poor_${Date.now()}`;
  const poorUser: UserProfile = {
    id: poorUserId,
    telegramId: 999888777,
    username: 'poor_user',
    firstName: 'Poor',
    balance: 5, // Below ₹10
    lifetimeEarnings: 5,
    referralEarnings: 0,
    referralCode: `ref_${poorUserId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(poorUser);

  try {
    await redeemGiftCardWithdrawal(poorUserId, 10);
    assert.fail('Should have rejected due to insufficient balance');
  } catch (err: any) {
    assert(err.message.includes('Insufficient balance'));
    console.log(`  ✓ Insufficient balance rejected cleanly with: "${err.message}"`);
  }

  // ----------------------------------------------------
  // TEST 8: Concurrency & Duplicate-Click Protection
  // ----------------------------------------------------
  console.log('\n▶ TEST 8: Concurrency & Duplicate-Click Race Condition Protection...');
  // Stock has only 1 available ₹10 code right now (AMZN-TEST-NEW-1005)
  // Let user with ₹20 fire 3 concurrent redemptions
  const richUserId = `test_user_concurrent_${Date.now()}`;
  const richUser: UserProfile = {
    id: richUserId,
    telegramId: 555444333,
    username: 'concurrent_user',
    firstName: 'Concurrent',
    balance: 20,
    lifetimeEarnings: 20,
    referralEarnings: 0,
    referralCode: `ref_${richUserId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(richUser);

  const results = await Promise.allSettled([
    redeemGiftCardWithdrawal(richUserId, 10),
    redeemGiftCardWithdrawal(richUserId, 10),
    redeemGiftCardWithdrawal(richUserId, 10),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  // Because only 1 code existed in stock, exactly 1 must succeed and the others must fail with out of stock
  assert.strictEqual(fulfilled.length, 1, 'Exactly 1 concurrent request must succeed with 1 code in stock');
  assert.strictEqual(rejected.length, 2, 'The other 2 must fail');
  console.log('  ✓ Concurrency tested: 1 request claimed the code, other 2 cleanly rejected without double assignment.');

  // Final check: user balance must be exactly 20 - 10 = 10
  const finalRichUser = await getUser(richUserId);
  assert.strictEqual(finalRichUser?.balance, 10, 'Balance accurately deducted exactly once');
  console.log('  ✓ Balance accurately deducted once (₹20 -> ₹10).');

  console.log('\n====================================================');
  console.log('🎉 ALL AMAZON GIFT CARD INVENTORY & REDEMPTION TESTS PASSED!');
  console.log('====================================================\n');
}

runGiftCardTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
