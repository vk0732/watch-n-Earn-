import crypto from 'crypto';

/**
 * Server-side Secret for signing client device identifiers.
 * Kept strictly server-side to prevent tampering or client forgery.
 */
const DEVICE_SIGNING_SECRET =
  process.env.DEVICE_SIGNING_SECRET || 'teleearn_anti_fraud_device_signing_secret_2026_x89';

export interface DeviceTokenPayload {
  deviceId: string;
  issuedAt: number;
}

export interface DeviceVerificationResult {
  isValid: boolean;
  deviceId: string;
  isNewDevice: boolean;
  token: string;
  error?: string;
}

/**
 * Creates a cryptographically signed device token.
 * Format: v1.<deviceId>.<issuedAt>.<hmacSignature>
 */
export function issueSignedDeviceToken(existingDeviceId?: string): string {
  const deviceId =
    existingDeviceId && /^dev_[a-f0-9]{24,48}$/i.test(existingDeviceId)
      ? existingDeviceId
      : `dev_${crypto.randomBytes(16).toString('hex')}`;
  const issuedAt = Date.now();
  const payloadStr = `${deviceId}.${issuedAt}`;
  const signature = crypto
    .createHmac('sha256', DEVICE_SIGNING_SECRET)
    .update(payloadStr)
    .digest('hex');

  return `v1.${payloadStr}.${signature}`;
}

/**
 * Verifies a server-issued signed device token.
 * Uses timing-safe string comparison to prevent side-channel timing attacks.
 */
export function verifySignedDeviceToken(token?: string): DeviceVerificationResult {
  if (!token || typeof token !== 'string') {
    const newToken = issueSignedDeviceToken();
    const parts = newToken.split('.');
    return {
      isValid: true,
      deviceId: parts[1],
      isNewDevice: true,
      token: newToken,
    };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // Malformed token, issue new token
    const newToken = issueSignedDeviceToken();
    const newParts = newToken.split('.');
    return {
      isValid: true,
      deviceId: newParts[1],
      isNewDevice: true,
      token: newToken,
    };
  }

  const [, deviceId, issuedAtStr, signature] = parts;
  const payloadStr = `${deviceId}.${issuedAtStr}`;
  const expectedSignature = crypto
    .createHmac('sha256', DEVICE_SIGNING_SECRET)
    .update(payloadStr)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    // Tampered token - do NOT trust the supplied deviceId. Issue fresh one.
    const newToken = issueSignedDeviceToken();
    const newParts = newToken.split('.');
    return {
      isValid: true,
      deviceId: newParts[1],
      isNewDevice: true,
      token: newToken,
      error: 'Invalid signature on client device token',
    };
  }

  return {
    isValid: true,
    deviceId,
    isNewDevice: false,
    token,
  };
}

/**
 * Computes non-invasive device risk hash from standard browser metadata.
 */
export function computeDeviceFingerprintHash(rawFingerprint?: string): string {
  if (!rawFingerprint || rawFingerprint.trim().length === 0) {
    return '';
  }
  return crypto.createHash('sha256').update(rawFingerprint.trim()).digest('hex').slice(0, 32);
}

/**
 * In-memory IP rate limiter to mitigate bot storms without treating shared public IPs as fraud.
 */
interface IpTracker {
  count: number;
  windowStart: number;
}
const ipRateLimits = new Map<string, IpTracker>();
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_SIGNUPS_PER_IP_WINDOW = 25; // Generous to accommodate shared Wi-Fi / carrier CGNAT

export function checkIpRateLimit(ip: string): { isRateLimited: boolean; currentCount: number } {
  const now = Date.now();
  const tracker = ipRateLimits.get(ip);

  if (!tracker || now - tracker.windowStart > IP_WINDOW_MS) {
    ipRateLimits.set(ip, { count: 1, windowStart: now });
    return { isRateLimited: false, currentCount: 1 };
  }

  tracker.count += 1;
  if (tracker.count > MAX_SIGNUPS_PER_IP_WINDOW) {
    return { isRateLimited: true, currentCount: tracker.count };
  }

  return { isRateLimited: false, currentCount: tracker.count };
}
