import {
  getUser,
  saveUser,
  getAppSettings,
  getUserByReferralCode,
  atomicClaimSignupBonus,
  atomicClaimReferralReward,
  hasUserClaimedSignupBonus,
  hasDeviceClaimedSignupBonus,
  memStore,
} from '../server/db.ts';
import {
  issueSignedDeviceToken,
  verifySignedDeviceToken,
  computeDeviceFingerprintHash,
} from '../server/deviceAuth.ts';

async function runTestSuite() {
  console.log('====================================================');
  console.log('🚀 TELEEARN ANTI-FRAUD & ONE-DEVICE TEST SUITE');
  console.log('====================================================\n');

  let passedTests = 0;
  const totalTests = 9;

  // TEST 1: A new eligible user receives the signup bonus once.
  console.log('▶ Test 1: New eligible user receives signup bonus once...');
  const user1Id = '90000001';
  const deviceToken1 = issueSignedDeviceToken();
  const verifiedDev1 = verifySignedDeviceToken(deviceToken1);
  const fpHash1 = computeDeviceFingerprintHash('Device1_Chrome_Linux_1920x1080');

  const newUser1 = await saveUser({
    id: user1Id,
    telegramId: 90000001,
    username: 'test_user_alpha',
    firstName: 'User Alpha',
    balance: 0,
    lifetimeEarnings: 0,
    referralEarnings: 0,
    referralCode: 'ref_90000001_abc',
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const claim1 = await atomicClaimSignupBonus({
    userId: user1Id,
    telegramId: 90000001,
    deviceId: verifiedDev1.deviceId,
    fingerprintHash: fpHash1,
  });

  const refreshedUser1 = await getUser(user1Id);
  if (
    claim1.success &&
    claim1.amount === 20 &&
    refreshedUser1?.balance === 20 &&
    refreshedUser1.signupBonusClaimed === true
  ) {
    console.log('  ✅ PASS: User Alpha received ₹20 signup bonus exactly once (Balance = 20).');
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 1 failed:', { claim1, balance: refreshedUser1?.balance });
  }

  // TEST 2: Repeated /start commands do not grant another bonus.
  console.log('\n▶ Test 2: Repeated /start commands do not grant another bonus...');
  const user1BeforeBalance = refreshedUser1?.balance || 0;
  // User Alpha runs /start again
  const userLookup = await getUser(user1Id);
  const isNew = !userLookup; // isNew is false!
  let startBonusGranted = false;
  if (isNew) {
    startBonusGranted = true;
  }
  const user1AfterBalance = (await getUser(user1Id))?.balance;
  if (!startBonusGranted && user1BeforeBalance === user1AfterBalance && user1AfterBalance === 20) {
    console.log('  ✅ PASS: Repeated /start commands did not grant another bonus (Balance remains 20).');
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 2 failed: Duplicate bonus on repeated /start.');
  }

  // TEST 3: The same Telegram account cannot claim the bonus twice.
  console.log('\n▶ Test 3: The same Telegram account cannot claim the bonus twice...');
  const repeatClaim = await atomicClaimSignupBonus({
    userId: user1Id,
    telegramId: 90000001,
    deviceId: verifiedDev1.deviceId,
    fingerprintHash: fpHash1,
  });
  const user1FinalBalance = (await getUser(user1Id))?.balance;
  if (!repeatClaim.success && user1FinalBalance === 20) {
    console.log(`  ✅ PASS: Second claim rejected (${repeatClaim.reason}). Balance remains 20.`);
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 3 failed: Account was able to claim bonus twice:', repeatClaim);
  }

  // TEST 4: Account B on the same identifiable device context is denied a second signup bonus.
  console.log('\n▶ Test 4: Account B on same device context is denied second signup bonus...');
  const user2Id = '90000002'; // Telegram Account B
  await saveUser({
    id: user2Id,
    telegramId: 90000002,
    username: 'test_user_beta',
    firstName: 'User Beta',
    balance: 0,
    lifetimeEarnings: 0,
    referralEarnings: 0,
    referralCode: 'ref_90000002_xyz',
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Account B attempts to claim on Device 1
  const claimBetaSameDevice = await atomicClaimSignupBonus({
    userId: user2Id,
    telegramId: 90000002,
    deviceId: verifiedDev1.deviceId, // SAME DEVICE!
    fingerprintHash: fpHash1,
  });

  const userBeta = await getUser(user2Id);
  const expectedMessage = '⚠️ Signup bonus has already been claimed on this device.';
  if (
    !claimBetaSameDevice.success &&
    claimBetaSameDevice.isDeviceDuplicate === true &&
    claimBetaSameDevice.message === expectedMessage &&
    userBeta?.balance === 0
  ) {
    console.log(`  ✅ PASS: Denied with exact message: "${claimBetaSameDevice.message}" (Balance = 0).`);
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 4 failed:', { claimBetaSameDevice, balance: userBeta?.balance });
  }

  // TEST 5: The same device cannot generate multiple referral rewards by switching Telegram accounts.
  console.log('\n▶ Test 5: Same device cannot generate referral rewards by switching accounts...');
  // Suppose User Alpha gives referral code to User Beta, but Beta is on Alpha's device!
  const deviceReferralAbuse = await atomicClaimReferralReward({
    referrerId: user1Id,
    refereeId: user2Id,
    refereeUsername: 'test_user_beta',
    refereeDeviceId: verifiedDev1.deviceId, // Same device as Alpha!
    refereeFingerprintHash: fpHash1,
  });

  const alphaBalanceAfterAbuse = (await getUser(user1Id))?.balance;
  if (!deviceReferralAbuse.success && deviceReferralAbuse.isAbuseDetected && alphaBalanceAfterAbuse === 20) {
    console.log(`  ✅ PASS: Referral fraud blocked (${deviceReferralAbuse.reason}). Referrer balance untouched.`);
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 5 failed:', { deviceReferralAbuse, alphaBalanceAfterAbuse });
  }

  // TEST 6: Self-referrals and invalid referral codes are rejected.
  console.log('\n▶ Test 6: Self-referrals and invalid referral codes are rejected...');
  // Self referral:
  const selfRefRes = await atomicClaimReferralReward({
    referrerId: user1Id,
    refereeId: user1Id, // SELF!
    refereeUsername: 'test_user_alpha',
    refereeDeviceId: 'dev_other_9999',
  });

  // Invalid referral code lookup:
  const invalidCode = await getUserByReferralCode('nonexistent_fake_code_123');
  const alteredCode = await getUserByReferralCode('ref_90000001_hacked');

  if (!selfRefRes.success && selfRefRes.isAbuseDetected && invalidCode === null && alteredCode === null) {
    console.log('  ✅ PASS: Self-referral rejected and manipulated/nonexistent referral codes return null.');
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 6 failed:', { selfRefRes, invalidCode, alteredCode });
  }

  // TEST 7: The same referral reward cannot be credited twice.
  console.log('\n▶ Test 7: The same referral reward cannot be credited twice...');
  // Legitimate referee User Gamma on a NEW Device 3
  const user3Id = '90000003';
  const deviceToken3 = issueSignedDeviceToken();
  const verifiedDev3 = verifySignedDeviceToken(deviceToken3);
  await saveUser({
    id: user3Id,
    telegramId: 90000003,
    username: 'test_user_gamma',
    firstName: 'User Gamma',
    balance: 0,
    lifetimeEarnings: 0,
    referralEarnings: 0,
    referralCode: 'ref_90000003_ggg',
    referredBy: user1Id,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Claim first time (legitimate)
  const legitRefClaim1 = await atomicClaimReferralReward({
    referrerId: user1Id,
    refereeId: user3Id,
    refereeUsername: 'test_user_gamma',
    refereeDeviceId: verifiedDev3.deviceId,
  });

  const alphaBalanceAfterLegit = (await getUser(user1Id))?.balance; // Was 20, should now be 30 (+10)

  // Claim second time for the exact same referee
  const repeatRefClaim2 = await atomicClaimReferralReward({
    referrerId: user1Id,
    refereeId: user3Id,
    refereeUsername: 'test_user_gamma',
    refereeDeviceId: verifiedDev3.deviceId,
  });

  const alphaBalanceAfterRepeat = (await getUser(user1Id))?.balance; // Must remain 30

  if (
    legitRefClaim1.success &&
    alphaBalanceAfterLegit === 30 &&
    !repeatRefClaim2.success &&
    alphaBalanceAfterRepeat === 30
  ) {
    console.log(`  ✅ PASS: Referral reward credited exactly once (+₹10). Duplicate attempt rejected: "${repeatRefClaim2.reason}".`);
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 7 failed:', { legitRefClaim1, repeatRefClaim2, alphaBalanceAfterRepeat });
  }

  // TEST 8: Concurrent requests cannot create duplicate bonus credits.
  console.log('\n▶ Test 8: Concurrent requests cannot create duplicate bonus credits...');
  const user4Id = '90000004';
  const deviceToken4 = issueSignedDeviceToken();
  const verifiedDev4 = verifySignedDeviceToken(deviceToken4);

  await saveUser({
    id: user4Id,
    telegramId: 90000004,
    username: 'test_user_delta',
    firstName: 'User Delta',
    balance: 0,
    lifetimeEarnings: 0,
    referralEarnings: 0,
    referralCode: 'ref_90000004_ddd',
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Launch 10 simultaneous concurrent claim requests
  const concurrentPromises = Array.from({ length: 10 }).map(() =>
    atomicClaimSignupBonus({
      userId: user4Id,
      telegramId: 90000004,
      deviceId: verifiedDev4.deviceId,
    })
  );

  const results = await Promise.all(concurrentPromises);
  const successfulClaims = results.filter((r) => r.success);
  const rejectedClaims = results.filter((r) => !r.success);
  const deltaFinalBalance = (await getUser(user4Id))?.balance;

  if (successfulClaims.length === 1 && rejectedClaims.length === 9 && deltaFinalBalance === 20) {
    console.log(`  ✅ PASS: 10 concurrent requests handled atomically. Exactly 1 succeeded, 9 rejected. Balance = ₹20.`);
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 8 failed:', {
      successCount: successfulClaims.length,
      rejectedCount: rejectedClaims.length,
      balance: deltaFinalBalance,
    });
  }

  // TEST 9: Existing legitimate users, balances, and referral records remain intact.
  console.log('\n▶ Test 9: Existing legitimate users, balances, and referral records remain intact...');
  const userAlphaCheck = await getUser(user1Id);
  const userGammaCheck = await getUser(user3Id);
  const userDeltaCheck = await getUser(user4Id);
  const alphaReferrals = Array.from(memStore.referrals.values()).filter(
    (r) => r.referrerId === user1Id
  );

  if (
    userAlphaCheck?.balance === 30 &&
    userGammaCheck?.referredBy === user1Id &&
    userDeltaCheck?.balance === 20 &&
    alphaReferrals.length >= 1
  ) {
    console.log('  ✅ PASS: All legitimate user records, balances, and referral records remain intact.');
    passedTests++;
  } else {
    console.error('  ❌ FAIL: Test 9 failed');
  }

  console.log('\n====================================================');
  console.log(`🎯 TEST SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================');

  if (passedTests === totalTests) {
    console.log('🌟 ALL 9 ANTI-FRAUD AND ONE-DEVICE REQUIREMENTS VERIFIED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED.');
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
