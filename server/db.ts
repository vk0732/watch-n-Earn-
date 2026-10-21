import dotenv from 'dotenv';
dotenv.config();

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
  GiftCardCode,
  GiftCardInventoryStats,
  BulkBalanceResetPreview,
  BulkBalanceResetResult,
  MandatoryWithdrawalVerificationResult,
  WithdrawalReferralEligibility,
} from '../src/types/index.ts';
import { formatBotUsername, checkTelegramChannelMembership } from './telegram.ts';
import { isSupabaseEnabled, supabaseRedeemGiftCard, supabaseCreditBalance, supabaseBulkResetBalances } from './supabase.ts';

// Multi-Tier Database Isolation Configuration for Independent Clones
export function getDbPrefix(): string {
  return (process.env.DB_PREFIX || process.env.COLLECTION_PREFIX || '').trim();
}

export const DB_PREFIX = getDbPrefix();

export function getColName(collectionName: string): string {
  const prefix = getDbPrefix();
  return prefix ? `${prefix}_${collectionName}` : collectionName;
}

const customFirebaseConfig = process.env.FIREBASE_CONFIG_JSON
  ? JSON.parse(process.env.FIREBASE_CONFIG_JSON)
  : {
      ...firebaseConfig,
      projectId: process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId,
      apiKey: process.env.FIREBASE_API_KEY || firebaseConfig.apiKey,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
      appId: process.env.FIREBASE_APP_ID || firebaseConfig.appId,
    };

const firestoreDatabaseId = (
  process.env.FIRESTORE_DATABASE_ID ||
  firebaseConfig.firestoreDatabaseId ||
  '(default)'
).trim();

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(customFirebaseConfig) : getApp();
export const db: Firestore = getFirestore(app, firestoreDatabaseId);

// In-Memory Fallback store to guarantee zero downtime and blazing fast tests
export const memStore = {
  users: new Map<string, UserProfile>(),
  tasks: new Map<string, Task>(),
  taskBots: new Map<string, TaskBot>(),
  taskCompletions: new Map<string, TaskCompletion>(),
  referrals: new Map<string, ReferralRecord>(),
  transactions: new Map<string, Transaction>(),
  withdrawals: new Map<string, Withdrawal>(),
  giftCardCodes: new Map<string, GiftCardCode>(),
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
    maxScratchSignupBonus: 10, // Admin-configurable Maximum Scratch Signup Bonus (default: ₹10)
    referralReward: 10, // PRD: ₹10 per referral
    dailyCheckinBaseReward: 5,
    dailyCheckinRewardDifference: 2,
    minWithdrawalAmount: 10, // PRD: ₹10 minimum withdrawal
    resetGeneration: 1, // Campaign generation for versioned reward re-eligibility
    withdrawalReferralRequirementEnabled: true,
    withdrawalReferralApplyFromCount: 2,
    withdrawalMinReferralsRequired: 1,
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
        '⚠️ <b>Mandatory Channel Verification</b>\n\nTo unlock task earnings and gift card redemptions, please join our official sponsor channels:\n\n{channels}\n\nTap "Verify Membership" once joined!',
      dailyRewardClaimed:
        '🎉 <b>Daily Streak Claimed!</b>\n\nYou received <b>+₹{amount}</b> for Day {streak}! Come back tomorrow for higher rewards.',
      taskCompleted:
        '✅ <b>Task Completed!</b>\n\nReward: <b>+₹{amount}</b> added to your balance for "{task_title}".',
      referralSuccess:
        '🤝 <b>New Referral Joined!</b>\n\nUser @{referee} joined using your invite link!\nYou earned <b>+₹{amount}</b> instant reward.',
      withdrawalReceived:
        '📤 <b>Gift Card Redemption Received</b>\n\nAmount: <b>₹{amount}</b>\nOrder ID: <code>{order_id}</code>\nStatus: <b>Processing Code Allocation</b>',
      withdrawalApproved:
        '✅ <b>Gift Card Delivered!</b>\n\nAmount: <b>₹{amount}</b> Amazon Gift Card\nCode: <code>{gift_card_code}</code>\nOrder ID: <code>{order_id}</code>',
      payoutProofBroadcast:
        '🎁 <b>NEW AMAZON GIFT CARD REDEEMED!</b>\n\n👤 Recipient: {masked_user}\n💰 Amount: <b>₹{amount}</b>\n🏷️ Method: <b>Amazon Gift Card Code</b>\n🆔 Order ID: <code>{order_id}</code>\n⚡ Status: <b>SUCCESS (Delivered)</b>\n\n🤖 <i>Earn daily with TeleEarn Bot!</i>',
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
    const docRef = doc(db, getColName('app_settings'), 'general');
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
      merged.dailyCheckinRewardDifference =
        typeof merged.dailyCheckinRewardDifference === 'number' && merged.dailyCheckinRewardDifference > 0
          ? merged.dailyCheckinRewardDifference
          : 2;
      merged.maxScratchSignupBonus =
        typeof merged.maxScratchSignupBonus === 'number' && merged.maxScratchSignupBonus > 0
          ? merged.maxScratchSignupBonus
          : 10;
      if (
        typeof merged.maxWithdrawalAmount === 'number' &&
        merged.maxWithdrawalAmount > 0 &&
        merged.maxWithdrawalAmount < (merged.minWithdrawalAmount || 10)
      ) {
        merged.maxWithdrawalAmount = 5000;
      }
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
    const docRef = doc(db, getColName('app_settings'), 'general');
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
  try {
    const docRef = doc(db, getColName('users'), userId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as UserProfile;
      memStore.users.set(userId, data);
      return data;
    }
  } catch (err) {
    console.warn(`[DB] Firestore getUser(${userId}) fallback:`, err);
  }
  return memStore.users.get(userId) || null;
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
    const q = query(collection(db, getColName('users')), where('referralCode', '==', code.trim()));
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
    const docRef = doc(db, getColName('users'), user.id);
    await setDoc(docRef, cleanDocData(user), { merge: true });
  } catch (err) {
    console.warn(`[DB] Firestore saveUser(${user.id}) fallback:`, err);
  }
  return user;
}

