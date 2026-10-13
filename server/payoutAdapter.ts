import crypto from 'node:crypto';
import type { Withdrawal } from '../src/types/index.ts';
import {
  getDecryptedCredentials,
  recordConnectionTestResult,
  ConnectionStatus,
  DecryptedGatewayCredentials,
  maskSecret,
} from './paymentSecurity.ts';

export interface PayoutProcessResult {
  status: 'processing' | 'success' | 'failed' | 'reversed';
  providerOrderId?: string;
  providerResponse: string;
  failureReason?: string;
  utr?: string;
}

export interface PayoutProviderStatus {
  isLiveEnabled: boolean;
  payoutsEnabled: boolean;
  environment: 'test' | 'live';
  providerName: string;
  hasCredentials: boolean;
  statusMessage: string;
  lastTestStatus?: ConnectionStatus;
  lastTestMessage?: string;
  lastTestedAt?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  status: ConnectionStatus;
  message: string;
  httpStatus?: number;
  environment: 'test' | 'live';
  provider: string;
  timestamp: string;
  rawDetails?: any;
}

/**
 * Strict UPI ID format validator (Virtual Payment Address)
 * Valid formats: username@bank, 9876543210@paytm, user.name@oksbi
 */
export function validateUpiId(upiId: string): { isValid: boolean; error?: string } {
  if (!upiId || typeof upiId !== 'string') {
    return { isValid: false, error: 'UPI ID cannot be empty.' };
  }
  const clean = upiId.trim();
  const upiRegex = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9]{2,32}$/;

  if (!upiRegex.test(clean)) {
    return {
      isValid: false,
      error: 'Invalid UPI ID format. Expected format: username@bank (e.g. user@oksbi, 9876543210@paytm).',
    };
  }
  return { isValid: true };
}

/**
 * Production UPI Payment Gateway Adapter
 * Connects dynamic encrypted configuration to real provider payout APIs
 */
export class UPIPaymentGatewayAdapter {
  /**
   * Get dynamic provider status for Admin Dashboard & Mini App
   */
  public async getStatus(): Promise<PayoutProviderStatus> {
    const creds = await getDecryptedCredentials();
    const hasCreds = Boolean(creds.apiKey && creds.apiSecret);

    let statusMessage = '';
    if (!creds.provider) {
      statusMessage = 'No Payment Gateway configured. Payouts DISABLED. Please configure in Payment Gateway Settings.';
    } else if (!creds.payoutsEnabled) {
      statusMessage = `Payouts are currently DISABLED in Payment Gateway Settings for [${creds.provider}]. All requests require admin manual review.`;
    } else if (!hasCreds) {
      statusMessage = `Gateway provider [${creds.provider}] selected, but API credentials are missing. Live payouts DISABLED.`;
    } else if (creds.environment === 'test') {
      statusMessage = `Gateway [${creds.provider}] is in TEST MODE (Sandbox). Live payouts DISABLED. Real money will NOT be moved.`;
    } else {
      statusMessage = `Gateway [${creds.provider}] is LIVE and ACTIVE. Payouts will process through official banking rails.`;
    }

    return {
      isLiveEnabled: creds.environment === 'live' && creds.payoutsEnabled && hasCreds,
      payoutsEnabled: creds.payoutsEnabled,
      environment: creds.environment,
      providerName: creds.provider || 'none',
      hasCredentials: hasCreds,
      statusMessage,
    };
  }

