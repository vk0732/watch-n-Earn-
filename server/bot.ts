import crypto from 'node:crypto';
import {
  getUser,
  getUserByTelegramId,
  saveUser,
  getAppSettings,
  atomicCreditBalance,
  getUserByReferralCode,
  getForceJoinChannels,
  updateChannelHealth,
  recordReferral,
  hasUserClaimedSignupBonus,
  getOrAssignSignupScratchBonus,
  atomicClaimSignupBonus,
  acquireLock,
} from './db.ts';
import {
  checkTelegramChannelMembership,
  sendTelegramMessage,
  deleteTelegramMessage,
  answerTelegramCallback,
  formatBotUsername,
  isTelegramAdmin,
} from './telegram.ts';
import type { UserProfile, ReferralRecord } from '../src/types/index.ts';

// Active force join verification tracking per chat ID
interface VerificationSession {
  forceJoinMsgId?: number;
  incompleteMsgIds: Set<number>;
}

const activeVerificationSessions = new Map<number, VerificationSession>();
const inFlightVerifications = new Set<number>();

export interface TelegramFrom {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChatMemberUpdated {
  chat: {
    id: number;
    title?: string;
    username?: string;
    type: string;
  };
  from: TelegramFrom;
  date: number;
  old_chat_member: {
    status: string;
  };
  new_chat_member: {
    status: string;
    can_be_edited?: boolean;
    can_manage_chat?: boolean;
    can_change_info?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_delete_messages?: boolean;
    can_invite_users?: boolean;
    can_restrict_members?: boolean;
    can_pin_messages?: boolean;
    can_promote_members?: boolean;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: TelegramFrom;
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: TelegramFrom;
    message?: {
      chat: { id: number };
      message_id: number;
    };
    data?: string;
  };
  my_chat_member?: TelegramChatMemberUpdated;
  chat_member?: TelegramChatMemberUpdated;
}

/**
 * Safe logger for incoming Telegram updates that NEVER prints secrets or bot tokens
 */
function logTelegramUpdate(type: string, fromId?: number, chatId?: number, textSummary?: string) {
  const timestamp = new Date().toISOString();
  console.log(
    `[Telegram Bot Update ${timestamp}] ${type} | User: ${fromId || 'unknown'} | Chat: ${
      chatId || 'unknown'
    } | Payload: ${textSummary ? textSummary.substring(0, 50) : 'none'}`
  );
}

/**
 * Validates that a candidate URL is a valid, publicly accessible HTTPS URL.
 * Telegram Bot API inline keyboards strictly require HTTPS for web_app buttons.
 * Localhost, HTTP, and raw IP addresses are invalid and rejected by Telegram.
 */
export function isValidMiniAppUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    // Reject localhost or raw IP addresses
    if (parsed.hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the Telegram Mini App HTTPS URL.
 * Priority order:
 * 1. MINI_APP_URL environment variable (if valid HTTPS)
 * 2. Provided appUrl argument (if valid HTTPS)
 * 3. APP_URL environment variable (if valid HTTPS)
 * 4. Fallback to verified production Mini App URL ('https://178-93-119-55.sslip.io')
 *
 * If no valid HTTPS URL can be resolved, logs an explicit diagnostic configuration error
 * and returns "" so that broken/malformed buttons are never sent to Telegram.
 */
export function getMiniAppUrl(providedUrl?: string): string {
  if (process.env.MINI_APP_URL && isValidMiniAppUrl(process.env.MINI_APP_URL)) {
    return process.env.MINI_APP_URL.trim();
  }
  if (providedUrl && isValidMiniAppUrl(providedUrl)) {
    return providedUrl.trim();
  }
  if (process.env.APP_URL && isValidMiniAppUrl(process.env.APP_URL)) {
    return process.env.APP_URL.trim();
  }
  const fallback = 'https://178-93-119-55.sslip.io';
  if (isValidMiniAppUrl(fallback)) {
    return fallback;
  }
  console.error(
    '[Mini App Configuration Error]: Missing or invalid HTTPS Mini App URL. ' +
    'Telegram Web Apps strictly require an HTTPS domain URL (no HTTP or raw IP addresses). ' +
    'Please set MINI_APP_URL in your environment configuration.'
  );
  return '';
}

/**
 * Handle incoming Telegram webhook/polling updates
 */
export async function handleTelegramBotUpdate(update: TelegramUpdate, appUrl: string) {
  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      logTelegramUpdate('CALLBACK', cb.from?.id, cb.message?.chat?.id, cb.data);
      await handleCallbackQuery(cb, appUrl);
      return;
    }

    if (update.my_chat_member) {
      const mcm = update.my_chat_member;
      logTelegramUpdate(
        'MY_CHAT_MEMBER',
        mcm.from?.id,
        mcm.chat?.id,
        `status:${mcm.new_chat_member?.status}`
      );
      await handleMyChatMemberUpdate(mcm);
      return;
    }

    const msg = update.message;
    if (!msg || !msg.text) return;

    const from = msg.from;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    logTelegramUpdate('MESSAGE', from?.id, chatId, text);

    if (text.startsWith('/start')) {
      await handleStartCommand(from, chatId, text, appUrl);
    } else if (text === '/help' || text === '/commands') {
      await handleHelpCommand(chatId, appUrl);
    } else {
      // Protected commands: recheck live channel membership before allowing action
      const passed = await ensureLiveChannelAccess(from.id, chatId);
      if (!passed) return;

      if (text === '/balance') {
        await handleBalanceCommand(from.id, chatId, appUrl);
      } else if (text === '/referral' || text === '/ref') {
        await handleReferralCommand(from.id, chatId, appUrl);
      } else if (text === '/tasks') {
        await handleTasksCommand(chatId, appUrl);
      } else {
        // Default fallback guidance
        await sendTelegramMessage(
          chatId,
          `👋 Hello <b>${from.first_name || 'Friend'}</b>!\n\nUse /start to open the <b>TeleEarn Mini App</b>, or /help to view all available commands.`
        );
      }
    }
  } catch (err: any) {
    console.error(`[Telegram Update Handler Error]: ${err.message}`);
  }
}

