/**
 * Non-invasive client-side device identification service.
 * Respects user privacy: only gathers standard browser capabilities to generate
 * an anti-abuse hardware risk fingerprint and persists the server-issued signed device token.
 */

const DEVICE_TOKEN_KEY = 'teleearn_device_token';

export async function getClientDeviceFingerprint(): Promise<string> {
  try {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      navigator.hardwareConcurrency || 4,
    ];
    const rawString = components.join('|');

    // SHA-256 via Web Crypto API
    const msgBuffer = new TextEncoder().encode(rawString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    return 'fallback_fp_' + Math.random().toString(36).substring(2, 10);
  }
}

export function getStoredDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch (err) {
    return null;
  }
}

export function saveDeviceToken(token: string): void {
  try {
    if (token && typeof token === 'string') {
      localStorage.setItem(DEVICE_TOKEN_KEY, token);
    }
  } catch (err) {
    // ignore storage quota errors
  }
}