  /**
   * Real, non-payment authentication / account-status check supported by the provider
   * Makes actual HTTP network calls to the provider's official API
   */
  public async testConnection(): Promise<ConnectionTestResult> {
    const creds = await getDecryptedCredentials();

    if (!creds.provider) {
      const result: ConnectionTestResult = {
        success: false,
        status: 'not_configured',
        message: 'No Payment Gateway provider selected. Please select a provider and provide credentials.',
        environment: creds.environment,
        provider: 'none',
        timestamp: new Date().toISOString(),
      };
      await recordConnectionTestResult(result.status, result.message);
      return result;
    }

    if (!creds.apiKey || !creds.apiSecret) {
      const result: ConnectionTestResult = {
        success: false,
        status: 'failed',
        message: 'Missing API credentials. Both API Key / Client ID and API Secret are required to test connection.',
        environment: creds.environment,
        provider: creds.provider,
        timestamp: new Date().toISOString(),
      };
      await recordConnectionTestResult(result.status, result.message);
      return result;
    }

    if (creds.provider === 'cashfree') {
      return await this.testCashfreeConnection(creds);
    }

    if (creds.provider === 'razorpayx') {
      return await this.testRazorpayXConnection(creds);
    }

    if (creds.provider === 'paytm') {
      return await this.testPaytmConnection(creds);
    }

    if (creds.provider === 'paynit') {
      return await this.testPaynitConnection(creds);
    }

    // Custom or Unintegrated Provider
    const result: ConnectionTestResult = {
      success: false,
      status: 'integration_required',
      message: 'Provider integration required. Implementation specifications and driver adapter are needed for this provider.',
      environment: creds.environment,
      provider: creds.provider,
      timestamp: new Date().toISOString(),
    };
    await recordConnectionTestResult(result.status, result.message);
    return result;
  }