/**
 * Handles bot administrator status updates in channels/supergroups.
 * When the bot is added as an administrator to a private channel, Telegram sends a my_chat_member update.
 * If the user who added the bot is an authorized admin, the bot automatically messages them
 * the channel title and exact numeric ID (-100...) for seamless Force Join setup.
 */
export async function handleMyChatMemberUpdate(mcm: TelegramChatMemberUpdated) {
  try {
    const chat = mcm.chat;
    const from = mcm.from;
    const newStatus = mcm.new_chat_member?.status;
    const oldStatus = mcm.old_chat_member?.status;

    console.log(
      `[Telegram Bot Admin Event] Bot status in chat "${chat.title || chat.id}" (${chat.id}): ${oldStatus} -> ${newStatus}`
    );

    // If bot was promoted to administrator
    if (newStatus === 'administrator') {
      const channelTitle = chat.title || 'Private Channel';
      const numericId = chat.id;

      // If the promoter is an authorized administrator, notify them with the exact ID
      if (from?.id && isTelegramAdmin(from.id)) {
        await sendTelegramMessage(
          from.id,
          `🎉 <b>Bot Promoted to Channel Administrator!</b>\n\n` +
            `📢 <b>Channel:</b> ${channelTitle}\n` +
            `🆔 <b>Channel Numeric ID:</b> <code>${numericId}</code>\n\n` +
            `💡 <i>Copy the numeric ID above and paste it into the <b>Channel ID</b> field in your Watch & Earn Admin Panel (Force Join Channels).</i>`
        );
      }
    }
  } catch (err: any) {
    console.error('[handleMyChatMemberUpdate Error]:', err.message);
  }
}

/**
 * Checks live channel membership for protected bot commands.
 * If user has left any channel, blocks access, updates DB, and displays the missing join buttons.
 */
async function ensureLiveChannelAccess(telegramId: number, chatId: number): Promise<boolean> {
  const channels = await getForceJoinChannels(true);
  if (channels.length === 0) return true;

  const unjoinedChannels: typeof channels = [];
  for (const ch of channels) {
    if (ch.healthStatus === 'bot_not_member' || ch.healthStatus === 'chat_not_found') {
      continue;
    }
    const check = await checkTelegramChannelMembership(ch.channelId, telegramId);
    if (
      check.status === 'bot_not_member' ||
      check.diagnostic === 'bot_not_member' ||
      (check.error && check.error.toLowerCase().includes('bot is not a member'))
    ) {
      updateChannelHealth(ch.id, 'bot_not_member', check.error);
      console.warn(`[BotEnsureAccess] Inaccessible channel ${ch.channelId} (bot is not a member). Skipping check.`);
      continue;
    }
    if (!check.isMember) {
      unjoinedChannels.push(ch);
    }
  }

  if (unjoinedChannels.length === 0) return true;

  // Revoke verified status in DB if user left
  const user = await getUser(telegramId.toString());
  if (user && user.forceJoinVerified) {
    user.forceJoinVerified = false;
    await saveUser(user);
  }

  const inlineKeyboard: any[][] = [];
  unjoinedChannels.forEach((ch) => {
    inlineKeyboard.push([{ text: `📢 Join ${ch.title}`, url: ch.inviteLink }]);
  });
  inlineKeyboard.push([{ text: '✅ I Have Joined (Verify Now)', callback_data: 'verify_channels' }]);

  await sendTelegramMessage(
    chatId,
    `⚠️ <b>Verification Incomplete!</b>\n\nYou must remain a member of all required channels to use this feature.\n\nPlease join the channel(s) below and click <b>Verify Now</b>:`,
    { inline_keyboard: inlineKeyboard }
  );

  return false;
}