export async function searchUsers(searchTerm?: string): Promise<UserProfile[]> {
  try {
    if (memStore.users.size < 50) {
      const snap = await getDocs(collection(db, getColName('users')));
      snap.forEach((d) => {
        const u = d.data() as UserProfile;
        memStore.users.set(u.id || d.id, { ...u, id: u.id || d.id });
      });
    }
  } catch (err) {
    console.warn('[DB] searchUsers Firestore sync fallback:', err);
  }

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
  const releaseLock = await acquireLock(`lock_balance_${userId}`);
  try {
    const nowIso = new Date().toISOString();
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Supabase PostgreSQL Procedure (if configured)
    if (isSupabaseEnabled()) {
      const spRes = await supabaseCreditBalance(userId, amount, type, description, referenceId);
      if (spRes.success) {
        const freshUser = await getUser(userId);
        const txObj: Transaction = {
          id: spRes.data?.transaction_id || txId,
          userId,
          type,
          amount,
          description,
          balanceAfter: spRes.data?.balance_after ?? (freshUser?.balance || 0),
          referenceId,
          createdAt: nowIso,
        };
        memStore.transactions.set(txObj.id, txObj);
        if (freshUser) memStore.users.set(userId, freshUser);
        return { user: freshUser || (memStore.users.get(userId) as UserProfile), transaction: txObj };
      }
    }

    // 2. Firestore ACID Transaction
    try {
      const userDocRef = doc(db, getColName('users'), userId);
      const txDocRef = doc(db, getColName('transactions'), txId);

      const result = await runTransaction(db, async (txn) => {
        const userDoc = await txn.get(userDocRef);
        let currentUser: UserProfile;

        if (!userDoc.exists()) {
          const mem = memStore.users.get(userId);
          if (!mem) throw new Error('User not found');
          currentUser = mem;
        } else {
          currentUser = userDoc.data() as UserProfile;
        }

        if (currentUser.isBanned) throw new Error('User account is suspended');

        const newBalance = Math.round((currentUser.balance + amount) * 100) / 100;
        if (newBalance < 0) {
          throw new Error(
            `Insufficient balance. Current balance is ₹${currentUser.balance.toFixed(2)}, cannot deduct ₹${Math.abs(amount).toFixed(2)}.`
          );
        }

        const newLifetime =
          amount > 0 ? Math.round((currentUser.lifetimeEarnings + amount) * 100) / 100 : currentUser.lifetimeEarnings;
        const newReferral =
          type === 'referral_reward'
            ? Math.round((currentUser.referralEarnings + amount) * 100) / 100
            : currentUser.referralEarnings;

        const updatedUser: UserProfile = {
          ...currentUser,
          balance: newBalance,
          lifetimeEarnings: newLifetime,
          referralEarnings: newReferral,
          updatedAt: nowIso,
        };

        const txObj: Transaction = {
          id: txId,
          userId,
          type,
          amount,
          description,
          balanceAfter: newBalance,
          referenceId,
          createdAt: nowIso,
        };

        txn.set(userDocRef, cleanDocData(updatedUser), { merge: true });
        txn.set(txDocRef, cleanDocData(txObj));

        return { user: updatedUser, transaction: txObj };
      });

      memStore.users.set(userId, result.user);
      memStore.transactions.set(txId, result.transaction);
      return result;
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes('Insufficient balance') ||
          err.message.includes('suspended') ||
          err.message.includes('User not found'))
      ) {
        throw err;
      }
      console.warn('[DB] atomicCreditBalance Firestore sync fallback:', err);
      // Fallback
      let user = memStore.users.get(userId);
      if (!user) throw err;
      if (user.isBanned) throw new Error('User account is suspended');
      const newBalance = Math.round((user.balance + amount) * 100) / 100;
      if (newBalance < 0) {
        throw new Error(
          `Insufficient balance. Current balance is ₹${user.balance.toFixed(2)}, cannot deduct ₹${Math.abs(amount).toFixed(2)}.`
        );
      }
      const newLifetime = amount > 0 ? Math.round((user.lifetimeEarnings + amount) * 100) / 100 : user.lifetimeEarnings;
      const newReferral =
        type === 'referral_reward'
          ? Math.round((user.referralEarnings + amount) * 100) / 100
          : user.referralEarnings;
      user = {
        ...user,
        balance: newBalance,
        lifetimeEarnings: newLifetime,
        referralEarnings: newReferral,
        updatedAt: nowIso,
      };
      const transaction: Transaction = {
        id: txId,
        userId,
        type,
        amount,
        description,
        balanceAfter: newBalance,
        referenceId,
        createdAt: nowIso,
      };
      memStore.users.set(userId, user);
      memStore.transactions.set(txId, transaction);
      return { user, transaction };
    }
  } finally {
    releaseLock();
  }
}

export async function getUserTransactions(userId: string, limit = 50): Promise<Transaction[]> {
  try {
    const q = query(collection(db, getColName('transactions')), where('userId', '==', userId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const items: Transaction[] = [];
      snap.forEach((d) => {
        const item = d.data() as Transaction;
        const tx = { ...item, id: item.id || d.id };
        memStore.transactions.set(tx.id, tx);
        items.push(tx);
      });
      return items
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }
  } catch (err) {
    console.warn('[DB] Firestore getUserTransactions fallback:', err);
  }

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
    const snap = await getDocs(collection(db, getColName('tasks')));
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
    const snap = await getDoc(doc(db, getColName('tasks'), taskId));
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
    await setDoc(doc(db, getColName('tasks'), task.id), cleanDocData(task), { merge: true });
  } catch (err) {
    console.warn('[DB] saveTask fallback:', err);
  }
  return task;
}

export async function deleteTask(taskId: string): Promise<boolean> {
  memStore.tasks.delete(taskId);
  try {
    await deleteDoc(doc(db, getColName('tasks'), taskId));
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
    const snap = await getDocs(collection(db, getColName('task_bots')));
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
    const snap = await getDoc(doc(db, getColName('task_bots'), id));
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
    await setDoc(doc(db, getColName('task_bots'), bot.id), cleanDocData(bot), { merge: true });
  } catch (err) {
    console.warn('[DB] saveTaskBot fallback:', err);
  }
  return bot;
}

