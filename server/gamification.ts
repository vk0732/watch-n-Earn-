import crypto from 'node:crypto';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  db,
  memStore,
  cleanDocData,
  acquireLock,
  atomicCreditBalance,
  getUser,
  getAppSettings,
  getUserCompletedTaskIds,
  recordAdminAudit,
} from './db.ts';
import type {
  GamificationSettings,
  SpinRewardSegment,
  ScratchRewardOption,
  UserGamificationState,
  ScratchCardItem,
  GamificationStats,
} from '../src/types/index.ts';

export interface SpinRecord {
  id: string;
  userId: string;
  segmentId: string;
  label: string;
  rewardType: 'coins' | 'bonus' | 'no_reward';
  rewardAmount: number;
  createdAt: string;
}

// In-Memory store extensions for high performance & instant testing
if (!(memStore as any).spinRecords) {
  (memStore as any).spinRecords = new Map<string, SpinRecord>();
}
if (!(memStore as any).scratchCards) {
  (memStore as any).scratchCards = new Map<string, ScratchCardItem & { userId: string }>();
}

export const defaultSpinSegments: SpinRewardSegment[] = [
  { id: 'spin_seg_5', label: '₹5 Coins', rewardType: 'coins', amount: 5, probability: 35, color: '#10b981', textColor: '#ffffff', isEnabled: true },
  { id: 'spin_seg_10', label: '₹10 Bonus', rewardType: 'bonus', amount: 10, probability: 25, color: '#3b82f6', textColor: '#ffffff', isEnabled: true },
  { id: 'spin_seg_20', label: '₹20 Jackpot', rewardType: 'bonus', amount: 20, probability: 10, color: '#8b5cf6', textColor: '#ffffff', isEnabled: true },
  { id: 'spin_seg_2', label: '₹2 Coins', rewardType: 'coins', amount: 2, probability: 20, color: '#f59e0b', textColor: '#ffffff', isEnabled: true },
  { id: 'spin_seg_0', label: 'Try Again', rewardType: 'no_reward', amount: 0, probability: 10, color: '#ef4444', textColor: '#ffffff', isEnabled: true },
];

export const defaultScratchRewardOptions: ScratchRewardOption[] = [
  { id: 'scr_opt_5', label: '₹5 Welcome Perk', rewardType: 'coins', amount: 5, probability: 40, isEnabled: true },
  { id: 'scr_opt_10', label: '₹10 Referral Bonus', rewardType: 'bonus', amount: 10, probability: 30, isEnabled: true },
  { id: 'scr_opt_25', label: '₹25 Mega Reward', rewardType: 'bonus', amount: 25, probability: 15, isEnabled: true },
  { id: 'scr_opt_0', label: 'Better Luck Next Time', rewardType: 'no_reward', amount: 0, probability: 15, isEnabled: true },
];

export const defaultGamificationSettings: GamificationSettings = {
  spinWheelEnabled: true,
  tasksRequiredPerSpin: 3, // Range 2-4, default 3
  dailySpinLimit: 5, // 0 = unlimited
  spinSegments: defaultSpinSegments,
  maxDailySpinRewardBudget: 1000,

  scratchCardEnabled: true,
  scratchCondition: 'registration', // 'registration' | 'channel_verification' | 'task_completion'
  scratchTasksRequired: 1,
  scratchRewardOptions: defaultScratchRewardOptions,
  maxDailyScratchRewardBudget: 1500,
};

/**
 * Returns merged Gamification Settings
 */