/**
 * Telegram Long Polling Controller (for local/preview development when no public HTTPS webhook is reachable)
 */
let pollingActive = false;
let pollingAbortController: AbortController | null = null;
let lastUpdateId = 0;

export function getBotPollingStatus() {
  return {
    isPolling: pollingActive,
    lastUpdateId,
  };
}

export async function stopBotPolling() {
  if (!pollingActive) return { success: true, message: 'Polling was not running' };
  pollingActive = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
  console.log('[Telegram Bot] Long polling stopped.');
  return { success: true, message: 'Long polling stopped successfully' };
}

export async function startBotPolling(appUrl: string): Promise<{ success: boolean; message: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')) {
    return {
      success: false,
      message: 'TELEGRAM_BOT_TOKEN is not configured or uses placeholder.',
    };
  }

  if (pollingActive) {
    return {
      success: true,
      message: 'Long polling is already active.',
    };
  }

  // Ensure webhook is removed first because Telegram forbids polling and webhook simultaneously
  try {
    const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    const delData = await delRes.json() as any;
    console.log('[Telegram Bot] deleteWebhook response for polling start:', delData.description || 'OK');
  } catch (err: any) {
    console.error('[Telegram Bot] Failed to clear webhook prior to polling:', err.message);
  }

  pollingActive = true;
  pollingAbortController = new AbortController();

  console.log('[Telegram Bot] Started long polling for incoming updates...');

  // Run polling loop asynchronously
  (async () => {
    while (pollingActive) {
      try {
        const timeout = 25; // seconds
        const pollUrl = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=${timeout}&allowed_updates=["message","callback_query","my_chat_member","chat_member"]`;
        
        const response = await fetch(pollUrl, {
          signal: pollingAbortController?.signal,
        });

        if (!response.ok) {
          console.error(`[Telegram Polling HTTP Error]: status ${response.status}`);
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        const data = await response.json() as any;

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);
            // Process update without throwing
            await handleTelegramBotUpdate(update, appUrl).catch((err) =>
              console.error('[Update Execution Error]:', err.message)
            );
          }
        } else {
          if (data.description?.includes('Conflict')) {
            console.warn('[Telegram Polling Conflict]: Webhook or another polling instance is running.');
            await stopBotPolling();
            break;
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          break;
        }
        console.error(`[Telegram Polling Error]: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    pollingActive = false;
  })();

  return {
    success: true,
    message: 'Long polling started successfully. Bot is now listening for live updates.',
  };
}

/**
 * Handle /start command with referral support & Force Join check
 */
async function handleStartCommand(
  from: TelegramFrom,
  chatId: number,
  text: string,
  appUrl: string
) {
  const userId = from.id.toString();
  const settings = await getAppSettings();

  // 1. Check or create user with atomic duplicate prevention
  let user = (await getUserByTelegramId(from.id)) || (await getUser(userId));
  const isNewUser = !user;

  if (isNewUser) {
    const unlock = await acquireLock(`reg_${from.id}`, 5000);
    try {
      user = (await getUserByTelegramId(from.id)) || (await getUser(userId));
      if (!user) {
        // Generate unique referral code
        const refCode = `ref_${from.id}_${crypto.randomBytes(3).toString('hex')}`;

        // Parse referral param from /start command (e.g. /start ref_98765_abc)
        let inviterUser: UserProfile | null = null;
        const parts = text.trim().split(/\s+/);
        if (parts.length > 1) {
          const param = parts[1].trim();
          // Strictly look up by registered referral code
          inviterUser = await getUserByReferralCode(param);
          // Strictly prevent self-referral
          if (inviterUser && (inviterUser.id === userId || (inviterUser.telegramId && inviterUser.telegramId === from.id))) {
            inviterUser = null;
          }
        }

        const newUser: UserProfile = {
          id: userId,
          telegramId: from.id,
          username: from.username || '',
          firstName: from.first_name || 'Telegram User',
          lastName: from.last_name || '',
          balance: 0,
          lifetimeEarnings: 0,
          referralEarnings: 0,
          referralCode: refCode,
          referredBy: inviterUser ? inviterUser.id : null,
          dailyStreak: 0,
          isBanned: false,
          signupBonusClaimed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        user = await saveUser(newUser);
      }
    } finally {
      unlock();
    }
  } else if (user) {
    // Repeated /start commands must NEVER grant duplicate signup bonuses
    // User already exists; keep existing balance and profile intact.
  }

  if (!user) {
    user = await getUser(userId);
    if (!user) return;
  }

  const currentGen = settings.resetGeneration || 1;
  const isAlreadyClaimed = await hasUserClaimedSignupBonus(userId, currentGen);

  // 2. FOR UNCLAIMED USERS: Show the Scratch Card Welcome experience directly!
  // In the new flow, sponsor channel verification occurs AFTER scratching during the claim step, NOT before.
  if (!isAlreadyClaimed) {
    const scratchInfo = await getOrAssignSignupScratchBonus(userId);
    const maxBonus = settings.maxScratchSignupBonus || 10;
    const miniAppUrl = getMiniAppUrl(appUrl);

    // Clean up previous message if user repeated /start
    const prevSession = activeVerificationSessions.get(chatId);
    if (prevSession?.forceJoinMsgId) {
      await deleteTelegramMessage(chatId, prevSession.forceJoinMsgId).catch(() => {});
    }

    const welcomeTemplate = settings.templates?.welcomeMessage?.trim();
    const scratchWelcomeText = welcomeTemplate
      ? `${welcomeTemplate}\n\n🎁 <b>Scratch & Win — Up to ₹${maxBonus} Signup Bonus!</b>\n\n👇 Tap below to scratch your card:`
      : `🎁 <b>Welcome to Watch & Earn!</b>\n\n` +
        `💰 <b>Complete Tasks & Earn Rewards</b>\n` +
        `⚡ Simple Tasks • Exciting Rewards\n\n` +
        `🎁 <b>Scratch & Win — Up to ₹${maxBonus} Signup Bonus!</b>\n` +
        `Your exclusive Signup Scratch Card is ready with a guaranteed cash reward.\n\n` +
        `👇 Tap below to scratch your card:`;

    const scratchInlineKeyboard: any[][] = [];

    if (miniAppUrl) {
      scratchInlineKeyboard.push([
        {
          text: `🎁 Scratch & Win — Up to ₹${maxBonus}`,
          web_app: { url: miniAppUrl },
        },
      ]);
    } else {
      console.error(
        '[Mini App Configuration Error]: Missing or invalid HTTPS Mini App URL for Scratch & Win button. ' +
        'Telegram Web Apps strictly require an HTTPS domain URL.'
      );
    }

    const scratchKeyboard = {
      inline_keyboard: scratchInlineKeyboard,
    };

    const sent = await sendTelegramMessage(chatId, scratchWelcomeText, scratchKeyboard);
    let session = activeVerificationSessions.get(chatId);
    if (!session) {
      session = { incompleteMsgIds: new Set() };
      activeVerificationSessions.set(chatId, session);
    }
    if (sent.messageId) {
      session.forceJoinMsgId = sent.messageId;
    }
    return;
  }

  // 3. FOR CLAIMED USERS: Show Dashboard with current balance intact
  const prevSession = activeVerificationSessions.get(chatId);
  if (prevSession?.forceJoinMsgId) {
    await deleteTelegramMessage(chatId, prevSession.forceJoinMsgId).catch(() => {});
  }

  const welcomeText = `🚀 <b>Welcome to Watch & Earn!</b>\n\n💰 <b>Your Available Balance:</b> ₹${user.balance.toFixed(2)}\n🎁 <b>Signup Bonus:</b> Credited!\n\nEarn money by watching videos, visiting partner sites, and inviting friends!\nRedeem instant <b>Amazon Gift Cards</b> directly to your account anytime.`;

  const miniAppUrl = getMiniAppUrl(appUrl);

  const keyboardRows: any[][] = [];
  if (miniAppUrl) {
    keyboardRows.push([
      {
        text: '🎮 Open Watch & Earn Mini App',
        web_app: { url: miniAppUrl },
      },
    ]);
  }
  keyboardRows.push([
    {
      text: '👥 Invite Friends',
      url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || settings.botUsername || 'WatchVEarnBot')}?start=${user.referralCode}`)}&text=${encodeURIComponent('Join Watch & Earn and earn instant cash daily!')}`,
    },
    {
      text: '💬 Support',
      url: `https://t.me/${(settings.supportTelegramUsername || 'TeleEarnSupport').replace(/^@+/, '')}`,
    },
  ]);

  const keyboard = {
    inline_keyboard: keyboardRows,
  };

  const sent = await sendTelegramMessage(chatId, welcomeText, keyboard);
  let session = activeVerificationSessions.get(chatId);
  if (!session) {
    session = { incompleteMsgIds: new Set() };
    activeVerificationSessions.set(chatId, session);
  }
  if (sent.messageId) {
    session.forceJoinMsgId = sent.messageId;
  }
}