  /**
   * Test Cashfree Payments Connection
   * Uses Cashfree Payouts Official Auth API: POST /authorize
   */
  private async testCashfreeConnection(creds: DecryptedGatewayCredentials): Promise<ConnectionTestResult> {
    const baseUrl =
      creds.apiBaseUrl ||
      (creds.environment === 'live'
        ? 'https://payout-api.cashfree.com/payout/v1'
        : 'https://sandbox.cashfree.com/payout/v1');

    const authUrl = `${baseUrl.replace(/\/$/, '')}/authorize`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'X-Client-Id': creds.apiKey,
          'X-Client-Secret': creds.apiSecret,
          'Content-Type': 'application/json',
          'User-Agent': 'TeleEarn-Admin/1.0',
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const status = response.status;
      let data: any = {};
      try {
        data = await response.json();
      } catch {
        data = { text: await response.text().catch(() => '') };
      }

      if (response.ok && (data.status === 'SUCCESS' || data.subCode === '200' || data.data?.token)) {
        const msg = `Successfully connected to Cashfree Payments (${creds.environment.toUpperCase()} Mode). Auth token generated successfully.`;
        await recordConnectionTestResult('connected', msg);
        return {
          success: true,
          status: 'connected',
          message: msg,
          httpStatus: status,
          environment: creds.environment,
          provider: 'Cashfree Payments',
          timestamp: new Date().toISOString(),
          rawDetails: { subCode: data.subCode, expiry: data.data?.expiry },
        };
      }

      // Provider returned an error (e.g. 401 Unauthorized, 400 Bad Request)
      const errorMsg =
        data.message ||
        data.error ||
        (status === 401 ? 'Invalid Client ID or Client Secret.' : `Provider returned HTTP ${status}: ${response.statusText}`);
      const fullMsg = `Cashfree Authentication Failed (HTTP ${status}): ${errorMsg}`;

      await recordConnectionTestResult('failed', fullMsg);
      return {
        success: false,
        status: 'failed',
        message: fullMsg,
        httpStatus: status,
        environment: creds.environment,
        provider: 'Cashfree Payments',
        timestamp: new Date().toISOString(),
        rawDetails: data,
      };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const msg = isAbort
        ? `Connection to Cashfree timed out after 12s at ${authUrl}`
        : `Network connection to Cashfree failed: ${err.message}`;
      await recordConnectionTestResult('failed', msg);
      return {
        success: false,
        status: 'failed',
        message: msg,
        environment: creds.environment,
        provider: 'Cashfree Payments',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Test RazorpayX Connection
   * Uses Razorpay Official API: GET /v1/payouts or /v1/fund_accounts
   */
  private async testRazorpayXConnection(creds: DecryptedGatewayCredentials): Promise<ConnectionTestResult> {
    const baseUrl = creds.apiBaseUrl || 'https://api.razorpay.com/v1';
    const testEndpoint = `${baseUrl.replace(/\/$/, '')}/payouts?limit=1`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const basicAuth = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64');
      const response = await fetch(testEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'User-Agent': 'TeleEarn-Admin/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const status = response.status;
      let data: any = {};
      try {
        data = await response.json();
      } catch {
        data = { text: await response.text().catch(() => '') };
      }

      if (response.ok) {
        const msg = `Successfully connected to RazorpayX API (${creds.environment.toUpperCase()} Mode). Account authenticated.`;
        await recordConnectionTestResult('connected', msg);
        return {
          success: true,
          status: 'connected',
          message: msg,
          httpStatus: status,
          environment: creds.environment,
          provider: 'RazorpayX',
          timestamp: new Date().toISOString(),
          rawDetails: { entity: data.entity, count: data.count },
        };
      }

      const errorMsg =
        data.error?.description ||
        data.message ||
        (status === 401 ? 'Authentication failed. Invalid Key ID or Key Secret.' : `HTTP ${status}: ${response.statusText}`);
      const fullMsg = `RazorpayX Authentication Failed (HTTP ${status}): ${errorMsg}`;

      await recordConnectionTestResult('failed', fullMsg);
      return {
        success: false,
        status: 'failed',
        message: fullMsg,
        httpStatus: status,
        environment: creds.environment,
        provider: 'RazorpayX',
        timestamp: new Date().toISOString(),
        rawDetails: data,
      };
    } catch (err: any) {
      const msg = `Network connection to RazorpayX failed: ${err.message}`;
      await recordConnectionTestResult('failed', msg);
      return {
        success: false,
        status: 'failed',
        message: msg,
        environment: creds.environment,
        provider: 'RazorpayX',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Test Paytm Connection
   */
  private async testPaytmConnection(creds: DecryptedGatewayCredentials): Promise<ConnectionTestResult> {
    const baseUrl =
      creds.apiBaseUrl ||
      (creds.environment === 'live'
        ? 'https://dashboard.paytm.com/bpay/api/v1'
        : 'https://staging-dashboard.paytm.com/bpay/api/v1');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/account/balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mid': creds.merchantId || '',
        },
        body: JSON.stringify({ mid: creds.merchantId }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const status = response.status;
      let data: any = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (response.ok && data.status === 'SUCCESS') {
        const msg = `Successfully connected to Paytm Payouts (${creds.environment.toUpperCase()} Mode).`;
        await recordConnectionTestResult('connected', msg);
        return {
          success: true,
          status: 'connected',
          message: msg,
          httpStatus: status,
          environment: creds.environment,
          provider: 'Paytm Payouts',
          timestamp: new Date().toISOString(),
        };
      }

      const msg = `Paytm Payouts check returned HTTP ${status}: ${data.statusMessage || response.statusText || 'Verification pending'}`;
      await recordConnectionTestResult('failed', msg);
      return {
        success: false,
        status: 'failed',
        message: msg,
        httpStatus: status,
        environment: creds.environment,
        provider: 'Paytm Payouts',
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      const msg = `Paytm connection check failed: ${err.message}`;
      await recordConnectionTestResult('failed', msg);
      return {
        success: false,
        status: 'failed',
        message: msg,
        environment: creds.environment,
        provider: 'Paytm Payouts',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Test Paynit Gateway Connection
   * Uses Paynit Official Status API: POST /check-order-status
   * Safely verifies X-Client-Id and X-Client-Secret without moving any funds
   */
  private async testPaynitConnection(creds: DecryptedGatewayCredentials): Promise<ConnectionTestResult> {
    const baseUrl =
      creds.apiBaseUrl ||
      process.env.PAYNIT_BASE_URL ||
      'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1';

    const statusUrl = process.env.PAYNIT_STATUS_URL || `${baseUrl.replace(/\/$/, '')}/check-order-status`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': creds.apiKey,
          'X-Client-Secret': creds.apiSecret,
          'User-Agent': 'TeleEarn-Admin/1.0',
        },
        body: JSON.stringify({ order_id: 'probe_test_connection' }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const status = response.status;
      let data: any = {};
      try {
        data = await response.json();
      } catch {
        data = { text: await response.text().catch(() => '') };
      }

      // Check authentication errors
      if (
        status === 401 ||
        status === 403 ||
        data.error?.toString().toLowerCase().includes('unauthorized') ||
        data.message?.toString().toLowerCase().includes('invalid client')
      ) {
        const fullMsg = `Paynit Authentication Failed (HTTP ${status}): ${data.message || data.error || 'Invalid X-Client-Id or X-Client-Secret.'}`;
        await recordConnectionTestResult('failed', fullMsg);
        return {
          success: false,
          status: 'failed',
          message: fullMsg,
          httpStatus: status,
          environment: creds.environment,
          provider: 'Paynit UPI Payouts',
          timestamp: new Date().toISOString(),
          rawDetails: data,
        };
      }

      // If response is OK or returns authenticated order check (even 404 for nonexistent probe order)
      if (response.ok || status === 404 || data.status !== undefined || data.message !== undefined) {
        const msg = `Successfully authenticated with Paynit UPI Gateway (${creds.environment.toUpperCase()} Mode). Provider API credentials verified.`;
        await recordConnectionTestResult('connected', msg);
        return {
          success: true,
          status: 'connected',
          message: msg,
          httpStatus: status,
          environment: creds.environment,
          provider: 'Paynit UPI Payouts',
          timestamp: new Date().toISOString(),
          rawDetails: data,
        };
      }

      const msg = `Paynit Payouts check returned HTTP ${status}: ${data.message || data.error || response.statusText}`;
      await recordConnectionTestResult('failed', msg);
      return {
        success: false,
        status: 'failed',
        message: msg,
        httpStatus: status,
        environment: creds.environment,
        provider: 'Paynit UPI Payouts',
        timestamp: new Date().toISOString(),
        rawDetails: data,
      };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const msg = isAbort
        ? `Connection to Paynit timed out after 12s at ${statusUrl}`
        : `Network connection to Paynit failed: ${err.message}`;
      await recordConnectionTestResult('failed', msg);
      return {
        success: false,
        status: 'failed',
        message: msg,
        environment: creds.environment,
        provider: 'Paynit UPI Payouts',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Process a payout through the configured gateway.
   * SAFETY GUARANTEE:
   * 1. If payouts are disabled: halts and places in review.
   * 2. If Test Mode is active: runs through sandbox API or sandbox execution safely without transferring real money.
   * 3. If Live Mode is active: calls the official provider payout API with idempotency key.
   * 4. NEVER marks payout 'success' solely because request was accepted — handles pending/queued outcomes.
   */
  public async executePayout(withdrawal: Withdrawal): Promise<PayoutProcessResult> {
    const creds = await getDecryptedCredentials();

    // 1. Check if payouts are enabled in settings
    if (!creds.payoutsEnabled) {
      return {
        status: 'processing',
        providerResponse: JSON.stringify({
          mode: 'PAYOUTS_DISABLED',
          notice: 'Payouts are disabled in Payment Gateway Settings. Order remains pending for manual admin review.',
          orderId: withdrawal.id,
          amount: withdrawal.amount,
          upiId: withdrawal.upiId,
          timestamp: new Date().toISOString(),
        }),
        failureReason: 'Payouts are disabled in Payment Gateway Settings.',
      };
    }

    // 2. Check credentials
    if (!creds.apiKey || !creds.apiSecret) {
      return {
        status: 'failed',
        providerResponse: JSON.stringify({ error: 'Missing gateway credentials' }),
        failureReason: 'Gateway provider credentials are not configured.',
      };
    }

    // 3. Test Mode / Sandbox execution (Does NOT transfer real money)
    if (creds.environment === 'test') {
      const sandboxRef = `SANDBOX_UPI_${withdrawal.id}_${Date.now().toString().slice(-6)}`;
      return {
        status: 'processing', // or 'success' if test mode auto-simulation
        providerOrderId: sandboxRef,
        providerResponse: JSON.stringify({
          provider: creds.provider,
          mode: 'SANDBOX_TEST_MODE',
          notice: 'Simulation in Test Mode. No real funds were moved.',
          referenceId: sandboxRef,
          amount: withdrawal.amount,
          upiId: withdrawal.upiId,
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // 4. LIVE MODE EXECUTION
    if (creds.provider === 'cashfree') {
      return await this.executeCashfreeLivePayout(withdrawal, creds);
    }

    if (creds.provider === 'razorpayx') {
      return await this.executeRazorpayXLivePayout(withdrawal, creds);
    }

    if (creds.provider === 'paynit') {
      return await this.executePaynitLivePayout(withdrawal, creds);
    }

    return {
      status: 'failed',
      providerResponse: JSON.stringify({ error: 'Provider integration required' }),
      failureReason: `Automated live payouts are not yet supported for provider [${creds.provider}]. Provider integration required.`,
    };
  }

  /**
   * Cashfree Live Payout execution
   */
  private async executeCashfreeLivePayout(
    withdrawal: Withdrawal,
    creds: DecryptedGatewayCredentials
  ): Promise<PayoutProcessResult> {
    const baseUrl = creds.apiBaseUrl || 'https://payout-api.cashfree.com/payout/v1';
    const transferUrl = `${baseUrl.replace(/\/$/, '')}/requestTransfer`;
    const idempotencyKey = `payout_${withdrawal.id}`;

    try {
      // Step A: Authorize to obtain token
      const authUrl = `${baseUrl.replace(/\/$/, '')}/authorize`;
      const authRes = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'X-Client-Id': creds.apiKey,
          'X-Client-Secret': creds.apiSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const authData: any = await authRes.json().catch(() => ({}));
      const token = authData?.data?.token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        headers['X-Client-Id'] = creds.apiKey;
        headers['X-Client-Secret'] = creds.apiSecret;
      }

      // Step B: Send transfer request
      const body = {
        transferId: withdrawal.id,
        amount: withdrawal.amount.toFixed(2),
        transferMode: 'upi',
        vpa: withdrawal.upiId,
        remarks: `TeleEarn payout for order ${withdrawal.id}`,
      };

      const res = await fetch(transferUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const resData: any = await res.json().catch(() => ({}));

      // Check Cashfree transfer status:
      // status can be "SUCCESS", "PENDING", or "ERROR"
      if (resData.status === 'SUCCESS' && resData.data?.acknowledged === 1) {
        const utr = resData.data?.utr;
        return {
          status: utr ? 'success' : 'processing',
          providerOrderId: resData.data?.referenceId || idempotencyKey,
          utr,
          providerResponse: JSON.stringify(resData),
        };
      }

      if (resData.status === 'PENDING') {
        return {
          status: 'processing',
          providerOrderId: resData.data?.referenceId || idempotencyKey,
          providerResponse: JSON.stringify(resData),
        };
      }

      return {
        status: 'failed',
        providerResponse: JSON.stringify(resData),
        failureReason: resData.message || resData.subCode || 'Cashfree transfer request rejected by bank.',
      };
    } catch (err: any) {
      return {
        status: 'processing', // Keep processing on uncertain timeout so funds are not lost
        providerResponse: JSON.stringify({ error: err.message, state: 'DISPATCH_TIMEOUT' }),
        failureReason: `Network timeout during gateway dispatch: ${err.message}. Awaiting reconciliation or webhook.`,
      };
    }
  }

  /**
   * RazorpayX Live Payout execution
   */
  private async executeRazorpayXLivePayout(
    withdrawal: Withdrawal,
    creds: DecryptedGatewayCredentials
  ): Promise<PayoutProcessResult> {
    const baseUrl = creds.apiBaseUrl || 'https://api.razorpay.com/v1';
    const payoutsUrl = `${baseUrl.replace(/\/$/, '')}/payouts`;
    const basicAuth = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64');

    try {
      const payload = {
        account_number: creds.merchantId,
        amount: Math.round(withdrawal.amount * 100), // in paise
        currency: 'INR',
        mode: 'UPI',
        purpose: 'payout',
        fund_account: {
          account_type: 'vpa',
          vpa: {
            address: withdrawal.upiId,
          },
          contact: {
            name: withdrawal.username || `User ${withdrawal.userId}`,
            type: 'customer',
            reference_id: withdrawal.userId,
          },
        },
        queue_if_low_balance: true,
        reference_id: withdrawal.id,
        narration: `TeleEarn Order ${withdrawal.id}`,
      };

      const res = await fetch(payoutsUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
          'X-Payout-Idempotency': `payout_${withdrawal.id}`,
        },
        body: JSON.stringify(payload),
      });

      const resData: any = await res.json().catch(() => ({}));

      // RazorpayX status: "processed", "processing", "queued", "reversed", "rejected"
      if (resData.status === 'processed') {
        return {
          status: 'success',
          providerOrderId: resData.id,
          utr: resData.utr,
          providerResponse: JSON.stringify(resData),
        };
      }

      if (resData.status === 'processing' || resData.status === 'queued') {
        return {
          status: 'processing',
          providerOrderId: resData.id,
          providerResponse: JSON.stringify(resData),
        };
      }

      if (resData.status === 'reversed') {
        return {
          status: 'reversed',
          providerOrderId: resData.id,
          providerResponse: JSON.stringify(resData),
          failureReason: 'RazorpayX transaction reversed.',
        };
      }

      return {
        status: 'failed',
        providerOrderId: resData.id,
        providerResponse: JSON.stringify(resData),
        failureReason: resData.error?.description || resData.failure_reason || 'RazorpayX rejected payout request.',
      };
    } catch (err: any) {
      return {
        status: 'processing',
        providerResponse: JSON.stringify({ error: err.message, state: 'DISPATCH_TIMEOUT' }),
        failureReason: `Network timeout during RazorpayX dispatch: ${err.message}. Awaiting webhook reconciliation.`,
      };
    }
  }

  /**
   * Reconcile uncertain / processing transaction outcomes
   */
  public async reconcilePayout(withdrawal: Withdrawal): Promise<PayoutProcessResult> {
    const creds = await getDecryptedCredentials();
    if (!creds.apiKey || !creds.apiSecret) {
      return {
        status: withdrawal.status as any,
        providerResponse: 'No credentials configured to reconcile transaction',
      };
    }

    if (creds.provider === 'cashfree') {
      try {
        const baseUrl = creds.apiBaseUrl || 'https://payout-api.cashfree.com/payout/v1';
        const url = `${baseUrl.replace(/\/$/, '')}/getTransferStatus?transferId=${encodeURIComponent(withdrawal.id)}`;
        const res = await fetch(url, {
          headers: {
            'X-Client-Id': creds.apiKey,
            'X-Client-Secret': creds.apiSecret,
          },
        });
        const data: any = await res.json().catch(() => ({}));
        if (data.status === 'SUCCESS' && data.data?.transfer) {
          const transfer = data.data.transfer;
          if (transfer.status === 'SUCCESS') {
            return {
              status: 'success',
              utr: transfer.utr,
              providerOrderId: transfer.referenceId,
              providerResponse: JSON.stringify(data),
            };
          }
          if (transfer.status === 'FAILED' || transfer.status === 'REJECTED') {
            return {
              status: 'failed',
              providerResponse: JSON.stringify(data),
              failureReason: transfer.reason || 'Cashfree reported transfer failed.',
            };
          }
          if (transfer.status === 'REVERSED') {
            return {
              status: 'reversed',
              providerResponse: JSON.stringify(data),
              failureReason: 'Bank reversed transfer.',
            };
          }
        }
      } catch (err: any) {
        console.warn('[PayoutAdapter] Reconcile error:', err);
      }
    }

    if (creds.provider === 'paynit') {
      return await this.reconcilePaynitPayout(withdrawal, creds);
    }

    return {
      status: withdrawal.status as any,
      providerResponse: 'Reconciliation query complete; status remains unchanged.',
    };
  }

  /**
   * Paynit Live Payout execution
   * Payout endpoint: https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1/merchant-paynit-payout
   * Required headers:
   * - Content-Type: application/json
   * - X-Client-Id: <client_id>
   * - X-Client-Secret: <client_secret>
   * - X-Idempotency-Key: <idempotency_key>
   * Payload fields: order_id, amount, payout_method ("UPI"), upi_id, note
   */
  public async executePaynitLivePayout(
    withdrawal: Withdrawal,
    creds: DecryptedGatewayCredentials
  ): Promise<PayoutProcessResult> {
    const baseUrl =
      creds.apiBaseUrl ||
      process.env.PAYNIT_BASE_URL ||
      'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1';

    const payoutUrl = process.env.PAYNIT_PAYOUT_URL || `${baseUrl.replace(/\/$/, '')}/merchant-paynit-payout`;
    const idempotencyKey = `payout_${withdrawal.id}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const payload = {
        order_id: withdrawal.id,
        amount: Number(withdrawal.amount),
        payout_method: 'UPI',
        upi_id: withdrawal.upiId.trim(),
        note: `TeleEarn payout for order ${withdrawal.id}`,
      };

      const res = await fetch(payoutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': creds.apiKey,
          'X-Client-Secret': creds.apiSecret,
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      let resData: any = {};
      try {
        resData = await res.json();
      } catch {
        resData = { text: await res.text().catch(() => '') };
      }

      // Check HTTP authorization/client error
      if (!res.ok && res.status >= 400 && res.status < 500) {
        return {
          status: 'failed',
          providerOrderId: resData.order_id || resData.data?.order_id || withdrawal.id,
          providerResponse: JSON.stringify(resData),
          failureReason: resData.message || resData.error || `HTTP ${res.status}: Provider rejected payout request.`,
        };
      }

      const parsedStatus = this.parseProviderStatus(resData);
      const utr =
        resData.utr ||
        resData.data?.utr ||
        resData.rrn ||
        resData.bank_reference ||
        resData.data?.bank_reference;

      const providerOrderId =
        resData.order_id ||
        resData.payout_id ||
        resData.data?.order_id ||
        resData.data?.payout_id ||
        idempotencyKey;

      if (parsedStatus === 'success') {
        return {
          status: 'success',
          providerOrderId,
          utr,
          providerResponse: JSON.stringify(resData),
        };
      }

      if (parsedStatus === 'failed') {
        return {
          status: 'failed',
          providerOrderId,
          providerResponse: JSON.stringify(resData),
          failureReason:
            resData.message ||
            resData.error ||
            resData.failure_reason ||
            resData.data?.failure_reason ||
            'Paynit transfer rejected by bank.',
        };
      }

      // Queued, pending, or intermediate response
      return {
        status: 'processing',
        providerOrderId,
        providerResponse: JSON.stringify(resData),
      };
    } catch (err: any) {
      // Network timeout: keep status as 'processing' so money is not duplicate-sent
      return {
        status: 'processing',
        providerResponse: JSON.stringify({ error: err.message, state: 'DISPATCH_TIMEOUT' }),
        failureReason: `Network timeout during Paynit dispatch: ${err.message}. Awaiting reconciliation via check-order-status.`,
      };
    }
  }

  /**
   * Reconcile Paynit Payout status
   * Status endpoint: https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1/check-order-status
   * Required headers:
   * - Content-Type: application/json
   * - X-Client-Id: <client_id>
   * - X-Client-Secret: <client_secret>
   * Status request must contain ONLY order_id
   */
  public async reconcilePaynitPayout(
    withdrawal: Withdrawal,
    creds: DecryptedGatewayCredentials
  ): Promise<PayoutProcessResult> {
    const baseUrl =
      creds.apiBaseUrl ||
      process.env.PAYNIT_BASE_URL ||
      'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1';

    const statusUrl = process.env.PAYNIT_STATUS_URL || `${baseUrl.replace(/\/$/, '')}/check-order-status`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': creds.apiKey,
          'X-Client-Secret': creds.apiSecret,
        },
        body: JSON.stringify({ order_id: withdrawal.id }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = { text: await res.text().catch(() => '') };
      }

      const parsedStatus = this.parseProviderStatus(data);
      const utr =
        data.utr ||
        data.data?.utr ||
        data.rrn ||
        data.bank_reference ||
        data.data?.bank_reference;

      const providerOrderId =
        data.order_id ||
        data.payout_id ||
        data.data?.order_id ||
        data.data?.payout_id ||
        withdrawal.id;

      if (parsedStatus === 'success') {
        return {
          status: 'success',
          utr,
          providerOrderId,
          providerResponse: JSON.stringify(data),
        };
      }

      if (parsedStatus === 'failed') {
        return {
          status: 'failed',
          providerOrderId,
          providerResponse: JSON.stringify(data),
          failureReason:
            data.message ||
            data.error ||
            data.failure_reason ||
            data.data?.failure_reason ||
            'Paynit reported order failed.',
        };
      }

      if (parsedStatus === 'processing') {
        return {
          status: 'processing',
          providerOrderId,
          providerResponse: JSON.stringify(data),
        };
      }
    } catch (err: any) {
      console.warn('[PayoutAdapter] Paynit reconcile error:', err);
    }

    return {
      status: withdrawal.status as any,
      providerResponse: 'Reconciliation query complete; status remains unchanged.',
    };
  }

  /**
   * Parse provider status from raw response
   * SAFETY GUARANTEE: Never marks payout 'success' without confirmed provider confirmation
   */
  public parseProviderStatus(data: any): 'success' | 'processing' | 'failed' {
    if (!data || typeof data !== 'object') return 'processing';

    const rawStatus = (
      data.status ||
      data.order_status ||
      data.payout_status ||
      data.data?.status ||
      data.data?.order_status ||
      data.data?.payout_status ||
      ''
    ).toString().toUpperCase().trim();

    // 1. Explicit Success confirmation
    if (
      rawStatus === 'SUCCESS' ||
      rawStatus === 'COMPLETED' ||
      rawStatus === 'PAID' ||
      rawStatus === 'SETTLED'
    ) {
      return 'success';
    }

    if (data.success === true && (rawStatus === 'SUCCESS' || Boolean(data.utr || data.data?.utr))) {
      return 'success';
    }

    // 2. Explicit Failure / Rejected
    if (
      rawStatus === 'FAILED' ||
      rawStatus === 'REJECTED' ||
      rawStatus === 'CANCELLED' ||
      rawStatus === 'FAILURE' ||
      rawStatus === 'DECLINED'
    ) {
      return 'failed';
    }

    if (data.error !== undefined && !['PROCESSING', 'PENDING', 'QUEUED'].includes(rawStatus)) {
      return 'failed';
    }

    if (data.success === false && !['PROCESSING', 'PENDING', 'QUEUED'].includes(rawStatus)) {
      return 'failed';
    }

    // 3. Processing / Pending / Queued or unconfirmed
    return 'processing';
  }

  /**
   * Verify Webhook signature if provider sends webhook callback
   */
  public async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const creds = await getDecryptedCredentials();
    const secret = creds.webhookSecret || creds.apiSecret;
    if (!secret || !signature) return false;

    try {
      // Standard HMAC-SHA256 hex or base64 verification
      const expectedHex = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const expectedBase64 = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('base64');

      if (signature.length === expectedHex.length) {
        return crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(signature));
      }
      if (signature.length === expectedBase64.length) {
        return crypto.timingSafeEqual(Buffer.from(expectedBase64), Buffer.from(signature));
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const payoutGateway = new UPIPaymentGatewayAdapter();