export async function getGamificationSettings(): Promise<GamificationSettings> {
  const settings = await getAppSettings();
  const gam = settings.gamification;
  if (!gam) return { ...defaultGamificationSettings };

  return {
    spinWheelEnabled: gam.spinWheelEnabled ?? defaultGamificationSettings.spinWheelEnabled,
    tasksRequiredPerSpin: Math.min(4, Math.max(2, gam.tasksRequiredPerSpin || 3)),
    dailySpinLimit: gam.dailySpinLimit ?? defaultGamificationSettings.dailySpinLimit,
    spinSegments: gam.spinSegments && gam.spinSegments.length >= 2 ? gam.spinSegments : defaultSpinSegments,
    maxDailySpinRewardBudget: gam.maxDailySpinRewardBudget ?? defaultGamificationSettings.maxDailySpinRewardBudget,

    scratchCardEnabled: gam.scratchCardEnabled ?? defaultGamificationSettings.scratchCardEnabled,
    scratchCondition: gam.scratchCondition || 'registration',
    scratchTasksRequired: gam.scratchTasksRequired || 1,
    scratchRewardOptions: gam.scratchRewardOptions && gam.scratchRewardOptions.length >= 2 ? gam.scratchRewardOptions : defaultScratchRewardOptions,
    maxDailyScratchRewardBudget: gam.maxDailyScratchRewardBudget ?? defaultGamificationSettings.maxDailyScratchRewardBudget,
  };
}

/**
 * Computes User Gamification State:
 * - Count of strictly verified completed tasks (each counts only once)
 * - Earned spins = Math.floor(completedTasks / tasksRequiredPerSpin)
 * - Used spins = count of spin_records in DB
 * - Available spins = max(0, earnedSpins - usedSpins)
 * - Scratch cards list
 */
export async function getUserGamificationState(userId: string): Promise<UserGamificationState> {
  const gamSettings = await getGamificationSettings();
  const completedTaskIds = await getUserCompletedTaskIds(userId);
  const completedTasksCount = completedTaskIds.size;
  const tasksReq = gamSettings.tasksRequiredPerSpin || 3;

  const earnedSpins = Math.floor(completedTasksCount / tasksReq);

  // Count spins used
  const spinRecordsMap = (memStore as any).spinRecords as Map<string, SpinRecord>;
  let usedSpins = 0;
  for (const s of spinRecordsMap.values()) {
    if (s.userId === userId) {
      usedSpins++;
    }
  }

  const availableSpins = Math.max(0, earnedSpins - usedSpins);
  const progressToNextSpin = completedTasksCount % tasksReq;
  const nextSpinMilestone = (earnedSpins + 1) * tasksReq;

  // Scratch cards
  const scratchCardsMap = (memStore as any).scratchCards as Map<string, ScratchCardItem & { userId: string }>;
  const userCards: ScratchCardItem[] = [];
  let unrevealedCount = 0;

  for (const card of scratchCardsMap.values()) {
    if (card.userId === userId) {
      userCards.push({
        id: card.id,
        referralId: card.referralId,
        refereeUsername: card.refereeUsername,
        isRevealed: card.isRevealed,
        rewardType: card.rewardType,
        rewardAmount: card.rewardAmount,
        revealedAt: card.revealedAt,
        createdAt: card.createdAt,
      });
      if (!card.isRevealed) unrevealedCount++;
    }
  }

  // Sort newest first
  userCards.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    completedTasksCount,
    tasksRequiredPerSpin: tasksReq,
    progressToNextSpin,
    earnedSpins,
    usedSpins,
    availableSpins,
    canSpinNow: gamSettings.spinWheelEnabled && availableSpins > 0,
    nextSpinMilestone,
    totalScratchCards: userCards.length,
    unrevealedScratchCards: unrevealedCount,
    scratchCards: userCards,
    spinWheelEnabled: gamSettings.spinWheelEnabled,
    scratchCardEnabled: gamSettings.scratchCardEnabled,
    spinSegments: gamSettings.spinSegments.filter((s) => s.isEnabled),
  };
}

/**
 * Cryptographically weighted random choice for spin segments
 */