export async function deleteTaskBot(id: string): Promise<boolean> {
  memStore.taskBots.delete(id);
  try {
    await deleteDoc(doc(db, getColName('task_bots'), id));
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

export async function hasUserClaimedSignupBonus(userId: string, generation?: number): Promise<boolean> {
  const settings = await getAppSettings();
  const currentGen = generation || settings.resetGeneration || 1;

  const user = memStore.users.get(userId);
  if (user?.signupBonusClaimedGeneration && user.signupBonusClaimedGeneration >= currentGen) {
    return true;
  }
  // Legacy gen 1 check if user had signupBonusClaimed: true before generation versioning
  if (currentGen === 1 && user?.signupBonusClaimed) {
    return true;
  }

  const claimKey = `claim_user_${userId}_gen_${currentGen}`;
  if (memStore.bonusClaims.has(claimKey)) return true;
  if (currentGen === 1 && memStore.userBonusClaims.has(userId)) return true;

  for (const t of memStore.transactions.values()) {
    if (t.userId === userId && t.type === 'signup_bonus') {
      if (t.referenceId === `signup_bonus_gen_${currentGen}`) {
        return true;
      }
      if (currentGen === 1 && (!t.referenceId || t.referenceId === 'signup_bonus')) {
        return true;
      }
    }
  }

  try {
    const snap = await getDoc(doc(db, getColName('bonus_claims'), claimKey));
    if (snap.exists()) {
      const data = snap.data() as BonusClaimRecord;
      memStore.bonusClaims.set(claimKey, data);
      return true;
    }
    if (currentGen === 1) {
      const snapOld = await getDoc(doc(db, getColName('bonus_claims'), `claim_user_${userId}`));
      if (snapOld.exists()) {
        const data = snapOld.data() as BonusClaimRecord;
        memStore.userBonusClaims.set(userId, data);
        return true;
      }
    }
  } catch (err) {
    // fallback
  }
  return false;
}

export async function hasDeviceClaimedSignupBonus(
  deviceId?: string,
  fingerprintHash?: string,
  generation?: number
): Promise<{ claimed: boolean; claimedByUserId?: string }> {
  const settings = await getAppSettings();
  const currentGen = generation || settings.resetGeneration || 1;

  if (deviceId) {
    const devKey = `claim_device_${deviceId}_gen_${currentGen}`;
    if (memStore.bonusClaims.has(devKey)) {
      const claim = memStore.bonusClaims.get(devKey)!;
      return { claimed: true, claimedByUserId: claim.userId };
    }
    if (currentGen === 1 && memStore.deviceClaims.has(deviceId)) {
      const claim = memStore.deviceClaims.get(deviceId)!;
      return { claimed: true, claimedByUserId: claim.userId };
    }
  }
  if (fingerprintHash) {
    const fpKey = `claim_fp_${fingerprintHash}_gen_${currentGen}`;
    if (memStore.bonusClaims.has(fpKey)) {
      const claim = memStore.bonusClaims.get(fpKey)!;
      return { claimed: true, claimedByUserId: claim.userId };
    }
    if (currentGen === 1 && memStore.deviceFingerprintClaims.has(fingerprintHash)) {
      const claim = memStore.deviceFingerprintClaims.get(fingerprintHash)!;
      return { claimed: true, claimedByUserId: claim.userId };
    }
  }
  if (deviceId) {
    try {
      const snap = await getDoc(doc(db, getColName('bonus_claims'), `claim_device_${deviceId}_gen_${currentGen}`));
      if (snap.exists()) {
        const data = snap.data() as BonusClaimRecord;
        memStore.bonusClaims.set(`claim_device_${deviceId}_gen_${currentGen}`, data);
        return { claimed: true, claimedByUserId: data.userId };
      }
      if (currentGen === 1) {
        const snapOld = await getDoc(doc(db, getColName('bonus_claims'), `claim_device_${deviceId}`));
        if (snapOld.exists()) {
          const data = snapOld.data() as BonusClaimRecord;
          memStore.deviceClaims.set(deviceId, data);
          return { claimed: true, claimedByUserId: data.userId };
        }
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

    const currentGen = settings.resetGeneration || 1;
    const bonusAmount =
      typeof user.pendingSignupBonus === 'number' && user.pendingSignupBonus > 0
        ? user.pendingSignupBonus
        : settings.maxScratchSignupBonus || settings.signupBonus || 10;

    // 1. Telegram user eligibility check: has user already claimed for this generation?
    const alreadyClaimed = await hasUserClaimedSignupBonus(userId, currentGen);
    if (alreadyClaimed) {
      return {
        success: false,
        reason: 'Signup bonus has already been claimed by this account.',
      };
    }

    // 2. One Device = One Signup Bonus Protection for this generation
    if (settings.deviceVerificationEnabled && settings.blockDuplicateDevices) {
      let conflictingClaimUserId: string | undefined;

      const devCheck = await hasDeviceClaimedSignupBonus(deviceId, fingerprintHash, currentGen);
      if (devCheck.claimed && devCheck.claimedByUserId !== userId) {
        conflictingClaimUserId = devCheck.claimedByUserId;
      }

      if (conflictingClaimUserId) {
        // Enforce exact message required: "⚠️ Signup bonus has already been claimed on this device."
        const rejectMsg = '⚠️ Signup bonus has already been claimed on this device.';
        const claimId = `rej_${Date.now()}_${userId}_gen_${currentGen}`;
        const rejectedClaim: BonusClaimRecord = {
          id: claimId,
          claimType: 'signup_bonus',
          userId,
          telegramId,
          deviceId,
          deviceFingerprintHash: fingerprintHash,
          ipHash,
          amount: 0,
          generation: currentGen,
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
          `Blocked signup bonus for duplicate device on user ${userId}. Device ${deviceId || fingerprintHash} was previously claimed by user ${conflictingClaimUserId} in generation ${currentGen}.`,
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
      id: `claim_user_${userId}_gen_${currentGen}`,
      claimType: 'signup_bonus',
      userId,
      telegramId,
      deviceId,
      deviceFingerprintHash: fingerprintHash,
      ipHash,
      amount: bonusAmount,
      generation: currentGen,
      status: 'claimed',
      createdAt: new Date().toISOString(),
    };

    memStore.bonusClaims.set(claimRecord.id, claimRecord);
    memStore.userBonusClaims.set(userId, claimRecord);
    if (deviceId) {
      memStore.bonusClaims.set(`claim_device_${deviceId}_gen_${currentGen}`, claimRecord);
      memStore.deviceClaims.set(deviceId, claimRecord);
    }
    if (fingerprintHash) {
      memStore.bonusClaims.set(`claim_fp_${fingerprintHash}_gen_${currentGen}`, claimRecord);
      memStore.deviceFingerprintClaims.set(fingerprintHash, claimRecord);
    }

    try {
      await setDoc(doc(db, getColName('bonus_claims'), claimRecord.id), cleanDocData(claimRecord));
      if (deviceId) {
        await setDoc(doc(db, getColName('bonus_claims'), `claim_device_${deviceId}_gen_${currentGen}`), cleanDocData(claimRecord));
      }
    } catch (err) {
      console.warn('[DB] Bonus claim sync fallback:', err);
    }

    // 4. Credit user balance atomically
    const creditRes = await atomicCreditBalance(
      userId,
      bonusAmount,
      'signup_bonus',
      `Welcome signup bonus (Gen ${currentGen})`,
      `signup_bonus_gen_${currentGen}`
    );
    user = creditRes.user;
    user.signupBonusClaimed = true;
    user.signupBonusClaimedGeneration = currentGen;
    user.pendingSignupBonus = 0;
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
 * Assigns or retrieves a persistent pending scratch card bonus amount for signup.
 * Guarantees that the assigned amount never changes on refresh, restart, or reopening.
 * Does NOT credit user balance.
 */
export async function getOrAssignSignupScratchBonus(userId: string): Promise<{
  eligible: boolean;
  alreadyClaimed: boolean;
  amount: number;
  maxBonus: number;
}> {
  const settings = await getAppSettings();
  const maxBonus = settings.maxScratchSignupBonus || 10;
  const user = await getUser(userId);
  if (!user) {
    return { eligible: false, alreadyClaimed: false, amount: 0, maxBonus };
  }

  const currentGen = settings.resetGeneration || 1;
  const claimed = await hasUserClaimedSignupBonus(userId, currentGen);
  if (claimed) {
    return { eligible: false, alreadyClaimed: true, amount: 0, maxBonus };
  }

  // If user already has an assigned pending amount, preserve it strictly
  if (typeof user.pendingSignupBonus === 'number' && user.pendingSignupBonus > 0) {
    return { eligible: true, alreadyClaimed: false, amount: user.pendingSignupBonus, maxBonus };
  }

  // Assign one bonus amount up to maxBonus
  const min = Math.max(1, Math.min(2, maxBonus));
  const assigned = Math.floor(Math.random() * (maxBonus - min + 1)) + min;
  user.pendingSignupBonus = assigned;
  await saveUser(user);

  return { eligible: true, alreadyClaimed: false, amount: assigned, maxBonus };
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
      await setDoc(doc(db, getColName('bonus_claims'), claimRecord.id), cleanDocData(claimRecord));
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
    const snap = await getDoc(doc(db, getColName('task_completions'), id));
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
  try {
    const q = query(collection(db, getColName('task_completions')), where('userId', '==', userId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      snap.forEach((d) => {
        const item = d.data() as TaskCompletion;
        memStore.taskCompletions.set(item.id || d.id, item);
        if (item.taskId) set.add(item.taskId);
      });
      return set;
    }
  } catch (err) {
    console.warn('[DB] Firestore getUserCompletedTaskIds fallback:', err);
  }

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
    await setDoc(doc(db, getColName('task_completions'), completion.id), cleanDocData(completion));
  } catch (err) {
    console.warn('[DB] recordTaskCompletion fallback:', err);
  }
  return completion;
}

/* ========================================================
   REFERRALS REPOSITORY
   ======================================================== */
export async function getReferralsByReferrer(referrerId: string): Promise<ReferralRecord[]> {
  try {
    const q = query(collection(db, getColName('referrals')), where('referrerId', '==', referrerId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const items: ReferralRecord[] = [];
      snap.forEach((d) => {
        const item = d.data() as ReferralRecord;
        const r = { ...item, id: item.id || d.id };
        memStore.referrals.set(r.id, r);
        items.push(r);
      });
      return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  } catch (err) {
    console.warn('[DB] Firestore getReferralsByReferrer fallback:', err);
  }

  return Array.from(memStore.referrals.values())
    .filter((r) => r.referrerId === referrerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function recordReferral(referral: ReferralRecord): Promise<ReferralRecord> {
  memStore.referrals.set(referral.id, referral);
  try {
    await setDoc(doc(db, getColName('referrals'), referral.id), cleanDocData(referral));
  } catch (err) {
    console.warn('[DB] recordReferral fallback:', err);
  }
  return referral;
}

/* ========================================================
   WITHDRAWALS & AMAZON GIFT CARD CODE REDEMPTION
   ======================================================== */
export async function createWithdrawalRequest(
  userId: string,
  amount: number,
  _deprecatedUpiId?: string,
  idempotencyKey?: string
): Promise<{ withdrawal: Withdrawal; transaction: Transaction; user: UserProfile; giftCardCode: string }> {
  return await redeemGiftCardWithdrawal(userId, amount, idempotencyKey);
}

export async function getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
  try {
    const q = query(collection(db, getColName('withdrawals')), where('userId', '==', userId));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const items: Withdrawal[] = [];
      snap.forEach((d) => {
        const item = d.data() as Withdrawal;
        const w = { ...item, id: item.id || d.id };
        memStore.withdrawals.set(w.id, w);
        items.push(w);
      });
      return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  } catch (err) {
    console.warn('[DB] Firestore getUserWithdrawals fallback:', err);
  }

  return Array.from(memStore.withdrawals.values())
    .filter((w) => w.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getAllWithdrawals(status?: string): Promise<Withdrawal[]> {
  try {
    const snap = await getDocs(collection(db, getColName('withdrawals')));
    if (!snap.empty) {
      snap.forEach((d) => {
        const item = d.data() as Withdrawal;
        const w = { ...item, id: item.id || d.id };
        memStore.withdrawals.set(w.id, w);
      });
    }
  } catch (err) {
    console.warn('[DB] Firestore getAllWithdrawals fallback:', err);
  }

  let list = Array.from(memStore.withdrawals.values());
  if (status && status !== 'all') {
    list = list.filter((w) => w.status === status);
  }
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/* ========================================================
   WITHDRAWAL REFERRAL REQUIREMENT HELPERS
   ======================================================== */

/**
 * Returns count of distinct, valid, successfully credited referrals for a given user.
 * Excludes:
 * - self-referrals (refereeId === referrerId)
 * - rejected or duplicate fraud records (status !== 'credited')
 * - empty or invalid referee IDs
 */
export async function getValidReferralCount(referrerId: string): Promise<number> {
  const referrals = await getReferralsByReferrer(referrerId);
  const validReferees = new Set<string>();
  for (const ref of referrals) {
    if (
      ref.status === 'credited' &&
      ref.referrerId === referrerId &&
      ref.refereeId &&
      ref.refereeId !== referrerId
    ) {
      validReferees.add(ref.refereeId);
    }
  }
  return validReferees.size;
}

/**
 * Returns all successfully completed withdrawals for a given user.
 * Per authoritative definition, only withdrawals with status === 'success' count as completed.
 * Pending, processing, failed, rejected, or reversed withdrawals do not count.
 */
export async function getCompletedWithdrawals(userId: string): Promise<Withdrawal[]> {
  const userWithdrawals = await getUserWithdrawals(userId);
  return userWithdrawals.filter((w) => w.status === 'success');
}

/**
 * Checks whether the user meets the withdrawal referral requirement.
 * 
 * Rules:
 * 1. Default: First withdrawal is unrestricted (applyFromCount = 2).
 * 2. Second withdrawal onward requires at least withdrawalMinReferralsRequired valid referrals.
 * 3. If withdrawalReferralRequirementEnabled is false, requirement is bypassed.
 * 4. Completed withdrawals count strictly authoritative records where status === 'success'.
 */
export async function checkWithdrawalReferralEligibility(userId: string): Promise<WithdrawalReferralEligibility> {
  const settings = await getAppSettings();
  const isEnabled = settings.withdrawalReferralRequirementEnabled !== false;
  const applyFromCount =
    typeof settings.withdrawalReferralApplyFromCount === 'number' && settings.withdrawalReferralApplyFromCount >= 1
      ? settings.withdrawalReferralApplyFromCount
      : 2;
  const requiredReferrals =
    typeof settings.withdrawalMinReferralsRequired === 'number' && settings.withdrawalMinReferralsRequired >= 1
      ? settings.withdrawalMinReferralsRequired
      : 1;

  const completed = await getCompletedWithdrawals(userId);
  const completedWithdrawals = completed.length;
  const currentReferrals = await getValidReferralCount(userId);

  // The next withdrawal attempt is number (completedWithdrawals + 1)
  const currentWithdrawalNumber = completedWithdrawals + 1;
  const applies = isEnabled && currentWithdrawalNumber >= applyFromCount;

  if (!applies) {
    return {
      eligible: true,
      applies: false,
      completedWithdrawals,
      currentReferrals,
      requiredReferrals,
      applyFromCount,
    };
  }

  const eligible = currentReferrals >= requiredReferrals;
  let message: string | undefined;
  if (!eligible) {
    if (completedWithdrawals === 1 && applyFromCount === 2) {
      message = `Your first withdrawal is available without referrals. To make this withdrawal, invite at least ${requiredReferrals} valid referral${requiredReferrals > 1 ? 's' : ''}.`;
    } else {
      const diff = requiredReferrals - currentReferrals;
      message = `Withdrawal #${currentWithdrawalNumber} requires at least ${requiredReferrals} valid referral${requiredReferrals > 1 ? 's' : ''}. You currently have ${currentReferrals} (invite ${diff} more to unlock).`;
    }
  }

  return {
    eligible,
    applies: true,
    completedWithdrawals,
    currentReferrals,
    requiredReferrals,
    applyFromCount,
    message,
  };
}

export async function updateWithdrawalStatus(
  orderId: string,
  newStatus: Withdrawal['status'],
  notes?: { providerResponse?: string; failureReason?: string; adminId?: string }
): Promise<Withdrawal> {
  let withdrawal = memStore.withdrawals.get(orderId);
  if (!withdrawal) {
    try {
      const snap = await getDoc(doc(db, getColName('withdrawals'), orderId));
      if (snap.exists()) {
        withdrawal = snap.data() as Withdrawal;
        memStore.withdrawals.set(orderId, withdrawal);
      }
    } catch (err) {
      console.warn('[DB] updateWithdrawalStatus fetch fallback:', err);
    }
  }
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
    await setDoc(doc(db, getColName('withdrawals'), orderId), cleanDocData(withdrawal), { merge: true });
  } catch (err) {
    console.warn('[DB] updateWithdrawalStatus Firestore sync fallback:', err);
  }

  return withdrawal;
}

/* ========================================================
   AMAZON GIFT CARD INVENTORY & INSTANT REDEMPTION
   ======================================================== */

/**
 * Fetch all gift card codes from Firestore and cache in memStore
 */
export async function getAllGiftCardCodes(filter?: {
  status?: 'available' | 'redeemed' | 'invalidated';
  denomination?: number;
}): Promise<GiftCardCode[]> {
  try {
    const snap = await getDocs(collection(db, getColName('gift_card_codes')));
    if (!snap.empty) {
      snap.forEach((d) => {
        const item = d.data() as GiftCardCode;
        memStore.giftCardCodes.set(item.id || d.id, { ...item, id: item.id || d.id });
      });
    }
  } catch (err) {
    // Keep memStore
  }

  let list = Array.from(memStore.giftCardCodes.values());
  if (filter?.status) {
    list = list.filter((c) => c.status === filter.status);
  }
  if (filter?.denomination && filter.denomination > 0) {
    list = list.filter((c) => c.denomination === filter.denomination);
  }
  return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Calculate inventory stats for Admin Panel
 */
export async function getGiftCardInventoryStats(): Promise<GiftCardInventoryStats> {
  const allCodes = await getAllGiftCardCodes();
  const available = allCodes.filter((c) => c.status === 'available');
  const redeemed = allCodes.filter((c) => c.status === 'redeemed');
  const invalidated = allCodes.filter((c) => c.status === 'invalidated');

  const availableByDenomination: Record<number, number> = {};
  let totalAvailableValue = 0;

  for (const c of available) {
    const denom = c.denomination || 10;
    availableByDenomination[denom] = (availableByDenomination[denom] || 0) + 1;
    totalAvailableValue += denom;
  }

  return {
    totalCodes: allCodes.length,
    availableCodes: available.length,
    redeemedCodes: redeemed.length,
    invalidatedCodes: invalidated.length,
    availableByDenomination,
    totalAvailableValue,
  };
}

/**
 * Admin: Add gift card codes (single or bulk), with strict duplicate detection
 */
export async function addGiftCardCodes(
  rawInput: string[] | string,
  denomination: number,
  createdBy = 'admin'
): Promise<{ added: number; duplicates: number; codes: GiftCardCode[] }> {
  const denom = Number(denomination);
  if (!denom || isNaN(denom) || denom <= 0) {
    throw new Error('Please enter a valid gift card denomination (e.g. ₹10).');
  }

  // Parse lines or array
  let codeStrings: string[] = [];
  if (Array.isArray(rawInput)) {
    codeStrings = rawInput;
  } else if (typeof rawInput === 'string') {
    codeStrings = rawInput.split(/[\r\n,;]+/);
  }

  // Clean and filter empty
  const cleanCodes = codeStrings
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (cleanCodes.length === 0) {
    throw new Error('No valid gift card codes found to import.');
  }

  // Acquire concurrency lock on inventory to prevent race conditions during import
  const releaseLock = await acquireLock('gift_card_inventory');
  try {
    const existingList = await getAllGiftCardCodes();
    const existingCodeSet = new Set(existingList.map((c) => c.code.trim().toUpperCase()));

    let addedCount = 0;
    let duplicateCount = 0;
    const addedList: GiftCardCode[] = [];
    const nowIso = new Date().toISOString();

    for (const rawCode of cleanCodes) {
      const normalized = rawCode.toUpperCase();
      if (existingCodeSet.has(normalized)) {
        duplicateCount++;
        continue;
      }

      existingCodeSet.add(normalized);
      const codeId = `gc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newCard: GiftCardCode = {
        id: codeId,
        code: rawCode,
        denomination: denom,
        status: 'available',
        assignedUserId: null,
        assignedTelegramId: null,
        assignedUsername: null,
        assignedWithdrawalId: null,
        redeemedAt: null,
        createdAt: nowIso,
        createdBy,
      };

      memStore.giftCardCodes.set(codeId, newCard);
      addedList.push(newCard);
      addedCount++;

      try {
        await setDoc(doc(db, getColName('gift_card_codes'), codeId), cleanDocData(newCard));
      } catch (err) {
        console.warn('[DB] addGiftCardCodes Firestore sync fallback:', err);
      }
    }

    return {
      added: addedCount,
      duplicates: duplicateCount,
      codes: addedList,
    };
  } finally {
    releaseLock();
  }
}

/**
 * Admin: Invalidate an unredeemed gift card code
 */
export async function invalidateGiftCardCode(id: string, reason?: string): Promise<GiftCardCode> {
  const releaseLock = await acquireLock('gift_card_inventory');
  try {
    await getAllGiftCardCodes();
    const card = memStore.giftCardCodes.get(id);
    if (!card) {
      throw new Error('Gift card code not found.');
    }
    if (card.status === 'redeemed') {
      throw new Error('Cannot invalidate an already redeemed gift card code.');
    }

    card.status = 'invalidated';
    card.notes = reason || 'Invalidated by admin';
    card.updatedAt = new Date().toISOString();
    memStore.giftCardCodes.set(id, card);

    try {
      await setDoc(doc(db, getColName('gift_card_codes'), id), cleanDocData(card), { merge: true });
    } catch (err) {
      console.warn('[DB] invalidateGiftCardCode Firestore sync fallback:', err);
    }

    return card;
  } finally {
    releaseLock();
  }
}

/**
 * Admin: Delete an unredeemed gift card code
 */
export async function deleteGiftCardCode(id: string): Promise<boolean> {
  const releaseLock = await acquireLock('gift_card_inventory');
  try {
    await getAllGiftCardCodes();
    const card = memStore.giftCardCodes.get(id);
    if (!card) {
      return false;
    }
    if (card.status === 'redeemed') {
      throw new Error('Cannot delete an already redeemed gift card code.');
    }

    memStore.giftCardCodes.delete(id);
    try {
      await deleteDoc(doc(db, getColName('gift_card_codes'), id));
    } catch (err) {
      console.warn('[DB] deleteGiftCardCode Firestore sync fallback:', err);
    }
    return true;
  } finally {
    releaseLock();
  }
}

/**
 * ONE CODE — ONE USER: Server-side atomic allocation and instant Amazon Gift Card redemption.
 *
 * Rules:
 * 1. Checks minimum & maximum withdrawal settings dynamically.
 * 2. Checks rolling 24-hour limits (if enabled).
 * 3. Verifies user balance >= requested amount.
 * 4. Atomically finds ONE available gift card code matching the denomination.
 * 5. If no code is available, throws "Gift card temporarily out of stock" and DOES NOT deduct balance.
 * 6. Atomically marks code redeemed, deducts balance, and writes withdrawal + transaction records.
 */
export async function redeemGiftCardWithdrawal(
  userId: string,
  requestedAmount?: number,
  idempotencyKey?: string
): Promise<{
  withdrawal: Withdrawal;
  transaction: Transaction;
  user: UserProfile;
  giftCardCode: string;
}> {
  // Dual-lock isolation: per-user lock (prevents multi-click race conditions) + inventory lock (prevents code reuse)
  const releaseUserLock = await acquireLock(`user_withdrawal_${userId}`);
  const releaseInvLock = await acquireLock('gift_card_allocation');

  try {
    const user = await getUser(userId);
    if (!user) throw new Error('User not found');
    if (user.isBanned) throw new Error('Account suspended');

    // 0. Persistent Idempotency Check: check memory and persistent DB
    if (idempotencyKey && idempotencyKey.trim()) {
      const cleanKey = idempotencyKey.trim();
      let existingWithdrawal = Array.from(memStore.withdrawals.values()).find(
        (w) => w.userId === userId && w.idempotencyKey === cleanKey
      );

      if (!existingWithdrawal) {
        try {
          const q = query(
            collection(db, getColName('withdrawals')),
            where('userId', '==', userId),
            where('idempotencyKey', '==', cleanKey)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            existingWithdrawal = snap.docs[0].data() as Withdrawal;
            memStore.withdrawals.set(existingWithdrawal.id, existingWithdrawal);
          }
        } catch (err) {
          console.warn('[DB] Persistent idempotency check fallback:', err);
        }
      }

      if (existingWithdrawal) {
        const existingTx = Array.from(memStore.transactions.values()).find(
          (t) => t.referenceId === existingWithdrawal.id
        );
        return {
          withdrawal: existingWithdrawal,
          transaction: existingTx || {
            id: `tx_${existingWithdrawal.id}`,
            userId,
            type: 'withdrawal_deduct',
            amount: -existingWithdrawal.amount,
            description: `Amazon Gift Card ₹${existingWithdrawal.amount} Code Redeemed (${existingWithdrawal.id})`,
            balanceAfter: user.balance,
            referenceId: existingWithdrawal.id,
            createdAt: existingWithdrawal.createdAt,
          },
          user,
          giftCardCode: existingWithdrawal.giftCardCode || '',
        };
      }
    }

    // Feature 3: Mandatory Telegram channel membership re-verification before every withdrawal
    const channelVerification = await verifyMandatoryWithdrawalMembership(user.telegramId);
    if (!channelVerification.isVerified) {
      if (channelVerification.isApiError) {
        throw new Error(
          channelVerification.error ||
            'Channel membership verification could not be completed due to a temporary Telegram connection issue. Please retry in a few moments.'
        );
      }
      const err: any = new Error(
        channelVerification.error ||
          'Please join all mandatory sponsor channels before redeeming your gift card code.'
      );
      err.unjoinedChannels = channelVerification.unjoinedChannels;
      err.forceJoinRequired = true;
      throw err;
    }

    // Withdrawal Referral Requirement check
    const referralEligibility = await checkWithdrawalReferralEligibility(userId);
    if (!referralEligibility.eligible) {
      const err: any = new Error(
        referralEligibility.message ||
          'You need more valid referrals before making this withdrawal.'
      );
      err.referralRequirementFailed = true;
      err.eligibility = referralEligibility;
      throw err;
    }

    const settings = await getAppSettings();

    // Determine amount dynamically based on settings
    let amount = Number(requestedAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      amount = settings.minWithdrawalAmount;
    }

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

      const userWithdrawals = await getUserWithdrawals(userId);
      const activeWindowWithdrawals = userWithdrawals.filter((w) => {
        const isEligibleStatus =
          w.status === 'pending' || w.status === 'processing' || w.status === 'success';
        if (!isEligibleStatus) return false;
        const createdAtMs = new Date(w.createdAt).getTime();
        return createdAtMs >= windowStartMs;
      });

      const maxReqs = settings.maxWithdrawalRequestsPer24h;
      if (maxReqs && maxReqs > 0 && activeWindowWithdrawals.length >= maxReqs) {
        throw new Error(
          `Daily withdrawal request limit reached. You can make at most ${maxReqs} withdrawal request(s) in a 24-hour period.`
        );
      }

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

    // 4. Verify balance
    if (user.balance < amount) {
      throw new Error(`Insufficient balance. Available: ₹${user.balance.toFixed(2)}, Requested: ₹${amount}`);
    }

    // 5. Supabase Row-Level Locking Procedure (if configured)
    if (isSupabaseEnabled()) {
      const spRes = await supabaseRedeemGiftCard(userId, amount, idempotencyKey);
      if (spRes.success && spRes.withdrawal && spRes.transaction) {
        const freshUser = await getUser(userId);
        memStore.withdrawals.set(spRes.withdrawal.id, spRes.withdrawal);
        memStore.transactions.set(spRes.transaction.id, spRes.transaction);
        return {
          withdrawal: spRes.withdrawal,
          transaction: spRes.transaction,
          user: freshUser || user,
          giftCardCode: spRes.giftCardCode || '',
        };
      }
      if (spRes.error && spRes.error.includes('out of stock')) {
        throw new Error('Gift card temporarily out of stock');
      }
    }

    // 6. Find an available code matching requested denomination
    await getAllGiftCardCodes();
    const availableCodes = Array.from(memStore.giftCardCodes.values()).filter(
      (c) => c.status === 'available' && c.denomination === amount
    );

    if (availableCodes.length === 0) {
      // STRICT REQUIREMENT: If no code is available, throw out of stock and NEVER touch balance
      throw new Error('Gift card temporarily out of stock');
    }

    // Pick first available code
    const selectedCode = availableCodes[0];

    // 7. Atomic Allocation & Ledger Deduction via Firestore ACID Transaction
    const orderId = `WTH-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const redeemedAt = new Date().toISOString();

    try {
      const userDocRef = doc(db, getColName('users'), userId);
      const codeDocRef = doc(db, getColName('gift_card_codes'), selectedCode.id);
      const wthDocRef = doc(db, getColName('withdrawals'), orderId);
      const txDocRef = doc(db, getColName('transactions'), txId);

      const txnResult = await runTransaction(db, async (txn) => {
        // A. Re-read user inside transaction for fresh ground-truth balance
        const uSnap = await txn.get(userDocRef);
        let freshUser: UserProfile;
        if (!uSnap.exists()) {
          const mem = memStore.users.get(userId);
          if (!mem) throw new Error('User not found');
          freshUser = mem;
        } else {
          freshUser = uSnap.data() as UserProfile;
        }

        if (freshUser.isBanned) throw new Error('Account suspended');
        if (freshUser.balance < amount) {
          throw new Error(
            `Insufficient balance. Available: ₹${freshUser.balance.toFixed(2)}, Requested: ₹${amount}`
          );
        }

        // B. Re-read gift card code inside transaction to guarantee it was not claimed concurrently
        const cSnap = await txn.get(codeDocRef);
        let freshCode: GiftCardCode;
        if (!cSnap.exists()) {
          const memC = memStore.giftCardCodes.get(selectedCode.id);
          if (!memC || memC.status !== 'available') throw new Error('Gift card temporarily out of stock');
          freshCode = memC;
        } else {
          freshCode = cSnap.data() as GiftCardCode;
          if (freshCode.status !== 'available') {
            throw new Error('Gift card temporarily out of stock');
          }
        }

        const newBalance = Math.round((freshUser.balance - amount) * 100) / 100;

        const updatedCodeDoc: GiftCardCode = {
          ...freshCode,
          status: 'redeemed',
          assignedUserId: freshUser.id,
          assignedTelegramId: freshUser.telegramId,
          assignedUsername: freshUser.username || '',
          assignedWithdrawalId: orderId,
          redeemedAt,
          updatedAt: redeemedAt,
        };

        const updatedUserDoc: UserProfile = {
          ...freshUser,
          balance: newBalance,
          updatedAt: redeemedAt,
        };

        const wthDoc: Withdrawal = {
          id: orderId,
          userId,
          userTelegramId: freshUser.telegramId,
          username: freshUser.username || '',
          amount,
          status: 'success',
          payoutMode: 'gift_card',
          giftCardCode: freshCode.code,
          giftCardDenomination: freshCode.denomination,
          giftCardId: freshCode.id,
          giftCardRedeemedAt: redeemedAt,
          idempotencyKey: idempotencyKey ? idempotencyKey.trim() : undefined,
          createdAt: redeemedAt,
          processedAt: redeemedAt,
        };

        const txDoc: Transaction = {
          id: txId,
          userId,
          type: 'withdrawal_deduct',
          amount: -amount,
          description: `Amazon Gift Card ₹${amount} Code Redeemed (${orderId})`,
          balanceAfter: newBalance,
          referenceId: orderId,
          createdAt: redeemedAt,
        };

        txn.set(codeDocRef, cleanDocData(updatedCodeDoc), { merge: true });
        txn.set(userDocRef, cleanDocData(updatedUserDoc), { merge: true });
        txn.set(wthDocRef, cleanDocData(wthDoc));
        txn.set(txDocRef, cleanDocData(txDoc));

        return {
          user: updatedUserDoc,
          withdrawal: wthDoc,
          transaction: txDoc,
          giftCardCode: freshCode.code,
        };
      });

      memStore.giftCardCodes.set(selectedCode.id, {
        ...selectedCode,
        status: 'redeemed',
        assignedUserId: userId,
        assignedWithdrawalId: orderId,
        redeemedAt,
      });
      memStore.users.set(userId, txnResult.user);
      memStore.withdrawals.set(orderId, txnResult.withdrawal);
      memStore.transactions.set(txId, txnResult.transaction);

      return txnResult;
    } catch (txnErr: any) {
      if (
        txnErr.message &&
        (txnErr.message.includes('Insufficient balance') ||
          txnErr.message.includes('Account suspended') ||
          txnErr.message.includes('out of stock') ||
          txnErr.message.includes('User not found'))
      ) {
        throw txnErr;
      }
      console.warn('[DB] runTransaction failed, checking memory fallback:', txnErr);

      // In-memory dual-lock fallback
      const newBalance = Math.round((user.balance - amount) * 100) / 100;
      selectedCode.status = 'redeemed';
      selectedCode.assignedUserId = user.id;
      selectedCode.assignedTelegramId = user.telegramId;
      selectedCode.assignedUsername = user.username || '';
      selectedCode.assignedWithdrawalId = orderId;
      selectedCode.redeemedAt = redeemedAt;
      selectedCode.updatedAt = redeemedAt;
      memStore.giftCardCodes.set(selectedCode.id, selectedCode);

      const updatedUser: UserProfile = { ...user, balance: newBalance, updatedAt: redeemedAt };
      memStore.users.set(userId, updatedUser);

      const withdrawal: Withdrawal = {
        id: orderId,
        userId,
        userTelegramId: user.telegramId,
        username: user.username || '',
        amount,
        status: 'success',
        payoutMode: 'gift_card',
        giftCardCode: selectedCode.code,
        giftCardDenomination: selectedCode.denomination,
        giftCardId: selectedCode.id,
        giftCardRedeemedAt: redeemedAt,
        idempotencyKey: idempotencyKey ? idempotencyKey.trim() : undefined,
        createdAt: redeemedAt,
        processedAt: redeemedAt,
      };
      memStore.withdrawals.set(orderId, withdrawal);

      const transaction: Transaction = {
        id: txId,
        userId,
        type: 'withdrawal_deduct',
        amount: -amount,
        description: `Amazon Gift Card ₹${amount} Code Redeemed (${orderId})`,
        balanceAfter: newBalance,
        referenceId: orderId,
        createdAt: redeemedAt,
      };
      memStore.transactions.set(txId, transaction);

      return {
        withdrawal,
        transaction,
        user: updatedUser,
        giftCardCode: selectedCode.code,
      };
    }
  } finally {
    releaseInvLock();
    releaseUserLock();
  }
}

/* ========================================================
   FORCE JOIN CHANNELS REPOSITORY
   ======================================================== */
export async function getForceJoinChannels(onlyEnabled = true): Promise<ForceJoinChannel[]> {
  try {
    const snap = await getDocs(collection(db, getColName('force_join_channels')));
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
    await setDoc(doc(db, getColName('force_join_channels'), channel.id), cleanDocData(channel), { merge: true });
  } catch (err) {
    console.warn('[DB] saveForceJoinChannel fallback:', err);
  }
  return channel;
}

export async function deleteForceJoinChannel(id: string): Promise<boolean> {
  memStore.channels.delete(id);
  try {
    await deleteDoc(doc(db, getColName('force_join_channels'), id));
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
    await setDoc(doc(db, getColName('admin_audit_logs'), log.id), cleanDocData(log));
  } catch (err) {
    console.warn('[DB] recordAdminAudit fallback:', err);
  }
  return log;
}

export async function getAdminAuditLogs(limit = 50): Promise<AdminAuditLog[]> {
  return memStore.auditLogs.slice(0, limit);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    if (memStore.users.size < 50) {
      const snap = await getDocs(collection(db, getColName('users')));
      snap.forEach((d) => {
        const u = d.data() as UserProfile;
        memStore.users.set(u.id || d.id, { ...u, id: u.id || d.id });
      });
    }
    if (memStore.withdrawals.size < 20) {
      const snap = await getDocs(collection(db, getColName('withdrawals')));
      snap.forEach((d) => {
        const w = d.data() as Withdrawal;
        memStore.withdrawals.set(w.id || d.id, { ...w, id: w.id || d.id });
      });
    }
    if (memStore.transactions.size < 50) {
      const snap = await getDocs(collection(db, getColName('transactions')));
      snap.forEach((d) => {
        const t = d.data() as Transaction;
        memStore.transactions.set(t.id || d.id, { ...t, id: t.id || d.id });
      });
    }
  } catch (err) {
    console.warn('[DB] getDashboardStats Firestore sync fallback:', err);
  }

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

/* ========================================================
   FEATURE 1: ADMIN BULK BALANCE RESET & GENERATION ELIGIBILITY
   ======================================================== */

export async function getBulkBalanceResetPreview(): Promise<BulkBalanceResetPreview> {
  const settings = await getAppSettings();
  const currentGeneration = settings.resetGeneration || 1;
  const nextGeneration = currentGeneration + 1;

  const allUsers = await searchUsers();
  let totalBalance = 0;
  let affectedCount = 0;

  for (const u of allUsers) {
    if (u.balance > 0) {
      affectedCount++;
      totalBalance += u.balance;
    }
  }

  return {
    totalUsers: affectedCount,
    totalBalance: Math.round(totalBalance * 100) / 100,
    currentGeneration,
    nextGeneration,
  };
}

export async function atomicResetAllUserBalances(adminId: string): Promise<BulkBalanceResetResult> {
  const releaseLock = await acquireLock('global_bulk_balance_reset', 15000);
  try {
    const settings = await getAppSettings();
    const currentGeneration = settings.resetGeneration || 1;
    const nextGeneration = currentGeneration + 1;
    const now = new Date().toISOString();

    const allUsers = await searchUsers();
    let affectedCount = 0;
    let totalBalanceReset = 0;

    for (const u of allUsers) {
      if (u.balance > 0) {
        affectedCount++;
        totalBalanceReset += u.balance;

        const txObj: Transaction = {
          id: `tx_reset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          userId: u.id,
          type: 'admin_adjustment',
          amount: -u.balance,
          balanceAfter: 0,
          description: `Bulk balance reset by admin (Campaign generation ${nextGeneration})`,
          referenceId: `reset_gen_${nextGeneration}`,
          createdAt: now,
        };
        memStore.transactions.set(txObj.id, txObj);

        u.balance = 0;
        u.lastBalanceResetAt = now;
        memStore.users.set(u.id, u);
        await saveUser(u);
      }
    }

    totalBalanceReset = Math.round(totalBalanceReset * 100) / 100;

    // Update settings with the new generation
    await updateAppSettings({ resetGeneration: nextGeneration });

    // Call Supabase procedure if configured
    if (isSupabaseEnabled()) {
      await supabaseBulkResetBalances(adminId, nextGeneration).catch((err) =>
        console.warn('[Supabase Bulk Reset Sync Warning]:', err)
      );
    }

    // Record audit log
    await recordAdminAudit(
      adminId,
      'BULK_BALANCE_RESET',
      `Bulk balance reset executed by admin ${adminId}. Affected users: ${affectedCount}. Total balance reset: ₹${totalBalanceReset.toFixed(2)}. New campaign generation: ${nextGeneration}.`
    );

    return {
      success: true,
      affectedUsers: affectedCount,
      totalBalanceReset,
      newResetGeneration: nextGeneration,
      resetAt: now,
    };
  } finally {
    releaseLock();
  }
}

/* ========================================================
   FEATURE 3: MANDATORY WITHDRAWAL CHANNEL VERIFICATION
   ======================================================== */

export async function getMandatoryWithdrawalChannels(): Promise<ForceJoinChannel[]> {
  const forceJoinChannels = await getForceJoinChannels(true);
  const tasks = await getAllTasks(true);

  const mandatoryChannelsMap = new Map<string, ForceJoinChannel>();

  for (const ch of forceJoinChannels) {
    if (ch.isEnabled && ch.channelId) {
      const cleanId = ch.channelId.trim();
      mandatoryChannelsMap.set(cleanId.toLowerCase(), ch);
    }
  }

  for (const task of tasks) {
    if (task.isActive && task.taskType === 'channel' && task.isMandatoryForWithdrawal && task.channelId) {
      const cleanId = task.channelId.trim();
      if (!mandatoryChannelsMap.has(cleanId.toLowerCase())) {
        mandatoryChannelsMap.set(cleanId.toLowerCase(), {
          id: `task_mandatory_${task.id}`,
          title: task.title,
          channelId: cleanId,
          inviteLink: task.destinationUrl || `https://t.me/${cleanId.replace(/^@/, '')}`,
          isPrivate: !cleanId.startsWith('@'),
          isEnabled: true,
          order: 999,
        });
      }
    }
  }

  return Array.from(mandatoryChannelsMap.values());
}

export async function verifyMandatoryWithdrawalMembership(
  telegramId: number
): Promise<MandatoryWithdrawalVerificationResult> {
  const channels = await getMandatoryWithdrawalChannels();
  if (channels.length === 0) {
    return { isVerified: true };
  }

  const unjoined: ForceJoinChannel[] = [];

  for (const ch of channels) {
    const check = await checkTelegramChannelMembership(ch.channelId, telegramId);

    // Fail closed: Telegram API error, Bot not admin, Bot token missing, or Chat not found
    if (!check.isMember) {
      if (
        check.status === 'api_error' ||
        check.status === 'bot_not_admin' ||
        check.status === 'chat_not_found' ||
        check.status === 'bot_token_missing'
      ) {
        return {
          isVerified: false,
          isApiError: true,
          error:
            check.error ||
            `Telegram channel verification temporarily unavailable for ${ch.title} (${ch.channelId}). Please retry.`,
          unjoinedChannels: [ch],
        };
      }
      unjoined.push(ch);
    }
  }

  if (unjoined.length > 0) {
    return {
      isVerified: false,
      isApiError: false,
      unjoinedChannels: unjoined,
      error: 'Please join all mandatory sponsor channels before redeeming your gift card code.',
    };
  }

  return { isVerified: true };
}

export async function getMandatoryCheckinChannels(): Promise<ForceJoinChannel[]> {
  const forceJoinChannels = await getForceJoinChannels(true);
  const tasks = await getAllTasks(true);

  const mandatoryChannelsMap = new Map<string, ForceJoinChannel>();

  for (const ch of forceJoinChannels) {
    if (ch.isEnabled && ch.channelId) {
      const cleanId = ch.channelId.trim();
      mandatoryChannelsMap.set(cleanId.toLowerCase(), ch);
    }
  }

  for (const task of tasks) {
    const isMandatory =
      task.isMandatoryForCheckin ||
      (task.isMandatoryForCheckin === undefined && task.isMandatoryForWithdrawal);
    if (task.isActive && task.taskType === 'channel' && isMandatory && task.channelId) {
      const cleanId = task.channelId.trim();
      if (!mandatoryChannelsMap.has(cleanId.toLowerCase())) {
        mandatoryChannelsMap.set(cleanId.toLowerCase(), {
          id: `task_mandatory_checkin_${task.id}`,
          title: task.title,
          channelId: cleanId,
          inviteLink: task.destinationUrl || `https://t.me/${cleanId.replace(/^@/, '')}`,
          isPrivate: !cleanId.startsWith('@'),
          isEnabled: true,
          order: 999,
        });
      }
    }
  }

  return Array.from(mandatoryChannelsMap.values());
}

export async function verifyMandatoryCheckinMembership(
  telegramId: number
): Promise<MandatoryWithdrawalVerificationResult> {
  const channels = await getMandatoryCheckinChannels();
  if (channels.length === 0) {
    return { isVerified: true };
  }

  const unjoined: ForceJoinChannel[] = [];

  for (const ch of channels) {
    const check = await checkTelegramChannelMembership(ch.channelId, telegramId);

    // Fail closed: Telegram API error, Bot not admin, Bot token missing, or Chat not found
    if (!check.isMember) {
      if (
        check.status === 'api_error' ||
        check.status === 'bot_not_admin' ||
        check.status === 'chat_not_found' ||
        check.status === 'bot_token_missing'
      ) {
        return {
          isVerified: false,
          isApiError: true,
          error:
            check.error ||
            `Telegram channel verification temporarily unavailable for ${ch.title} (${ch.channelId}). Please retry.`,
          unjoinedChannels: [ch],
        };
      }
      unjoined.push(ch);
    }
  }

  if (unjoined.length > 0) {
    return {
      isVerified: false,
      isApiError: false,
      unjoinedChannels: unjoined,
      error: 'Please join all mandatory channels before claiming your daily check-in reward.',
    };
  }

  return { isVerified: true };
}

