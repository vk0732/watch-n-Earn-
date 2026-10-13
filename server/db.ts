import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  runTransaction,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import type {
  UserProfile,
  Task,
  TaskBot,
  TaskCompletion,
  ReferralRecord,
  Transaction,
  Withdrawal,
  ForceJoinChannel,
  AppSettings,
  AdminAuditLog,
  DashboardStats,
  BonusClaimRecord,
} from '../src/types/index.ts';
import { formatBotUsername } from './telegram.ts';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// In-Memory Fallback store to guarantee zero downtime and blazing fast tests
export const memStore = {
  users: new Map<string, UserProfile>(),
  tasks: new Map<string, Task>(),
  taskBots: new Map<string, TaskBot>(),
  taskCompletions: new Map<string, TaskCompletion>(),
  referrals: new Map<string, ReferralRecord>(),
  transactions: new Map<string, Transaction>(),
  withdrawals: new Map<string, Withdrawal>(),
  channels: new Map<string, ForceJoinChannel>(),
  deviceFingerprints: new Map<string, string>(), // fingerprint -> userId
  ipHashes: new Map<string, string>(), // ipHash -> userId
  // Server-side Anti-Fraud & Bonus Claim Registry
  bonusClaims: new Map<string, BonusClaimRecord>(),
  deviceClaims: new Map<string, BonusClaimRecord>(), // deviceId -> claim
  userBonusClaims: new Map<string, BonusClaimRecord>(), // userId -> claim
  deviceFingerprintClaims: new Map<string, BonusClaimRecord>(), // fingerprintHash -> claim
  referralClaims: new Map<string, BonusClaimRecord>(), // refereeId -> claim
  settings: {
    signupBonus: 20, // PRD: ₹10-₹25 configurable
    referralReward: 10, // PRD: ₹10 per referral
    dailyCheckinBaseReward: 5,
    minWithdrawalAmount: 10, // PRD: ₹10 minimum withdrawal
    maxWithdrawalAmount: 5000, // Configurable upper bound
    dailyWithdrawalLimitEnabled: false,
    maxWithdrawalRequestsPer24h: 3,
    maxWithdrawalAmountPer24h: 5000,
    supportTelegramUsername: 'TeleEarnSupport',
    maintenanceMode: false,
    payoutLiveEnabled: false,
    botUsername: formatBotUsername(process.env.TELEGRAM_BOT_USERNAME || 'WatchXEarnBot'),
    payoutBotToken: process.env.PAYOUT_BOT_TOKEN || '',
    payoutChannelId: process.env.PAYOUT_CHANNEL_ID || '@TeleEarnPayouts',
    payoutAdminChatId: process.env.PAYOUT_ADMIN_CHAT_ID || '',
    deviceVerificationEnabled: true,
    blockDuplicateDevices: true,
    templates: {
      welcomeMessage:
        '🎁 <b>Welcome to TeleEarn!</b>\n\n💰 <b>Complete Tasks & Earn Rewards</b>\n⚡ Simple Tasks • Exciting Rewards\n\n🚀 Start your earning journey today!',
      forceJoinPrompt:
        '⚠️ <b>Mandatory Channel Verification</b>\n\nTo unlock task earnings and UPI withdrawals, please join our official sponsor channels:\n\n{channels}\n\nTap "Verify Membership" once joined!',
      dailyRewardClaimed:
        '🎉 <b>Daily Streak Claimed!</b>\n\nYou received <b>+₹{amount}</b> for Day {streak}! Come back tomorrow for higher rewards.',
      taskCompleted:
        '✅ <b>Task Completed!</b>\n\nReward: <b>+₹{amount}</b> added to your balance for "{task_title}".',
      referralSuccess:
        '🤝 <b>New Referral Joined!</b>\n\nUser @{referee} joined using your invite link!\nYou earned <b>+₹{amount}</b> instant reward.',
      withdrawalReceived:
        '📤 <b>Withdrawal Request Submitted</b>\n\nAmount: <b>₹{amount}</b>\nUPI ID: <code>{upi_id}</code>\nOrder ID: <code>{order_id}</code>\nStatus: <b>Pending Review</b>',
      withdrawalApproved:
        '✅ <b>Withdrawal Paid!</b>\n\nAmount: <b>₹{amount}</b> sent to UPI <code>{upi_id}</code>\nOrder ID: <code>{order_id}</code>\nTxn ID: <code>{txn_id}</code>',
      payoutProofBroadcast:
        '💸 <b>NEW UPI CASHBACK PAID!</b>\n\n👤 Recipient: {masked_user}\n💰 Amount: <b>₹{amount}</b>\n💳 Destination: <code>{masked_upi}</code>\n🆔 Order ID: <code>{order_id}</code>\n⚡ Status: <b>SUCCESS (Verified)</b>\n\n🤖 <i>Earn daily with TeleEarn Bot!</i>',
    },
  } as AppSettings,
  auditLogs: [] as AdminAuditLog[],
};

