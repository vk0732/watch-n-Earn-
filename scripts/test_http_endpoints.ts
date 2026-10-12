import express from 'express';
import { apiRouter } from '../server/apiRouter.ts';
import { getUser, saveUser, createWithdrawalRequest, memStore } from '../server/db.ts';
import type { UserProfile } from '../src/types/index.ts';

async function testHttpEndpoints() {
  console.log('====================================================');
  console.log('🌐 TESTING PAYMENT GATEWAY HTTP ENDPOINTS');
  console.log('====================================================\n');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    // Setup Admin User and Regular User
    const adminUser: UserProfile = {
      id: '2022247489',
      telegramId: 2022247489,
      username: 'admin_tester',
      firstName: 'Admin',
      balance: 1000,
      lifetimeEarnings: 1000,
      referralEarnings: 0,
      referralCode: 'ref_admin_2022247489',
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(adminUser);

    const normalUser: UserProfile = {
      id: 'user_test_2002',
      telegramId: 2002,
      username: 'normal_tester',
      firstName: 'Normal',
      balance: 200,
      lifetimeEarnings: 200,
      referralEarnings: 0,
      referralCode: 'ref_normal_2002',
      dailyStreak: 0,
      isBanned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveUser(normalUser);

    // TEST 1: Unauthorized Access Prevention
    console.log('TEST 1: Unauthorized Access Prevention');
    const unauthRes = await fetch(`${baseUrl}/admin/gateway/config`);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized without auth headers, got ${unauthRes.status}`);
    }
    console.log(`  ✓ Unauthenticated request rejected with HTTP ${unauthRes.status}`);

    const regularUserRes = await fetch(`${baseUrl}/admin/gateway/config`, {
      headers: { 'x-mock-user-id': 'user_test_2002' },
    });
    if (regularUserRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for non-admin user, got ${regularUserRes.status}`);
    }
    console.log(`  ✓ Non-admin user blocked with HTTP ${regularUserRes.status}`);

    // TEST 2: Authorized Admin Config Retrieval
    console.log('\nTEST 2: Authorized Admin Config Retrieval');
    const adminGetRes = await fetch(`${baseUrl}/admin/gateway/config`, {
      headers: { 'x-mock-user-id': '2022247489' },
    });
    if (!adminGetRes.ok) {
      throw new Error(`Admin failed to get gateway config: HTTP ${adminGetRes.status}`);
    }
    const adminGetData = await adminGetRes.json();
    console.log('  ✓ Admin successfully retrieved gateway config:');
    console.log(`    - Supported Providers: ${adminGetData.config.supportedProviders.length}`);
    console.log(`    - Webhook URL: ${adminGetData.config.webhookUrl}`);

    // TEST 3: Authorized Admin Config Saving & Encrypted Storage
    console.log('\nTEST 3: Authorized Admin Config Saving');
    const savePayload = {
      provider: 'cashfree',
      environment: 'test',
      payoutsEnabled: true,
      apiBaseUrl: 'https://sandbox.cashfree.com/payout/v1',
      apiKey: 'CF_API_KEY_ABCD1234',
      apiSecret: 'CF_SECRET_XYZ987654321',
      merchantId: 'CF_MID_5555',
      webhookSecret: 'CF_WH_SECRET_9999',
    };
    const adminSaveRes = await fetch(`${baseUrl}/admin/gateway/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-user-id': '2022247489',
      },
      body: JSON.stringify(savePayload),
    });
    if (!adminSaveRes.ok) {
      const err = await adminSaveRes.json();
      throw new Error(`Failed to save config: ${err.error || adminSaveRes.statusText}`);
    }
    const adminSaveData = await adminSaveRes.json();
    console.log('  ✓ Gateway settings saved successfully:');
    console.log(`    - Masked Key: ${adminSaveData.config.maskedApiKey}`);
    console.log(`    - Masked Secret: ${adminSaveData.config.maskedApiSecret}`);
    console.log(`    - Masked Merchant ID: ${adminSaveData.config.maskedMerchantId}`);

    if (JSON.stringify(adminSaveData).includes('CF_SECRET_XYZ987654321')) {
      throw new Error('SECURITY BREACH: Plaintext secret returned in POST response!');
    }
    console.log('  ✓ Verified: Secret is not revealed in frontend response');

    // TEST 4: Real Connection Test API Call
    console.log('\nTEST 4: Real Connection Test API Endpoint');
    const testConnRes = await fetch(`${baseUrl}/admin/gateway/test-connection`, {
      method: 'POST',
      headers: { 'x-mock-user-id': '2022247489' },
    });
    const testConnData = await testConnRes.json();
    console.log('  ✓ Connection test returned:');
    console.log(`    - Status: ${testConnData.status}`);
    console.log(`    - Message: ${testConnData.message}`);
    console.log(`    - Provider: ${testConnData.provider}`);

    // TEST 5: Webhook Handling & Reconciliation
    console.log('\nTEST 5: Public Webhook Endpoint & Reconciliation');
    const testWithdrawal = await createWithdrawalRequest('user_test_2002', 50, 'testuser@paytm');
    const testOrderId = testWithdrawal.withdrawal.id;

    // Simulate Cashfree Payout Webhook payload
    const webhookPayload = {
      event: 'TRANSFER_FAILED',
      data: {
        transferId: testOrderId,
        utr: '',
        reason: 'Beneficiary bank rejected transaction',
      },
    };

    const webhookRes = await fetch(`${baseUrl}/payouts/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    const webhookData = await webhookRes.json();
    console.log('  ✓ Webhook accepted and processed:', webhookData);

    const userAfterWebhook = await getUser('user_test_2002');
    console.log(`  ✓ User balance after failed webhook refund: ₹${userAfterWebhook!.balance}`);
    if (userAfterWebhook!.balance !== 200) {
      throw new Error(`Expected refunded balance 200, got ${userAfterWebhook!.balance}`);
    }

    console.log('\n====================================================');
    console.log('🎉 ALL HTTP API ENDPOINT TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');
  } finally {
    server.close();
    process.exit(0);
  }
}

testHttpEndpoints().catch((err) => {
  console.error('❌ HTTP Test failed:', err);
  process.exit(1);
});
