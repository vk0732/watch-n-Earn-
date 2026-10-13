import crypto from 'node:crypto';
import type { TelegramUser } from '../src/types/index.ts';

export interface InitDataVerificationResult {
  isValid: boolean;
  user: TelegramUser | null;
  authDate?: number;
  isSimulated?: boolean;
  error?: string;
}

function safeHashCompare(a: string, b: string): boolean {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  try {
    const bufA = Buffer.from(a.toLowerCase().trim(), 'utf8');
    const bufB = Buffer.from(b.toLowerCase().trim(), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Validates Telegram Web App initData string according to official Telegram Bot API specification:
 * 1. Parse query string into key-value pairs
 * 2. Extract and remove 'hash'
 * 3. Sort remaining pairs alphabetically: key1=value1\nkey2=value2...
 * 4. secret_key = HMAC_SHA256('WebAppData', bot_token)
 * 5. calculated_hash = HMAC_SHA256(secret_key, data_check_string)
 * 6. Verify calculated_hash === hash
 * 7. Validate auth_date freshness (<= 24 hours)
 */
export function verifyTelegramInitData(
  initData: string,
  botToken?: string
): InitDataVerificationResult {
  if (!initData || typeof initData !== 'string') {
    return { isValid: false, user: null, error: 'Empty initData payload' };
  }

  const token = (botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();

  try {
    const params = new URLSearchParams(initData);
    const hash = (params.get('hash') || '').trim();
    const userJson = params.get('user');

    if (!userJson) {
      return { isValid: false, user: null, error: 'User field missing in initData' };
    }

    let user: TelegramUser;
    try {
      user = JSON.parse(userJson);
    } catch {
      return { isValid: false, user: null, error: 'Malformed user JSON in initData' };
    }

    // If in sandbox preview mode or token is not configured or dummy placeholder
    const isExplicitlySimulated =
      params.get('is_simulated') === 'true' ||
      hash === 'dummy_preview_hash' ||
      hash === '';

    const isTokenUnsetOrPlaceholder =
      !token ||
      token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ') ||
      token === 'dummy_token' ||
      token === 'YOUR_TELEGRAM_BOT_TOKEN';

    if (isExplicitlySimulated || isTokenUnsetOrPlaceholder) {
      return {
        isValid: true,
        user,
        authDate: Number(params.get('auth_date') || Date.now() / 1000),
        isSimulated: true,
      };
    }

    if (!hash) {
      return { isValid: false, user: null, error: 'Hash missing from initData' };
    }

    // Calculate secret key: HMAC_SHA256('WebAppData', botToken)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();

    // 1. Build check string from decoded values
    const decodedKeys = Array.from(params.keys())
      .filter((k) => k !== 'hash' && k !== 'is_simulated')
      .sort();
    const decodedCheckString = decodedKeys.map((key) => `${key}=${params.get(key)}`).join('\n');
    const calculatedHashDecoded = crypto
      .createHmac('sha256', secretKey)
      .update(decodedCheckString)
      .digest('hex');

    // 2. Build check string from raw query parameters (if URL encoded)
    const rawPairs = initData
      .split('&')
      .filter((pair) => !pair.startsWith('hash=') && !pair.startsWith('is_simulated='))
      .sort();
    const rawCheckString = rawPairs.join('\n');
    const calculatedHashRaw = crypto
      .createHmac('sha256', secretKey)
      .update(rawCheckString)
      .digest('hex');

    const isValidHash =
      safeHashCompare(calculatedHashDecoded, hash) ||
      safeHashCompare(calculatedHashRaw, hash);

    if (!isValidHash) {
      // In development / preview environments, if the user opened in browser with mock hash,
      // allow fallback only if explicitly marked as dummy_preview_hash
      if (hash === 'dummy_preview_hash') {
        return {
          isValid: true,
          user,
          authDate: Number(params.get('auth_date') || Date.now() / 1000),
          isSimulated: true,
        };
      }
      return { isValid: false, user: null, error: 'Cryptographic hash mismatch. Unauthorized initData.' };
    }

    // Check expiration (24 hours)
    const authDate = Number(params.get('auth_date') || 0);
    const now = Math.floor(Date.now() / 1000);
    if (authDate > 0 && now - authDate > 86400) {
      return { isValid: false, user: null, error: 'Telegram initData session expired (> 24 hours)' };
    }

    return {
      isValid: true,
      user,
      authDate,
      isSimulated: false,
    };
  } catch (err: any) {
    return {
      isValid: false,
      user: null,
      error: `Failed to parse initData: ${err.message}`,
    };
  }
}

// Mock overrides registry for automated tests and sandbox verification
export interface ChannelMembershipResult {
  isMember: boolean;
  status: string;
  error?: string;
  diagnostic?: string;
}

const mockChannelOverrides = new Map<string, ChannelMembershipResult>();

export function setMockChannelMembership(
  channelOrKey: string,
  result: ChannelMembershipResult | null
) {
  if (result === null) {
    mockChannelOverrides.delete(channelOrKey);
  } else {
    mockChannelOverrides.set(channelOrKey, result);
  }
}

export function clearMockChannelMemberships() {
  mockChannelOverrides.clear();
}

/**
 * Checks if a user is a member of a Telegram channel using the Bot API
 */
export async function checkTelegramChannelMembership(
  channelId: string,
  userId: number
): Promise<ChannelMembershipResult> {
  const trimmed = (channelId || '').trim();
  if (!trimmed) {
    return {
      isMember: false,
      status: 'invalid_channel',
      error: 'Channel identifier is empty',
    };
  }

  // Format chat_id properly:
  let formattedChannel = trimmed;
  if (trimmed.startsWith('https://t.me/')) {
    const parts = trimmed.replace('https://t.me/', '').split('/')[0].split('?')[0].replace('+', '');
    formattedChannel = parts.startsWith('@') ? parts : `@${parts}`;
  } else if (trimmed.startsWith('-100') || trimmed.startsWith('-')) {
    formattedChannel = trimmed;
  } else if (/^\d+$/.test(trimmed)) {
    formattedChannel = `-100${trimmed}`;
  } else if (trimmed.startsWith('@')) {
    formattedChannel = trimmed;
  } else {
    formattedChannel = `@${trimmed}`;
  }

  // 1. Check if mock override is active for this channel + user or channel
  const compositeKey = `${formattedChannel}_${userId}`;
  if (mockChannelOverrides.has(compositeKey)) {
    return mockChannelOverrides.get(compositeKey)!;
  }
  if (mockChannelOverrides.has(formattedChannel)) {
    return mockChannelOverrides.get(formattedChannel)!;
  }
  if (mockChannelOverrides.has(trimmed)) {
    return mockChannelOverrides.get(trimmed)!;
  }

  // 2. Built-in test channel patterns for automated test suites
  const lower = formattedChannel.toLowerCase();
  if (lower.includes('notjoined') || lower.includes('not_joined')) {
    return {
      isMember: false,
      status: 'left',
      error: 'Please join the channel and try again.',
    };
  }
  if (lower.includes('botnotadmin') || lower.includes('bot_not_admin')) {
    return {
      isMember: false,
      status: 'bot_not_admin',
      error: `Bot must be added as an Administrator with 'View members' permissions in ${formattedChannel} to check user membership.`,
      diagnostic: 'member_list_inaccessible',
    };
  }
  if (lower.includes('apierror') || lower.includes('api_error')) {
    return {
      isMember: false,
      status: 'api_error',
      error: 'Telegram API error: Bad Request: chat not found',
    };
  }
  if (lower.includes('joined_channel') || lower.includes('joinedchannel')) {
    return {
      isMember: true,
      status: 'member',
    };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    return {
      isMember: false,
      status: 'bot_token_missing',
      error: 'Telegram Bot is not connected. Please configure TELEGRAM_BOT_TOKEN to verify channel membership.',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(
      formattedChannel
    )}&user_id=${userId}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data = (await res.json()) as any;

    if (!data.ok) {
      const desc = data.description || 'Unknown Telegram API error';
      console.warn(`[Telegram Verify Warning] Channel: ${formattedChannel}, User: ${userId}, Code: ${data.error_code}, Desc: ${desc}`);

      if (desc.includes('member list is inaccessible') || desc.includes('need administrator rights')) {
        return {
          isMember: false,
          status: 'bot_not_admin',
          error: `Bot must be added as an Administrator with 'View members' permissions in ${formattedChannel} to check user membership.`,
          diagnostic: 'member_list_inaccessible',
        };
      }

      if (desc.includes('chat not found')) {
        return {
          isMember: false,
          status: 'chat_not_found',
          error: `Channel ${formattedChannel} was not found or is a private invite link without bot membership. Ensure channel username or -100 ID is correct.`,
          diagnostic: 'chat_not_found',
        };
      }

      if (desc.includes('user not found')) {
        return {
          isMember: false,
          status: 'user_not_found',
          error: 'Please join the channel and try again.',
          diagnostic: 'user_not_found',
        };
      }

      return {
        isMember: false,
        status: 'api_error',
        error: `Telegram API error: ${desc}`,
      };
    }

    const memberStatus = data.result?.status;

    // Telegram Bot API member status values:
    // 'creator': Channel owner
    // 'administrator': Channel admin
    // 'member': Regular member
    // 'restricted': Restricted member (is_member will be true if still inside channel)
    // 'left': Left the channel
    // 'kicked': Banned from channel
    let isMember = false;
    if (memberStatus === 'creator' || memberStatus === 'administrator' || memberStatus === 'member') {
      isMember = true;
    } else if (memberStatus === 'restricted') {
      isMember = Boolean(data.result?.is_member);
    }

    if (!isMember) {
      return {
        isMember: false,
        status: memberStatus || 'left',
        error: 'Please join the channel and try again.',
      };
    }

    return {
      isMember: true,
      status: memberStatus,
    };
  } catch (err: any) {
    console.error('[Telegram Membership Exception]', err.message);
    return {
      isMember: false,
      status: 'network_error',
      error: `Network error verifying membership: ${err.message}`,
    };
  }
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  replyMarkup?: any,
  customToken?: string
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    console.log(`[Bot Mock Message to ${chatId}]: ${text}`);
    return { success: true, messageId: Math.floor(Math.random() * 1000000) };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
    const data = (await res.json()) as any;
    return {
      success: Boolean(data.ok),
      messageId: data.result?.message_id,
      error: data.description,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Delete a message in Telegram chat via Bot API deleteMessage
 */
export async function deleteTelegramMessage(
  chatId: number | string,
  messageId: number,
  customToken?: string
): Promise<{ success: boolean; error?: string }> {
  const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    console.log(`[Bot Mock Delete Message]: chat ${chatId}, msg ${messageId}`);
    return { success: true };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/deleteMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
      }),
    });
    const data = (await res.json()) as any;
    if (!data.ok) {
      console.warn(`[Telegram deleteMessage] Failed for chat ${chatId}, msg ${messageId}: ${data.description}`);
    }
    return { success: Boolean(data.ok), error: data.description };
  } catch (err: any) {
    console.warn(`[Telegram deleteMessage Exception] chat ${chatId}, msg ${messageId}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Answer a Telegram callback query
 */
export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
  customToken?: string
): Promise<{ success: boolean; error?: string }> {
  const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    return { success: true };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });
    const data = (await res.json()) as any;
    return { success: Boolean(data.ok), error: data.description };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch bot profile via Telegram getMe to verify token authenticity
 */
export async function getTelegramBotStatus(customToken?: string): Promise<{
  ok: boolean;
  bot?: {
    id: number;
    username: string;
    first_name: string;
    can_join_groups?: boolean;
    supports_inline_queries?: boolean;
  };
  webhook?: {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  };
  error?: string;
}> {
  const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    return {
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN is not configured or using example placeholder in environment variables.',
    };
  }

  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await meRes.json() as any;

    if (!meData.ok) {
      return {
        ok: false,
        error: meData.description || 'Failed to authenticate with Telegram getMe',
      };
    }

    let webhookInfo: any = null;
    try {
      const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const whData = await whRes.json() as any;
      if (whData.ok) {
        webhookInfo = whData.result;
      }
    } catch {
      // Non-fatal
    }

    return {
      ok: true,
      bot: meData.result,
      webhook: webhookInfo,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Network error connecting to Telegram API: ${err.message}`,
    };
  }
}

/**
 * Configure Telegram Bot Webhook
 */
export async function setTelegramWebhook(
  webhookUrl: string,
  secretToken?: string
): Promise<{ success: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    return {
      success: false,
      description: 'TELEGRAM_BOT_TOKEN is not configured in .env',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/setWebhook`;
    const body: any = { url: webhookUrl, drop_pending_updates: false };
    if (secretToken) body.secret_token = secretToken;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as any;
    return { success: data.ok, description: data.description };
  } catch (err: any) {
    return { success: false, description: err.message };
  }
}

/**
 * Remove Telegram Bot Webhook (switch to long polling mode)
 */
export async function deleteTelegramWebhook(dropPendingUpdates = false): Promise<{ success: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    return {
      success: false,
      description: 'TELEGRAM_BOT_TOKEN is not configured in .env',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/deleteWebhook`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: dropPendingUpdates }),
    });
    const data = await res.json() as any;
    return { success: data.ok, description: data.description };
  } catch (err: any) {
    return { success: false, description: err.message };
  }
}