/**
 * Handle callback query from inline buttons (e.g., verify_channels)
 */
async function handleCallbackQuery(
  cb: NonNullable<TelegramUpdate['callback_query']>,
  appUrl: string
) {
  if (!cb.message) return;
  const chatId = cb.message.chat.id;
  const userId = cb.from.id;
  const triggeringMsgId = cb.message.message_id;

  if (cb.data === 'scratch_signup') {
    await answerTelegramCallback(cb.id, '🎁 Opening Scratch & Win in Mini App...');

    const settings = await getAppSettings();
    const maxBonus = settings.maxScratchSignupBonus || 10;
    const miniAppUrl = getMiniAppUrl(appUrl);

    if (miniAppUrl) {
      const inlineKeyboard: any[][] = [
        [
          {
            text: `🎁 Scratch & Win — Up to ₹${maxBonus}`,
            web_app: { url: miniAppUrl },
          },
        ],
      ];

      await sendTelegramMessage(
        chatId,
        `🎁 <b>Scratch & Win Inside Mini App</b>\n\n` +
        `Your Signup Scratch Card is ready! Tap below to scratch and reveal your guaranteed cash bonus inside the Mini App:\n\n` +
        `👇 Tap below to scratch your card:`,
        { inline_keyboard: inlineKeyboard }
      );
    }
    return;
  }

  if (cb.data === 'claim_scratch_bonus') {
    if (inFlightVerifications.has(userId)) {
      await answerTelegramCallback(cb.id, '⏳ Verification in progress...');
      return;
    }

    inFlightVerifications.add(userId);

    try {
      const settings = await getAppSettings();
      const currentGen = settings.resetGeneration || 1;
      const alreadyClaimed = await hasUserClaimedSignupBonus(userId.toString(), currentGen);

      if (alreadyClaimed) {
        await answerTelegramCallback(cb.id, '⚠️ Signup bonus already claimed!');
        const miniAppUrl = getMiniAppUrl(appUrl);
        const user = await getUser(userId.toString());
        const inlineKeyboard: any[][] = [];
        if (miniAppUrl) {
          inlineKeyboard.push([
            {
              text: '🎮 Open Watch & Earn Mini App',
              web_app: { url: miniAppUrl },
            },
          ]);
        }
        inlineKeyboard.push([
          {
            text: '👥 Invite Friends',
            url: `https://t.me/share/url?url=${encodeURIComponent(
              `https://t.me/${formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || settings.botUsername || 'WatchVEarnBot')}?start=${user?.referralCode || ''}`
            )}&text=${encodeURIComponent('Join Watch & Earn and earn instant cash daily!')}`,
          },
          {
            text: '💬 Support',
            url: `https://t.me/${(settings.supportTelegramUsername || 'TeleEarnSupport').replace(/^@+/, '')}`,
          },
        ]);
        await sendTelegramMessage(
          chatId,
          `ℹ️ You have already claimed your Signup Bonus!\n\n👇 Tap below to explore tasks and earn more:`,
          inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined
        );
        return;
      }

      // Check live channel membership with Telegram Bot API getChatMember
      const channels = await getForceJoinChannels(true);
      let allJoined = true;
      const stillUnjoined: Array<{ channel: typeof channels[0]; error?: string; status?: string }> = [];

      for (const ch of channels) {
        if (ch.healthStatus === 'bot_not_member' || ch.healthStatus === 'chat_not_found') {
          continue;
        }
        const rawId = (ch.channelId || ch.username || '').trim();
        const check = await checkTelegramChannelMembership(rawId, userId);
        if (
          check.status === 'bot_not_member' ||
          check.diagnostic === 'bot_not_member' ||
          (check.error && check.error.toLowerCase().includes('bot is not a member'))
        ) {
          updateChannelHealth(ch.id, 'bot_not_member', check.error);
          console.warn(`[BotScratchClaim] Inaccessible channel ${rawId} (bot is not a member). Skipping check.`);
          continue;
        }
        if (!check.isMember) {
          allJoined = false;
          stillUnjoined.push({ channel: ch, error: check.error, status: check.status });
        }
      }

      const miniAppUrl = getMiniAppUrl(appUrl);

      if (!allJoined) {
        const scratchInfo = await getOrAssignSignupScratchBonus(userId.toString());
        await answerTelegramCallback(cb.id, '❌ Please join all sponsor channels first!');

        const inlineKeyboard: any[][] = [];
        stillUnjoined.forEach((item) => {
          const ch = item.channel;
          const joinUrl =
            (ch.inviteLink || '').trim() ||
            (ch.channelId?.startsWith('@') ? `https://t.me/${ch.channelId.replace('@', '')}` : '');
          if (joinUrl) {
            inlineKeyboard.push([{ text: `📢 Join ${ch.title}`, url: joinUrl }]);
          }
        });

        inlineKeyboard.push([
          {
            text: `✅ Verify & Claim ₹${scratchInfo.amount} Bonus`,
            callback_data: 'claim_scratch_bonus',
          },
        ]);
        if (miniAppUrl) {
          inlineKeyboard.push([
            {
              text: '🎮 Open Watch & Earn Mini App',
              web_app: { url: miniAppUrl },
            },
          ]);
        }

        const channelNotes = stillUnjoined
          .map((item, i) => `${i + 1}. <b>${item.channel.title}</b>${item.error ? `\n   <i>(${item.error})</i>` : ''}`)
          .join('\n');

        const messageText =
          `⚠️ <b>Channel Verification Incomplete!</b>\n\n` +
          `Your <b>₹${scratchInfo.amount}</b> bonus is reserved, but you must join all required sponsor channels:\n\n` +
          `${channelNotes}\n\n` +
          `Please join the channel(s) above, then tap <b>Verify & Claim</b>.`;

        await sendTelegramMessage(chatId, messageText, { inline_keyboard: inlineKeyboard });
        return;
      }

      // All channels verified! Atomically claim signup bonus
      const claimResult = await atomicClaimSignupBonus({
        userId: userId.toString(),
        telegramId: userId,
      });

      if (!claimResult.success) {
        await answerTelegramCallback(cb.id, `⚠️ ${claimResult.reason || 'Could not claim bonus'}`);
        return;
      }

      const creditedAmount = claimResult.amount || 0;
      const userBalance = claimResult.user?.balance ?? creditedAmount;

      await answerTelegramCallback(cb.id, `🎉 ₹${creditedAmount} Credited to Your Balance!`);

      // Mark user forceJoinVerified
      let user = await getUser(userId.toString());
      if (user && !user.forceJoinVerified) {
        user.forceJoinVerified = true;
        await saveUser(user);
      }

      // Send success message with Open Mini App button (requirement 7)
      const successText =
        `🎉 <b>Signup Bonus Successfully Claimed!</b>\n\n` +
        `✅ <b>+₹${creditedAmount}</b> has been credited to your balance!\n` +
        `💰 <b>Available Balance:</b> ₹${userBalance.toFixed(2)}\n\n` +
        `👇 Tap below to launch the Mini App and start completing tasks:`;

      const successKeyboard: any[][] = [];
      if (miniAppUrl) {
        successKeyboard.push([
          {
            text: '🎮 Open Watch & Earn Mini App',
            web_app: { url: miniAppUrl },
          },
        ]);
      }
      successKeyboard.push([
        {
          text: '👥 Invite Friends (+₹10)',
          url: `https://t.me/share/url?url=${encodeURIComponent(
            `https://t.me/${formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || settings.botUsername || 'WatchVEarnBot')}?start=${user?.referralCode || ''}`
          )}&text=${encodeURIComponent('Join Watch & Earn and earn instant cash daily!')}`,
        },
        {
          text: '💬 Support',
          url: `https://t.me/${(settings.supportTelegramUsername || 'TeleEarnSupport').replace(/^@+/, '')}`,
        },
      ]);

      await sendTelegramMessage(chatId, successText, {
        inline_keyboard: successKeyboard,
      });
    } finally {
      inFlightVerifications.delete(userId);
    }
    return;
  }

  if (cb.data === 'verify_channels') {
    // 1. Prevent duplicate concurrent runs when user taps repeatedly
    if (inFlightVerifications.has(userId)) {
      await answerTelegramCallback(cb.id, '⏳ Verification in progress...');
      return;
    }

    // Always check live channel membership with Telegram Bot API getChatMember
    // Never trust previously saved verification status without rechecking live membership
    inFlightVerifications.add(userId);

    try {
      const channels = await getForceJoinChannels(true);
      let allJoined = true;
      const stillUnjoined: Array<{ channel: typeof channels[0]; error?: string; status?: string }> = [];

      for (const ch of channels) {
        if (ch.healthStatus === 'bot_not_member' || ch.healthStatus === 'chat_not_found') {
          continue;
        }
        const rawId = (ch.channelId || ch.username || '').trim();
        const check = await checkTelegramChannelMembership(rawId, userId);
        if (
          check.status === 'bot_not_member' ||
          check.diagnostic === 'bot_not_member' ||
          (check.error && check.error.toLowerCase().includes('bot is not a member'))
        ) {
          updateChannelHealth(ch.id, 'bot_not_member', check.error);
          console.warn(`[BotScratchClaim] Inaccessible channel ${rawId} (bot is not a member). Skipping check.`);
          continue;
        }
        if (!check.isMember) {
          allJoined = false;
          stillUnjoined.push({ channel: ch, error: check.error, status: check.status });
        }
      }

      if (!allJoined) {
        // User has left or not joined all required channels: revoke verified status
        let user = await getUser(userId.toString());
        if (user && user.forceJoinVerified) {
          user.forceJoinVerified = false;
          await saveUser(user);
        }

        const settings = await getAppSettings();
        const currentBotName = formatBotUsername(settings.botUsername || process.env.TELEGRAM_BOT_USERNAME || 'WatchVEarnBot');

        const botErrors = stillUnjoined.filter(
          (item) => item.status === 'chat_not_found' || item.status === 'bot_not_admin'
        );

        if (botErrors.length > 0) {
          const firstErr = botErrors[0];
          await answerTelegramCallback(
            cb.id,
            `⚠️ Bot Access Issue: @${currentBotName} is not an Admin in ${firstErr.channel.channelId || firstErr.channel.title}`
          );
        } else {
          await answerTelegramCallback(
            cb.id,
            '❌ Verification Incomplete! Please join the required channels.'
          );
        }

        // Remove previous incomplete messages from the same verification flow where possible
        const session = activeVerificationSessions.get(chatId);
        if (session) {
          for (const oldMsgId of session.incompleteMsgIds) {
            if (oldMsgId !== triggeringMsgId) {
              await deleteTelegramMessage(chatId, oldMsgId).catch(() => {});
            }
          }
          session.incompleteMsgIds.clear();
        }

        const inlineKeyboard: any[][] = [];
        stillUnjoined.forEach((item) => {
          const ch = item.channel;
          const joinUrl =
            (ch.inviteLink || '').trim() ||
            (ch.channelId?.startsWith('@') ? `https://t.me/${ch.channelId.replace('@', '')}` : '');
          if (joinUrl) {
            inlineKeyboard.push([{ text: `📢 Join ${ch.title}`, url: joinUrl }]);
          }
        });
        inlineKeyboard.push([{ text: '✅ I Have Joined (Verify Now)', callback_data: 'verify_channels' }]);

        let messageText = '';
        if (botErrors.length > 0) {
          const botErrorNotes = botErrors
            .map(
              (item, i) =>
                `${i + 1}. <b>${item.channel.title}</b> (<code>${item.channel.channelId}</code>)\n   <i>${item.error}</i>`
            )
            .join('\n\n');
          messageText = `⚠️ <b>Bot Permission Notice</b>\n\n@${currentBotName} cannot check members in the following channel(s):\n\n${botErrorNotes}\n\n👉 <b>If you are the admin:</b> Please add @${currentBotName} to the channel as an Administrator with 'View members' permissions.\n👉 <b>If you are a user:</b> Please contact support to resolve this issue.`;
        } else {
          const channelNotes = stillUnjoined
            .map((item, i) => `${i + 1}. <b>${item.channel.title}</b>${item.error ? `\n   <i>(${item.error})</i>` : ''}`)
            .join('\n');
          messageText = `⚠️ <b>Verification Incomplete!</b>\n\nYou still haven't joined all required channels:\n\n${channelNotes}\n\nPlease join them and try again.`;
        }

        const sentIncomplete = await sendTelegramMessage(chatId, messageText, { inline_keyboard: inlineKeyboard });

        if (sentIncomplete.messageId) {
          let curSession = activeVerificationSessions.get(chatId);
          if (!curSession) {
            curSession = { incompleteMsgIds: new Set() };
            activeVerificationSessions.set(chatId, curSession);
          }
          curSession.incompleteMsgIds.add(sentIncomplete.messageId);
        }
        return;
      }

      // Verification successful!
      await answerTelegramCallback(cb.id, '✅ Channels Verified!');

      // Update user in DB
      let user = await getUser(userId.toString());
      if (user) {
        user.forceJoinVerified = true;
        await saveUser(user);
      }

      // Cleanup old joining messages:
      // A. Delete the message that had the Verify button
      if (triggeringMsgId) {
        await deleteTelegramMessage(chatId, triggeringMsgId).catch(() => {});
      }

      // B. Delete the initial force-join message and previous verification-incomplete messages
      const session = activeVerificationSessions.get(chatId);
      if (session) {
        if (session.forceJoinMsgId && session.forceJoinMsgId !== triggeringMsgId) {
          await deleteTelegramMessage(chatId, session.forceJoinMsgId).catch(() => {});
        }
        for (const msgId of session.incompleteMsgIds) {
          if (msgId !== triggeringMsgId) {
            await deleteTelegramMessage(chatId, msgId).catch(() => {});
          }
        }
        activeVerificationSessions.delete(chatId);
      }

      // C. Send clean success message with Launch Mini App button
      const miniAppUrl = getMiniAppUrl(appUrl);
      const settings = await getAppSettings();
      const successText = `✅ <b>Channels Verified!</b>\n\n🎉 Your account is unlocked.\n💰 Explore tasks and earn rewards!\n\n👇 Tap below to launch the Mini App.`;

      const verifyKeyboard: any[][] = [];
      if (miniAppUrl) {
        verifyKeyboard.push([
          {
            text: '🎮 Launch Watch & Earn Mini App',
            web_app: { url: miniAppUrl },
          },
        ]);
      }
      verifyKeyboard.push([
        {
          text: '👥 Invite Friends',
          url: `https://t.me/share/url?url=${encodeURIComponent(
            `https://t.me/${formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || settings.botUsername || 'WatchVEarnBot')}?start=${user?.referralCode || ''}`
          )}&text=${encodeURIComponent('Join Watch & Earn and earn instant cash daily!')}`,
        },
        {
          text: '💬 Support',
          url: `https://t.me/${(settings.supportTelegramUsername || 'TeleEarnSupport').replace(/^@+/, '')}`,
        },
      ]);

      await sendTelegramMessage(
        chatId,
        successText,
        verifyKeyboard.length > 0 ? { inline_keyboard: verifyKeyboard } : undefined
      );
    } finally {
      inFlightVerifications.delete(userId);
    }
  }
}

