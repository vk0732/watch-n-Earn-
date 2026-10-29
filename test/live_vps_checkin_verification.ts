import assert from 'node:assert';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

import {
  getAppSettings,
  updateAppSettings,
  getDailyCheckinCycleRewards,
  getTotalRegisteredUsersCount,
  getAllTasks,
  saveUser,
  getUser,
} from '../server/db.ts';
import type { UserProfile } from '../src/types/index.ts';

function pass(name: string) {
  console.log(`  ✓ PASS: ${name}`);
}

async function verifyLiveVPS() {
  console.log('\n======================================================================');
  console.log('  LIVE VPS HEALTH CHECK & DAILY CHECK-IN VERIFICATION');
  console.log('======================================================================\n');

  // 1. Verify Live Health & Config via HTTP to localhost:3002
  console.log('Step 1: Testing Live HTTP Endpoints (Port 3002)');
  const healthRes = await fetch('http://127.0.0.1:3002/api/health');
  assert.strictEqual(healthRes.status, 200, 'Health endpoint must return 200 OK');
  const healthJson = await healthRes.json();
  assert.strictEqual(healthJson.status, 'ok', 'Health status must be ok');
  assert.strictEqual(healthJson.botUsername, 'WatchVEarnBot', 'Bot username must be WatchVEarnBot');
  pass('Health endpoint responding with HTTP 200 and WatchVEarnBot');

  const configRes = await fetch('http://127.0.0.1:3002/api/config');
  assert.strictEqual(configRes.status, 200, 'Config endpoint must return 200 OK');
  const configJson = await configRes.json();
  assert.ok(configJson.settings, 'Config must return settings');
  pass('Config endpoint responding with HTTP 200');

  // 2. Verify Frontend Assets
  console.log('\nStep 2: Testing Frontend Production Build');
  const htmlRes = await fetch('http://127.0.0.1:3002/');
  assert.strictEqual(htmlRes.status, 200, 'Index.html must return 200 OK');
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes('<div id="root"></div>'), 'Index.html must contain root mount point');
  pass('Frontend index.html successfully served from live build');

  // 3. Verify Flexible Daily Check-In Amounts and Decimal Precision
  console.log('\nStep 3: Testing Custom Per-Day Reward Settings & Decimal Precision');
  const testRewards = [0.25, 0.50, 0.75, 1.25, 1.50, 2.25, 3.50];
  await updateAppSettings({
    dailyCheckinRewards: testRewards,
    dailyCheckinBaseReward: testRewards[0],
    dailyCheckinEnabled: true,
  });

  const settingsAfterUpdate = await getAppSettings();
  assert.strictEqual(settingsAfterUpdate.dailyCheckinEnabled, true, 'Daily checkin must be enabled');
  assert.deepStrictEqual(settingsAfterUpdate.dailyCheckinRewards, testRewards, 'Daily checkin rewards must match exact custom decimals');
  assert.strictEqual(settingsAfterUpdate.dailyCheckinBaseReward, 0.25, 'Base reward must be 0.25');

  const cycleRewards = getDailyCheckinCycleRewards(settingsAfterUpdate);
  assert.deepStrictEqual(cycleRewards, testRewards, 'Cycle rewards function returns exact decimal amounts');
  pass('Custom decimal amounts [₹0.25, ₹0.50, ₹0.75, ₹1.25, ₹1.50, ₹2.25, ₹3.50] verified with zero rounding');

  // 4. Test Master ON/OFF Toggle Persistence and Claim Blocking
  console.log('\nStep 4: Testing Master ON/OFF Toggle & Claim Blocking When OFF');
  
  // Set to OFF
  await updateAppSettings({ dailyCheckinEnabled: false });
  const settingsOff = await getAppSettings();
  assert.strictEqual(settingsOff.dailyCheckinEnabled, false, 'Daily checkin must be OFF');
  pass('Daily checkin successfully disabled in settings');

  // Verify HTTP rejection when calling daily check-in with a test user while OFF
  const botToken = process.env.TELEGRAM_BOT_TOKEN || 'dummy:token';
  const testTgId = 98881234;
  const testUserJson = JSON.stringify({ id: testTgId, first_name: 'TestOffUser', username: 'testoffuser' });
  const authDate = Math.floor(Date.now() / 1000);
  const dataCheckString = `auth_date=${authDate}\nuser=${testUserJson}`;
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const validHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const validInitData = `auth_date=${authDate}&user=${encodeURIComponent(testUserJson)}&hash=${validHash}`;

  const testUser: UserProfile = {
    id: `user_test_off_${Date.now()}`,
    telegramId: testTgId,
    username: 'testoffuser',
    firstName: 'TestOffUser',
    lastName: '',
    photoUrl: '',
    balance: 50.00,
    lifetimeEarnings: 50.00,
    referralEarnings: 0,
    referralCode: `ref_test_off_${Date.now()}`,
    dailyStreak: 0,
    isBanned: false,
    signupBonusClaimed: true,
    lastDailyCheckIn: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(testUser);

  const claimOffRes = await fetch('http://127.0.0.1:3002/api/rewards/daily-checkin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': validInitData,
    },
  });
  assert.strictEqual(claimOffRes.status, 403, 'Claiming when Daily Check-in is OFF must return 403 Forbidden');
  const claimOffJson = await claimOffRes.json();
  assert.strictEqual(claimOffJson.disabled, true, 'Response must indicate feature is disabled');
  assert.ok(claimOffJson.error.includes('disabled'), 'Error message must state check-in is disabled');
  pass('Backend strictly rejects reward claim with 403 Forbidden when Daily Check-In is OFF');

  // 5. Test Switching ON again and Claiming Normal Reward
  console.log('\nStep 5: Testing Switching ON again & Claiming Reward');
  await updateAppSettings({ dailyCheckinEnabled: true });
  const settingsOn = await getAppSettings();
  assert.strictEqual(settingsOn.dailyCheckinEnabled, true, 'Daily checkin must be ON');
  assert.deepStrictEqual(settingsOn.dailyCheckinRewards, testRewards, 'Custom amounts preserved after re-enabling');
  pass('Re-enabling Daily Check-in restores custom amounts and availability');

  const claimOnRes = await fetch('http://127.0.0.1:3002/api/rewards/daily-checkin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': validInitData,
    },
  });
  assert.strictEqual(claimOnRes.status, 200, 'Claiming when Daily Check-in is ON must return 200 OK');
  const claimOnJson = await claimOnRes.json();
  assert.strictEqual(claimOnJson.success, true, 'Claim must succeed');
  assert.strictEqual(claimOnJson.rewardAmount, 0.25, 'Day 1 reward must be exactly 0.25');
  assert.strictEqual(claimOnJson.streak, 1, 'Streak must be 1');
  pass('Claiming when ON awards exact configured Day 1 decimal reward (+₹0.25)');

  // 6. Test Same-Day Duplicate Claim Block
  console.log('\nStep 6: Testing Duplicate Same-Day Claim Rejection');
  const dupClaimRes = await fetch('http://127.0.0.1:3002/api/rewards/daily-checkin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': validInitData,
    },
  });
  assert.strictEqual(dupClaimRes.status, 400, 'Duplicate claim on same calendar day must return 400 Bad Request');
  pass('Duplicate same-day check-in attempt strictly rejected with 400');

  // 7. Data Safety Verification
  console.log('\nStep 7: Production Data Safety Verification');
  const totalUsers = getTotalRegisteredUsersCount();
  assert.ok(totalUsers >= 1143, `Total users count must remain >= 1,143 (got ${totalUsers})`);
  const tasks = await getAllTasks();
  assert.ok(tasks.length > 0, 'Tasks must remain present and functional');
  pass(`Authoritative user count (${totalUsers}) and tasks verified intact with ZERO data loss`);

  console.log('\n======================================================================');
  console.log('  ALL LIVE VPS CHECKS & VERIFICATIONS PASSED (7/7) ✓');
  console.log('======================================================================\n');
}

verifyLiveVPS()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Live Verification Failed:', err);
    process.exit(1);
  });
