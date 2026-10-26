import crypto from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import {
  getUser,
  getUserByTelegramId,
  saveUser,
  getAppSettings,
  updateAppSettings,
  getAllTasks,
  getTaskById,
  saveTask,
  deleteTask,
  getAllTaskBots,
  getTaskBotById,
  saveTaskBot,
  deleteTaskBot,
  checkDeviceDuplicate,
  registerDeviceFingerprint,
  getTaskCompletion,
  getUserCompletedTaskIds,
  recordTaskCompletion,
  atomicCreditBalance,
  getUserTransactions,
  getReferralsByReferrer,
  createWithdrawalRequest,
  redeemGiftCardWithdrawal,
  getAllGiftCardCodes,
  getGiftCardInventoryStats,
  getGiftCardAuditReport,
  addGiftCardCodes,
  invalidateGiftCardCode,
  deleteGiftCardCode,
  getUserWithdrawals,
  getAllWithdrawals,
  updateWithdrawalStatus,
  getForceJoinChannels,
  saveForceJoinChannel,
  deleteForceJoinChannel,
  getDashboardStats,
  getTotalRegisteredUsersCount,
  recordAdminAudit,
  getAdminAuditLogs,
  searchUsers,
  getUserByReferralCode,
  atomicClaimSignupBonus,
  atomicClaimReferralReward,
  acquireLock,
  getBulkBalanceResetPreview,
  atomicResetAllUserBalances,
  getMandatoryWithdrawalChannels,
  verifyMandatoryWithdrawalMembership,
  getMandatoryCheckinChannels,
  verifyMandatoryCheckinMembership,
  getOrAssignSignupScratchBonus,
  hasUserClaimedSignupBonus,
  checkWithdrawalReferralEligibility,
  getValidReferralCount,
  getOrRegisterDeviceOwner,
  isDeviceRestrictedForUser,
  DB_PREFIX,
  getDbPrefix,
} from './db.ts';
import {
  startBroadcast,
  getBroadcastPreview,
  getBroadcastStatus,
  getLatestBroadcast,
  cancelBroadcast,
} from './broadcast.ts';
import {
  verifySignedDeviceToken,
  computeDeviceFingerprintHash,
  checkIpRateLimit,
} from './deviceAuth.ts';
import {
  verifyTelegramInitData,
  checkTelegramChannelMembership,
  checkBotChannelAccess,
  formatChannelIdentifier,
  isTelegramAdmin,
  setTelegramWebhook,
  deleteTelegramWebhook,
  getTelegramBotStatus,
  formatBotUsername,
} from './telegram.ts';
import {
  validateUpiId,
  payoutGateway,
} from './payoutAdapter.ts';
import {
  getPublicGatewayConfig,
  saveGatewayConfig,
  removeGatewayCredentials,
  getStoredGatewayConfig,
  maskSecret,
} from './paymentSecurity.ts';
import {
  notifyAdminNewWithdrawal,
  broadcastPayoutProof,
  notifyUserWithdrawalResult,
} from './payoutBot.ts';
import {
  handleTelegramBotUpdate,
  startBotPolling,
  stopBotPolling,
  getBotPollingStatus,
} from './bot.ts';
import {
  getGamificationSettings,
  getUserGamificationState,
  executeSpinWheel,
  grantReferralScratchCard,
  revealScratchCard,
  getGamificationStats,
  checkAndTriggerReferralScratchCard,
} from './gamification.ts';
import {
  verifyChannelTask,
  verifyVideoTask,
  verifyWebsiteTask,
  verifySocialTask,
  TaskVerificationResult,
} from './taskVerification.ts';
import type { UserProfile, Task, TaskBot, ForceJoinChannel, AppSettings } from '../src/types/index.ts';

export const apiRouter = Router();

// Store active task timers in memory to prevent instant-click exploitation
// Key: `${userId}_${taskId}`, Value: start timestamp
const taskStartTimestamps = new Map<string, number>();

/**
 * Authentication Middleware: extracts & validates Telegram user from header
 */
async function extractTelegramUser(req: Request, res: Response, next: NextFunction) {
  const initData = (req.headers['x-telegram-init-data'] as string) || (req.query.initData as string);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const hasLiveBot = Boolean(botToken && !botToken.includes('ABCdefGHIjklMNOpqrSTUvwxYZ'));

  if (!initData) {
    // In preview mode or when running inside iframe without full Telegram wrapper,
    // allow testing with demo mode user header
    const mockUserId = req.headers['x-mock-user-id'] as string;
    if (mockUserId) {
      if (hasLiveBot && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Missing Telegram authentication (x-telegram-init-data)' });
      }
      const user = await getUser(mockUserId);
      if (user) {
        if (user.isBanned) {
          return res.status(403).json({ error: 'Your account is suspended. Contact support.' });
        }
        (req as any).user = user;
        (req as any).isAdmin = isTelegramAdmin(user.telegramId) && !hasLiveBot;
        (req as any).isSimulatedAuth = true;
        return next();
      }
    }
    return res.status(401).json({ error: 'Missing Telegram authentication (x-telegram-init-data)' });
  }

  const result = verifyTelegramInitData(initData);
  if (!result.isValid || !result.user) {
    return res.status(401).json({ error: result.error || 'Invalid Telegram initData signature' });
  }

  let user = (await getUserByTelegramId(result.user.id)) || (await getUser(result.user.id.toString()));
  if (!user) {
    const unlock = await acquireLock(`reg_${result.user.id}`, 5000);
    try {
      user = (await getUserByTelegramId(result.user.id)) || (await getUser(result.user.id.toString()));
      if (!user) {
        // Provision user if not yet in database
        const settings = await getAppSettings();
        const newUser: UserProfile = {
          id: result.user.id.toString(),
          telegramId: result.user.id,
          username: result.user.username || '',
          firstName: result.user.first_name || 'Telegram User',
          lastName: result.user.last_name || '',
          photoUrl: result.user.photo_url || '',
          balance: 0,
          lifetimeEarnings: 0,
          referralEarnings: 0,
          referralCode: `ref_${result.user.id}_${Math.random().toString(36).substring(2, 6)}`,
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
  }

  if (user.isBanned) {
    return res.status(403).json({ error: 'Your account is suspended. Contact support.' });
  }

  (req as any).user = user;
  (req as any).isAdmin = isTelegramAdmin(user.telegramId) && (!hasLiveBot || !result.isSimulated);
  (req as any).isSimulatedAuth = result.isSimulated;
  next();
}

/**
 * Admin Access Gate
 */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as UserProfile;
  const isSimulated = Boolean((req as any).isSimulatedAuth);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const hasLiveBot = Boolean(botToken && !botToken.includes('ABCdefGHIjklMNOpqrSTUvwxYZ'));

  if (!user || !(req as any).isAdmin || !isTelegramAdmin(user.telegramId)) {
    return res.status(403).json({
      error: 'Access denied: You are not authorized as an administrator for this bot.',
    });
  }

  // Deny simulated admin operations when live bot credentials are configured
  if (hasLiveBot && isSimulated) {
    return res.status(403).json({
      error: 'Access denied: Admin operations require verified Telegram client credentials.',
    });
  }

  next();
}

/**
 * Middleware: Enforces that the user currently belongs to all active force-join channels.
 * Always checks LIVE membership using Telegram Bot API getChatMember.
 * Never trusts stale or cached verification status.
 */
async function requireLiveChannelMembership(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as UserProfile;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized user' });
  }

  // Administrators bypass force-join requirement
  if (isTelegramAdmin(user.telegramId)) {
    return next();
  }

  const channels = await getForceJoinChannels(true);
  if (channels.length === 0) {
    return next();
  }

  const unjoined: ForceJoinChannel[] = [];
  for (const ch of channels) {
    const check = await checkTelegramChannelMembership(ch.channelId, user.telegramId);
    if (!check.isMember) {
      unjoined.push(ch);
    }
  }

  if (unjoined.length > 0) {
    // If user was previously marked verified, revoke it in DB immediately
    if (user.forceJoinVerified) {
      user.forceJoinVerified = false;
      await saveUser(user);
    }
    return res.status(403).json({
      error: 'Verification Incomplete! You have left one or more required channels. Please rejoin to access this feature.',
      forceJoinRequired: true,
      unjoinedChannels: unjoined,
    });
  }

  // User is currently a verified member of all channels
  if (!user.forceJoinVerified) {
    user.forceJoinVerified = true;
    await saveUser(user);
  }

  next();
}

/* ========================================================
   SYSTEM & HEALTH ENDPOINTS
   ======================================================== */
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')),
    botUsername: formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || 'WatchXEarnBot'),
    database: 'Firebase Firestore',
    dbPrefix: getDbPrefix() || '(default)',
    isolatedNamespace: Boolean(getDbPrefix() || process.env.FIRESTORE_DATABASE_ID || process.env.FIREBASE_PROJECT_ID),
  });
});

