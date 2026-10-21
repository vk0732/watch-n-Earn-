import crypto from 'node:crypto';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, cleanDocData, memStore, getColName } from './db.ts';

export type GatewayProvider = 'cashfree' | 'razorpayx' | 'paytm' | 'paynit' | 'custom';
export type GatewayEnvironment = 'test' | 'live';
export type ConnectionStatus = 'not_configured' | 'connected' | 'failed' | 'integration_required';

export interface EncryptedField {
  iv: string; // hex
  data: string; // hex
  tag: string; // hex
}

export interface StoredGatewayConfig {
  provider: GatewayProvider | '';
  environment: GatewayEnvironment;
  payoutsEnabled: boolean;
  apiBaseUrl: string;
  merchantId?: string; // encrypted or masked
  encryptedApiKey?: EncryptedField;
  encryptedApiSecret?: EncryptedField;
  encryptedWebhookSecret?: EncryptedField;
  encryptedMerchantId?: EncryptedField;
  maskedApiKey?: string;
  maskedApiSecret?: string;
  maskedMerchantId?: string;
  maskedWebhookSecret?: string;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasMerchantId: boolean;
  hasWebhookSecret: boolean;
  lastTestedAt?: string;
  lastTestStatus?: ConnectionStatus;
  lastTestMessage?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PaymentGatewayPublicConfig {
  provider: GatewayProvider | '';
  environment: GatewayEnvironment;
  payoutsEnabled: boolean;
  apiBaseUrl: string;
  maskedApiKey: string;
  maskedApiSecret: string;
  maskedMerchantId: string;
  maskedWebhookSecret: string;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasMerchantId: boolean;
  hasWebhookSecret: boolean;
  status: {
    connectionStatus: ConnectionStatus;
    message: string;
    lastTestedAt?: string;
    environment: GatewayEnvironment;
  };
  supportedProviders: Array<{
    id: GatewayProvider;
    name: string;
    description: string;
    requiresMerchantId: boolean;
    merchantIdLabel: string;
    defaultTestUrl: string;
    defaultLiveUrl: string;
    docsUrl: string;
    isIntegrated: boolean;
  }>;
  webhookUrl: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DecryptedGatewayCredentials {
  provider: GatewayProvider | '';
  environment: GatewayEnvironment;
  payoutsEnabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  apiSecret: string;
  merchantId: string;
  webhookSecret: string;
}

// Master Key for AES-256-GCM encryption at rest
// Derived using SHA-256 of server environment secret
function getEncryptionKey(): Buffer {
  const masterSecret =
    process.env.PAYMENT_ENCRYPTION_KEY ||
    process.env.DEVICE_SIGNING_SECRET ||
    process.env.FIREBASE_PROJECT_ID ||
    'teleearn_payment_gateway_master_key_v1';
  return crypto.createHash('sha256').update(masterSecret).digest();
}

/**
 * Encrypt a sensitive credential using AES-256-GCM
 */
export function encryptSecret(plainText: string): EncryptedField {
  if (!plainText) {
    return { iv: '', data: '', tag: '' };
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt a sensitive credential with AES-256-GCM authentication verification
 */
export function decryptSecret(encrypted: EncryptedField | undefined): string {
  if (!encrypted || !encrypted.iv || !encrypted.data || !encrypted.tag) {
    return '';
  }
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.data, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[PaymentSecurity] Decryption failed or tag mismatch:', err);
    return '';
  }
}

/**
 * Mask credential for safe display in UI (e.g. ****abcd or ********)
 */
export function maskSecret(value: string | undefined, visibleTrailingChars = 4): string {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= visibleTrailingChars) {
    return '********';
  }
  const maskedPrefix = '****';
  const suffix = trimmed.slice(-visibleTrailingChars);
  return `${maskedPrefix}${suffix}`;
}

// In-memory cache of stored gateway settings
let inMemoryGatewayConfig: StoredGatewayConfig | null = null;

// Supported providers metadata (Paynit UPI Payouts is the exclusive gateway)
export const SUPPORTED_PROVIDERS = [
  {
    id: 'paynit' as GatewayProvider,
    name: 'Paynit UPI Payouts (Supabase Gateway)',
    description: 'Instant automated UPI Payouts via Paynit Merchant API. Endpoints: merchant-paynit-payout & check-order-status.',
    requiresMerchantId: false,
    merchantIdLabel: 'Merchant ID (Optional)',
    defaultTestUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
    defaultLiveUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
    docsUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co',
    isIntegrated: true,
  },
];

/**
 * Load stored configuration from Firestore or memory
 */
export async function getStoredGatewayConfig(): Promise<StoredGatewayConfig> {
  if (inMemoryGatewayConfig) {
    return inMemoryGatewayConfig;
  }

  try {
    const docRef = doc(db, getColName('payment_gateway_config'), 'settings');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      inMemoryGatewayConfig = snap.data() as StoredGatewayConfig;
      // Single-gateway architecture: unconditionally map provider to paynit
      inMemoryGatewayConfig.provider = 'paynit';
      if (!inMemoryGatewayConfig.apiBaseUrl) {
        inMemoryGatewayConfig.apiBaseUrl = 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1';
      }
      return inMemoryGatewayConfig;
    }
  } catch (err) {
    console.warn('[PaymentSecurity] Firestore config read fallback:', err);
  }

  // Fallback defaults: Paynit UPI Payouts
  const envProvider = (process.env.PAYOUT_PROVIDER as GatewayProvider) || 'paynit';

  const envApiKey =
    process.env.PAYNIT_CLIENT_ID ||
    process.env.PAYOUT_API_KEY ||
    process.env.PAYOUT_CLIENT_ID ||
    '';

  const envApiSecret =
    process.env.PAYNIT_CLIENT_SECRET ||
    process.env.PAYOUT_API_SECRET ||
    process.env.PAYOUT_CLIENT_SECRET ||
    '';

  const defaultConfig: StoredGatewayConfig = {
    provider: envProvider,
    environment: (process.env.PAYOUT_LIVE_ENABLED === 'true' ? 'live' : 'test') as GatewayEnvironment,
    payoutsEnabled: process.env.PAYOUT_LIVE_ENABLED === 'true',
    apiBaseUrl:
      process.env.PAYNIT_BASE_URL ||
      process.env.PAYOUT_BASE_URL ||
      'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
    hasApiKey: Boolean(envApiKey && !envApiKey.includes('your_')),
    hasApiSecret: Boolean(envApiSecret && !envApiSecret.includes('your_')),
    hasMerchantId: false,
    hasWebhookSecret: false,
    maskedApiKey: envApiKey && !envApiKey.includes('your_') ? maskSecret(envApiKey) : '',
    maskedApiSecret: envApiSecret && !envApiSecret.includes('your_') ? '********' : '',
    lastTestStatus: 'not_configured',
    lastTestMessage: 'Credentials have not been tested with the provider yet.',
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };

  // If environment variables provided initial keys, encrypt them
  if (envApiKey && !envApiKey.includes('your_')) {
    defaultConfig.encryptedApiKey = encryptSecret(envApiKey);
  }
  if (envApiSecret && !envApiSecret.includes('your_')) {
    defaultConfig.encryptedApiSecret = encryptSecret(envApiSecret);
  }

  inMemoryGatewayConfig = defaultConfig;
  return inMemoryGatewayConfig;
}

/**
 * Get public masked configuration for the Admin UI (never exposes raw secrets)
 */
export async function getPublicGatewayConfig(reqHost?: string): Promise<PaymentGatewayPublicConfig> {
  const stored = await getStoredGatewayConfig();
  const host = reqHost || process.env.VITE_APP_URL || 'https://your-domain.com';
  const webhookUrl = `${host.replace(/\/$/, '')}/api/payouts/webhook`;

  return {
    provider: 'paynit',
    environment: stored.environment,
    payoutsEnabled: stored.payoutsEnabled,
    apiBaseUrl: stored.apiBaseUrl || 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
    maskedApiKey: stored.maskedApiKey || (stored.hasApiKey ? '****••••' : ''),
    maskedApiSecret: stored.maskedApiSecret || (stored.hasApiSecret ? '••••••••' : ''),
    maskedMerchantId: '',
    maskedWebhookSecret: '',
    hasApiKey: stored.hasApiKey,
    hasApiSecret: stored.hasApiSecret,
    hasMerchantId: false,
    hasWebhookSecret: false,
    status: {
      connectionStatus: stored.lastTestStatus || 'not_configured',
      message: stored.lastTestMessage || 'Paynit UPI Payouts configured.',
      lastTestedAt: stored.lastTestedAt,
      environment: stored.environment,
    },
    supportedProviders: SUPPORTED_PROVIDERS,
    webhookUrl,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };
}

/**
 * Save updated configuration securely (encrypts secrets before writing)
 */
export async function saveGatewayConfig(
  input: {
    provider?: GatewayProvider | '';
    environment: GatewayEnvironment;
    payoutsEnabled: boolean;
    apiBaseUrl: string;
    apiKey?: string;
    apiSecret?: string;
    merchantId?: string;
    webhookSecret?: string;
  },
  adminId: string
): Promise<StoredGatewayConfig> {
  const current = await getStoredGatewayConfig();

  // Validate API base URL format if provided
  if (input.apiBaseUrl) {
    try {
      const parsed = new URL(input.apiBaseUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error('API Base URL must start with https://');
      }
    } catch (e: any) {
      throw new Error(`Invalid API Base URL: ${e.message}`);
    }
  }

  const updated: StoredGatewayConfig = {
    ...current,
    provider: 'paynit',
    environment: input.environment,
    payoutsEnabled: input.payoutsEnabled,
    apiBaseUrl: input.apiBaseUrl?.trim() || current.apiBaseUrl || 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
    updatedAt: new Date().toISOString(),
    updatedBy: adminId,
  };

  // API Key update: if input provided and not a masked placeholder
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    if (trimmed && !trimmed.startsWith('****')) {
      updated.encryptedApiKey = encryptSecret(trimmed);
      updated.maskedApiKey = maskSecret(trimmed);
      updated.hasApiKey = true;
    } else if (trimmed === '') {
      delete updated.encryptedApiKey;
      updated.maskedApiKey = '';
      updated.hasApiKey = false;
    }
  }