async function handleHelpCommand(chatId: number, appUrl: string) {
  const miniAppUrl = getMiniAppUrl(appUrl);
  const helpText = `📖 <b>TeleEarn Help & Commands</b>\n\n• /start - Launch bot and open dashboard\n• /balance - Check current cash balance\n• /help - View this help menu\n\n<b>How to Earn:</b>\n1. Open the Mini App\n2. Complete Watch & Earn tasks\n3. Claim Daily Check-In\n4. Share your referral link for +₹25 per friend!\n5. Redeem instant Amazon Gift Cards once you reach the minimum balance.`;
  const helpKeyboard: any[][] = [];
  if (miniAppUrl) {
    helpKeyboard.push([
      {
        text: '🎮 Open Watch & Earn Mini App',
        web_app: { url: miniAppUrl },
      },
    ]);
  }
  await sendTelegramMessage(
    chatId,
    helpText,
    helpKeyboard.length > 0 ? { inline_keyboard: helpKeyboard } : undefined
  );
}

async function handleBalanceCommand(telegramId: number, chatId: number, appUrl: string) {
  const user = (await getUserByTelegramId(telegramId)) || (await getUser(telegramId.toString()));
  if (!user) {
    await sendTelegramMessage(chatId, '❌ Account not found. Type /start to register.');
    return;
  }

  const text = `💰 <b>Account Summary</b>\n\n• Available Balance: <b>₹${user.balance.toFixed(2)}</b>\n• Lifetime Earnings: <b>₹${user.lifetimeEarnings.toFixed(2)}</b>\n• Referral Earnings: <b>₹${user.referralEarnings.toFixed(2)}</b>\n• Daily Streak: <b>${user.dailyStreak} days</b>`;
  await sendTelegramMessage(chatId, text);
}