apiRouter.get('/config', async (req, res) => {
  try {
    const settings = await getAppSettings();
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   AUTHENTICATION & USER ENDPOINTS
   ======================================================== */
apiRouter.post('/auth/verify-telegram', async (req, res) => {
  try {
    const { initData, refCode, deviceToken, deviceFingerprint } = req.body;
    if (!initData) {
      return res.status(400).json({ error: 'Missing initData in request payload' });
    }

    const verification = verifyTelegramInitData(initData);
    if (!verification.isValid || !verification.user) {
      return res.status(401).json({ error: verification.error || 'Invalid initData' });
    }

    const tgUser = verification.user;
    const userId = tgUser.id.toString();
    const settings = await getAppSettings();

    // 1. Verify or issue server-signed device token
    const deviceVerification = verifySignedDeviceToken(deviceToken);
    const deviceId = deviceVerification.deviceId;
    const fingerprintHash = computeDeviceFingerprintHash(deviceFingerprint);

    // 2. IP Rate Limit & network hashing (without treating shared IP as proof of fraud)
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const clientIp = rawIp.replace(/^::ffff:/, '');
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 16);
    const ipCheck = checkIpRateLimit(clientIp);
    if (ipCheck.isRateLimited) {
      await recordAdminAudit(
        'ANTI_ABUSE_RATE_LIMIT',
        'IP_SIGNUP_VELOCITY_HIGH',
        `High velocity signups (${ipCheck.currentCount} attempts) from IP hash ${ipHash}. Monitoring.`,
        userId
      );
    }

    let user = (await getUserByTelegramId(tgUser.id)) || (await getUser(userId));
    const isNew = !user;

    // 3. Secure Referral Code Capture & Validation
    let inviterUser: UserProfile | null = null;
    if (refCode && typeof refCode === 'string') {
      const cleanRefCode = refCode.trim();
      inviterUser = await getUserByReferralCode(cleanRefCode);
      // Strictly prevent self-referral
      if (inviterUser && (inviterUser.id === userId || (inviterUser.telegramId && inviterUser.telegramId === tgUser.id))) {
        inviterUser = null;
      }
    }

    if (isNew) {
      const unlock = await acquireLock(`reg_${tgUser.id}`, 5000);
      try {
        user = (await getUserByTelegramId(tgUser.id)) || (await getUser(userId));
        if (!user) {
          // Generate guaranteed collision-resistant unique referral code
          const uniqueSuffix = crypto.randomBytes(3).toString('hex');
          const referralCode = `ref_${tgUser.id}_${uniqueSuffix}`;

          const newUser: UserProfile = {
            id: userId,
            telegramId: tgUser.id,
            username: tgUser.username || '',
            firstName: tgUser.first_name || 'Telegram User',
            lastName: tgUser.last_name || '',
            photoUrl: tgUser.photo_url || '',
            balance: 0,
            lifetimeEarnings: 0,
            referralEarnings: 0,
            referralCode,
            referredBy: inviterUser ? inviterUser.id : null,
            dailyStreak: 0,
            isBanned: false,
            deviceId,
            deviceFingerprint: fingerprintHash,
            ipHash,
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
      // Update profile info while strictly preserving immutable referral attribution
      const updatedUser: UserProfile = {
        ...user,
        username: tgUser.username || user.username || '',
        firstName: tgUser.first_name || user.firstName || 'Telegram User',
        lastName: tgUser.last_name || user.lastName || '',
        photoUrl: tgUser.photo_url || user.photoUrl || '',
        deviceId: user.deviceId || deviceId,
      };

      // If user had no referrer previously and provided a valid non-self referral code
      if (!updatedUser.referredBy && inviterUser && inviterUser.id !== userId) {
        updatedUser.referredBy = inviterUser.id;
      }

      user = await saveUser(updatedUser);
    }

    if (!user) {
      return res.status(500).json({ error: 'Failed to initialize user' });
    }

    // Register or verify device ownership on auth
    let deviceWarning: string | undefined;
    const deviceOwnerCheck = await getOrRegisterDeviceOwner(userId, tgUser.id, deviceId, fingerprintHash);
    if (!deviceOwnerCheck.isPrimaryAccount && deviceOwnerCheck.primaryUserId !== userId) {
      user.isDuplicateAccount = true;
      user.duplicateReason = '⚠️ Multiple accounts detected on this device. Rewards are restricted to the primary registered account.';
      user.primaryDeviceId = deviceOwnerCheck.primaryUserId;
      deviceWarning = user.duplicateReason;
      await saveUser(user);
    }

    // 4. Scratch Card Signup Bonus: Assign or retrieve pending scratch bonus without crediting balance
    let signupBonusMessage: string | undefined;
    let pendingBonus = user.pendingSignupBonus || 0;

    const currentGen = settings.resetGeneration || 1;
    const isClaimed = await hasUserClaimedSignupBonus(userId, currentGen);

    if (!isClaimed) {
      if (user.isDuplicateAccount) {
        pendingBonus = 0;
        signupBonusMessage = user.duplicateReason;
      } else {
        const scratchInfo = await getOrAssignSignupScratchBonus(userId);
        pendingBonus = scratchInfo.amount;
        user = (await getUser(userId)) || user;
        signupBonusMessage = `🎁 Scratch & Win up to ₹${scratchInfo.maxBonus} Signup Bonus!`;
      }
    }

    // 5. Atomic Referral Reward Claim for Inviter (with Device-Switching Abuse Prevention)
    const effectiveReferrerId = user.referredBy || (inviterUser ? inviterUser.id : null);
    if (effectiveReferrerId && settings.referralReward > 0) {
      await atomicClaimReferralReward({
        referrerId: effectiveReferrerId,
        refereeId: userId,
        refereeUsername: tgUser.username || tgUser.first_name,
        refereeDeviceId: deviceId,
        refereeFingerprintHash: fingerprintHash,
      });

      // Gamification: check and grant referral scratch card if condition is registration
      await checkAndTriggerReferralScratchCard(userId, 'registration').catch((err) =>
        console.warn('[Gamification] checkAndTriggerReferralScratchCard error:', err)
      );
    }

    registerDeviceFingerprint(userId, fingerprintHash, ipHash, deviceId);

    // Refresh user state
    user = (await getUser(userId)) || user;

    if (!user) {
      return res.status(500).json({ error: 'Failed to initialize user' });
    }

    // Check Force Join Status - Live membership verification
    const channels = await getForceJoinChannels(true);
    const unjoined: ForceJoinChannel[] = [];
    for (const ch of channels) {
      const check = await checkTelegramChannelMembership(ch.channelId, tgUser.id);
      if (!check.isMember) {
        unjoined.push(ch);
      }
    }

    const allJoined = unjoined.length === 0;
    if (user.forceJoinVerified !== allJoined) {
      user.forceJoinVerified = allJoined;
      await saveUser(user);
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const hasLiveBot = Boolean(botToken && !botToken.includes('ABCdefGHIjklMNOpqrSTUvwxYZ'));
    const isAdmin = isTelegramAdmin(user.telegramId) && (!hasLiveBot || !verification.isSimulated);

    res.json({
      success: true,
      user: {
        ...user,
        signupBonusClaimed: isClaimed,
      },
      deviceToken: deviceVerification.token,
      signupBonusMessage,
      deviceWarning,
      isAdmin,
      isSimulatedAuth: verification.isSimulated,
      forceJoinRequired: unjoined.length > 0,
      unjoinedChannels: unjoined,
      pendingSignupBonus: pendingBonus,
      maxScratchSignupBonus: settings.maxScratchSignupBonus || 10,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Assigns or retrieves the persistent scratch signup bonus amount.
 * Does not credit user balance.
 */
apiRouter.post('/auth/signup-scratch/assign', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const scratchCard = await getOrAssignSignupScratchBonus(user.id);
    res.json(scratchCard);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Authoritatively verifies force-join channels and claims the scratch signup bonus.
 * Credits exactly the assigned pending amount once all channels pass live verification.
 */
apiRouter.post('/auth/signup-scratch/claim', extractTelegramUser, async (req, res) => {
  const reqUser = (req as any).user as UserProfile;
  const user = (await getUser(reqUser.id)) || reqUser;
  const deviceId = (req.body?.deviceId as string) || user.deviceId;
  const fingerprintHash = (req.body?.deviceFingerprint as string) || user.deviceFingerprint;
  const ipHash = user.ipHash;

  const releaseLock = await acquireLock(`lock_claim_signup_${user.id}`);
  try {
    const settings = await getAppSettings();
    const currentGen = settings.resetGeneration || 1;

    // 1. Eligibility check: cannot claim twice
    const alreadyClaimed = await hasUserClaimedSignupBonus(user.id, currentGen);
    if (alreadyClaimed) {
      return res.status(400).json({
        error: 'Signup bonus has already been claimed by this account.',
      });
    }

    // 1B. Same-Device Anti-Abuse: Restrict signup bonus to primary account on device
    const deviceCheck = await isDeviceRestrictedForUser(user.id, deviceId, fingerprintHash);
    if (deviceCheck.restricted) {
      return res.status(403).json({
        error: deviceCheck.reason || '⚠️ Signup bonus is restricted to the primary account registered on this device.',
        isDeviceDuplicate: true,
      });
    }

    // 2. Mandatory Force-Join Membership Verification (FAIL CLOSED)
    const channels = await getForceJoinChannels(true);
    const unjoined: ForceJoinChannel[] = [];
    for (const ch of channels) {
      const check = await checkTelegramChannelMembership(ch.channelId, user.telegramId);
      if (!check.isMember) {
        if (
          check.status === 'api_error' ||
          check.status === 'bot_not_admin' ||
          check.status === 'chat_not_found' ||
          check.status === 'bot_token_missing'
        ) {
          return res.status(503).json({
            error:
              check.error ||
              `Telegram channel verification temporarily unavailable for ${ch.title}. Please retry in a moment.`,
            isApiError: true,
            unjoinedChannels: [ch],
          });
        }
        unjoined.push(ch);
      }
    }

    if (unjoined.length > 0) {
      return res.status(403).json({
        error: 'Please join all required channels before claiming your signup bonus.',
        forceJoinRequired: true,
        unjoinedChannels: unjoined,
      });
    }

    // 3. Atomically claim signup bonus
    const claimRes = await atomicClaimSignupBonus({
      userId: user.id,
      telegramId: user.telegramId,
      deviceId,
      fingerprintHash,
      ipHash,
    });

    if (!claimRes.success) {
      return res.status(400).json({
        error: claimRes.reason || claimRes.message || 'Unable to claim signup bonus.',
        isDeviceDuplicate: claimRes.isDeviceDuplicate,
      });
    }

    const freshUser = claimRes.user || (await getUser(user.id)) || user;

    // 4. Atomic Referral Reward Claim for Inviter (if referred)
    if (freshUser.referredBy && settings.referralReward > 0) {
      await atomicClaimReferralReward({
        referrerId: freshUser.referredBy,
        refereeId: freshUser.id,
        refereeUsername: freshUser.username || freshUser.firstName,
        refereeDeviceId: deviceId,
        refereeFingerprintHash: fingerprintHash,
      }).catch((err) => console.warn('[DB] Referral reward claim error:', err));
    }

    res.json({
      success: true,
      claimedAmount: claimRes.amount,
      newBalance: freshUser.balance,
      user: freshUser,
      message: `🎁 Successfully claimed ₹${claimRes.amount} signup bonus!`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseLock();
  }
});

apiRouter.get('/auth/me', extractTelegramUser, async (req, res) => {
  const user = (req as any).user as UserProfile;
  const isAdmin = (req as any).isAdmin as boolean;

  // Check channel status - Live membership verification
  const channels = await getForceJoinChannels(true);
  const unjoined: ForceJoinChannel[] = [];
  for (const ch of channels) {
    const check = await checkTelegramChannelMembership(ch.channelId, user.telegramId);
    if (!check.isMember) unjoined.push(ch);
  }

  const allJoined = unjoined.length === 0;
  if (user.forceJoinVerified !== allJoined) {
    user.forceJoinVerified = allJoined;
    await saveUser(user);
  }

  const settings = await getAppSettings();
  const currentGen = settings.resetGeneration || 1;
  const isClaimed = await hasUserClaimedSignupBonus(user.id, currentGen);

  res.json({
    user: {
      ...user,
      signupBonusClaimed: isClaimed,
    },
    isAdmin,
    forceJoinRequired: unjoined.length > 0,
    unjoinedChannels: unjoined,
    pendingSignupBonus: user.pendingSignupBonus || 0,
    maxScratchSignupBonus: settings.maxScratchSignupBonus || 10,
  });
});

/* ========================================================
   DAILY CHECK-IN REWARD
   ======================================================== */
apiRouter.post('/rewards/daily-checkin', extractTelegramUser, async (req, res) => {
  const reqUser = (req as any).user as UserProfile;
  const releaseLock = await acquireLock(`lock_daily_checkin_${reqUser.id}`);

  try {
    const user = (await getUser(reqUser.id)) || reqUser;
    const settings = await getAppSettings();

    const todayUTC = new Date().toISOString().split('T')[0];

    // 1. Check daily claim eligibility first
    if (user.lastDailyCheckIn === todayUTC) {
      return res.status(400).json({
        error: 'You have already claimed your daily check-in reward today! Return tomorrow.',
      });
    }

    // 1B. Enforce Same-Device Restriction: Daily Check-In is restricted to primary account
    const deviceCheck = await isDeviceRestrictedForUser(user.id, user.deviceId, user.deviceFingerprint);
    if (deviceCheck.restricted) {
      return res.status(403).json({
        error: deviceCheck.reason || '⚠️ Daily check-in rewards are restricted to the primary account registered on this device.',
        isDeviceDuplicate: true,
      });
    }

    // 2. Mandatory Telegram channel membership re-verification before claiming
    // Administrators bypass channel membership check
    if (!isTelegramAdmin(user.telegramId)) {
      const checkinVerification = await verifyMandatoryCheckinMembership(user.telegramId);
      if (!checkinVerification.isVerified) {
        if (checkinVerification.isApiError) {
          return res.status(503).json({
            error: checkinVerification.error,
            isApiError: true,
            unjoinedChannels: checkinVerification.unjoinedChannels || [],
          });
        }
        return res.status(403).json({
          error:
            checkinVerification.error ||
            'You have left one or more required channels. Please rejoin to claim your daily check-in reward.',
          forceJoinRequired: true,
          unjoinedChannels: checkinVerification.unjoinedChannels || [],
        });
      }
    }

    // 3. 7-day repeating cycle streak calculation (Day 1 -> Day 7 -> Day 1)
    let streak = 1;
    if (user.lastDailyCheckIn) {
      const lastDate = new Date(user.lastDailyCheckIn);
      const todayDate = new Date(todayUTC);
      const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
      if (diffDays === 1) {
        const prevStreak = user.dailyStreak || 0;
        // After Day 7, roll over to Day 1
        streak = prevStreak >= 7 ? 1 : prevStreak + 1;
      }
    }

    // 4. Configurable reward difference calculation
    const diff =
      typeof settings.dailyCheckinRewardDifference === 'number' && settings.dailyCheckinRewardDifference > 0
        ? settings.dailyCheckinRewardDifference
        : 2;
    const bonus = (streak - 1) * diff;
    const reward = settings.dailyCheckinBaseReward + bonus;

    // 5. Credit balance atomically first
    const result = await atomicCreditBalance(
      user.id,
      reward,
      'daily_checkin',
      `Daily Check-In Reward (Day ${streak} Streak bonus: +₹${bonus})`
    );

    // 6. Only after balance credit succeeds, save user checkin state
    result.user.lastDailyCheckIn = todayUTC;
    result.user.dailyStreak = streak;
    await saveUser(result.user);

    res.json({
      success: true,
      rewardAmount: reward,
      streak,
      newBalance: result.user.balance,
      message: `Claimed ₹${reward} coins for Day ${streak}!`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseLock();
  }
});

/* ========================================================
   WATCH & EARN TASKS
   ======================================================== */
apiRouter.get('/tasks', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const tasks = await getAllTasks(true);
    const completedIds = await getUserCompletedTaskIds(user.id);

    const list = tasks.map((t) => ({
      ...t,
      completed: completedIds.has(t.id),
    }));

    res.json({ tasks: list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/tasks/start', extractTelegramUser, requireLiveChannelMembership, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    const task = await getTaskById(taskId);
    if (!task || !task.isActive) return res.status(404).json({ error: 'Task not found or inactive' });

    const completion = await getTaskCompletion(user.id, taskId);
    if (completion) return res.status(400).json({ error: 'Task already completed' });

    // Store starting timestamp on server
    const sessionKey = `${user.id}_${taskId}`;
    taskStartTimestamps.set(sessionKey, Date.now());

    res.json({
      success: true,
      timerSeconds: task.timerSeconds,
      startedAt: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/tasks/complete', extractTelegramUser, requireLiveChannelMembership, async (req, res) => {
  const user = (req as any).user as UserProfile;
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });

  const lockKey = `lock_task_claim_${user.id}_${taskId}`;
  const releaseLock = await acquireLock(lockKey);

  try {
    const task = await getTaskById(taskId);
    if (!task || !task.isActive) return res.status(404).json({ error: 'Task not found or inactive' });

    // Enforce Same-Device Restriction: Task completion rewards are restricted to primary account
    const deviceCheck = await isDeviceRestrictedForUser(user.id, user.deviceId, user.deviceFingerprint);
    if (deviceCheck.restricted) {
      return res.status(403).json({
        error: deviceCheck.reason || '⚠️ Task completion rewards are restricted to the primary account registered on this device.',
        isDeviceDuplicate: true,
      });
    }

    // Idempotency: verify user has not already claimed this task
    const existingComp = await getTaskCompletion(user.id, taskId);
    if (existingComp) {
      return res.status(400).json({ error: 'You have already received rewards for this task.' });
    }

    const sessionKey = `${user.id}_${taskId}`;
    const startedAt = taskStartTimestamps.get(sessionKey);

    // Distinct verification handler execution per task type
    let verifyRes: TaskVerificationResult;
    switch (task.taskType) {
      case 'channel':
        verifyRes = await verifyChannelTask(user, task);
        break;
      case 'video':
        verifyRes = await verifyVideoTask(user, task, startedAt);
        break;
      case 'website':
        verifyRes = await verifyWebsiteTask(user, task, startedAt);
        break;
      case 'social':
        verifyRes = await verifySocialTask(user, task, req.body, startedAt);
        break;
      case 'bot':
        verifyRes = { success: true };
        break;
      default:
        verifyRes = { success: false, error: `Unsupported task type: ${task.taskType}` };
    }

    if (!verifyRes.success) {
      return res.status(400).json({ error: verifyRes.error || 'Task verification failed' });
    }

    // If manual review is required for social tasks
    if (verifyRes.pendingReview) {
      taskStartTimestamps.delete(sessionKey);
      return res.json({
        success: true,
        pendingReview: true,
        message: verifyRes.message || 'Task submitted for manual review.',
      });
    }

    // Record completion in DB
    const completionId = `${user.id}_${taskId}`;
    await recordTaskCompletion({
      id: completionId,
      userId: user.id,
      taskId,
      rewardAmount: task.rewardAmount,
      completedAt: new Date().toISOString(),
    });

    taskStartTimestamps.delete(sessionKey);

    // Credit balance atomically (server-authoritative task.rewardAmount)
    const credResult = await atomicCreditBalance(
      user.id,
      task.rewardAmount,
      'task_reward',
      `Completed Task: ${task.title}`,
      taskId
    );

    // Gamification Hook: Check if referrer unlocked a scratch card via referee task completion
    await checkAndTriggerReferralScratchCard(user.id, 'task_completion').catch((err) =>
      console.warn('[Gamification] Task complete referral check error:', err)
    );

    // Get updated gamification state (spins earned/available)
    const gamState = await getUserGamificationState(user.id);

    res.json({
      success: true,
      rewardAmount: task.rewardAmount,
      newBalance: credResult.user.balance,
      gamification: {
        completedTasksCount: gamState.completedTasksCount,
        availableSpins: gamState.availableSpins,
        canSpinNow: gamState.canSpinNow,
        tasksRequiredPerSpin: gamState.tasksRequiredPerSpin,
        progressToNextSpin: gamState.progressToNextSpin,
      },
      message: `Task completed! +₹${task.rewardAmount} coins added to your balance.${
        gamState.canSpinNow ? ' 🎡 You earned a Lucky Spin!' : ''
      }`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseLock();
  }
});

/* ========================================================
   TASK BOTS (PRD Task Bot Management)
   ======================================================== */
apiRouter.get('/task-bots', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const bots = await getAllTaskBots(true);
    const completedIds = await getUserCompletedTaskIds(user.id);

    const list = bots.map((b) => ({
      ...b,
      completed: completedIds.has(`bot_${b.id}`),
    }));

    res.json({ bots: list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/task-bots/:id/start', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const bot = await getTaskBotById(req.params.id);
    if (!bot || !bot.isEnabled) return res.status(404).json({ error: 'Task Bot not found or disabled' });

    const completion = await getTaskCompletion(user.id, `bot_${bot.id}`);
    if (completion) return res.status(400).json({ error: 'You have already completed this Task Bot reward' });

    taskStartTimestamps.set(`${user.id}_bot_${bot.id}`, Date.now());

    res.json({
      success: true,
      botUrl: bot.botUrl,
      startedAt: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/task-bots/:id/complete', extractTelegramUser, async (req, res) => {
  const user = (req as any).user as UserProfile;
  const botId = req.params.id;
  const lockKey = `lock_bot_claim_${user.id}_${botId}`;
  const releaseLock = await acquireLock(lockKey);

  try {
    const bot = await getTaskBotById(botId);
    if (!bot || !bot.isEnabled) return res.status(404).json({ error: 'Task Bot not found or disabled' });

    // Enforce Same-Device Restriction: Task Bot rewards are restricted to primary account
    const deviceCheck = await isDeviceRestrictedForUser(user.id, user.deviceId, user.deviceFingerprint);
    if (deviceCheck.restricted) {
      return res.status(403).json({
        error: deviceCheck.reason || '⚠️ Task rewards are restricted to the primary account registered on this device.',
        isDeviceDuplicate: true,
      });
    }

    const existingComp = await getTaskCompletion(user.id, `bot_${bot.id}`);
    if (existingComp) return res.status(400).json({ error: 'You have already received rewards for this Task Bot' });

    // Record completion in DB
    const completionId = `${user.id}_bot_${bot.id}`;
    await recordTaskCompletion({
      id: completionId,
      userId: user.id,
      taskId: `bot_${bot.id}`,
      rewardAmount: bot.rewardAmount,
      completedAt: new Date().toISOString(),
    });

    taskStartTimestamps.delete(`${user.id}_bot_${bot.id}`);

    // Credit balance atomically
    const credResult = await atomicCreditBalance(
      user.id,
      bot.rewardAmount,
      'task_reward',
      `Completed Task Bot: ${bot.botName}`,
      bot.id
    );

    // Gamification Hook: Check if referrer unlocked a scratch card via referee task completion
    await checkAndTriggerReferralScratchCard(user.id, 'task_completion').catch((err) =>
      console.warn('[Gamification] Task bot complete referral check error:', err)
    );

    const gamState = await getUserGamificationState(user.id);

    res.json({
      success: true,
      rewardAmount: bot.rewardAmount,
      newBalance: credResult.user.balance,
      gamification: {
        completedTasksCount: gamState.completedTasksCount,
        availableSpins: gamState.availableSpins,
        canSpinNow: gamState.canSpinNow,
        tasksRequiredPerSpin: gamState.tasksRequiredPerSpin,
        progressToNextSpin: gamState.progressToNextSpin,
      },
      message: `Task Bot completed! +₹${bot.rewardAmount} coins added to your balance.${
        gamState.canSpinNow ? ' 🎡 You earned a Lucky Spin!' : ''
      }`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    releaseLock();
  }
});

/* ========================================================
   REFERRALS
   ======================================================== */
apiRouter.get('/referrals/stats', extractTelegramUser, async (req, res) => {
  try {
    let user = (req as any).user as UserProfile;
    const settings = await getAppSettings();
    const referrals = await getReferralsByReferrer(user.id);

    // Ensure user has a valid referral code
    if (!user.referralCode) {
      user.referralCode = `ref_${user.id}_${Math.random().toString(36).substring(2, 6)}`;
      user = await saveUser(user);
    }

    const botUsername = formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || settings.botUsername || 'WatchVEarnBot');
    const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;

    res.json({
      referralCode: user.referralCode,
      referralLink,
      referralReward: settings.referralReward,
      totalReferrals: referrals.length,
      totalEarned: user.referralEarnings,
      history: referrals,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   WITHDRAWALS & INSTANT AMAZON GIFT CARD REDEMPTION
   ======================================================== */
apiRouter.post('/withdrawals/create', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const { amount, idempotencyKey } = req.body;
    const headerKey = req.headers['x-idempotency-key'] as string;
    const effectiveKey = (idempotencyKey || headerKey || '').trim();

    const numAmount = amount !== undefined && amount !== null && amount !== '' ? Number(amount) : undefined;
    if (numAmount !== undefined && (isNaN(numAmount) || numAmount <= 0)) {
      return res.status(400).json({ error: 'Please enter a valid withdrawal amount.' });
    }

    // Feature 3: Mandatory channel membership re-verification before every withdrawal
    const channelVerification = await verifyMandatoryWithdrawalMembership(user.telegramId);
    if (!channelVerification.isVerified) {
      if (channelVerification.isApiError) {
        return res.status(503).json({
          error:
            channelVerification.error ||
            'Channel membership verification could not be completed due to a temporary Telegram connection issue. Please retry in a few moments.',
          isApiError: true,
        });
      }
      return res.status(403).json({
        error:
          channelVerification.error ||
          'Please join all mandatory sponsor channels before redeeming your Amazon Gift Card.',
        forceJoinRequired: true,
        unjoinedChannels: channelVerification.unjoinedChannels || [],
      });
    }

    // Every withdrawal is fulfilled instantly via Amazon Gift Card Code redemption
    const result = await redeemGiftCardWithdrawal(user.id, numAmount, effectiveKey || undefined);
    return res.json({
      success: true,
      orderId: result.withdrawal.id,
      giftCardCode: result.giftCardCode,
      denomination: result.withdrawal.giftCardDenomination,
      withdrawal: result.withdrawal,
      remainingBalance: result.user.balance,
      message: 'Amazon Gift Card Code redeemed successfully!',
    });
  } catch (err: any) {
    if (err.forceJoinRequired) {
      return res.status(403).json({
        error: err.message,
        forceJoinRequired: true,
        unjoinedChannels: err.unjoinedChannels || [],
      });
    }
    if (err.referralRequirementFailed) {
      return res.status(403).json({
        error: err.message,
        referralRequirementFailed: true,
        eligibility: err.eligibility,
      });
    }
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/withdrawals/eligibility', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const eligibility = await checkWithdrawalReferralEligibility(user.id);
    res.json({ success: true, eligibility });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/withdrawals/my', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const withdrawals = await getUserWithdrawals(user.id);
    res.json({ withdrawals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/transactions/my', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const transactions = await getUserTransactions(user.id, 50);
    res.json({ transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   FORCE JOIN MEMBERSHIP VERIFICATION
   ======================================================== */
apiRouter.post('/force-join/verify', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const channels = await getForceJoinChannels(true);

    const results: Array<ForceJoinChannel & { isMember: boolean; status: string; error?: string; diagnostic?: string }> = [];
    let allJoined = true;
    let failureReason = '';

    for (const ch of channels) {
      const check = await checkTelegramChannelMembership(ch.channelId, user.telegramId);
      results.push({
        ...ch,
        isMember: check.isMember,
        status: check.status,
        error: check.error,
        diagnostic: check.diagnostic,
      });
      if (!check.isMember) {
        allJoined = false;
        if (!failureReason && check.error) {
          failureReason = check.error;
        }
      }
    }

    // Sync user.forceJoinVerified in DB according to live reality
    const userToUpdate = await getUser(user.id);
    if (userToUpdate && userToUpdate.forceJoinVerified !== allJoined) {
      userToUpdate.forceJoinVerified = allJoined;
      await saveUser(userToUpdate);
    }

    if (allJoined) {
      // Gamification Hook: Check if referrer unlocked a scratch card via referee channel verification
      await checkAndTriggerReferralScratchCard(user.id, 'channel_verification').catch((err) =>
        console.warn('[Gamification] Channel verify referral scratch card error:', err)
      );
    }

    res.json({
      allJoined,
      channels: results,
      failureReason: failureReason || (allJoined ? null : 'Please join all required channels to unlock the app.'),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   ADMIN PANEL ENDPOINTS (Protected with requireAdmin)
   ======================================================== */
apiRouter.get('/admin/dashboard', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const stats = await getDashboardStats();
    let gatewayStatus: any = null;
    try {
      gatewayStatus = await payoutGateway.getStatus();
    } catch (gwErr) {
      console.warn('[Admin Dashboard] Gateway status warning:', gwErr);
    }
    const settings = await getAppSettings();

    res.json({
      stats,
      gatewayStatus,
      settings,
    });
  } catch (err: any) {
    console.error('[Admin Dashboard Error]:', err);
    const totalUsers = getTotalRegisteredUsersCount();
    res.json({
      stats: {
        totalUsers,
        activeUsersToday: 0,
        totalTaskCompletions: 0,
        totalRewardsCredited: 0,
        pendingWithdrawalsCount: 0,
        pendingWithdrawalsAmount: 0,
        successfulPayoutsCount: 0,
        successfulPayoutsAmount: 0,
        failedPayoutsCount: 0,
        duplicateDevicesBlocked: 0,
        totalTaskBots: 0,
        stale: true,
      },
      gatewayStatus: null,
      settings: await getAppSettings().catch(() => ({})),
    });
  }
});

// Admin Tasks CRUD
apiRouter.get('/admin/tasks', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const tasks = await getAllTasks(false);
    res.json({ tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/tasks', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const taskData: Task = req.body;

    if (!taskData.id) {
      taskData.id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      taskData.createdAt = new Date().toISOString();
    }

    if (taskData.taskType === 'channel') {
      const rawId = (taskData.channelId || '').trim();
      const rawUrl = (taskData.destinationUrl || '').trim();

      const parsed = formatChannelIdentifier(rawId);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
      }

      taskData.channelId = parsed.formatted;

      if (parsed.isPrivate && (!rawUrl || rawUrl === 'https://')) {
        return res.status(400).json({
          error:
            'Private channel tasks require a valid Telegram invite URL (https://t.me/+...) in Join URL so users can join.',
        });
      }

      if (rawUrl.startsWith('t.me/') || rawUrl.startsWith('telegram.me/')) {
        taskData.destinationUrl = `https://${rawUrl}`;
      } else if ((!rawUrl || rawUrl === 'https://') && parsed.formatted?.startsWith('@')) {
        taskData.destinationUrl = `https://t.me/${parsed.formatted.replace('@', '')}`;
      }
    }

    if (taskData.isMandatoryForWithdrawal !== undefined) {
      taskData.isMandatoryForWithdrawal = Boolean(taskData.isMandatoryForWithdrawal);
    }
    if (taskData.isMandatoryForCheckin !== undefined) {
      taskData.isMandatoryForCheckin = Boolean(taskData.isMandatoryForCheckin);
    }

    const saved = await saveTask(taskData);
    await recordAdminAudit(admin.id, 'SAVE_TASK', `Saved task: ${saved.title} (Reward: ${saved.rewardAmount})`);

    res.json({ success: true, task: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/admin/tasks/:id', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    await deleteTask(req.params.id);
    await recordAdminAudit(admin.id, 'DELETE_TASK', `Deleted task ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Force Join Channels CRUD
apiRouter.get('/admin/channels', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const channels = await getForceJoinChannels(false);
    res.json({ channels });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/channels', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const chData: ForceJoinChannel = req.body;
    if (!chData.id) {
      chData.id = `chan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    }

    let rawId = (chData.channelId || '').trim();
    let rawUrl = (chData.inviteLink || '').trim();

    // Auto-detect if user accidentally swapped Channel ID and Invite Link
    if (
      (/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)/i.test(rawId) || rawId.startsWith('+')) &&
      (/^-100\d+$/.test(rawUrl) || /^-?\d+$/.test(rawUrl) || /(?:t\.me|telegram\.me)\/c\/\d+/i.test(rawUrl))
    ) {
      const temp = rawId;
      rawId = rawUrl;
      rawUrl = temp;
      chData.channelId = rawId;
      chData.inviteLink = rawUrl;
    }

    const parsed = formatChannelIdentifier(rawId);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    chData.channelId = parsed.formatted!;
    chData.isPrivate = Boolean(parsed.isPrivate);

    if (parsed.isPrivate && (!rawUrl || rawUrl === 'https://')) {
      return res.status(400).json({
        error:
          'Private force join channels require a valid Telegram invite URL (https://t.me/+...) in Invite Link so users can join.',
      });
    }

    if (!rawUrl && parsed.formatted?.startsWith('@')) {
      chData.inviteLink = `https://t.me/${parsed.formatted.replace('@', '')}`;
    }

    const saved = await saveForceJoinChannel(chData);
    await recordAdminAudit(admin.id, 'SAVE_CHANNEL', `Saved channel: ${saved.title} (${saved.channelId})`);
    res.json({ success: true, channel: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/admin/channels/:id', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    await deleteForceJoinChannel(req.params.id);
    await recordAdminAudit(admin.id, 'DELETE_CHANNEL', `Deleted channel ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/channels/test-access', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }
    const access = await checkBotChannelAccess(channelId);
    res.json({
      success: access.ok,
      ...access,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/channels/:id/test-diagnostic', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const channels = await getForceJoinChannels(false);
    const target = channels.find((c) => c.id === req.params.id);

    if (!target) return res.status(404).json({ error: 'Channel not found' });

    const botAccess = await checkBotChannelAccess(target.channelId);
    const membershipCheck = await checkTelegramChannelMembership(target.channelId, admin.telegramId);

    res.json({
      channel: target,
      diagnostic: membershipCheck,
      botAccess,
      botTokenPresent: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')
      ),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/tasks/:id/test-diagnostic', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const task = await getTaskById(req.params.id);

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.taskType !== 'channel') {
      return res.status(400).json({ error: 'Task is not a channel task' });
    }

    const channelIdentifier = task.channelId || '';
    if (!channelIdentifier) {
      return res.status(400).json({ error: 'Task has no channel identifier configured' });
    }

    const botAccess = await checkBotChannelAccess(channelIdentifier);
    const membershipCheck = await checkTelegramChannelMembership(channelIdentifier, admin.telegramId);

    res.json({
      task,
      botAccess,
      membershipCheck,
      botTokenPresent: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('ABCdefGHIjklMNOpqrSTUvwxYZ')
      ),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin App & Reward Settings
apiRouter.get('/admin/settings', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const settings = await getAppSettings();
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/settings', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const incoming = req.body || {};

    // Validate withdrawal settings
    if (incoming.minWithdrawalAmount !== undefined) {
      const minVal = Number(incoming.minWithdrawalAmount);
      if (isNaN(minVal) || minVal <= 0) {
        return res.status(400).json({ error: 'Minimum withdrawal amount must be greater than 0.' });
      }
    }

    if (incoming.maxWithdrawalAmount !== undefined && incoming.maxWithdrawalAmount !== null && incoming.maxWithdrawalAmount !== '') {
      const maxVal = Number(incoming.maxWithdrawalAmount);
      const currentMin = incoming.minWithdrawalAmount !== undefined ? Number(incoming.minWithdrawalAmount) : (await getAppSettings()).minWithdrawalAmount;
      if (isNaN(maxVal) || maxVal <= 0) {
        return res.status(400).json({ error: 'Maximum withdrawal amount must be greater than 0.' });
      }
      if (maxVal < currentMin) {
        return res.status(400).json({
          error: `Maximum withdrawal amount (₹${maxVal}) cannot be lower than the minimum withdrawal amount (₹${currentMin}).`,
        });
      }
    }

    if (incoming.dailyWithdrawalLimitEnabled) {
      if (incoming.maxWithdrawalRequestsPer24h !== undefined) {
        const reqs = Number(incoming.maxWithdrawalRequestsPer24h);
        if (isNaN(reqs) || reqs <= 0) {
          return res.status(400).json({ error: 'Maximum requests per 24 hours must be at least 1.' });
        }
      }
      if (incoming.maxWithdrawalAmountPer24h !== undefined) {
        const dailyAmt = Number(incoming.maxWithdrawalAmountPer24h);
        if (isNaN(dailyAmt) || dailyAmt <= 0) {
          return res.status(400).json({ error: 'Maximum total amount per 24 hours must be greater than 0.' });
        }
      }
    }

    // Validate Daily Check-In reward settings
    if (incoming.dailyCheckinRewardDifference !== undefined && incoming.dailyCheckinRewardDifference !== null && incoming.dailyCheckinRewardDifference !== '') {
      const diffVal = Number(incoming.dailyCheckinRewardDifference);
      if (isNaN(diffVal) || diffVal <= 0 || !Number.isFinite(diffVal) || diffVal > 500) {
        return res.status(400).json({
          error: 'Daily check-in reward difference must be a valid positive number greater than 0 (e.g. ₹1, ₹2, ₹3, ₹5).',
        });
      }
      incoming.dailyCheckinRewardDifference = diffVal;
    }

    if (incoming.dailyCheckinBaseReward !== undefined && incoming.dailyCheckinBaseReward !== null && incoming.dailyCheckinBaseReward !== '') {
      const baseVal = Number(incoming.dailyCheckinBaseReward);
      if (isNaN(baseVal) || baseVal <= 0 || !Number.isFinite(baseVal) || baseVal > 5000) {
        return res.status(400).json({
          error: 'Daily check-in base reward must be a valid positive number greater than 0.',
        });
      }
      incoming.dailyCheckinBaseReward = baseVal;
    }

    // Validate Maximum Scratch Signup Bonus
    if (incoming.maxScratchSignupBonus !== undefined && incoming.maxScratchSignupBonus !== null && incoming.maxScratchSignupBonus !== '') {
      const maxScratch = Number(incoming.maxScratchSignupBonus);
      if (isNaN(maxScratch) || maxScratch <= 0 || !Number.isFinite(maxScratch) || maxScratch > 1000) {
        return res.status(400).json({
          error: 'Maximum Scratch Signup Bonus must be a valid positive number greater than 0 (e.g. ₹5, ₹10, ₹25).',
        });
      }
      incoming.maxScratchSignupBonus = maxScratch;
    }

    // Validate Withdrawal Referral Requirement settings
    if (incoming.withdrawalReferralRequirementEnabled !== undefined) {
      incoming.withdrawalReferralRequirementEnabled = Boolean(incoming.withdrawalReferralRequirementEnabled);
    }

    if (
      incoming.withdrawalReferralApplyFromCount !== undefined &&
      incoming.withdrawalReferralApplyFromCount !== null &&
      incoming.withdrawalReferralApplyFromCount !== ''
    ) {
      const applyFrom = Number(incoming.withdrawalReferralApplyFromCount);
      if (isNaN(applyFrom) || !Number.isInteger(applyFrom) || applyFrom < 1) {
        return res.status(400).json({
          error: 'Withdrawal Referral "Apply from withdrawal number" must be a positive integer of at least 1 (default is 2).',
        });
      }
      incoming.withdrawalReferralApplyFromCount = applyFrom;
    }

    if (
      incoming.withdrawalMinReferralsRequired !== undefined &&
      incoming.withdrawalMinReferralsRequired !== null &&
      incoming.withdrawalMinReferralsRequired !== ''
    ) {
      const minRefs = Number(incoming.withdrawalMinReferralsRequired);
      if (isNaN(minRefs) || !Number.isInteger(minRefs) || minRefs < 1) {
        return res.status(400).json({
          error: 'Withdrawal Referral "Minimum valid referrals required" must be a positive integer of at least 1.',
        });
      }
      incoming.withdrawalMinReferralsRequired = minRefs;
    }

    const updated = await updateAppSettings(incoming);
    await recordAdminAudit(admin.id, 'UPDATE_SETTINGS', `Updated settings: ${JSON.stringify(incoming)}`);
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Withdrawals Management
apiRouter.get('/admin/withdrawals', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as string;
    const withdrawals = await getAllWithdrawals(status);
    res.json({ withdrawals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/withdrawals/:orderId/action', extractTelegramUser, requireAdmin, async (req, res) => {
  const orderId = req.params.orderId;
  const releaseLock = await acquireLock(`payout_action_${orderId}`);

  try {
    const admin = (req as any).user as UserProfile;
    const { action, reason } = req.body; // action: 'approve' | 'reject' | 'process_payout' | 'reconcile'

    const withdrawals = await getAllWithdrawals();
    const target = withdrawals.find((w) => w.id === orderId);
    if (!target) {
      releaseLock();
      return res.status(404).json({ error: 'Withdrawal order not found' });
    }

    if (action === 'approve') {
      const updated = await updateWithdrawalStatus(orderId, 'success', {
        providerResponse: `Manually approved by Administrator (${admin.id})`,
        adminId: admin.id,
      });
      await recordAdminAudit(admin.id, 'APPROVE_WITHDRAWAL', `Approved payout order ${orderId} for ₹${updated.amount}`);
      await notifyUserWithdrawalResult(updated, true).catch(() => {});
      await broadcastPayoutProof(updated).catch(() => {});
      releaseLock();
      return res.json({ success: true, withdrawal: updated });
    }

    if (action === 'reject') {
      const updated = await updateWithdrawalStatus(orderId, 'rejected', {
        failureReason: reason || 'Rejected by Administrator. Funds refunded.',
        adminId: admin.id,
      });
      await recordAdminAudit(
        admin.id,
        'REJECT_WITHDRAWAL',
        `Rejected payout order ${orderId} for ₹${updated.amount}. Refunded to user ${updated.userId}. Reason: ${reason}`
      );
      await notifyUserWithdrawalResult(updated, false).catch(() => {});
      releaseLock();
      return res.json({ success: true, withdrawal: updated, refunded: true });
    }

    if (action === 'process_payout') {
      releaseLock();
      return res.status(400).json({
        error: 'UPI payouts are permanently disabled. All withdrawals are fulfilled exclusively via Amazon Gift Card Code redemption.',
      });
    }

    if (action === 'reconcile') {
      const reconcileResult = await payoutGateway.reconcilePayout(target);
      let updated = target;
      if (reconcileResult.status !== target.status) {
        updated = await updateWithdrawalStatus(orderId, reconcileResult.status, {
          providerResponse: reconcileResult.providerResponse,
          failureReason: reconcileResult.failureReason,
          adminId: admin.id,
        });
        if (reconcileResult.utr) {
          updated.payoutTransactionId = reconcileResult.utr;
        }
        await recordAdminAudit(
          admin.id,
          'RECONCILE_PAYOUT',
          `Reconciled order ${orderId}. Status transitioned from ${target.status} to ${updated.status}`
        );
        if (updated.status === 'success') {
          await broadcastPayoutProof(updated).catch(() => {});
          await notifyUserWithdrawalResult(updated, true).catch(() => {});
        } else if (updated.status === 'failed' || updated.status === 'reversed') {
          await notifyUserWithdrawalResult(updated, false).catch(() => {});
        }
      }
      releaseLock();
      return res.json({
        success: true,
        withdrawal: updated,
        reconcileResult,
      });
    }

    releaseLock();
    res.status(400).json({ error: 'Invalid action. Choose approve, reject, process_payout, or reconcile.' });
  } catch (err: any) {
    releaseLock();
    res.status(500).json({ error: err.message });
  }
});

// Dedicated Reconcile Endpoint
apiRouter.post('/admin/withdrawals/:orderId/reconcile', extractTelegramUser, requireAdmin, async (req, res) => {
  const orderId = req.params.orderId;
  const releaseLock = await acquireLock(`payout_reconcile_${orderId}`);

  try {
    const admin = (req as any).user as UserProfile;
    const withdrawals = await getAllWithdrawals();
    const target = withdrawals.find((w) => w.id === orderId);
    if (!target) {
      releaseLock();
      return res.status(404).json({ error: 'Order not found' });
    }

    const reconcileResult = await payoutGateway.reconcilePayout(target);
    let updated = target;
    if (reconcileResult.status !== target.status) {
      updated = await updateWithdrawalStatus(orderId, reconcileResult.status, {
        providerResponse: reconcileResult.providerResponse,
        failureReason: reconcileResult.failureReason,
        adminId: admin.id,
      });
      if (reconcileResult.utr) {
        updated.payoutTransactionId = reconcileResult.utr;
      }
      await recordAdminAudit(
        admin.id,
        'RECONCILE_PAYOUT',
        `Reconciled order ${orderId} from ${target.status} to ${updated.status}`
      );
      if (updated.status === 'success') {
        await broadcastPayoutProof(updated).catch(() => {});
        await notifyUserWithdrawalResult(updated, true).catch(() => {});
      }
    }

    releaseLock();
    res.json({
      success: true,
      withdrawal: updated,
      message: `Reconciliation complete. Status is ${updated.status}.`,
    });
  } catch (err: any) {
    releaseLock();
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   ADMIN GIFT CARD INVENTORY ENDPOINTS
   ======================================================== */

// Get Gift Card Inventory Stats (available counts, redeemed, total value)
apiRouter.get('/admin/gift-cards/stats', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const stats = await getGiftCardInventoryStats();
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Comprehensive Gift Card Audit & Conflict Review Report for Admins
apiRouter.get('/admin/gift-cards/audit-report', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const report = await getGiftCardAuditReport();
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List Gift Card Codes (with status/denomination filters)
apiRouter.get('/admin/gift-cards', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status as any;
    const denomination = req.query.denomination ? Number(req.query.denomination) : undefined;
    const codes = await getAllGiftCardCodes({
      status: status && status !== 'all' ? status : undefined,
      denomination,
    });
    res.json({ codes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add Gift Card Codes (single code or bulk text/lines)
apiRouter.post('/admin/gift-cards/add', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const { codes, denomination } = req.body;

    const numDenom = Number(denomination);
    if (!numDenom || isNaN(numDenom) || numDenom <= 0) {
      return res.status(400).json({ error: 'Please specify a valid gift card denomination (e.g. 10).' });
    }

    if (!codes || (Array.isArray(codes) && codes.length === 0)) {
      return res.status(400).json({ error: 'Please enter at least one gift card code.' });
    }

    const result = await addGiftCardCodes(codes, numDenom, admin.username || admin.id);
    await recordAdminAudit(
      admin.id,
      'IMPORT_GIFT_CARDS',
      `Imported ${result.added} codes (₹${numDenom}). Skipped ${result.duplicates} duplicates.`
    );

    res.json({
      success: true,
      added: result.added,
      duplicates: result.duplicates,
      message: `Successfully imported ${result.added} code(s). ${result.duplicates > 0 ? `${result.duplicates} duplicate(s) skipped.` : ''}`,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Invalidate an unredeemed Gift Card Code
apiRouter.post('/admin/gift-cards/:id/invalidate', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const { id } = req.params;
    const { reason } = req.body;

    const updated = await invalidateGiftCardCode(id, reason);
    await recordAdminAudit(
      admin.id,
      'INVALIDATE_GIFT_CARD',
      `Invalidated gift card code ${id} (${updated.code.slice(0, 4)}****). Reason: ${reason || 'Admin action'}`
    );

    res.json({ success: true, code: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete an unredeemed Gift Card Code
apiRouter.delete('/admin/gift-cards/:id', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const { id } = req.params;

    const deleted = await deleteGiftCardCode(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Gift card code not found.' });
    }

    await recordAdminAudit(admin.id, 'DELETE_GIFT_CARD', `Deleted gift card code ${id}`);
    res.json({ success: true, message: 'Gift card code deleted.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/* ========================================================
   PAYMENT GATEWAY DYNAMIC CONFIGURATION & TEST ENDPOINTS
   ======================================================== */

// Get Payment Gateway Configuration (Strictly Masked - Never exposes secrets)
apiRouter.get('/admin/gateway/config', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const host = req.get('host') ? `${req.protocol}://${req.get('host')}` : undefined;
    const config = await getPublicGatewayConfig(host);
    res.json({ config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save Payment Gateway Configuration (Encrypts secrets at rest)
apiRouter.post('/admin/gateway/config', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const {
      provider,
      environment,
      payoutsEnabled,
      apiBaseUrl,
      apiKey,
      apiSecret,
      merchantId,
      webhookSecret,
    } = req.body;

    // Validate provider (Paynit is the primary supported gateway)
    const allowedProviders = ['paynit', 'cashfree', 'razorpayx', 'paytm', 'custom', ''];
    if (provider !== undefined && !allowedProviders.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider selected.' });
    }

    // Validate environment
    if (environment && !['test', 'live'].includes(environment)) {
      return res.status(400).json({ error: 'Environment must be either "test" or "live".' });
    }

    // If enabling Live Mode or Live Payouts, ensure credentials are present
    const stored = await getStoredGatewayConfig();
    const willHaveApiKey = (apiKey && apiKey.trim() !== '') || stored.hasApiKey;
    const willHaveApiSecret = (apiSecret && apiSecret.trim() !== '') || stored.hasApiSecret;

    if (payoutsEnabled && environment === 'live' && (!willHaveApiKey || !willHaveApiSecret)) {
      return res.status(400).json({
        error: 'Cannot enable Live Payouts without valid API credentials (API Key and Secret are required).',
      });
    }

    // Save with encryption (defaulting provider to 'paynit')
    await saveGatewayConfig(
      {
        provider: provider || 'paynit',
        environment: environment || 'test',
        payoutsEnabled: Boolean(payoutsEnabled),
        apiBaseUrl: apiBaseUrl || 'https://pxqyeonymwlpiklfyjbb.supabase.co/functions/v1',
        apiKey,
        apiSecret,
        merchantId,
        webhookSecret,
      },
      admin.id
    );

    // Record audit log without logging secrets!
    await recordAdminAudit(
      admin.id,
      'UPDATE_PAYMENT_GATEWAY_CONFIG',
      `Updated Payment Gateway settings for provider: ${provider || 'none'}, environment: ${environment}, payoutsEnabled: ${Boolean(payoutsEnabled)}`
    );

    const host = req.get('host') ? `${req.protocol}://${req.get('host')}` : undefined;
    const publicConfig = await getPublicGatewayConfig(host);

    res.json({
      success: true,
      config: publicConfig,
      message: 'Payment Gateway settings saved and encrypted securely.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Real Non-Payment Connection Test Check
apiRouter.post('/admin/gateway/test-connection', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const testResult = await payoutGateway.testConnection();

    await recordAdminAudit(
      admin.id,
      'TEST_GATEWAY_CONNECTION',
      `Tested gateway connection. Provider: ${testResult.provider}, Status: ${testResult.status}, Result: ${testResult.message}`
    );

    res.json(testResult);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      status: 'failed',
      message: `Connection test error: ${err.message}`,
      environment: 'test',
      provider: 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
});

// Securely Remove / Wipe Saved Gateway Credentials
apiRouter.delete('/admin/gateway/credentials', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    await removeGatewayCredentials(admin.id);

    await recordAdminAudit(
      admin.id,
      'REMOVE_GATEWAY_CREDENTIALS',
      `Wiped and removed stored payment gateway credentials`
    );

    const host = req.get('host') ? `${req.protocol}://${req.get('host')}` : undefined;
    const publicConfig = await getPublicGatewayConfig(host);

    res.json({
      success: true,
      config: publicConfig,
      message: 'Payment gateway credentials securely wiped.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   PAYMENT GATEWAY WEBHOOK (Public Callback Endpoint)
   ======================================================== */
apiRouter.post('/payouts/webhook', async (req, res) => {
  try {
    const signature =
      (req.headers['x-cashfree-signature'] as string) ||
      (req.headers['x-razorpay-signature'] as string) ||
      (req.headers['x-signature'] as string) ||
      '';

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // If signature provided, verify signature
    if (signature) {
      const isValid = await payoutGateway.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn('[Webhook] Rejected payout webhook with invalid signature');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const payload = req.body || {};
    // Extract Order ID & Event from either Cashfree or Razorpay format
    let orderId = '';
    let status: 'success' | 'failed' | 'reversed' | 'processing' | null = null;
    let utr = '';
    let reason = '';

    // Cashfree Payout Webhook structure
    if (payload.event && payload.event.startsWith('TRANSFER_')) {
      orderId = payload.data?.transferId || payload.data?.transfer?.transferId || '';
      const event = payload.event;
      if (event === 'TRANSFER_SUCCESS') {
        status = 'success';
        utr = payload.data?.utr || payload.data?.transfer?.utr || '';
      } else if (event === 'TRANSFER_FAILED' || event === 'TRANSFER_REJECTED') {
        status = 'failed';
        reason = payload.data?.reason || payload.data?.transfer?.reason || 'Cashfree transfer failed';
      } else if (event === 'TRANSFER_REVERSED') {
        status = 'reversed';
        reason = payload.data?.reason || 'Cashfree transfer reversed by bank';
      }
    }

    // Razorpay Payout Webhook structure
    if (payload.event && payload.event.startsWith('payout.')) {
      const entity = payload.payload?.payout?.entity || {};
      orderId = entity.reference_id || '';
      utr = entity.utr || '';
      if (payload.event === 'payout.processed') {
        status = 'success';
      } else if (payload.event === 'payout.failed' || payload.event === 'payout.rejected') {
        status = 'failed';
        reason = entity.failure_reason || 'RazorpayX payout failed';
      } else if (payload.event === 'payout.reversed') {
        status = 'reversed';
        reason = 'RazorpayX payout reversed';
      }
    }

    if (!orderId || !status) {
      // Unrecognized payload structure, acknowledge receipt safely
      return res.json({ received: true, note: 'Event acknowledged' });
    }

    // Acquire lock to prevent race conditions
    const releaseLock = await acquireLock(`payout_webhook_${orderId}`);

    try {
      const withdrawals = await getAllWithdrawals();
      const target = withdrawals.find((w) => w.id === orderId);

      if (!target) {
        releaseLock();
        return res.json({ received: true, note: 'Order not found in ledger' });
      }

      // Idempotency check: don't re-transition if already in this final state
      if (target.status === status) {
        releaseLock();
        return res.json({ received: true, note: 'Already in target state' });
      }

      const updated = await updateWithdrawalStatus(orderId, status, {
        providerResponse: JSON.stringify(payload),
        failureReason: reason || undefined,
        adminId: 'GATEWAY_WEBHOOK',
      });

      if (utr) {
        updated.payoutTransactionId = utr;
      }

      if (status === 'success') {
        await broadcastPayoutProof(updated).catch(() => {});
        await notifyUserWithdrawalResult(updated, true).catch(() => {});
      } else if (status === 'failed' || status === 'reversed') {
        await notifyUserWithdrawalResult(updated, false).catch(() => {});
      }

      releaseLock();
      return res.json({ received: true, status: 'processed', orderId, newStatus: status });
    } catch (err: any) {
      releaseLock();
      console.error('[Webhook] Error processing payout event:', err);
      return res.status(500).json({ error: err.message });
    }
  } catch (err: any) {
    console.error('[Webhook] Payout webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Admin User Management
apiRouter.get('/admin/users', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const query = req.query.q as string;
    const limitParam = req.query.limit ? Number(req.query.limit) : 50;
    const users = await searchUsers(query, limitParam);
    const totalUsers = getTotalRegisteredUsersCount();
    res.json({ users, totalUsers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/users/:id/ban', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const target = await getUser(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    target.isBanned = !target.isBanned;
    await saveUser(target);

    await recordAdminAudit(
      admin.id,
      target.isBanned ? 'BAN_USER' : 'UNBAN_USER',
      `Toggled ban status for user ${target.id} (${target.username || target.firstName}) to ${target.isBanned}`
    );

    res.json({ success: true, user: target });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/users/:id/adjust-balance', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const { amount, reason } = req.body;
    const numAmount = Number(amount);

    if (!numAmount || isNaN(numAmount)) {
      return res.status(400).json({ error: 'Please enter a valid amount' });
    }

    const cred = await atomicCreditBalance(
      req.params.id,
      numAmount,
      'admin_adjustment',
      `Admin adjustment by ${admin.id}: ${reason || 'Manual correction'}`
    );

    await recordAdminAudit(
      admin.id,
      'ADJUST_BALANCE',
      `Adjusted user ${req.params.id} balance by ₹${numAmount}. Reason: ${reason}`
    );

    res.json({ success: true, user: cred.user, transaction: cred.transaction });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Feature 1: Admin Bulk Balance Reset
apiRouter.get('/admin/bulk-balance-reset/preview', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const preview = await getBulkBalanceResetPreview();
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/bulk-balance-reset', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const { confirmPhrase } = req.body;

    if (!confirmPhrase || confirmPhrase.trim() !== 'RESET ALL BALANCES') {
      return res.status(400).json({
        error: 'Confirmation phrase mismatch. Please type "RESET ALL BALANCES" exactly to confirm.',
      });
    }

    const result = await atomicResetAllUserBalances(admin.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Feature 2: Admin Telegram Broadcast
apiRouter.get('/admin/broadcast/preview', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const preview = await getBroadcastPreview();
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/admin/broadcast/send', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const { message, parseMode } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Broadcast message text is required.' });
    }

    const task = await startBroadcast(admin.id, message.trim(), parseMode || 'HTML');
    res.json({ success: true, task });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/admin/broadcast/latest', extractTelegramUser, requireAdmin, (req, res) => {
  const task = getLatestBroadcast();
  res.json({ task });
});

apiRouter.get('/admin/broadcast/status/:id', extractTelegramUser, requireAdmin, (req, res) => {
  const task = getBroadcastStatus(req.params.id);
  if (!task) return res.status(404).json({ error: 'Broadcast task not found' });
  res.json({ task });
});

apiRouter.post('/admin/broadcast/cancel/:id', extractTelegramUser, requireAdmin, (req, res) => {
  const success = cancelBroadcast(req.params.id);
  res.json({ success });
});

apiRouter.get('/admin/audit-logs', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const logs = await getAdminAuditLogs(100);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   TELEGRAM BOT WEBHOOK & REGISTRATION
   ======================================================== */
apiRouter.post('/telegram/webhook', async (req, res) => {
  try {
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    await handleTelegramBotUpdate(req.body, appUrl);
    res.sendStatus(200);
  } catch (err: any) {
    console.error('[Bot Webhook Error]:', err);
    res.sendStatus(200); // Always respond 200 to Telegram so it doesn't endlessly retry
  }
});

apiRouter.get('/telegram/status', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const botStatus = await getTelegramBotStatus();
    const pollingStatus = getBotPollingStatus();
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const configuredWebhookUrl = `${appUrl}/api/telegram/webhook`;

    res.json({
      ...botStatus,
      polling: pollingStatus,
      appUrl,
      suggestedWebhookUrl: configuredWebhookUrl,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

apiRouter.post('/telegram/setup-webhook', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    // Stop polling first so webhook and polling never conflict
    await stopBotPolling();

    const appUrl = (req.body.customWebhookUrl || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).trim();
    const webhookUrl = appUrl.endsWith('/api/telegram/webhook') ? appUrl : `${appUrl}/api/telegram/webhook`;
    const secret = process.env.WEBHOOK_SECRET;

    const result = await setTelegramWebhook(webhookUrl, secret);
    await recordAdminAudit(
      admin.id,
      'SETUP_WEBHOOK',
      `Registered Telegram Webhook to ${webhookUrl}: ${result.description || (result.success ? 'Success' : 'Failed')}`
    );

    res.json({
      webhookUrl,
      result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/telegram/delete-webhook', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const dropPending = Boolean(req.body.dropPendingUpdates);
    const result = await deleteTelegramWebhook(dropPending);

    await recordAdminAudit(
      admin.id,
      'DELETE_WEBHOOK',
      `Deleted Telegram Webhook (dropUpdates=${dropPending}): ${result.description || 'Success'}`
    );

    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/telegram/polling/start', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const result = await startBotPolling(appUrl);

    await recordAdminAudit(
      admin.id,
      'START_BOT_POLLING',
      `Started live Telegram bot polling mode for preview / local testing`
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/telegram/polling/stop', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const result = await stopBotPolling();

    await recordAdminAudit(admin.id, 'STOP_BOT_POLLING', `Stopped Telegram bot polling mode`);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/telegram/test-message', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const targetChatId = req.body.chatId || admin.telegramId;
    const testText =
      req.body.text ||
      `🤖 <b>TeleEarn Bot Connection Test</b>\n\nYour Telegram bot is verified and communicating properly with the TeleEarn server!\n\n🕒 Server Time: ${new Date().toLocaleString()}\n👑 Tested by: ${admin.firstName} (ID: ${admin.id})`;

    const { sendTelegramMessage } = await import('./telegram.ts');
    const result = await sendTelegramMessage(targetChatId, testText);

    res.json({
      success: result.success,
      error: result.error,
      chatId: targetChatId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================================================
   GAMIFICATION & REWARDS ENDPOINTS (Spin Wheel & Scratch Cards)
   ======================================================== */

// Get user gamification status (spins, scratch cards, progress)
apiRouter.get('/gamification/status', extractTelegramUser, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const state = await getUserGamificationState(user.id);
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Spin the Lucky Wheel
apiRouter.post('/gamification/spin', extractTelegramUser, requireLiveChannelMembership, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const deviceCheck = await isDeviceRestrictedForUser(user.id, user.deviceId, user.deviceFingerprint);
    if (deviceCheck.restricted) {
      return res.status(403).json({
        error: deviceCheck.reason || '⚠️ Spin rewards are restricted to the primary account registered on this device.',
        isDeviceDuplicate: true,
      });
    }

    const result = await executeSpinWheel(user.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Reveal a Scratch Card
apiRouter.post('/gamification/scratch-cards/:id/reveal', extractTelegramUser, requireLiveChannelMembership, async (req, res) => {
  try {
    const user = (req as any).user as UserProfile;
    const deviceCheck = await isDeviceRestrictedForUser(user.id, user.deviceId, user.deviceFingerprint);
    if (deviceCheck.restricted) {
      return res.status(403).json({
        error: deviceCheck.reason || '⚠️ Scratch card rewards are restricted to the primary account registered on this device.',
        isDeviceDuplicate: true,
      });
    }

    const cardId = req.params.id;
    const result = await revealScratchCard(user.id, cardId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Get Gamification Settings & Statistics
apiRouter.get('/admin/gamification', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const [settings, stats] = await Promise.all([
      getGamificationSettings(),
      getGamificationStats(),
    ]);
    res.json({ settings, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update Gamification Settings
apiRouter.post('/admin/gamification/settings', extractTelegramUser, requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as UserProfile;
    const newGamSettings = req.body;

    // Validate tasks required per spin (2, 3, or 4)
    if (newGamSettings.tasksRequiredPerSpin !== undefined) {
      const tasksReq = Number(newGamSettings.tasksRequiredPerSpin);
      if (![2, 3, 4].includes(tasksReq)) {
        return res.status(400).json({ error: 'Tasks required per spin must be 2, 3, or 4' });
      }
      newGamSettings.tasksRequiredPerSpin = tasksReq;
    }

    // Validate segments if provided
    if (newGamSettings.spinSegments && Array.isArray(newGamSettings.spinSegments)) {
      if (newGamSettings.spinSegments.length < 2) {
        return res.status(400).json({ error: 'At least 2 spin reward segments are required' });
      }
      const totalProb = newGamSettings.spinSegments
        .filter((s: any) => s.isEnabled)
        .reduce((sum: number, s: any) => sum + (Number(s.probability) || 0), 0);
      if (totalProb <= 0) {
        return res.status(400).json({ error: 'Total probability of enabled spin segments must be greater than 0' });
      }
    }

    // Validate scratch options if provided
    if (newGamSettings.scratchRewardOptions && Array.isArray(newGamSettings.scratchRewardOptions)) {
      if (newGamSettings.scratchRewardOptions.length < 2) {
        return res.status(400).json({ error: 'At least 2 scratch card reward options are required' });
      }
    }

    const currentSettings = await getAppSettings();
    const updatedGam = {
      ...(currentSettings.gamification || {}),
      ...newGamSettings,
    };

    await updateAppSettings({
      gamification: updatedGam,
    });

    await recordAdminAudit(
      admin.id,
      'UPDATE_GAMIFICATION_SETTINGS',
      `Updated Gamification & Rewards settings: SpinWheel=${updatedGam.spinWheelEnabled}, ReqTasks=${updatedGam.tasksRequiredPerSpin}, ScratchCards=${updatedGam.scratchCardEnabled}`
    );

    const [savedGam, stats] = await Promise.all([
      getGamificationSettings(),
      getGamificationStats(),
    ]);

    res.json({
      success: true,
      message: 'Gamification & Rewards settings saved successfully',
      settings: savedGam,
      stats,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