  // API Secret update
  if (input.apiSecret !== undefined) {
    const trimmed = input.apiSecret.trim();
    if (trimmed && !trimmed.startsWith('****') && !trimmed.startsWith('••••')) {
      updated.encryptedApiSecret = encryptSecret(trimmed);
      updated.maskedApiSecret = maskSecret(trimmed);
      updated.hasApiSecret = true;
    } else if (trimmed === '') {
      delete updated.encryptedApiSecret;
      updated.maskedApiSecret = '';
      updated.hasApiSecret = false;
    }
  }

  // Merchant ID update
  if (input.merchantId !== undefined) {
    const trimmed = input.merchantId.trim();
    if (trimmed && !trimmed.startsWith('****')) {
      updated.encryptedMerchantId = encryptSecret(trimmed);
      updated.maskedMerchantId = maskSecret(trimmed);
      updated.hasMerchantId = true;
    } else if (trimmed === '') {
      delete updated.encryptedMerchantId;
      updated.maskedMerchantId = '';
      updated.hasMerchantId = false;
    }
  }

  // Webhook Secret update
  if (input.webhookSecret !== undefined) {
    const trimmed = input.webhookSecret.trim();
    if (trimmed && !trimmed.startsWith('****') && !trimmed.startsWith('••••')) {
      updated.encryptedWebhookSecret = encryptSecret(trimmed);
      updated.maskedWebhookSecret = maskSecret(trimmed);
      updated.hasWebhookSecret = true;
    } else if (trimmed === '') {
      delete updated.encryptedWebhookSecret;
      updated.maskedWebhookSecret = '';
      updated.hasWebhookSecret = false;
    }
  }