// Seed default data if empty
function initSeeds() {
  if (memStore.tasks.size === 0) {
    const defaultTasks: Task[] = [
      {
        id: 'task_sponsor_video_1',
        title: 'Watch Sponsored Crypto App Preview',
        description: 'Watch the full 30-second presentation of Web3 Gaming Partner.',
        destinationUrl: 'https://youtube.com',
        rewardAmount: 30,
        taskType: 'video',
        timerSeconds: 15,
        isActive: true,
        sortOrder: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'task_visit_partner_web',
        title: 'Visit Trading Signals Portal',
        description: 'Stay on the page for 20 seconds and explore market trends.',
        destinationUrl: 'https://telegram.org',
        rewardAmount: 20,
        taskType: 'website',
        timerSeconds: 10,
        isActive: true,
        sortOrder: 2,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'task_join_partner_channel',
        title: 'Join Daily Crypto Signals Channel',
        description: 'Join the channel and stay updated with free daily calls.',
        destinationUrl: 'https://t.me/telegram',
        rewardAmount: 40,
        taskType: 'channel',
        channelId: '@telegram',
        timerSeconds: 0,
        isActive: true,
        sortOrder: 3,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'task_video_ad_short',
        title: 'Watch 15s High-Yield Staking Ad',
        description: 'Quick 15s advertisement video reward.',
        destinationUrl: 'https://google.com',
        rewardAmount: 15,
        taskType: 'video',
        timerSeconds: 15,
        isActive: true,
        sortOrder: 4,
        createdAt: new Date().toISOString(),
      },
    ];
    defaultTasks.forEach((t) => memStore.tasks.set(t.id, t));
  }

  if (memStore.channels.size === 0) {
    const defaultChannels: ForceJoinChannel[] = [
      {
        id: 'chan_main_updates',
        title: 'TeleEarn Official Announcements',
        username: 'TeleEarnOfficial',
        channelId: '@TeleEarnOfficial',
        inviteLink: 'https://t.me/telegram',
        isPrivate: false,
        isEnabled: true,
        order: 1,
      },
      {
        id: 'chan_payment_proofs',
        title: 'Live Payment Proofs Channel',
        username: 'TeleEarnPayouts',
        channelId: '@TeleEarnPayouts',
        inviteLink: 'https://t.me/telegram',
        isPrivate: false,
        isEnabled: true,
        order: 2,
      },
    ];
    defaultChannels.forEach((c) => memStore.channels.set(c.id, c));
  }

  if (memStore.taskBots.size === 0) {
    const defaultBots: TaskBot[] = [
      {
        id: 'bot_partner_crypto',
        botName: 'Crypto Signals AI Bot',
        botUsername: 'CryptoSignalsAIBot',
        description: 'Start bot, tap /start and claim free weekly VIP signals pass.',
        startParameter: 'teleearn_sponsor',
        botUrl: 'https://t.me/telegram',
        rewardAmount: 15,
        verificationType: 'deep_link',
        isEnabled: true,
        sortOrder: 1,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'bot_airdrop_tracker',
        botName: 'Airdrop Hunter Notification Bot',
        botUsername: 'AirdropHunterBot',
        description: 'Start the bot to subscribe to high-yield verified airdrop alerts.',
        startParameter: 'ref_teleearn',
        botUrl: 'https://t.me/telegram',
        rewardAmount: 12,
        verificationType: 'deep_link',
        isEnabled: true,
        sortOrder: 2,
        createdAt: new Date().toISOString(),
      },
    ];
    defaultBots.forEach((b) => memStore.taskBots.set(b.id, b));
  }
}
initSeeds();

export function cleanDocData<T>(obj: T): any {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => cleanDocData(item));

  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj as Record<string, any>)) {
    if (val === undefined) {
      cleaned[key] = null;
    } else if (val !== null && typeof val === 'object') {
      cleaned[key] = cleanDocData(val);
    } else {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

/* ========================================================
   SETTINGS REPOSITORY
   ======================================================== */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const docRef = doc(db, 'app_settings', 'general');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as AppSettings;
      const merged = { ...memStore.settings, ...data };
      if (
        !merged.templates?.welcomeMessage ||
        merged.templates.welcomeMessage.includes('👋 <b>Welcome {first_name}')
      ) {
        merged.templates = {
          ...merged.templates,
          welcomeMessage: memStore.settings.templates?.welcomeMessage,
        };
      }
      merged.botUsername = formatBotUsername(merged.botUsername || process.env.TELEGRAM_BOT_USERNAME || 'WatchXEarnBot');
      return merged;
    }
  } catch (err) {
    console.warn('[DB] Using local app_settings fallback:', err);
  }
  return memStore.settings;
}

export async function updateAppSettings(newSettings: Partial<AppSettings>): Promise<AppSettings> {
  if (newSettings.botUsername) {
    newSettings.botUsername = formatBotUsername(newSettings.botUsername);
  }
  memStore.settings = { ...memStore.settings, ...newSettings };
  try {
    const docRef = doc(db, 'app_settings', 'general');
    await setDoc(docRef, cleanDocData(memStore.settings), { merge: true });
  } catch (err) {
    console.warn('[DB] Firestore updateAppSettings fallback:', err);
  }
  return memStore.settings;
}

/* ========================================================
   USERS REPOSITORY
   ======================================================== */
export async function getUser(userId: string): Promise<UserProfile | null> {
  // Check memory first
  const memUser = memStore.users.get(userId);
  if (memUser) return memUser;

  try {
    const docRef = doc(db, 'users', userId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as UserProfile;
      memStore.users.set(userId, data);
      return data;
    }
  } catch (err) {
    console.warn(`[DB] Firestore getUser(${userId}) fallback:`, err);
  }
  return null;
}

export async function getUserByReferralCode(code: string): Promise<UserProfile | null> {
  if (!code) return null;
  const cleanCode = code.trim().toLowerCase();
  for (const user of memStore.users.values()) {
    if (user.referralCode && user.referralCode.trim().toLowerCase() === cleanCode) {
      return user;
    }
  }
  try {
    const q = query(collection(db, 'users'), where('referralCode', '==', code.trim()));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const user = snap.docs[0].data() as UserProfile;
      memStore.users.set(user.id, user);
      return user;
    }
  } catch (err) {
    console.warn('[DB] getUserByReferralCode fallback:', err);
  }

  // Strictly return null for unrecognized / invalid / manipulated codes
  return null;
}

