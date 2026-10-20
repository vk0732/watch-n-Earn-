export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface UserProfile {
  id: string; // Telegram ID string
  telegramId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  photoUrl?: string;
  balance: number;
  lifetimeEarnings: number;
  referralEarnings: number;
  referralCode: string;
  referredBy?: string | null;
  lastDailyCheckIn?: string | null; // YYYY-MM-DD
  dailyStreak: number;
  isBanned: boolean;
  isAdmin?: boolean;
  forceJoinVerified?: boolean;
  // Device & duplicate account protection
  deviceId?: string;
  deviceFingerprint?: string;
  ipHash?: string;
  isDuplicateAccount?: boolean;
  duplicateReason?: string;
  signupBonusClaimed?: boolean;
  signupBonusClaimedGeneration?: number;
  signupBonusMessage?: string;
  lastBalanceResetAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BonusClaimRecord {
  id: string; // e.g. claim_user_<id> or claim_device_<id>
  claimType: 'signup_bonus' | 'referral_reward';
  userId: string;
  telegramId?: number;
  deviceId?: string;
  deviceFingerprintHash?: string;
  ipHash?: string;
  amount: number;
  generation?: number;
  status: 'claimed' | 'rejected' | 'flagged';
  reason?: string;
  createdAt: string;
}

export type TaskType = 'video' | 'website' | 'channel' | 'social' | 'bot';

export interface Task {
  id: string;
  title: string;
  description: string;
  destinationUrl: string;
  rewardAmount: number;
  taskType: TaskType;
  timerSeconds: number;
  isActive: boolean;
  sortOrder: number;
  iconName?: string;
  completed?: boolean;
  botUsername?: string;
  channelId?: string; // Telegram channel username (e.g. @telegram) or numeric chat ID (-100...)
  isMandatoryForWithdrawal?: boolean; // When true, membership in this channel is required to redeem withdrawals
  isMandatoryForCheckin?: boolean; // When true, membership in this channel is required for daily check-in claims
  socialPlatform?: 'youtube' | 'twitter' | 'instagram' | 'telegram' | 'discord' | 'facebook' | 'other';
  verificationMethod?: 'telegram_membership' | 'timer' | 'manual_review' | 'code_confirmation';
  verificationCode?: string; // Optional code for code_confirmation
  createdAt: string;
}

export interface TaskBot {
  id: string;
  botName: string;
  botUsername: string; // e.g. PartnerEarnBot
  description: string;
  startParameter?: string; // e.g. ref_123 or promo
  botUrl: string;
  rewardAmount: number;
  verificationType: 'deep_link' | 'membership' | 'manual_review';
  isEnabled: boolean;
  sortOrder: number;
  completed?: boolean;
  createdAt: string;
}

export interface TaskCompletion {
  id: string;
  userId: string;
  taskId: string;
  rewardAmount: number;
  completedAt: string;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  refereeId: string;
  refereeUsername: string;
  refereeFirstName?: string;
  rewardAmount: number;
  status: 'credited' | 'pending' | 'rejected_duplicate' | 'rejected' | 'flagged_abuse';
  rejectionReason?: string;
  createdAt: string;
}

export type TransactionType =
  | 'signup_bonus'
  | 'daily_checkin'
  | 'task_reward'
  | 'referral_reward'
  | 'spin_reward'
  | 'scratch_reward'
  | 'withdrawal_deduct'
  | 'withdrawal_refund'
  | 'admin_adjustment';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  description: string;
  balanceAfter: number;
  referenceId?: string;
  createdAt: string;
}

export type WithdrawalStatus = 'pending' | 'processing' | 'success' | 'rejected' | 'failed' | 'reversed';

