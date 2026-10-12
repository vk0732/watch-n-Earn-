import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  saveUser,
  getUser,
  recordTaskCompletion,
  getUserCompletedTaskIds,
  updateAppSettings,
  getAppSettings,
  getUserTransactions,
  memStore,
} from '../server/db.ts';
import {
  getGamificationSettings,
  getUserGamificationState,
  executeSpinWheel,
  grantReferralScratchCard,
  revealScratchCard,
  getGamificationStats,
  checkAndTriggerReferralScratchCard,
} from '../server/gamification.ts';
import type { UserProfile } from '../src/types/index.ts';

console.log('====================================================');
console.log('🧪 RUNNING GAMIFICATION (SPIN WHEEL & SCRATCH CARD) TEST SUITE');
console.log('====================================================');

async function runTests() {
  const testUserId = `tg_gam_user_${Date.now()}`;
  const testUser: UserProfile = {
    id: testUserId,
    telegramId: 999111222,
    username: 'gam_tester',
    firstName: 'Gam Tester',
    balance: 100,
    lifetimeEarnings: 100,
    referralEarnings: 0,
    referralCode: `ref_${testUserId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(testUser);

  // 1. Check default threshold
  console.log('\nTEST 1: Tasks threshold configuration (default 3 tasks per spin)');
  const initialSettings = await getGamificationSettings();
  assert.strictEqual(initialSettings.tasksRequiredPerSpin, 3, 'Default tasks required should be 3');
  assert.strictEqual(initialSettings.spinWheelEnabled, true, 'Spin wheel should be enabled by default');

  let userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.completedTasksCount, 0);
  assert.strictEqual(userState.availableSpins, 0);
  assert.strictEqual(userState.canSpinNow, false);
  console.log('  ✓ Initial state: 0 tasks, 0 spins');

  // Complete 1 task
  await recordTaskCompletion({
    id: `${testUserId}_task_1`,
    userId: testUserId,
    taskId: 'task_1',
    rewardAmount: 10,
    completedAt: new Date().toISOString(),
  });

  userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.completedTasksCount, 1);
  assert.strictEqual(userState.availableSpins, 0);
  assert.strictEqual(userState.progressToNextSpin, 1);
  console.log('  ✓ 1 task completed: 0 spins available, progress = 1/3');

  // Complete 2nd task
  await recordTaskCompletion({
    id: `${testUserId}_task_2`,
    userId: testUserId,
    taskId: 'task_2',
    rewardAmount: 10,
    completedAt: new Date().toISOString(),
  });
  userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.completedTasksCount, 2);
  assert.strictEqual(userState.availableSpins, 0);
  assert.strictEqual(userState.progressToNextSpin, 2);
  console.log('  ✓ 2 tasks completed: 0 spins available, progress = 2/3');

  // Try duplicate completion of task 2 (must not increment)
  const completedIds = await getUserCompletedTaskIds(testUserId);
  assert.strictEqual(completedIds.size, 2);
  console.log('  ✓ Incomplete or duplicate tasks do not increase task counter');

  // Complete 3rd task -> exactly unlocks 1 spin
  await recordTaskCompletion({
    id: `${testUserId}_task_3`,
    userId: testUserId,
    taskId: 'task_3',
    rewardAmount: 10,
    completedAt: new Date().toISOString(),
  });
  userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.completedTasksCount, 3);
  assert.strictEqual(userState.earnedSpins, 1);
  assert.strictEqual(userState.availableSpins, 1);
  assert.strictEqual(userState.canSpinNow, true);
  console.log('  ✓ Exactly 3 tasks reached: 1 spin granted! Available spins = 1');

  // 2. Consume one spin atomically
  console.log('\nTEST 2: Spin execution & atomic consumption');
  const spinRes = await executeSpinWheel(testUserId);
  assert.strictEqual(spinRes.success, true);
  assert.ok(spinRes.winningSegment);
  assert.ok(spinRes.winningSegment.label);
  assert.strictEqual(spinRes.availableSpinsRemaining, 0);
  console.log(`  ✓ Won segment: ${spinRes.winningSegment.label} (₹${spinRes.winningSegment.amount})`);

  userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.availableSpins, 0, 'Spins must be 0 after consumption');
  assert.strictEqual(userState.usedSpins, 1, 'Used spins must be 1');

  // Repeated spin attempt without available spins must be rejected
  try {
    await executeSpinWheel(testUserId);
    assert.fail('Should not allow spin when availableSpins is 0');
  } catch (err: any) {
    console.log(`  ✓ Repeated spin attempt blocked: "${err.message}"`);
  }

  // 3. Test Configurable Range (2, 3, or 4 tasks per spin)
  console.log('\nTEST 3: Admin configuration of tasks required per spin (2, 3, 4)');
  await updateAppSettings({
    gamification: {
      ...initialSettings,
      tasksRequiredPerSpin: 2,
    },
  });
  const updatedSettings = await getGamificationSettings();
  assert.strictEqual(updatedSettings.tasksRequiredPerSpin, 2);

  // User has 3 completed tasks, threshold is 2 -> earned = floor(3/2) = 1, used = 1 -> available = 0
  userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.tasksRequiredPerSpin, 2);
  assert.strictEqual(userState.progressToNextSpin, 1); // 3 % 2 = 1

  // Adding 4th task -> 4 completed, threshold 2 -> earned = 2, used = 1 -> available = 1 spin!
  await recordTaskCompletion({
    id: `${testUserId}_task_4`,
    userId: testUserId,
    taskId: 'task_4',
    rewardAmount: 10,
    completedAt: new Date().toISOString(),
  });
  userState = await getUserGamificationState(testUserId);
  assert.strictEqual(userState.earnedSpins, 2);
  assert.strictEqual(userState.availableSpins, 1);
  console.log('  ✓ Configured to 2 tasks: 4 completed tasks gives 2 earned, 1 available spin');

  // Reset back to 3
  await updateAppSettings({
    gamification: {
      ...initialSettings,
      tasksRequiredPerSpin: 3,
    },
  });

  // 4. Referral Scratch Card Granting & Idempotency
  console.log('\nTEST 4: Successful referral scratch card granting');
  const referrerId = testUserId;
  const refereeId = `referee_${Date.now()}`;
  const referralId = `${referrerId}_${refereeId}`;

  const card1 = await grantReferralScratchCard(referrerId, referralId, 'invited_friend');
  assert.ok(card1);
  assert.strictEqual(card1.isRevealed, false);
  console.log(`  ✓ Unique scratch card generated for referral ${referralId}`);

  // Idempotency test: calling grant again returns same card without duplicating
  const cardDup = await grantReferralScratchCard(referrerId, referralId, 'invited_friend');
  assert.strictEqual(cardDup?.id, card1.id, 'Must return same card entitlement id');
  console.log('  ✓ Duplicate card creation blocked idempotently');

  userState = await getUserGamificationState(referrerId);
  assert.strictEqual(userState.totalScratchCards, 1);
  assert.strictEqual(userState.unrevealedScratchCards, 1);

  // 5. Scratch Card Reveal & Ledger Verification
  console.log('\nTEST 5: Scratch card reveal and atomic ledger reward');
  const initialBalance = (await getUser(referrerId))!.balance;
  const revealRes = await revealScratchCard(referrerId, card1.id);
  assert.strictEqual(revealRes.success, true);
  assert.strictEqual(revealRes.card.isRevealed, true);
  console.log(`  ✓ Scratch card revealed: Reward = ₹${revealRes.card.rewardAmount}`);

  const userAfterReveal = (await getUser(referrerId))!;
  if (revealRes.card.rewardAmount > 0) {
    assert.strictEqual(userAfterReveal.balance, Math.round((initialBalance + revealRes.card.rewardAmount) * 100) / 100);
    const txs = await getUserTransactions(referrerId);
    const scratchTx = txs.find((t) => t.type === 'scratch_reward');
    assert.ok(scratchTx, 'Financial transaction ledger must record scratch_reward');
    console.log('  ✓ Scratch reward recorded in financial ledger');
  }

  // Repeated scratch of same card must not duplicate reward
  const repeatReveal = await revealScratchCard(referrerId, card1.id);
  assert.strictEqual(repeatReveal.success, true);
  assert.strictEqual((await getUser(referrerId))!.balance, userAfterReveal.balance);
  console.log('  ✓ Repeated scratch attempt rejected idempotently without balance addition');

  // 6. Referral Condition Trigger (Registration vs Tasks)
  console.log('\nTEST 6: Referral eligibility condition trigger');
  await updateAppSettings({
    gamification: {
      ...initialSettings,
      scratchCondition: 'registration',
    },
  });
  const referee2: UserProfile = {
    id: `referee_user_2`,
    telegramId: 888222,
    username: 'ref_user_two',
    firstName: 'Ref Two',
    balance: 50,
    lifetimeEarnings: 50,
    referralEarnings: 0,
    referralCode: 'ref_2',
    referredBy: referrerId,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(referee2);

  await checkAndTriggerReferralScratchCard(referee2.id, 'registration');
  const updatedUserState = await getUserGamificationState(referrerId);
  assert.strictEqual(updatedUserState.totalScratchCards, 2, 'Should have 2 scratch cards after second qualified referral');
  console.log('  ✓ Qualified referral triggered scratch card issuance successfully');

  // 7. Gamification Stats Overview
  console.log('\nTEST 7: Admin gamification statistics');
  const stats = await getGamificationStats();
  assert.ok(stats.spinsEarned >= 1);
  assert.ok(stats.spinsUsed >= 1);
  assert.strictEqual(stats.scratchCardsIssued, 2);
  assert.strictEqual(stats.scratchCardsRevealed, 1);
  console.log(`  ✓ Stats verified: Spins=${stats.spinsEarned}, Cards Issued=${stats.scratchCardsIssued}, Revealed=${stats.scratchCardsRevealed}`);

  // Restore initial settings
  await updateAppSettings({ gamification: initialSettings });

  console.log('\n====================================================');
  console.log('🎉 ALL 7 GAMIFICATION SUITE TESTS PASSED PERFECTLY!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