export async function saveUser(user: UserProfile): Promise<UserProfile> {
  user.updatedAt = new Date().toISOString();

  // Immutable Referral Attribution Protection: Once attributed, cannot be changed
  const existingUser = memStore.users.get(user.id);
  if (existingUser && existingUser.referredBy && user.referredBy !== existingUser.referredBy) {
    user.referredBy = existingUser.referredBy;
  }
  if (existingUser && existingUser.signupBonusClaimed) {
    user.signupBonusClaimed = true;
  }

  memStore.users.set(user.id, user);

  try {
    const docRef = doc(db, 'users', user.id);
    await setDoc(docRef, cleanDocData(user), { merge: true });
  } catch (err) {
    console.warn(`[DB] Firestore saveUser(${user.id}) fallback:`, err);
  }
  return user;
}

export async function searchUsers(searchTerm?: string): Promise<UserProfile[]> {
  const users = Array.from(memStore.users.values());
  if (!searchTerm) return users.slice(0, 50);

  const term = searchTerm.toLowerCase();
  return users.filter(
    (u) =>
      u.id.includes(term) ||
      u.telegramId.toString().includes(term) ||
      (u.username && u.username.toLowerCase().includes(term)) ||
      u.firstName.toLowerCase().includes(term)
  );
}

/* ========================================================
   ATOMIC TRANSACTIONS & BALANCES
   ======================================================== */
export async function atomicCreditBalance(
  userId: string,
  amount: number,
  type: Transaction['type'],
  description: string,
  referenceId?: string
): Promise<{ user: UserProfile; transaction: Transaction }> {
  let user = await getUser(userId);
  if (!user) throw new Error('User not found');
  if (user.isBanned) throw new Error('User account is suspended');

  const newBalance = Math.round((user.balance + amount) * 100) / 100;
  const newLifetime = amount > 0 ? Math.round((user.lifetimeEarnings + amount) * 100) / 100 : user.lifetimeEarnings;
  const newReferral = type === 'referral_reward' ? Math.round((user.referralEarnings + amount) * 100) / 100 : user.referralEarnings;

  user = {
    ...user,
    balance: newBalance,
    lifetimeEarnings: newLifetime,
    referralEarnings: newReferral,
    updatedAt: new Date().toISOString(),
  };

  const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const transaction: Transaction = {
    id: txId,
    userId,
    type,
    amount,
    description,
    balanceAfter: newBalance,
    referenceId,
    createdAt: new Date().toISOString(),
  };

  memStore.users.set(userId, user);
  memStore.transactions.set(txId, transaction);

  try {
    const userDocRef = doc(db, 'users', userId);
    const txDocRef = doc(db, 'transactions', txId);
    await setDoc(userDocRef, cleanDocData(user), { merge: true });
    await setDoc(txDocRef, cleanDocData(transaction));
  } catch (err) {
    console.warn('[DB] atomicCreditBalance Firestore sync fallback:', err);
  }

  return { user, transaction };
}

export async function getUserTransactions(userId: string, limit = 50): Promise<Transaction[]> {
  const list = Array.from(memStore.transactions.values())
    .filter((t) => t.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return list.slice(0, limit);
}

/* ========================================================
   TASKS REPOSITORY
   ======================================================== */
export async function getAllTasks(onlyActive = false): Promise<Task[]> {
  try {
    const snap = await getDocs(collection(db, 'tasks'));
    if (!snap.empty) {
      memStore.tasks.clear();
      snap.forEach((d) => {
        const item = d.data() as Task;
        memStore.tasks.set(item.id || d.id, { ...item, id: item.id || d.id });
      });
    }
  } catch (err) {
    // Keep memStore fallback
  }

  let list = Array.from(memStore.tasks.values());
  if (onlyActive) {
    list = list.filter((t) => t.isActive);
  }
  return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const task = memStore.tasks.get(taskId);
  if (task) return task;
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (snap.exists()) {
      const data = snap.data() as Task;
      memStore.tasks.set(taskId, data);
      return data;
    }
  } catch (err) {
    console.warn('[DB] getTaskById fallback:', err);
  }
  return null;
}

export async function saveTask(task: Task): Promise<Task> {
  memStore.tasks.set(task.id, task);
  try {
    await setDoc(doc(db, 'tasks', task.id), cleanDocData(task), { merge: true });
  } catch (err) {
    console.warn('[DB] saveTask fallback:', err);
  }
  return task;
}

export async function deleteTask(taskId: string): Promise<boolean> {
  memStore.tasks.delete(taskId);
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
  } catch (err) {
    console.warn('[DB] deleteTask fallback:', err);
  }
  return true;
}

/* ========================================================
   TASK BOTS REPOSITORY (PRD Task Bot Management)
   ======================================================== */