export interface Withdrawal {
  id: string;
  userId: string;
  userTelegramId: number;
  username?: string;
  amount: number;
  upiId?: string;
  status: WithdrawalStatus;
  providerResponse?: string;
  failureReason?: string;
  payoutTransactionId?: string;
  payoutChannelMessageId?: number;
  payoutMode?: 'manual' | 'gateway' | 'gift_card';
  giftCardCode?: string;
  giftCardDenomination?: number;
  giftCardId?: string;
  giftCardRedeemedAt?: string;
  idempotencyKey?: string;
  createdAt: string;
  processedAt?: string | null;
}

export interface GiftCardCode {
  id: string;
  code: string;
  denomination: number;
  status: 'available' | 'redeemed' | 'invalidated';
  assignedUserId?: string | null;
  assignedTelegramId?: number | null;
  assignedUsername?: string | null;
  assignedWithdrawalId?: string | null;
  redeemedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  notes?: string;
}

export interface GiftCardInventoryStats {
  totalCodes: number;
  availableCodes: number;
  redeemedCodes: number;
  invalidatedCodes: number;
  availableByDenomination: Record<number, number>;
  totalAvailableValue: number;
}

export interface ForceJoinChannel {
  id: string;
  title: string;
  username?: string;
  channelId: string; // @channel_name or -100123456789
  inviteLink: string;
  isPrivate: boolean;
  isEnabled: boolean;
  order: number;
  joined?: boolean;
}

export interface BotMessageTemplates {
  welcomeMessage: string;
  forceJoinPrompt: string;
  dailyRewardClaimed: string;
  taskCompleted: string;
  referralSuccess: string;
  withdrawalReceived: string;
  withdrawalApproved: string;
  payoutProofBroadcast: string;
}

export interface AppSettings {
  signupBonus: number;
  referralReward: number;
  dailyCheckinBaseReward: number;
  dailyCheckinRewardDifference?: number; // Configurable Daily Check-in Reward Difference (default: 2)
  minWithdrawalAmount: number;
  maxWithdrawalAmount?: number; // Optional/configurable upper bound, e.g. 5000
  dailyWithdrawalLimitEnabled?: boolean; // Enable/disable 24-hour rolling limit
  maxWithdrawalRequestsPer24h?: number; // Maximum number of withdrawal requests per 24 hours
  maxWithdrawalAmountPer24h?: number; // Maximum total withdrawal amount in rolling 24 hours
  supportTelegramUsername: string;
  maintenanceMode: boolean;
  payoutLiveEnabled: boolean;
  botUsername?: string;
  // Payout Bot & Channels
  payoutBotToken?: string;
  payoutChannelId?: string; // e.g. @teleearn_payouts or -100...
  payoutAdminChatId?: string; // Private group/channel for withdrawal approvals
  // Anti-fraud settings
  deviceVerificationEnabled?: boolean;
  blockDuplicateDevices?: boolean;
  // Bot Templates
  templates?: Partial<BotMessageTemplates>;
  // Gamification & Rewards: Spin Wheel & Scratch Card
  gamification?: GamificationSettings;
  // Reset Generation for controlled reward campaign versioning
  resetGeneration?: number;
}

export interface SpinRewardSegment {
  id: string;
  label: string; // e.g. "₹5 Coins", "₹10 Bonus", "Try Again"
  rewardType: 'coins' | 'bonus' | 'no_reward';
  amount: number; // 0 for no_reward
  probability: number; // e.g. 25 (%)
  color: string; // Hex color for wheel segment
  textColor?: string;
  isEnabled: boolean;
}

export interface ScratchRewardOption {
  id: string;
  label: string;
  rewardType: 'coins' | 'bonus' | 'no_reward';
  amount: number;
  probability: number;
  isEnabled: boolean;
}

export type ReferralScratchCondition = 'registration' | 'channel_verification' | 'task_completion';

export interface GamificationSettings {
  // Spin Wheel Configuration
  spinWheelEnabled: boolean;
  tasksRequiredPerSpin: number; // Configurable: 2, 3, or 4 (default 3)
  dailySpinLimit: number; // 0 = unlimited, or e.g. 5
  spinSegments: SpinRewardSegment[];
  maxDailySpinRewardBudget: number; // Max total coins budget per day

