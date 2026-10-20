import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getUser,
  saveUser,
  atomicCreditBalance,
  getUserTransactions,
  addGiftCardCodes,
  redeemGiftCardWithdrawal,
  getUserWithdrawals,
  getAllWithdrawals,
  memStore,
} from '../server/db.ts';
import { setMockChannelMembership } from '../server/telegram.ts';
import type { UserProfile } from '../src/types/index.ts';

async function runPersistenceTests() {
  console.log('=== TEST SUITE: FINANCIAL PERSISTENCE ACROSS COLD-STARTS ===');

  const testUserId = `persist_user_${Date.now()}`;
  const mockUser: UserProfile = {
    id: testUserId,
    telegramId: 999111222,
    username: 'persistence_tester',
    firstName: 'Persistence',
    balance: 0,
    lifetimeEarnings: 0,
    referralEarnings: 0,
    dailyStreak: 0,
    referralCode: 'PERSIST99',
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  setMockChannelMembership('*', { isMember: true, status: 'member' });

  await saveUser(mockUser);
  console.log('  ✓ Saved initial user profile');

  // Credit balance +₹50
  const credit1 = await atomicCreditBalance(testUserId, 50, 'signup_bonus', 'Initial Signup Bonus');
  assert.strictEqual(credit1.user.balance, 50);
  assert.strictEqual(credit1.transaction.balanceAfter, 50);
  console.log('  ✓ Credited +₹50 signup bonus (balance = 50)');

  // Credit balance +₹20
  const credit2 = await atomicCreditBalance(testUserId, 20, 'task_reward', 'Completed Task 1');
  assert.strictEqual(credit2.user.balance, 70);
  assert.strictEqual(credit2.transaction.balanceAfter, 70);
  console.log('  ✓ Credited +₹20 task reward (balance = 70)');

  // Add a gift card code
  const gcCode = `AMZN-PERSIST-${Date.now()}`;
  await addGiftCardCodes([gcCode], 10, 'admin_tester');
  console.log('  ✓ Added ₹10 gift card code to inventory');

  // SIMULATE SERVERLESS COLD-START / BOT RESTART
  console.log('\n--- SIMULATING SERVERLESS COLD-START / BOT RESTART ---');
  memStore.users.clear();
  memStore.transactions.clear();
  memStore.withdrawals.clear();
  memStore.giftCardCodes.clear();
  console.log('  [MEMSTORE CLEARED]: All volatile in-memory state wiped!');
  assert.strictEqual(memStore.users.size, 0);
  assert.strictEqual(memStore.transactions.size, 0);
  assert.strictEqual(memStore.withdrawals.size, 0);

  // 1. Verify User survives cold start
  const rehydratedUser = await getUser(testUserId);
  assert.ok(rehydratedUser, 'User must exist in persistent database');
  assert.strictEqual(rehydratedUser.balance, 70, 'User balance must match persistent value ₹70');
  console.log(`  ✓ User ground-truth balance persisted across restart: ₹${rehydratedUser.balance}`);

  // 2. Verify Transactions survive cold start
  const transactionsAfterRestart = await getUserTransactions(testUserId);
  assert.ok(transactionsAfterRestart.length >= 2, `Expected at least 2 transactions, got ${transactionsAfterRestart.length}`);
  console.log(`  ✓ Transactions persisted across restart: ${transactionsAfterRestart.length} records retrieved from DB`);

  // 3. Redeem Gift Card
  const idempotencyKey = `idemp_persist_${Date.now()}`;
  const redemption1 = await redeemGiftCardWithdrawal(testUserId, 10, idempotencyKey);
  assert.strictEqual(redemption1.withdrawal.status, 'success');
  assert.strictEqual(redemption1.withdrawal.amount, 10);
  assert.ok(redemption1.giftCardCode && redemption1.giftCardCode.length > 0, 'Gift card code must be assigned');
  assert.strictEqual(redemption1.user.balance, 60);
  console.log(`  ✓ Redeemed ₹10 Gift Card code: ${redemption1.giftCardCode}, balance deducted to ₹${redemption1.user.balance}`);

  // SIMULATE ANOTHER RESTART / LAMBDA RECYCLE
  console.log('\n--- SIMULATING SECOND RESTART (TESTING PERSISTENT IDEMPOTENCY) ---');
  memStore.users.clear();
  memStore.transactions.clear();
  memStore.withdrawals.clear();
  memStore.giftCardCodes.clear();
  console.log('  [MEMSTORE CLEARED AGAIN]');

  // 4. Test Idempotent Retry across cold starts
  const redemptionRetry = await redeemGiftCardWithdrawal(testUserId, 10, idempotencyKey);
  assert.strictEqual(redemptionRetry.withdrawal.id, redemption1.withdrawal.id, 'Withdrawal ID must be identical on idempotent retry');
  assert.strictEqual(redemptionRetry.giftCardCode, redemption1.giftCardCode, 'Gift card code must be identical on idempotent retry');
  assert.strictEqual(redemptionRetry.user.balance, 60, 'Balance must NOT be deducted again on idempotent retry');
  console.log('  ✓ Idempotent retry returned identical withdrawal without double deduction!');

  // 5. Verify User Withdrawals survive cold starts
  const withdrawalsAfterRestart = await getUserWithdrawals(testUserId);
  assert.ok(withdrawalsAfterRestart.length >= 1, 'Withdrawal history must persist');
  assert.strictEqual(withdrawalsAfterRestart[0].id, redemption1.withdrawal.id);
  assert.strictEqual(withdrawalsAfterRestart[0].giftCardCode, redemption1.giftCardCode);
  console.log(`  ✓ Withdrawal history persisted across restarts: Order ${withdrawalsAfterRestart[0].id}`);

  // 6. Verify Admin getAllWithdrawals survives cold starts
  const allWithdrawalsAfterRestart = await getAllWithdrawals();
  assert.ok(allWithdrawalsAfterRestart.length >= 1, 'Admin withdrawals must load from DB');
  console.log(`  ✓ Admin withdrawals persisted across restarts: ${allWithdrawalsAfterRestart.length} total records`);

  console.log('\n==================================================');
  console.log('  FINANCIAL PERSISTENCE SUITE: ALL TESTS PASSED ✓');
  console.log('==================================================\n');
  process.exit(0);
}

runPersistenceTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