  // Reset test status if provider or keys were changed
  if (current.provider !== updated.provider || current.environment !== updated.environment) {
    updated.lastTestStatus = 'not_configured';
    updated.lastTestMessage = 'Settings changed. Please test connection to verify.';
  }

  // Persist to Firestore and memory cache
  inMemoryGatewayConfig = updated;
  try {
    const docRef = doc(db, getColName('payment_gateway_config'), 'settings');
    await setDoc(docRef, cleanDocData(updated), { merge: true });
  } catch (err) {
    console.warn('[PaymentSecurity] Firestore saveGatewayConfig fallback:', err);
  }

  return updated;
}

/**
 * Remove / wipe stored credentials securely
 */
export async function removeGatewayCredentials(adminId: string): Promise<StoredGatewayConfig> {
  const updated: StoredGatewayConfig = {
    provider: 'paynit',
    environment: 'test',
    payoutsEnabled: false,
    apiBaseUrl: 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
    hasApiKey: false,
    hasApiSecret: false,
    hasMerchantId: false,
    hasWebhookSecret: false,
    maskedApiKey: '',
    maskedApiSecret: '',
    maskedMerchantId: '',
    maskedWebhookSecret: '',
    lastTestStatus: 'not_configured',
    lastTestMessage: 'Credentials have been removed by administrator.',
    lastTestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: adminId,
  };

  inMemoryGatewayConfig = updated;
  try {
    const docRef = doc(db, getColName('payment_gateway_config'), 'settings');
    await deleteDoc(docRef);
  } catch (err) {
    console.warn('[PaymentSecurity] Firestore delete fallback:', err);
  }

  return updated;
}