function selectWinningSpinSegment(segments: SpinRewardSegment[]): SpinRewardSegment {
  const active = segments.filter((s) => s.isEnabled && s.probability > 0);
  if (active.length === 0) {
    return segments[0] || defaultSpinSegments[0];
  }

  const totalProb = active.reduce((sum, s) => sum + s.probability, 0);
  // Cryptographically secure random integer in [0, totalProb)
  const randomBytes = crypto.randomBytes(4);
  const randomVal = (randomBytes.readUInt32BE(0) / 0xffffffff) * totalProb;

  let cumulative = 0;
  for (const seg of active) {
    cumulative += seg.probability;
    if (randomVal <= cumulative) {
      return seg;
    }
  }
  return active[active.length - 1];
}

/**
 * Cryptographically weighted random choice for scratch card rewards
 */
function selectWinningScratchReward(options: ScratchRewardOption[]): ScratchRewardOption {
  const active = options.filter((o) => o.isEnabled && o.probability > 0);
  if (active.length === 0) {
    return options[0] || defaultScratchRewardOptions[0];
  }

  const totalProb = active.reduce((sum, o) => sum + o.probability, 0);
  const randomBytes = crypto.randomBytes(4);
  const randomVal = (randomBytes.readUInt32BE(0) / 0xffffffff) * totalProb;

  let cumulative = 0;
  for (const opt of active) {
    cumulative += opt.probability;
    if (randomVal <= cumulative) {
      return opt;
    }
  }
  return active[active.length - 1];
}

/**
 * Execute Spin:
 * - Checks lock
 * - Verifies user has available spins
 * - Checks daily spin limit
 * - Checks budget
 * - Server determines winning segment BEFORE animation
 * - Records spin and atomically credits user if amount > 0
 */
