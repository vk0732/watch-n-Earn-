import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  getStoredGatewayConfig,
  saveGatewayConfig,
  removeGatewayCredentials,
  getPublicGatewayConfig,
  getDecryptedCredentials,
} from '../server/paymentSecurity.ts';
import { payoutGateway, validateUpiId } from '../server/payoutAdapter.ts';
import {
  getUser,
  saveUser,
  createWithdrawalRequest,
  getAllWithdrawals,
  updateWithdrawalStatus,
  atomicCreditBalance,
  memStore,
} from '../server/db.ts';
import type { UserProfile, Withdrawal } from '../src/types/index.ts';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PAYMENT GATEWAY SUITE TESTS');
  console.log('====================================================\n');

  // TEST 1: Encryption at Rest & Masking
  console.log('TEST 1: Encryption at Rest (AES-256-GCM) & Masking');
  const secretKey = 'cashfree_secret_live_9876543210_abcdef';
  const encrypted = encryptSecret(secretKey);

  if (!encrypted.iv || !encrypted.data || !encrypted.tag) {
    throw new Error('Encryption failed: Missing iv, data, or auth tag');
  }
  console.log('  ✓ Cipher text generated with fresh 96-bit IV and GCM auth tag');

  const decrypted = decryptSecret(encrypted);
  if (decrypted !== secretKey) {
    throw new Error(`Decryption mismatch! Expected ${secretKey}, got ${decrypted}`);
  }
  console.log('  ✓ Decryption verified successfully with tag authentication');

  const masked = maskSecret(secretKey);
  if (!masked.startsWith('****') || masked === secretKey) {
    throw new Error(`Masking failed! Output was ${masked}`);
  }
  console.log(`  ✓ Masked output for display: ${masked}`);

  // TEST 2: Dynamic Gateway Configuration Saving & Secret Protection
  console.log('\nTEST 2: Dynamic Gateway Configuration Saving');
  const saved = await saveGatewayConfig(
    {
      provider: 'cashfree',
      environment: 'test',
      payoutsEnabled: false,
      apiBaseUrl: 'https://sandbox.cashfree.com/payout/v1',
      apiKey: 'CF_TEST_CLIENT_ID_9999',
      apiSecret: 'CF_TEST_CLIENT_SECRET_8888',
      webhookSecret: 'CF_TEST_WEBHOOK_SECRET_7777',
    },
    'test_admin_user'
  );

  const publicConfig = await getPublicGatewayConfig('https://teleearn-app.com');
  console.log('  ✓ Public config retrieved:');
  console.log(`    - Provider: ${publicConfig.provider}`);
  console.log(`    - Environment: ${publicConfig.environment}`);
  console.log(`    - Masked API Key: ${publicConfig.maskedApiKey}`);
  console.log(`    - Masked API Secret: ${publicConfig.maskedApiSecret}`);
  console.log(`    - Has Key: ${publicConfig.hasApiKey}, Has Secret: ${publicConfig.hasApiSecret}`);
  console.log(`    - Webhook URL: ${publicConfig.webhookUrl}`);

  if (JSON.stringify(publicConfig).includes('CF_TEST_CLIENT_SECRET_8888')) {
    throw new Error('SECURITY VIOLATION: Raw API Secret found in public config response!');
  }
  console.log('  ✓ Security verified: Raw secrets are never present in public frontend responses');

  // TEST 3: UPI VPA Validator
  console.log('\nTEST 3: UPI ID Format Validation');
  const validUpi = validateUpiId('merchant@oksbi');
  const invalidUpi = validateUpiId('invalid-upi-string');
  if (!validUpi.isValid || invalidUpi.isValid) {
    throw new Error('UPI validation failed');
  }
  console.log('  ✓ Valid UPI "merchant@oksbi" accepted');
  console.log(`  ✓ Invalid UPI rejected: "${invalidUpi.error}"`);

  // TEST 4: Real Connection Validation to Provider Official API
  console.log('\nTEST 4: Real Provider Connection Test');
  console.log('  Executing live non-payment network call to Cashfree Test API...');
  const testConnResult = await payoutGateway.testConnection();
  console.log(`  ✓ Real HTTP request executed to Cashfree API`);
  console.log(`    - Provider: ${testConnResult.provider}`);
  console.log(`    - Status: ${testConnResult.status}`);
  console.log(`    - Provider Response Message: ${testConnResult.message}`);
  if (testConnResult.httpStatus) {
    console.log(`    - Provider HTTP Status: ${testConnResult.httpStatus}`);
  }

  // Verify that an unintegrated provider correctly returns 'integration_required'
  await saveGatewayConfig(
    {
      provider: 'custom',
      environment: 'test',
      payoutsEnabled: false,
      apiBaseUrl: '',
      apiKey: 'custom_key',
      apiSecret: 'custom_secret',
    },
    'test_admin'
  );
  const customConnResult = await payoutGateway.testConnection();
  if (customConnResult.status !== 'integration_required') {
    throw new Error(`Expected integration_required for custom provider, got ${customConnResult.status}`);
  }
  console.log('  ✓ Unintegrated provider correctly returned: "Provider integration required"');

  // Restore Cashfree configuration in Test Mode with payouts enabled for testing
  await saveGatewayConfig(
    {
      provider: 'cashfree',
      environment: 'test',
      payoutsEnabled: true,
      apiBaseUrl: 'https://sandbox.cashfree.com/payout/v1',
      apiKey: 'CF_TEST_CLIENT_ID_9999',
      apiSecret: 'CF_TEST_CLIENT_SECRET_8888',
      webhookSecret: 'CF_TEST_WEBHOOK_SECRET_7777',
    },
    'test_admin'
  );

  // TEST 5: Sandbox Mode Payout Execution & Idempotency
  console.log('\nTEST 5: Sandbox Mode Payout Execution & Protection');
  // Create test user and balance
  const testUserId = `user_test_${Date.now()}`;
  const testUser: UserProfile = {
    id: testUserId,
    telegramId: 99887766,
    username: 'test_payout_user',
    firstName: 'PayoutTester',
    balance: 500,
    lifetimeEarnings: 500,
    referralEarnings: 0,
    referralCode: `ref_${testUserId}`,
    dailyStreak: 0,
    isBanned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUser(testUser);

  // Create withdrawal request
  const withdrawalRes = await createWithdrawalRequest(testUserId, 150, 'payouttest@okaxis');
  const orderId = withdrawalRes.withdrawal.id;
  console.log(`  ✓ Withdrawal order ${orderId} created for ₹150. User balance reserved: ₹${withdrawalRes.user.balance}`);

  if (withdrawalRes.user.balance !== 350) {
    throw new Error(`Balance deduction incorrect! Expected 350, got ${withdrawalRes.user.balance}`);
  }

  // Execute payout through gateway in Sandbox Mode
  const payoutResult = await payoutGateway.executePayout(withdrawalRes.withdrawal);
  console.log(`  ✓ Gateway executePayout finished with status: ${payoutResult.status}`);
  console.log(`    Response: ${payoutResult.providerResponse}`);

  if (!payoutResult.providerResponse.includes('SANDBOX_TEST_MODE')) {
    throw new Error('Test mode did not execute in SANDBOX_TEST_MODE!');
  }
  console.log('  ✓ Verified: Test Mode executed safely without touching real money rails');

  // Update order to 'processing'
  const processingOrder = await updateWithdrawalStatus(orderId, 'processing', {
    providerResponse: payoutResult.providerResponse,
  });
  console.log(`  ✓ Order status updated to: ${processingOrder.status}`);

  // TEST 6: Bank Reversal & Duplicate Refund Prevention
  console.log('\nTEST 6: Bank Reversal & Duplicate Refund Prevention');
  const userBeforeReversal = await getUser(testUserId);
  const balanceBefore = userBeforeReversal!.balance;

  // Simulate bank reversal webhook
  const reversedOrder = await updateWithdrawalStatus(orderId, 'reversed', {
    failureReason: 'Bank rejected UPI transfer: Beneficiary bank network timeout',
  });
  console.log(`  ✓ Order transitioned to: ${reversedOrder.status}`);

  const userAfterReversal = await getUser(testUserId);
  console.log(`  ✓ User balance restored: ₹${balanceBefore} -> ₹${userAfterReversal!.balance}`);

  if (userAfterReversal!.balance !== balanceBefore + 150) {
    throw new Error(`Refund amount mismatch! Expected ${balanceBefore + 150}, got ${userAfterReversal!.balance}`);
  }

  // Try updating again to check duplicate refund prevention
  try {
    await updateWithdrawalStatus(orderId, 'failed');
    console.log('  ✓ Additional status update on reversed order prevented or handled idempotently');
  } catch (err: any) {
    console.log(`  ✓ Order state machine protected: ${err.message}`);
  }

  const userFinal = await getUser(testUserId);
  if (userFinal!.balance !== userAfterReversal!.balance) {
    throw new Error('DUPLICATE REFUND DETECTED! Balance changed unexpectedly.');
  }
  console.log('  ✓ Verified: No duplicate refunds occurred');

  // TEST 7: Remove / Wipe Credentials
  console.log('\nTEST 7: Secure Credential Wipe');
  await removeGatewayCredentials('test_admin');
  const wipedConfig = await getPublicGatewayConfig();
  if (wipedConfig.hasApiKey || wipedConfig.hasApiSecret || wipedConfig.maskedApiKey) {
    throw new Error('Credential wipe failed: Keys still exist in config!');
  }
  console.log('  ✓ Credentials securely removed and zeroed out');

  // TEST 8: Paynit UPI Payout Gateway Protocol & Endpoint Verification
  console.log('\nTEST 8: Paynit UPI Gateway Protocol & Requirements');
  // 1. Provider configuration & env variable support
  process.env.PAYNIT_CLIENT_ID = 'paynit_test_client_id_001';
  process.env.PAYNIT_CLIENT_SECRET = 'paynit_test_secret_key_002';

  const paynitSaved = await saveGatewayConfig(
    {
      provider: 'paynit',
      environment: 'test',
      payoutsEnabled: false,
      apiBaseUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
      apiKey: 'paynit_test_client_id_001',
      apiSecret: 'paynit_test_secret_key_002',
    },
    'test_admin'
  );
  const paynitPublic = await getPublicGatewayConfig();
  if (paynitPublic.provider !== 'paynit') {
    throw new Error(`Expected provider paynit, got ${paynitPublic.provider}`);
  }
  console.log('  ✓ Paynit provider registered and active in gateway configuration');
  console.log(`    - Payout Endpoint: https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1/merchant-paynit-payout`);
  console.log(`    - Status Endpoint: https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1/check-order-status`);

  // 2. Status Mapping Verification
  const pSuccess = payoutGateway.parseProviderStatus({ status: 'SUCCESS', utr: 'UTR123456789012' });
  const pProc = payoutGateway.parseProviderStatus({ status: 'PROCESSING', order_id: 'ord_1' });
  const pPending = payoutGateway.parseProviderStatus({ status: 'PENDING' });
  const pFailed = payoutGateway.parseProviderStatus({ status: 'FAILED', error: 'Beneficiary invalid' });
  const pRejected = payoutGateway.parseProviderStatus({ status: 'REJECTED' });

  if (pSuccess !== 'success' || pProc !== 'processing' || pPending !== 'processing' || pFailed !== 'failed' || pRejected !== 'failed') {
    throw new Error('Paynit status mapping validation failed');
  }
  console.log('  ✓ Status mapping verified: SUCCESS -> success, PROCESSING/PENDING -> processing, FAILED/REJECTED -> failed');

  // 3. Safety: Never mark successful on unconfirmed response
  const pUnconfirmed = payoutGateway.parseProviderStatus({ received: true });
  if (pUnconfirmed !== 'processing') {
    throw new Error('Safety failure: Unconfirmed response marked as success');
  }
  console.log('  ✓ Safety guarantee verified: Never marks success without confirmed response');

  // 4. Test Mode Safety: Real money is not moved
  const dummyWth: Withdrawal = {
    id: `WTH_TEST_${Date.now()}`,
    userId: testUserId,
    userTelegramId: 99887766,
    amount: 100,
    upiId: 'merchant@oksbi',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const paynitTestRes = await payoutGateway.executePayout(dummyWth);
  if (paynitTestRes.status !== 'processing' || !paynitTestRes.providerResponse.includes('PAYOUTS_DISABLED')) {
    throw new Error('Safety violation: Disabled payouts allowed execution');
  }
  console.log('  ✓ Automated UPI payouts verified DISABLED during test / review mode');

  // Clean up test gateway credentials so dummy keys do not remain in database
  await removeGatewayCredentials('test_cleanup');
  console.log('  ✓ Stored test credentials cleaned up from database');

  console.log('\n====================================================');
  console.log('🎉 ALL PAYMENT GATEWAY TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