/**
 * Update test connection outcome in stored config
 */
export async function recordConnectionTestResult(
  status: ConnectionStatus,
  message: string
): Promise<void> {
  const current = await getStoredGatewayConfig();
  current.lastTestStatus = status;
  current.lastTestMessage = message;
  current.lastTestedAt = new Date().toISOString();

  inMemoryGatewayConfig = current;
  try {
    const docRef = doc(db, getColName('payment_gateway_config'), 'settings');
    await setDoc(
      docRef,
      {
        lastTestStatus: status,
        lastTestMessage: message,
        lastTestedAt: current.lastTestedAt,
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[PaymentSecurity] Firestore test result record fallback:', err);
  }
}

/**
 * Decrypt credentials for server-side API execution ONLY
 */
export async function getDecryptedCredentials(): Promise<DecryptedGatewayCredentials> {
  const stored = await getStoredGatewayConfig();
  const provider = 'paynit';

  const apiKey =
    decryptSecret(stored.encryptedApiKey) ||
    process.env.PAYNIT_CLIENT_ID ||
    process.env.PAYOUT_CLIENT_ID ||
    process.env.PAYOUT_API_KEY ||
    '';

  const apiSecret =
    decryptSecret(stored.encryptedApiSecret) ||
    process.env.PAYNIT_CLIENT_SECRET ||
    process.env.PAYOUT_CLIENT_SECRET ||
    process.env.PAYOUT_API_SECRET ||
    '';

  const merchantId =
    decryptSecret(stored.encryptedMerchantId) ||
    process.env.PAYNIT_MERCHANT_ID ||
    process.env.PAYOUT_MERCHANT_ID ||
    '';

  const webhookSecret =
    decryptSecret(stored.encryptedWebhookSecret) ||
    process.env.PAYNIT_WEBHOOK_SECRET ||
    process.env.PAYOUT_WEBHOOK_SECRET ||
    '';

  const apiBaseUrl =
    stored.apiBaseUrl ||
    process.env.PAYNIT_BASE_URL ||
    process.env.PAYOUT_BASE_URL ||
    (provider === 'paynit'
      ? 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1'
      : '');

  return {
    provider,
    environment: stored.environment,
    payoutsEnabled: stored.payoutsEnabled,
    apiBaseUrl,
    apiKey,
    apiSecret,
    merchantId,
    webhookSecret,
  };
}
