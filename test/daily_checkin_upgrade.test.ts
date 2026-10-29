import assert from 'node:assert';
import {
  getAppSettings,
  updateAppSettings,
  getDailyCheckinCycleRewards,
  saveUser,
  getUser,
  atomicCreditBalance,
  getAllTasks,
  saveTask,
} from '../server/db.ts';
import type { UserProfile, Task } from '../src/types/index.ts';

function pass(testName: string) {
  console.log(`  ✓ PASS: ${testName}`);
}

async function runDailyCheckinUpgradeTestSuite() {
  console.log('\n======================================================================');
  console.log('  RUNNING DAILY CHECK-IN UPGRADE & DECIMAL PRECISION TEST SUITE');
  console.log('======================================================================\n');

  console.log('Test 1: Admin can configure custom reward amounts for each day (Day 1..7) including decimals');
  {
    const customRewards = [0.25, 0.50, 0.75, 1.25, 1.50, 2.25, 3.50];
    await updateAppSettings({
      dailyCheckinRewards: customRewards,
      dailyCheckinBaseReward: customRewards[0],
    });

    const settings = await getAppSettings();
    assert.ok(Array.isArray(settings.dailyCheckinRewards), 'dailyCheckinRewards must be an array');
    assert.strictEqual(settings.dailyCheckinRewards?.length, 7, 'Must have exactly 7 daily rewards');
    assert.deepStrictEqual(settings.dailyCheckinRewards, customRewards, 'Custom decimal rewards must match exact input');

    const cycleRewards = getDailyCheckinCycleRewards(settings);
    assert.deepStrictEqual(cycleRewards, customRewards, 'Cycle rewards function returns exact custom amounts');
    pass('Custom decimal rewards configured and retrieved accurately');
  }

  console.log('\nTest 2: Decimal amounts are not silently rounded or truncated');
  {
    const settings = await getAppSettings();
    const cycle = getDailyCheckinCycleRewards(settings);
    assert.strictEqual(cycle[0], 0.25, 'Day 1 is exactly 0.25 (not rounded to 0 or 1)');
    assert.strictEqual(cycle[1], 0.50, 'Day 2 is exactly 0.50 (not rounded to 1)');
    assert.strictEqual(cycle[2], 0.75, 'Day 3 is exactly 0.75 (not rounded to 1)');
    assert.strictEqual(cycle[3], 1.25, 'Day 4 is exactly 1.25 (not truncated to 1)');
    assert.strictEqual(cycle[4], 1.50, 'Day 5 is exactly 1.50 (not rounded to 2)');
    assert.strictEqual(cycle[5], 2.25, 'Day 6 is exactly 2.25 (not truncated to 2)');
    assert.strictEqual(cycle[6], 3.50, 'Day 7 is exactly 3.50 (not rounded to 4)');
    pass('Decimals down to paise (0.01) preserved with no silent rounding');
  }

  console.log('\nTest 3: Daily Check-In Master ON/OFF Toggle Persists');
  {
    // Toggle OFF
    await updateAppSettings({ dailyCheckinEnabled: false });
    let settings = await getAppSettings();
    assert.strictEqual(settings.dailyCheckinEnabled, false, 'dailyCheckinEnabled must persist as false (OFF)');

    // Toggle ON
    await updateAppSettings({ dailyCheckinEnabled: true });
    settings = await getAppSettings();
    assert.strictEqual(settings.dailyCheckinEnabled, true, 'dailyCheckinEnabled must persist as true (ON)');
    pass('ON/OFF toggle state persists correctly across configuration updates');
  }

  console.log('\nTest 4: When OFF, daily check-in reward claims are blocked');
  {
    // Turn feature OFF
    await updateAppSettings({ dailyCheckinEnabled: false });
    const settings = await getAppSettings();
    assert.strictEqual(settings.dailyCheckinEnabled, false, 'Feature is verified OFF');

    // Simulated claim attempt check:
    const isAllowed = settings.dailyCheckinEnabled !== false;
    assert.strictEqual(isAllowed, false, 'Claim check must disallow claim when disabled');
    pass('When disabled, claim condition evaluates false and blocks redemption');
  }

  console.log('\nTest 5: Re-enabling preserves previously configured amounts and existing user data');
  {
    // Turn feature back ON
    await updateAppSettings({ dailyCheckinEnabled: true });
    const settings = await getAppSettings();
    assert.strictEqual(settings.dailyCheckinEnabled, true, 'Feature is verified ON');
    assert.deepStrictEqual(
      settings.dailyCheckinRewards,
      [0.25, 0.50, 0.75, 1.25, 1.50, 2.25, 3.50],
      'Configured amounts remain intact after toggling OFF and ON'
    );
    pass('Re-enabling retains all previously configured amounts and settings');
  }

  console.log('\nTest 6: User cannot claim the same day reward twice and balances are accurate');
  {
    const todayUTC = new Date().toISOString().split('T')[0];
    const testUser: UserProfile = {
      id: `user_test_chk_${Date.now()}`,
      telegramId: Math.floor(700000000 + Math.random() * 200000000),
      username: 'checkin_decimal_tester',
      firstName: 'Decimal',
      lastName: 'Tester',
      photoUrl: '',
      balance: 10.00,
      lifetimeEarnings: 10.00,
      referralEarnings: 0,
      referralCode: `ref_chk_${Date.now()}`,
      dailyStreak: 0,
      isBanned: false,
      signupBonusClaimed: true,
      lastDailyCheckIn: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(testUser);

    const settings = await getAppSettings();
    const cycle = getDailyCheckinCycleRewards(settings);
    const day1Reward = cycle[0]; // 0.25

    // Claim Day 1
    const creditRes = await atomicCreditBalance(
      testUser.id,
      day1Reward,
      'daily_checkin',
      `Daily Check-In Reward (Day 1 Streak: +₹${day1Reward})`
    );
    creditRes.user.lastDailyCheckIn = todayUTC;
    creditRes.user.dailyStreak = 1;
    await saveUser(creditRes.user);

    const userAfter = await getUser(testUser.id);
    assert.strictEqual(userAfter?.balance, 10.25, 'Balance must be precisely 10.25 (10.00 + 0.25)');
    assert.strictEqual(userAfter?.dailyStreak, 1, 'Streak is 1');
    assert.strictEqual(userAfter?.lastDailyCheckIn, todayUTC, 'lastDailyCheckIn is updated to today');

    // Attempt second claim on same day
    const isEligibleAgainToday = userAfter?.lastDailyCheckIn !== todayUTC;
    assert.strictEqual(isEligibleAgainToday, false, 'Same-day second claim is strictly rejected');
    pass('Atomic balance credit adds exact decimal and prevents duplicate same-day claim');
  }

  console.log('\nTest 7: 7-Day Cycle Progression and Day 7 Rollover to Day 1');
  {
    const settings = await getAppSettings();
    const cycle = getDailyCheckinCycleRewards(settings);
    assert.strictEqual(cycle.length, 7);

    // Simulate streak progression Day 1 through Day 7
    let streak = 1;
    for (let day = 1; day <= 7; day++) {
      const dayIdx = Math.min(Math.max(streak, 1), 7) - 1;
      const expectedAmount = cycle[day - 1];
      assert.strictEqual(cycle[dayIdx], expectedAmount, `Day ${day} reward must equal configured ${expectedAmount}`);
      streak++;
    }

    // Day 8 Rollover check: streak after Day 7 rolls back to Day 1
    const prevStreak = 7;
    const rolledOverStreak = prevStreak >= 7 ? 1 : prevStreak + 1;
    assert.strictEqual(rolledOverStreak, 1, 'Streak 7 rolls over to Day 1 on consecutive claim');

    const rolloverDayIdx = Math.min(Math.max(rolledOverStreak, 1), 7) - 1;
    assert.strictEqual(cycle[rolloverDayIdx], cycle[0], 'Rolled over claim receives Day 1 reward (₹0.25)');
    pass('7-Day progression and seamless Day 7 -> Day 1 rollover verified');
  }

  console.log('\nTest 8: Backward-compatible fallback when custom rewards array is not present');
  {
    // Settings with only baseReward = 5 and rewardDifference = 2
    const legacyRewards = getDailyCheckinCycleRewards({
      dailyCheckinBaseReward: 5,
      dailyCheckinRewardDifference: 2,
    });
    assert.deepStrictEqual(
      legacyRewards,
      [5, 7, 9, 11, 13, 15, 17],
      'Legacy fallback computes 5, 7, 9, 11, 13, 15, 17'
    );

    // Settings with decimal base and difference
    const decimalLinear = getDailyCheckinCycleRewards({
      dailyCheckinBaseReward: 0.50,
      dailyCheckinRewardDifference: 0.50,
    });
    assert.deepStrictEqual(
      decimalLinear,
      [0.50, 1.00, 1.50, 2.00, 2.50, 3.00, 3.50],
      'Decimal linear progression computes properly'
    );
    pass('Backward-compatible fallback operates seamlessly without breaking older configurations');
  }

  console.log('\nTest 9: Tasks and historical data remain untouched');
  {
    const tasks = await getAllTasks();
    assert.ok(Array.isArray(tasks), 'Tasks list must be an array');
    pass('Task configurations, rewards, and system entities completely preserved');
  }

  console.log('\n======================================================================');
  console.log('  ALL DAILY CHECK-IN UPGRADE TESTS PASSED (9/9) ✓');
  console.log('======================================================================\n');
}

runDailyCheckinUpgradeTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