async function handleReferralCommand(telegramId: number, chatId: number, appUrl: string) {
  const user = (await getUserByTelegramId(telegramId)) || (await getUser(telegramId.toString()));
  const settings = await getAppSettings();
  if (!user) {
    await sendTelegramMessage(chatId, '❌ Account not found. Type /start to register.');
    return;
  }

  const botUsername = formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || settings.botUsername || 'WatchVEarnBot');
  const refLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
  const text = `👥 <b>Referral Program</b>\n\nShare your link with friends to earn <b>+₹${settings.referralReward}</b> for every friend that joins!\n\n🔗 <b>Your Invite Link:</b>\n<code>${refLink}</code>\n\n💰 <b>Total Referral Earnings:</b> ₹${user.referralEarnings.toFixed(2)}`;
  
  await sendTelegramMessage(chatId, text, {
    inline_keyboard: [
      [
        {
          text: '📤 Share Link',
          url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join TeleEarn and earn real cash daily!')}`,
        },
      ],
    ],
  });
}

async function handleTasksCommand(chatId: number, appUrl: string) {
  const miniAppUrl = getMiniAppUrl(appUrl);
  const text = `🎯 <b>Watch & Earn Tasks</b>\n\nComplete quick video and visit tasks directly in the Mini App to earn instant cash!\n\nTap below to start earning now:`;
  const taskKeyboard: any[][] = [];
  if (miniAppUrl) {
    taskKeyboard.push([
      {
        text: '🚀 Open Tasks in Mini App',
        web_app: { url: `${miniAppUrl}#tasks` },
      },
    ]);
  }
  await sendTelegramMessage(
    chatId,
    text,
    taskKeyboard.length > 0 ? { inline_keyboard: taskKeyboard } : undefined
  );
}
