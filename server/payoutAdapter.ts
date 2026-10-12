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

    return {
      status: withdrawal.status as any,
      providerResponse: 'Reconciliation query complete; status remains unchanged.',
    };
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