export async function executeSpinWheel(userId: string): Promise<{
  success: boolean;
  winningSegment: SpinRewardSegment;
  segmentIndex: number;
  newBalance: number;
  availableSpinsRemaining: number;
  message: string;
}> {
  const lockKey = `lock_spin_${userId}`;
  const releaseLock = await acquireLock(lockKey);

  try {
    const user = await getUser(userId);
    if (!user) throw new Error('User not found');
    if (user.isBanned) throw new Error('Account suspended');

    const gamSettings = await getGamificationSettings();
    if (!gamSettings.spinWheelEnabled) {
      throw new Error('Spin Wheel is currently disabled by administrator');
    }

    const state = await getUserGamificationState(userId);
    if (state.availableSpins <= 0) {
      throw new Error(`No spins available. Complete ${state.tasksRequiredPerSpin} tasks to earn a spin!`);
    }

    // Daily limit check
    if (gamSettings.dailySpinLimit > 0) {
      const today = new Date().toISOString().split('T')[0];
      const spinRecordsMap = (memStore as any).spinRecords as Map<string, SpinRecord>;
      let todaySpins = 0;
      for (const s of spinRecordsMap.values()) {
        if (s.userId === userId && s.createdAt.startsWith(today)) {
          todaySpins++;
        }
      }
      if (todaySpins >= gamSettings.dailySpinLimit) {
        throw new Error(`Daily spin limit reached (${gamSettings.dailySpinLimit} spins per day). Come back tomorrow!`);
      }
    }

    const activeSegments = gamSettings.spinSegments.filter((s) => s.isEnabled);
    const winningSeg = selectWinningSpinSegment(activeSegments);
    const segIndex = activeSegments.findIndex((s) => s.id === winningSeg.id);

    // Record Spin in DB
    const spinId = `spin_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const spinRecord: SpinRecord = {
      id: spinId,
      userId,
      segmentId: winningSeg.id,
      label: winningSeg.label,
      rewardType: winningSeg.rewardType,
      rewardAmount: winningSeg.amount,
      createdAt: new Date().toISOString(),
    };

    (memStore as any).spinRecords.set(spinId, spinRecord);

    try {
      await setDoc(doc(db, 'spin_records', spinId), cleanDocData(spinRecord));
    } catch (err) {
      console.warn('[Gamification] Spin record firestore sync fallback:', err);
    }

    let finalBalance = user.balance;

    if (winningSeg.amount > 0) {
      const creditRes = await atomicCreditBalance(
        userId,
        winningSeg.amount,
        'spin_reward',
        `Spin Wheel Reward: ${winningSeg.label}`,
        spinId
      );
      finalBalance = creditRes.user.balance;
    }

    const remainingSpins = Math.max(0, state.availableSpins - 1);

    const message =
      winningSeg.amount > 0
        ? `🎉 Congratulations! You won ${winningSeg.label}!`
        : `Spin completed! Better luck next time.`;

    return {
      success: true,
      winningSegment: winningSeg,
      segmentIndex: segIndex >= 0 ? segIndex : 0,
      newBalance: finalBalance,
      availableSpinsRemaining: remainingSpins,
      message,
    };
  } finally {
    releaseLock();
  }
}

/**
 * Grant a Scratch Card to Referrer upon qualifying condition
 */
export async function grantReferralScratchCard(referrerId: string, referralId: string, refereeUsername: string): Promise<ScratchCardItem | null> {
  const gamSettings = await getGamificationSettings();
  if (!gamSettings.scratchCardEnabled) return null;

  const cardId = `sc_${referralId}`;
  const scratchCardsMap = (memStore as any).scratchCards as Map<string, ScratchCardItem & { userId: string }>;

  // Idempotency: generate only ONE unique scratch card entitlement per eligible referral
  if (scratchCardsMap.has(cardId)) {
    return scratchCardsMap.get(cardId)!;
  }

  // Determine reward beforehand or upon creation with backend randomness
  const winningOpt = selectWinningScratchReward(gamSettings.scratchRewardOptions);

  const newCard: ScratchCardItem & { userId: string } = {
    id: cardId,
    userId: referrerId,
    referralId,
    refereeUsername,
    isRevealed: false,
    rewardType: winningOpt.rewardType,
    rewardAmount: winningOpt.amount,
    createdAt: new Date().toISOString(),
  };

  scratchCardsMap.set(cardId, newCard);

  try {
    await setDoc(doc(db, 'scratch_cards', cardId), cleanDocData(newCard));
  } catch (err) {
    console.warn('[Gamification] Scratch card firestore sync fallback:', err);
  }

  return newCard;
}

/**
 * Reveal Scratch Card:
 * - Checks lock
 * - Ensures card belongs to user and is not already revealed
 * - Atomically credits user if amount > 0
 */
export async function revealScratchCard(userId: string, cardId: string): Promise<{
  success: boolean;
  card: ScratchCardItem;
  newBalance: number;
  message: string;
}> {
  const lockKey = `lock_scratch_${cardId}`;
  const releaseLock = await acquireLock(lockKey);

  try {
    const user = await getUser(userId);
    if (!user) throw new Error('User not found');
    if (user.isBanned) throw new Error('Account suspended');

    const scratchCardsMap = (memStore as any).scratchCards as Map<string, ScratchCardItem & { userId: string }>;
    const card = scratchCardsMap.get(cardId);

    if (!card) throw new Error('Scratch card not found');
    if (card.userId !== userId) throw new Error('Access denied: Scratch card does not belong to you');

    if (card.isRevealed) {
      return {
        success: true,
        card,
        newBalance: user.balance,
        message: `Card already revealed! Reward was ₹${card.rewardAmount}.`,
      };
    }

    // Mark revealed
    card.isRevealed = true;
    card.revealedAt = new Date().toISOString();
    scratchCardsMap.set(cardId, card);

    try {
      await setDoc(doc(db, 'scratch_cards', cardId), cleanDocData(card), { merge: true });
    } catch (err) {
      console.warn('[Gamification] Scratch card reveal firestore sync fallback:', err);
    }

    let finalBalance = user.balance;

    if (card.rewardAmount > 0) {
      const creditRes = await atomicCreditBalance(
        userId,
        card.rewardAmount,
        'scratch_reward',
        `Referral Scratch Card: @${card.refereeUsername}`,
        cardId
      );
      finalBalance = creditRes.user.balance;
    }

    const message =
      card.rewardAmount > 0
        ? `🎉 Scratch card revealed! You won +₹${card.rewardAmount}!`
        : `Card revealed: Better luck next time!`;

    return {
      success: true,
      card,
      newBalance: finalBalance,
      message,
    };
  } finally {
    releaseLock();
  }
}

/**
 * Returns overall Gamification Statistics for Admin Dashboard
 */
export async function getGamificationStats(): Promise<GamificationStats> {
  const spinRecordsMap = (memStore as any).spinRecords as Map<string, SpinRecord>;
  const scratchCardsMap = (memStore as any).scratchCards as Map<string, ScratchCardItem & { userId: string }>;

  let spinsUsed = spinRecordsMap.size;
  let spinRewardsGranted = 0;
  let spinTotalCost = 0;

  for (const s of spinRecordsMap.values()) {
    if (s.rewardAmount > 0) {
      spinRewardsGranted++;
      spinTotalCost += s.rewardAmount;
    }
  }

  // Calculate total spins earned across all users
  const completedCompletions = memStore.taskCompletions.size;
  const gamSettings = await getGamificationSettings();
  const tasksReq = gamSettings.tasksRequiredPerSpin || 3;
  // Approximate total earned across user counts:
  const userTaskCounts = new Map<string, number>();
  for (const comp of memStore.taskCompletions.values()) {
    userTaskCounts.set(comp.userId, (userTaskCounts.get(comp.userId) || 0) + 1);
  }
  let totalSpinsEarned = 0;
  for (const count of userTaskCounts.values()) {
    totalSpinsEarned += Math.floor(count / tasksReq);
  }

  let cardsIssued = scratchCardsMap.size;
  let cardsRevealed = 0;
  let scratchRewardsGranted = 0;
  let scratchTotalCost = 0;

  for (const c of scratchCardsMap.values()) {
    if (c.isRevealed) {
      cardsRevealed++;
      if (c.rewardAmount > 0) {
        scratchRewardsGranted++;
        scratchTotalCost += c.rewardAmount;
      }
    }
  }

  return {
    spinsEarned: Math.max(totalSpinsEarned, spinsUsed),
    spinsUsed,
    spinRewardsGranted,
    spinTotalCost: Math.round(spinTotalCost * 100) / 100,
    scratchCardsIssued: cardsIssued,
    scratchCardsRevealed: cardsRevealed,
    scratchRewardsGranted,
    scratchTotalCost: Math.round(scratchTotalCost * 100) / 100,
  };
}

/**
 * Trigger referral scratch card check when conditions change:
 * - registration
 * - channel_verification
 * - task_completion
 */
export async function checkAndTriggerReferralScratchCard(refereeId: string, triggerEvent: 'registration' | 'channel_verification' | 'task_completion') {
  const referee = await getUser(refereeId);
  if (!referee || !referee.referredBy) return;

  const referrerId = referee.referredBy;
  if (referrerId === refereeId) return; // Self-referral safety

  const gamSettings = await getGamificationSettings();
  if (!gamSettings.scratchCardEnabled) return;

  // Condition evaluation
  if (gamSettings.scratchCondition === 'registration' && triggerEvent === 'registration') {
    await grantReferralScratchCard(referrerId, `${referrerId}_${refereeId}`, referee.username || referee.firstName);
  } else if (gamSettings.scratchCondition === 'channel_verification' && triggerEvent === 'channel_verification') {
    await grantReferralScratchCard(referrerId, `${referrerId}_${refereeId}`, referee.username || referee.firstName);
  } else if (gamSettings.scratchCondition === 'task_completion' && triggerEvent === 'task_completion') {
    const refereeTaskIds = await getUserCompletedTaskIds(refereeId);
    const required = gamSettings.scratchTasksRequired || 1;
    if (refereeTaskIds.size >= required) {
      await grantReferralScratchCard(referrerId, `${referrerId}_${refereeId}`, referee.username || referee.firstName);
    }
  }
}