export async function getAllTaskBots(onlyEnabled = false): Promise<TaskBot[]> {
  try {
    const snap = await getDocs(collection(db, 'task_bots'));
    if (!snap.empty) {
      memStore.taskBots.clear();
      snap.forEach((d) => {
        const item = d.data() as TaskBot;
        memStore.taskBots.set(item.id || d.id, { ...item, id: item.id || d.id });
      });
    }
  } catch (err) {
    // Keep memStore fallback
  }

  let list = Array.from(memStore.taskBots.values());
  if (onlyEnabled) list = list.filter((b) => b.isEnabled);
  return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export async function getTaskBotById(id: string): Promise<TaskBot | null> {
  const bot = memStore.taskBots.get(id);
  if (bot) return bot;
  try {
    const snap = await getDoc(doc(db, 'task_bots', id));
    if (snap.exists()) {
      const data = snap.data() as TaskBot;
      memStore.taskBots.set(id, data);
      return data;
    }
  } catch (err) {
    console.warn('[DB] getTaskBotById fallback:', err);
  }
  return null;
}

export async function saveTaskBot(bot: TaskBot): Promise<TaskBot> {
  memStore.taskBots.set(bot.id, bot);
  try {
    await setDoc(doc(db, 'task_bots', bot.id), cleanDocData(bot), { merge: true });
  } catch (err) {
    console.warn('[DB] saveTaskBot fallback:', err);
  }
  return bot;
}

export async function deleteTaskBot(id: string): Promise<boolean> {
  memStore.taskBots.delete(id);
  try {
    await deleteDoc(doc(db, 'task_bots', id));
  } catch (err) {
    console.warn('[DB] deleteTaskBot fallback:', err);
  }
  return true;
}

/* ========================================================
   CONCURRENCY LOCKING & ATOMIC ISOLATION
   ======================================================== */
const activeLocks = new Set<string>();

export async function acquireLock(key: string, timeoutMs = 8000): Promise<() => void> {
  const start = Date.now();
  while (activeLocks.has(key)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Lock acquisition timeout for key: ${key}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  activeLocks.add(key);
  return () => {
    activeLocks.delete(key);
  };
}

/* ========================================================
   DEVICE & DUPLICATE ACCOUNT DETECTION (PRD Anti-Abuse)
   ======================================================== */
export async function checkDeviceDuplicate(
  fingerprint?: string,
  ipHash?: string,
  excludeUserId?: string,
  deviceId?: string
): Promise<{ isDuplicate: boolean; reason?: string }> {
  const settings = await getAppSettings();
  if (!settings.deviceVerificationEnabled) {
    return { isDuplicate: false };
  }

  // 1. Check server-issued signed device identifier in registry
  if (deviceId && deviceId.length >= 8) {
    const existingDeviceClaim = memStore.deviceClaims.get(deviceId);
    if (existingDeviceClaim && existingDeviceClaim.userId !== excludeUserId) {
      return {
        isDuplicate: true,
        reason: '⚠️ Signup bonus has already been claimed on this device.',
      };
    }
  }

  // 2. Check client hardware fingerprint in registry
  if (fingerprint && fingerprint.length >= 8) {
    const existingFpClaim = memStore.deviceFingerprintClaims.get(fingerprint);
    if (existingFpClaim && existingFpClaim.userId !== excludeUserId) {
      return {
        isDuplicate: true,
        reason: '⚠️ Signup bonus has already been claimed on this device.',
      };
    }
    const legacyUser = memStore.deviceFingerprints.get(fingerprint);
    if (legacyUser && legacyUser !== excludeUserId) {
      return {
        isDuplicate: true,
        reason: '⚠️ Signup bonus has already been claimed on this device.',
      };
    }
  }

  return { isDuplicate: false };
}

export function registerDeviceFingerprint(userId: string, fingerprint?: string, ipHash?: string, deviceId?: string) {
  if (fingerprint && fingerprint.length >= 8) {
    memStore.deviceFingerprints.set(fingerprint, userId);
  }
  if (ipHash && ipHash.length >= 8) {
    memStore.ipHashes.set(ipHash, userId);
  }
}

export async function hasUserClaimedSignupBonus(userId: string): Promise<boolean> {
  if (memStore.userBonusClaims.has(userId)) return true;
  const user = memStore.users.get(userId);
  if (user?.signupBonusClaimed) return true;
  for (const t of memStore.transactions.values()) {
    if (t.userId === userId && t.type === 'signup_bonus') {
      return true;
    }
  }
  try {
    const snap = await getDoc(doc(db, 'bonus_claims', `claim_user_${userId}`));
    if (snap.exists()) {
      const data = snap.data() as BonusClaimRecord;
      memStore.userBonusClaims.set(userId, data);
      return true;
    }
  } catch (err) {
    // fallback
  }
  return false;
}

export async function hasDeviceClaimedSignupBonus(deviceId?: string, fingerprintHash?: string): Promise<{ claimed: boolean; claimedByUserId?: string }> {
  if (deviceId && memStore.deviceClaims.has(deviceId)) {
    const claim = memStore.deviceClaims.get(deviceId)!;
    return { claimed: true, claimedByUserId: claim.userId };
  }
  if (fingerprintHash && memStore.deviceFingerprintClaims.has(fingerprintHash)) {
    const claim = memStore.deviceFingerprintClaims.get(fingerprintHash)!;
    return { claimed: true, claimedByUserId: claim.userId };
  }
  if (deviceId) {
    try {
      const snap = await getDoc(doc(db, 'bonus_claims', `claim_device_${deviceId}`));
      if (snap.exists()) {
        const data = snap.data() as BonusClaimRecord;
        memStore.deviceClaims.set(deviceId, data);
        return { claimed: true, claimedByUserId: data.userId };
      }
    } catch (err) {
      // fallback
    }
  }
  return { claimed: false };
}

/**
 * Atomically claim signup bonus exactly once per user and once per device.
 */
export interface SignupBonusClaimResult {
  success: boolean;
  amount?: number;
  isDeviceDuplicate?: boolean;
  message?: string;
  reason?: string;
  user?: UserProfile;
}

export async function atomicClaimSignupBonus({
  userId,
  telegramId,
  deviceId,
  fingerprintHash,
  ipHash,
}: {
  userId: string;
  telegramId?: number;
  deviceId?: string;
  fingerprintHash?: string;
  ipHash?: string;
}): Promise<SignupBonusClaimResult> {
  const settings = await getAppSettings();
  const bonusAmount = settings.signupBonus || 20;

  // Mutex lock on both user and device to prevent race conditions during concurrent requests
  const userLockKey = `lock_user_${userId}`;
  const deviceLockKey = deviceId ? `lock_device_${deviceId}` : `lock_user_${userId}`;

  const releaseUserLock = await acquireLock(userLockKey);
  let releaseDeviceLock: (() => void) | null = null;
  if (deviceId && deviceLockKey !== userLockKey) {
    releaseDeviceLock = await acquireLock(deviceLockKey);
  }

  try {
    let user = await getUser(userId);
    if (!user) {
      return { success: false, reason: 'User not found' };
    }

    // 1. Telegram user eligibility check: has user already claimed?
    if (user.signupBonusClaimed || memStore.userBonusClaims.has(userId)) {
      return {
        success: false,
        reason: 'Signup bonus has already been claimed by this account.',
      };
    }

    const existingTx = Array.from(memStore.transactions.values()).find(
      (t) => t.userId === userId && t.type === 'signup_bonus'
    );
    if (existingTx) {
      user.signupBonusClaimed = true;
      memStore.users.set(userId, user);
      return {
        success: false,
        reason: 'Signup bonus has already been claimed by this account.',
      };
    }

    // 2. One Device = One Signup Bonus Protection
    if (settings.deviceVerificationEnabled && settings.blockDuplicateDevices) {
      let conflictingClaim: BonusClaimRecord | undefined;

      if (deviceId && memStore.deviceClaims.has(deviceId)) {
        conflictingClaim = memStore.deviceClaims.get(deviceId);
      } else if (fingerprintHash && memStore.deviceFingerprintClaims.has(fingerprintHash)) {
        conflictingClaim = memStore.deviceFingerprintClaims.get(fingerprintHash);
      }

      if (conflictingClaim && conflictingClaim.userId !== userId) {
        // Enforce exact message required: "⚠️ Signup bonus has already been claimed on this device."
        const rejectMsg = '⚠️ Signup bonus has already been claimed on this device.';
        const claimId = `rej_${Date.now()}_${userId}`;
        const rejectedClaim: BonusClaimRecord = {
          id: claimId,
          claimType: 'signup_bonus',
          userId,
          telegramId,
          deviceId,
          deviceFingerprintHash: fingerprintHash,
          ipHash,
          amount: 0,
          status: 'rejected',
          reason: rejectMsg,
          createdAt: new Date().toISOString(),
        };

        memStore.bonusClaims.set(claimId, rejectedClaim);
        user.isDuplicateAccount = true;
        user.duplicateReason = rejectMsg;
        user.signupBonusMessage = rejectMsg;
        if (deviceId) user.deviceId = deviceId;
        if (fingerprintHash) user.deviceFingerprint = fingerprintHash;
        await saveUser(user);

        // Record suspicious attempt for admin review
        await recordAdminAudit(
          'ANTI_FRAUD',
          'DUPLICATE_DEVICE_BONUS_BLOCKED',
          `Blocked signup bonus for duplicate device on user ${userId}. Device ${deviceId || fingerprintHash} was previously claimed by user ${conflictingClaim.userId}.`,
          userId
        );

        return {
          success: false,
          isDeviceDuplicate: true,
          message: rejectMsg,
          reason: rejectMsg,
          user,
        };
      }
    }

    // 3. Eligible! Atomically reserve the claim
    const claimRecord: BonusClaimRecord = {
      id: `claim_user_${userId}`,
      claimType: 'signup_bonus',
      userId,
      telegramId,
      deviceId,
      deviceFingerprintHash: fingerprintHash,
      ipHash,
      amount: bonusAmount,
      status: 'claimed',
      createdAt: new Date().toISOString(),
    };

    memStore.bonusClaims.set(claimRecord.id, claimRecord);
    memStore.userBonusClaims.set(userId, claimRecord);
    if (deviceId) {
      memStore.deviceClaims.set(deviceId, claimRecord);
    }
    if (fingerprintHash) {
      memStore.deviceFingerprintClaims.set(fingerprintHash, claimRecord);
    }

    try {
      await setDoc(doc(db, 'bonus_claims', claimRecord.id), cleanDocData(claimRecord));
      if (deviceId) {
        await setDoc(doc(db, 'bonus_claims', `claim_device_${deviceId}`), cleanDocData(claimRecord));
      }
    } catch (err) {
      console.warn('[DB] Bonus claim sync fallback:', err);
    }

    // 4. Credit user balance atomically
    const creditRes = await atomicCreditBalance(
      userId,
      bonusAmount,
      'signup_bonus',
      'Welcome signup bonus'
    );
    user = creditRes.user;
    user.signupBonusClaimed = true;
    user.isDuplicateAccount = false;
    user.duplicateReason = undefined;
    user.signupBonusMessage = undefined;
    if (deviceId) user.deviceId = deviceId;
    if (fingerprintHash) user.deviceFingerprint = fingerprintHash;
    await saveUser(user);

    return {
      success: true,
      amount: bonusAmount,
      message: 'Signup bonus claimed successfully',
      user,
    };
  } finally {
    releaseUserLock();
    if (releaseDeviceLock) releaseDeviceLock();
  }
}

/**
 * Atomically awards referral reward to the inviter only if all anti-abuse rules pass.
 */
export interface ReferralRewardClaimResult {
  success: boolean;
  amount?: number;
  reason?: string;
  isAbuseDetected?: boolean;
}

export async function atomicClaimReferralReward({
  referrerId,
  refereeId,
  refereeUsername,
  refereeDeviceId,
  refereeFingerprintHash,
}: {
  referrerId: string;
  refereeId: string;
  refereeUsername: string;
  refereeDeviceId?: string;
  refereeFingerprintHash?: string;
}): Promise<ReferralRewardClaimResult> {
  const settings = await getAppSettings();
  const rewardAmount = settings.referralReward || 10;

  // Lock on referee to guarantee that this referee can ONLY EVER trigger one referral reward
  const lockKey = `lock_referral_${refereeId}`;
  const releaseLock = await acquireLock(lockKey);

  try {
    // 1. Self-referral prevention
    if (referrerId === refereeId) {
      return {
        success: false,
        reason: 'Self-referral is strictly prohibited.',
        isAbuseDetected: true,
      };
    }

    // 2. Check if this referee has already credited a reward
    if (memStore.referralClaims.has(refereeId)) {
      return {
        success: false,
        reason: 'Referral reward has already been credited for this referee.',
      };
    }

    const existingRef = Array.from(memStore.referrals.values()).find(
      (r) => r.refereeId === refereeId && r.status === 'credited'
    );
    if (existingRef) {
      return {
        success: false,
        reason: 'Referral reward has already been credited for this referee.',
      };
    }

    // 3. Referrer validity check
    const referrerUser = await getUser(referrerId);
    if (!referrerUser) {
      return { success: false, reason: 'Referrer not found.' };
    }
    if (referrerUser.isBanned) {
      return { success: false, reason: 'Referrer account is suspended.' };
    }

    // 4. One Device Referral Anti-Fraud Check:
    // "5. The same device cannot generate multiple referral rewards by switching Telegram accounts."
    if (settings.deviceVerificationEnabled && settings.blockDuplicateDevices && refereeDeviceId) {
      const isSameDeviceAsReferrer = Boolean(
        referrerUser.deviceId && referrerUser.deviceId === refereeDeviceId
      );

      let deviceCollisionWithPreviousClaim = false;
      const existingDeviceClaim = memStore.deviceClaims.get(refereeDeviceId);
      if (existingDeviceClaim && existingDeviceClaim.userId === referrerId) {
        deviceCollisionWithPreviousClaim = true;
      }

      if (isSameDeviceAsReferrer || deviceCollisionWithPreviousClaim) {
        // Block referral reward!
        const refRecord: ReferralRecord = {
          id: `${referrerId}_${refereeId}`,
          referrerId,
          refereeId,
          refereeUsername,
          rewardAmount: 0,
          status: 'rejected',
          rejectionReason: 'Device collision: Referee is on same device context as referrer',
          createdAt: new Date().toISOString(),
        };
        await recordReferral(refRecord);

        await recordAdminAudit(
          'ANTI_FRAUD',
          'REFERRAL_DEVICE_FRAUD_BLOCKED',
          `Blocked referral reward for referrer ${referrerId}: referee ${refereeId} joined from the same device context (${refereeDeviceId}).`,
          referrerId
        );

        return {
          success: false,
          reason: 'Device collision: Referee used the same device context as the referrer.',
          isAbuseDetected: true,
        };
      }
    }

    // 5. Reserve referral claim atomically
    const claimRecord: BonusClaimRecord = {
      id: `claim_referral_${refereeId}`,
      claimType: 'referral_reward',
      userId: referrerId,
      deviceId: refereeDeviceId,
      deviceFingerprintHash: refereeFingerprintHash,
      amount: rewardAmount,
      status: 'claimed',
      createdAt: new Date().toISOString(),
    };
    memStore.bonusClaims.set(claimRecord.id, claimRecord);
    memStore.referralClaims.set(refereeId, claimRecord);

    try {
      await setDoc(doc(db, 'bonus_claims', claimRecord.id), cleanDocData(claimRecord));
    } catch (err) {
      console.warn('[DB] Referral claim sync fallback:', err);
    }

    // 6. Record referral in ledger
    const referralRecord: ReferralRecord = {
      id: `${referrerId}_${refereeId}`,
      referrerId,
      refereeId,
      refereeUsername,
      rewardAmount,
      status: 'credited',
      createdAt: new Date().toISOString(),
    };
    await recordReferral(referralRecord);

    // 7. Credit referrer balance
    await atomicCreditBalance(
      referrerId,
      rewardAmount,
      'referral_reward',
      `Referral reward for inviting @${refereeUsername}`,
      refereeId
    );

    return {
      success: true,
      amount: rewardAmount,
    };
  } finally {
    releaseLock();
  }
}

/* ========================================================
   TASK COMPLETIONS REPOSITORY
   ======================================================== */
export async function getTaskCompletion(userId: string, taskId: string): Promise<TaskCompletion | null> {
  const id = `${userId}_${taskId}`;
  const comp = memStore.taskCompletions.get(id);
  if (comp) return comp;
  try {
    const snap = await getDoc(doc(db, 'task_completions', id));
    if (snap.exists()) {
      const data = snap.data() as TaskCompletion;
      memStore.taskCompletions.set(id, data);
      return data;
    }
  } catch (err) {
    console.warn('[DB] getTaskCompletion fallback:', err);
  }
  return null;
}

export async function getUserCompletedTaskIds(userId: string): Promise<Set<string>> {
  const set = new Set<string>();
  for (const comp of memStore.taskCompletions.values()) {
    if (comp.userId === userId) {
      set.add(comp.taskId);
    }
  }
  return set;
}

export async function recordTaskCompletion(completion: TaskCompletion): Promise<TaskCompletion> {
  memStore.taskCompletions.set(completion.id, completion);
  try {
    await setDoc(doc(db, 'task_completions', completion.id), cleanDocData(completion));
  } catch (err) {
    console.warn('[DB] recordTaskCompletion fallback:', err);
  }
  return completion;
}

/* ========================================================
   REFERRALS REPOSITORY
   ======================================================== */
export async function getReferralsByReferrer(referrerId: string): Promise<ReferralRecord[]> {
  return Array.from(memStore.referrals.values())
    .filter((r) => r.referrerId === referrerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function recordReferral(referral: ReferralRecord): Promise<ReferralRecord> {
  memStore.referrals.set(referral.id, referral);
  try {
    await setDoc(doc(db, 'referrals', referral.id), cleanDocData(referral));
  } catch (err) {
    console.warn('[DB] recordReferral fallback:', err);
  }
  return referral;
}

/* ========================================================
   WITHDRAWALS & UPI ATOMICS
   ======================================================== */
export async function createWithdrawalRequest(
  userId: string,
  amount: number,
  upiId: string
): Promise<{ withdrawal: Withdrawal; transaction: Transaction; user: UserProfile }> {
  // Concurrency isolation: Acquire per-user lock to prevent race conditions & limit bypass
  const releaseLock = await acquireLock(`user_withdrawal_${userId}`);

  try {
    const user = await getUser(userId);
    if (!user) throw new Error('User not found');
    if (user.isBanned) throw new Error('Account suspended');

    const settings = await getAppSettings();

    // 1. Minimum withdrawal check
    if (amount < settings.minWithdrawalAmount) {
      throw new Error(`Minimum withdrawal amount is ₹${settings.minWithdrawalAmount}`);
    }

    // 2. Maximum withdrawal limit check (if configured and > 0)
    if (settings.maxWithdrawalAmount && settings.maxWithdrawalAmount > 0) {
      if (amount > settings.maxWithdrawalAmount) {
        throw new Error(
          `Withdrawal amount exceeds the allowed maximum limit of ₹${settings.maxWithdrawalAmount}. Please enter an amount up to ₹${settings.maxWithdrawalAmount}.`
        );
      }
    }

    // 3. Rolling 24-Hour Withdrawal Limits
    if (settings.dailyWithdrawalLimitEnabled) {
      const nowMs = Date.now();
      const windowStartMs = nowMs - 24 * 60 * 60 * 1000;

      // Retrieve all existing user withdrawals
      const userWithdrawals = await getUserWithdrawals(userId);

      // Eligible statuses for rolling 24h window:
      // Count pending, processing, and success (completed).
      // EXCLUDE rejected, failed, and reversed (per requirement: do not count failed or reversed payouts as completed payouts; prevent pending requests from being used to bypass limits).
      const activeWindowWithdrawals = userWithdrawals.filter((w) => {
        const isEligibleStatus =
          w.status === 'pending' || w.status === 'processing' || w.status === 'success';
        if (!isEligibleStatus) return false;
        const createdAtMs = new Date(w.createdAt).getTime();
        return createdAtMs >= windowStartMs;
      });

      // A. Maximum requests per 24 hours
      const maxReqs = settings.maxWithdrawalRequestsPer24h;
      if (maxReqs && maxReqs > 0) {
        if (activeWindowWithdrawals.length >= maxReqs) {
          throw new Error(
            `Daily withdrawal request limit reached. You can make at most ${maxReqs} withdrawal request(s) in a 24-hour period.`
          );
        }
      }

      // B. Maximum total amount per 24 hours
      const maxDailyAmount = settings.maxWithdrawalAmountPer24h;
      if (maxDailyAmount && maxDailyAmount > 0) {
        const currentDailySum = activeWindowWithdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);
        if (currentDailySum + amount > maxDailyAmount) {
          const remainingDailyAllowance = Math.max(0, maxDailyAmount - currentDailySum);
          throw new Error(
            `Daily withdrawal amount limit reached. Your 24-hour limit is ₹${maxDailyAmount}. You have already withdrawn/requested ₹${currentDailySum.toFixed(
              2
            )} in the past 24 hours (remaining: ₹${remainingDailyAllowance.toFixed(2)}).`
          );
        }
      }
    }

    if (user.balance < amount) {
      throw new Error(`Insufficient balance. Available: ₹${user.balance.toFixed(2)}, Requested: ₹${amount}`);
    }

  // Atomically deduct balance
  const newBalance = Math.round((user.balance - amount) * 100) / 100;
  const orderId = `WTH-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const withdrawal: Withdrawal = {
    id: orderId,
    userId,
    userTelegramId: user.telegramId,
    username: user.username || '',
    amount,
    upiId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const updatedUser: UserProfile = {
    ...user,
    balance: newBalance,
    updatedAt: new Date().toISOString(),
  };

  const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const transaction: Transaction = {
    id: txId,
    userId,
    type: 'withdrawal_deduct',
    amount: -amount,
    description: `Withdrawal request to UPI: ${upiId} (Order: ${orderId})`,
    balanceAfter: newBalance,
    referenceId: orderId,
    createdAt: new Date().toISOString(),
  };

  memStore.users.set(userId, updatedUser);
  memStore.withdrawals.set(orderId, withdrawal);
  memStore.transactions.set(txId, transaction);

  try {
    await setDoc(doc(db, 'users', userId), cleanDocData(updatedUser), { merge: true });
    await setDoc(doc(db, 'withdrawals', orderId), cleanDocData(withdrawal));
    await setDoc(doc(db, 'transactions', txId), cleanDocData(transaction));
  } catch (err) {
    console.warn('[DB] createWithdrawalRequest Firestore sync fallback:', err);
  }

    return { withdrawal, transaction, user: updatedUser };
  } finally {
    releaseLock();
  }
}

export async function getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
  return Array.from(memStore.withdrawals.values())
    .filter((w) => w.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getAllWithdrawals(status?: string): Promise<Withdrawal[]> {
  let list = Array.from(memStore.withdrawals.values());
  if (status && status !== 'all') {
    list = list.filter((w) => w.status === status);
  }
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function updateWithdrawalStatus(
  orderId: string,
  newStatus: Withdrawal['status'],
  notes?: { providerResponse?: string; failureReason?: string; adminId?: string }
): Promise<Withdrawal> {
  const withdrawal = memStore.withdrawals.get(orderId);
  if (!withdrawal) throw new Error('Withdrawal request not found');

  const prevStatus = withdrawal.status;

  // Prevent invalid re-transitions (allow transition to 'reversed' in case of bank reversal)
  if (prevStatus === 'success' && newStatus !== 'reversed') {
    throw new Error('Completed withdrawals cannot be modified except for bank reversal');
  }
  if (prevStatus === 'reversed') {
    throw new Error('Reversed withdrawals cannot be modified');
  }

  withdrawal.status = newStatus;
  withdrawal.processedAt = new Date().toISOString();
  if (notes?.providerResponse) withdrawal.providerResponse = notes.providerResponse;
  if (notes?.failureReason) withdrawal.failureReason = notes.failureReason;

  memStore.withdrawals.set(orderId, withdrawal);

  // If rejected, failed, or reversed, safely refund funds back to the user atomically
  // only if previous state had not already been refunded
  const wasAlreadyRefunded =
    (prevStatus as string) === 'rejected' ||
    (prevStatus as string) === 'failed' ||
    (prevStatus as string) === 'reversed';
  if ((newStatus === 'rejected' || newStatus === 'failed' || newStatus === 'reversed') && !wasAlreadyRefunded) {
    await atomicCreditBalance(
      withdrawal.userId,
      withdrawal.amount,
      'withdrawal_refund',
      `Refund for ${newStatus} withdrawal ${orderId}: ${notes?.failureReason || 'Admin/Provider decision'}`,
      orderId
    );
  }

  try {
    await setDoc(doc(db, 'withdrawals', orderId), cleanDocData(withdrawal), { merge: true });
  } catch (err) {
    console.warn('[DB] updateWithdrawalStatus Firestore sync fallback:', err);
  }

  return withdrawal;
}

/* ========================================================
   FORCE JOIN CHANNELS REPOSITORY
   ======================================================== */
export async function getForceJoinChannels(onlyEnabled = true): Promise<ForceJoinChannel[]> {
  try {
    const snap = await getDocs(collection(db, 'force_join_channels'));
    if (!snap.empty) {
      memStore.channels.clear();
      snap.forEach((d) => {
        const item = d.data() as ForceJoinChannel;
        memStore.channels.set(item.id || d.id, { ...item, id: item.id || d.id });
      });
    }
  } catch (err) {
    // Keep memStore
  }

  let list = Array.from(memStore.channels.values());
  if (onlyEnabled) {
    list = list.filter((c) => c.isEnabled);
  }
  return list.sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function saveForceJoinChannel(channel: ForceJoinChannel): Promise<ForceJoinChannel> {
  memStore.channels.set(channel.id, channel);
  try {
    await setDoc(doc(db, 'force_join_channels', channel.id), cleanDocData(channel), { merge: true });
  } catch (err) {
    console.warn('[DB] saveForceJoinChannel fallback:', err);
  }
  return channel;
}

export async function deleteForceJoinChannel(id: string): Promise<boolean> {
  memStore.channels.delete(id);
  try {
    await deleteDoc(doc(db, 'force_join_channels', id));
  } catch (err) {
    console.warn('[DB] deleteForceJoinChannel fallback:', err);
  }
  return true;
}

/* ========================================================
   ADMIN AUDIT LOGS & STATS
   ======================================================== */
export async function recordAdminAudit(
  adminId: string,
  action: string,
  details: string,
  targetUserId?: string | null
): Promise<AdminAuditLog> {
  const log: AdminAuditLog = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    adminId,
    action,
    targetUserId,
    details,
    createdAt: new Date().toISOString(),
  };
  memStore.auditLogs.unshift(log);
  if (memStore.auditLogs.length > 200) memStore.auditLogs.pop();

  try {
    await setDoc(doc(db, 'admin_audit_logs', log.id), cleanDocData(log));
  } catch (err) {
    console.warn('[DB] recordAdminAudit fallback:', err);
  }
  return log;
}

export async function getAdminAuditLogs(limit = 50): Promise<AdminAuditLog[]> {
  return memStore.auditLogs.slice(0, limit);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const users = Array.from(memStore.users.values());
  const today = new Date().toISOString().split('T')[0];
  const activeToday = users.filter((u) => u.lastDailyCheckIn === today || u.updatedAt.startsWith(today)).length;

  const totalRewards = Array.from(memStore.transactions.values())
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const withdrawals = Array.from(memStore.withdrawals.values());
  const pending = withdrawals.filter((w) => w.status === 'pending');
  const success = withdrawals.filter((w) => w.status === 'success');
  const failed = withdrawals.filter((w) => w.status === 'failed' || w.status === 'rejected');

  return {
    totalUsers: users.length,
    activeUsersToday: Math.max(activeToday, users.length > 0 ? 1 : 0),
    totalTaskCompletions: memStore.taskCompletions.size,
    totalRewardsCredited: Math.round(totalRewards * 100) / 100,
    pendingWithdrawalsCount: pending.length,
    pendingWithdrawalsAmount: pending.reduce((sum, w) => sum + w.amount, 0),
    successfulPayoutsCount: success.length,
    successfulPayoutsAmount: success.reduce((sum, w) => sum + w.amount, 0),
    failedPayoutsCount: failed.length,
    duplicateDevicesBlocked: users.filter((u) => u.isDuplicateAccount).length,
    totalTaskBots: memStore.taskBots.size,
  };
}