  // Referral Scratch Card Configuration
  scratchCardEnabled: boolean;
  scratchCondition: ReferralScratchCondition;
  scratchTasksRequired?: number; // Tasks needed if condition is 'task_completion' (e.g. 1)
  scratchRewardOptions: ScratchRewardOption[];
  maxDailyScratchRewardBudget: number;
}

export interface UserGamificationState {
  // Spin Wheel State
  completedTasksCount: number;
  tasksRequiredPerSpin: number;
  progressToNextSpin: number; // e.g. 2 / 3
  earnedSpins: number;
  usedSpins: number;
  availableSpins: number;
  canSpinNow: boolean;
  nextSpinMilestone: number;

  // Scratch Cards State
  totalScratchCards: number;
  unrevealedScratchCards: number;
  scratchCards: ScratchCardItem[];

  // Global Gamification Settings Summary
  spinWheelEnabled: boolean;
  scratchCardEnabled: boolean;
  spinSegments: SpinRewardSegment[];
}

export interface ScratchCardItem {
  id: string; // e.g. sc_<referralId>
  referralId: string;
  refereeUsername: string;
  isRevealed: boolean;
  rewardType: 'coins' | 'bonus' | 'no_reward';
  rewardAmount: number;
  revealedAt?: string | null;
  createdAt: string;
}

export interface GamificationStats {
  spinsEarned: number;
  spinsUsed: number;
  spinRewardsGranted: number;
  spinTotalCost: number;
  scratchCardsIssued: number;
  scratchCardsRevealed: number;
  scratchRewardsGranted: number;
  scratchTotalCost: number;
}

export interface AdminAuditLog {
  id: string;
  adminId: string;
  action: string;
  targetUserId?: string | null;
  details: string;
  createdAt: string;
}

export interface DashboardStats {
  totalUsers: number;
  activeUsersToday: number;
  totalTaskCompletions: number;
  totalRewardsCredited: number;
  pendingWithdrawalsCount: number;
  pendingWithdrawalsAmount: number;
  successfulPayoutsCount: number;
  successfulPayoutsAmount: number;
  failedPayoutsCount: number;
  duplicateDevicesBlocked: number;
  totalTaskBots: number;
}

export type GatewayProvider = 'cashfree' | 'razorpayx' | 'paytm' | 'paynit' | 'custom';
export type GatewayEnvironment = 'test' | 'live';
export type ConnectionStatus = 'not_configured' | 'connected' | 'failed' | 'integration_required';

export interface SupportedProviderInfo {
  id: GatewayProvider;
  name: string;
  description: string;
  requiresMerchantId: boolean;
  merchantIdLabel: string;
  defaultTestUrl: string;
  defaultLiveUrl: string;
  docsUrl: string;
  isIntegrated: boolean;
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
  supportedProviders: SupportedProviderInfo[];
  webhookUrl: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface GatewayTestResult {
  success: boolean;
  status: ConnectionStatus;
  message: string;
  httpStatus?: number;
  environment: GatewayEnvironment;
  provider: string;
  timestamp: string;
  rawDetails?: any;
}

export interface BulkBalanceResetPreview {
  totalUsers: number;
  totalBalance: number;
  currentGeneration: number;
  nextGeneration: number;
}

export interface BulkBalanceResetResult {
  success: boolean;
  affectedUsers: number;
  totalBalanceReset: number;
  newResetGeneration: number;
  resetAt: string;
  error?: string;
}

export interface BroadcastPreview {
  recipientCount: number;
}

export interface BroadcastTask {
  id: string;
  adminId: string;
  message: string;
  parseMode: 'HTML' | 'Markdown' | 'None';
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  blockedCount: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface MandatoryWithdrawalVerificationResult {
  isVerified: boolean;
  isApiError?: boolean;
  unjoinedChannels?: ForceJoinChannel[];
  error?: string;
}

export type MandatoryChannelVerificationResult = MandatoryWithdrawalVerificationResult;