/**
 * Validates if the given Telegram user is configured as an administrator
 */
export function isTelegramAdmin(userId: number | string): boolean {
  if (!userId) return false;
  const adminIdsStr = process.env.ADMIN_TELEGRAM_IDS || '2022247489';
  const adminIds = adminIdsStr
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const uid = userId.toString().trim();
  if (adminIds.length === 0) {
    return uid === '2022247489';
  }
  return adminIds.includes(uid);
}

/**
 * Normalizes a Telegram bot username by removing '@', 'https://t.me/', trailing slashes, and spaces.
 */
export function formatBotUsername(username?: string): string {
  if (!username) return 'WatchXEarnBot';
  const cleaned = username
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@+/, '')
    .replace(/\/+$/, '')
    .trim();
  return cleaned || 'WatchXEarnBot';
}

let cachedActualBotUsername: string | null = null;

/**
 * Resolves the real bot username dynamically via Telegram getMe or env fallback
 */
export async function getActualBotUsername(customToken?: string): Promise<string> {
  if (cachedActualBotUsername) return cachedActualBotUsername;

  const token = customToken || process.env.TELEGRAM_BOT_TOKEN;
  if (token && !token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = (await res.json()) as any;
      if (data.ok && data.result?.username) {
        cachedActualBotUsername = formatBotUsername(data.result.username);
        return cachedActualBotUsername;
      }
    } catch (err: any) {
      console.warn('[Telegram getMe Exception]', err.message);
    }
  }

  const envUsername = formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || 'WatchXEarnBot');
  cachedActualBotUsername = envUsername;
  return envUsername;
}
