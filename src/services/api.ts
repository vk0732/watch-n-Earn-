import type {
  UserProfile,
  Task,
  Withdrawal,
  Transaction,
  ForceJoinChannel,
  AppSettings,
  DashboardStats,
  AdminAuditLog,
  PaymentGatewayPublicConfig,
  GatewayTestResult,
  UserGamificationState,
  SpinRewardSegment,
  ScratchCardItem,
  GamificationSettings,
  GamificationStats,
  GiftCardCode,
  GiftCardInventoryStats,
} from '../types/index.ts';

let currentInitData = '';
let mockUserId = '';

export function setApiAuth(initData: string, mockId = '') {
  currentInitData = initData;
  mockUserId = mockId;
}

let forceJoinRequiredCallback: ((unjoined: ForceJoinChannel[]) => void) | null = null;

export function onForceJoinRequired(callback: (unjoined: ForceJoinChannel[]) => void) {
  forceJoinRequiredCallback = callback;
}

// In-flight GET request deduplication map to prevent simultaneous duplicate HTTP requests
const inFlightGetRequests = new Map<string, Promise<any>>();

// Cache for static, non-sensitive app configuration
let configCache: { data: any; expiry: number } | null = null;

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  // Deduplicate in-flight GET requests
  if (isGet) {
    const existing = inFlightGetRequests.get(endpoint);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  const executeRequest = async (): Promise<T> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (currentInitData) {
      headers['x-telegram-init-data'] = currentInitData;
    }
    if (mockUserId) {
      headers['x-mock-user-id'] = mockUserId;
    }

    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json();
    if (!res.ok) {
      if (data.forceJoinRequired && forceJoinRequiredCallback) {
        forceJoinRequiredCallback(data.unjoinedChannels || []);
      }
      const error: any = new Error(data.error || 'Server request failed');
      error.forceJoinRequired = data.forceJoinRequired;
      error.unjoinedChannels = data.unjoinedChannels;
      throw error;
    }
    return data as T;
  };

  if (isGet) {
    const promise = executeRequest().finally(() => {
      inFlightGetRequests.delete(endpoint);
    });
    inFlightGetRequests.set(endpoint, promise);
    return promise;
  }

  return executeRequest();
}

let isWithdrawalInProgress = false;

export const api = {
  // Authentication & Session
  verifyTelegramAuth: (
    initData: string,
    refCode?: string,
    deviceToken?: string,
    deviceFingerprint?: string
  ) =>
    request<{
      success: boolean;
      user: UserProfile;
      deviceToken?: string;
      signupBonusMessage?: string;
      deviceWarning?: string;
      isAdmin: boolean;
      isSimulatedAuth: boolean;
      forceJoinRequired: boolean;
      unjoinedChannels: ForceJoinChannel[];
    }>('/auth/verify-telegram', {
      method: 'POST',
      body: JSON.stringify({ initData, refCode, deviceToken, deviceFingerprint }),
    }),

  getCurrentUser: () =>
    request<{
      user: UserProfile;
      isAdmin: boolean;
      forceJoinRequired: boolean;
      unjoinedChannels: ForceJoinChannel[];
    }>('/auth/me'),

  getConfig: async () => {
    if (configCache && Date.now() < configCache.expiry) {
      return configCache.data;
    }
    const data = await request<{ settings: AppSettings }>('/config');
    configCache = { data, expiry: Date.now() + 30_000 };
    return data;
  },

  // Rewards & Tasks
  claimDailyCheckin: () =>
    request<{
      success: boolean;
      rewardAmount: number;
      streak: number;
      newBalance: number;
      message: string;
    }>('/rewards/daily-checkin', { method: 'POST' }),

  getTasks: () => request<{ tasks: Task[] }>('/tasks'),

  startTask: (taskId: string) =>
    request<{ success: boolean; timerSeconds: number; startedAt: number }>('/tasks/start', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),

  completeTask: (
    taskId: string,
    payload?: {
      socialHandle?: string;
      verificationCode?: string;
      confirmedAction?: boolean;
    }
  ) =>
    request<{
      success: boolean;
      rewardAmount?: number;
      newBalance?: number;
      message: string;
      pendingReview?: boolean;
      gamification?: any;
    }>('/tasks/complete', {
      method: 'POST',
      body: JSON.stringify({ taskId, ...(payload || {}) }),
    }),

  // Referrals
  getReferralStats: () =>
    request<{
      referralCode: string;
      referralLink: string;
      referralReward: number;
      totalReferrals: number;
      totalEarned: number;
      history: any[];
    }>('/referrals/stats'),

  // Withdrawals & Gift Card Code Redemption (with Double-Submission Guard)
  requestWithdrawal: async (amount?: number, idempotencyKey?: string) => {
    if (isWithdrawalInProgress) {
      throw new Error('A gift card redemption request is already processing. Please wait.');
    }
    isWithdrawalInProgress = true;
    try {
      return await request<{
        success: boolean;
        orderId: string;
        giftCardCode: string;
        denomination?: number;
        withdrawal: Withdrawal;
        remainingBalance: number;
        message: string;
      }>('/withdrawals/create', {
        method: 'POST',
        body: JSON.stringify({ amount, idempotencyKey }),
      });
    } finally {
      isWithdrawalInProgress = false;
    }
  },

  redeemGiftCard: async (amount?: number, idempotencyKey?: string) => {
    if (isWithdrawalInProgress) {
      throw new Error('A gift card redemption request is already processing. Please wait.');
    }
    isWithdrawalInProgress = true;
    try {
      return await request<{
        success: boolean;
        orderId: string;
        giftCardCode: string;
        denomination?: number;
        withdrawal: Withdrawal;
        remainingBalance: number;
        message: string;
      }>('/withdrawals/create', {
        method: 'POST',
        body: JSON.stringify({ amount, idempotencyKey }),
      });
    } finally {
      isWithdrawalInProgress = false;
    }
  },

  getMyWithdrawals: () => request<{ withdrawals: Withdrawal[] }>('/withdrawals/my'),

  getMyTransactions: () => request<{ transactions: Transaction[] }>('/transactions/my'),

  // Force Join
  verifyForceJoin: () =>
    request<{
      allJoined: boolean;
      channels: Array<ForceJoinChannel & { isMember: boolean; status: string; error?: string; diagnostic?: string }>;
      failureReason?: string | null;
    }>('/force-join/verify', { method: 'POST' }),

  // Gamification & Rewards (Spin Wheel & Scratch Cards)
  getGamificationStatus: () => request<UserGamificationState>('/gamification/status'),

  spinWheel: () =>
    request<{
      success: boolean;
      winningSegment: SpinRewardSegment;
      segmentIndex: number;
      newBalance: number;
      availableSpinsRemaining: number;
      message: string;
    }>('/gamification/spin', { method: 'POST' }),

  revealScratchCard: (cardId: string) =>
    request<{
      success: boolean;
      card: ScratchCardItem;
      newBalance: number;
      message: string;
    }>(`/gamification/scratch-cards/${cardId}/reveal`, { method: 'POST' }),

  getAdminGamification: () =>
    request<{ settings: GamificationSettings; stats: GamificationStats }>('/admin/gamification'),

  saveAdminGamification: (settings: Partial<GamificationSettings>) =>
    request<{
      success: boolean;
      message: string;
      settings: GamificationSettings;
      stats: GamificationStats;
    }>('/admin/gamification/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  // Admin APIs
  getAdminDashboard: () =>
    request<{
      stats: DashboardStats;
      gatewayStatus: any;
      settings: AppSettings;
    }>('/admin/dashboard'),

  getAdminTasks: () => request<{ tasks: Task[] }>('/admin/tasks'),

  saveAdminTask: (task: Task) =>
    request<{ success: boolean; task: Task }>('/admin/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    }),

  deleteAdminTask: (taskId: string) =>
    request<{ success: boolean }>(`/admin/tasks/${taskId}`, { method: 'DELETE' }),

  getAdminChannels: () => request<{ channels: ForceJoinChannel[] }>('/admin/channels'),

  saveAdminChannel: (channel: ForceJoinChannel) =>
    request<{ success: boolean; channel: ForceJoinChannel }>('/admin/channels', {
      method: 'POST',
      body: JSON.stringify(channel),
    }),

  deleteAdminChannel: (channelId: string) =>
    request<{ success: boolean }>(`/admin/channels/${channelId}`, { method: 'DELETE' }),

  testChannelDiagnostic: (channelId: string) =>
    request<any>(`/admin/channels/${channelId}/test-diagnostic`, { method: 'POST' }),

  testChannelAccess: (channelId: string) =>
    request<{
      success: boolean;
      ok: boolean;
      status: string;
      error?: string;
      channelTitle?: string;
      botUsername?: string;
      isPrivate?: boolean;
    }>('/admin/channels/test-access', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    }),

  testTaskChannelDiagnostic: (taskId: string) =>
    request<any>(`/admin/tasks/${taskId}/test-diagnostic`, { method: 'POST' }),

  getAdminSettings: () => request<{ settings: AppSettings }>('/admin/settings'),

  updateAdminSettings: (settings: Partial<AppSettings>) =>
    request<{ success: boolean; settings: AppSettings }>('/admin/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  getAdminWithdrawals: (status = 'all') =>
    request<{ withdrawals: Withdrawal[] }>(`/admin/withdrawals?status=${status}`),

  handleWithdrawalAction: (orderId: string, action: 'approve' | 'reject' | 'process_payout' | 'reconcile', reason?: string) =>
    request<any>(`/admin/withdrawals/${orderId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    }),

  reconcileWithdrawal: (orderId: string) =>
    request<{ success: boolean; withdrawal: Withdrawal; message: string }>(`/admin/withdrawals/${orderId}/reconcile`, {
      method: 'POST',
    }),

  // Admin Gift Card Inventory
  getAdminGiftCardStats: () =>
    request<{ stats: GiftCardInventoryStats }>('/admin/gift-cards/stats'),

  getAdminGiftCards: (status?: string, denomination?: number) => {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.append('status', status);
    if (denomination && denomination > 0) params.append('denomination', denomination.toString());
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ codes: GiftCardCode[] }>(`/admin/gift-cards${qs}`);
  },

  addAdminGiftCards: (codes: string[] | string, denomination: number) =>
    request<{ success: boolean; added: number; duplicates: number; message: string }>('/admin/gift-cards/add', {
      method: 'POST',
      body: JSON.stringify({ codes, denomination }),
    }),

  invalidateAdminGiftCard: (id: string, reason?: string) =>
    request<{ success: boolean; code: GiftCardCode }>(`/admin/gift-cards/${id}/invalidate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  deleteAdminGiftCard: (id: string) =>
    request<{ success: boolean; message: string }>(`/admin/gift-cards/${id}`, {
      method: 'DELETE',
    }),

  getPaymentGatewayConfig: () =>
    request<{ config: PaymentGatewayPublicConfig }>('/admin/gateway/config'),

  savePaymentGatewayConfig: (data: {
    provider: string;
    environment: 'test' | 'live';
    payoutsEnabled: boolean;
    apiBaseUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    merchantId?: string;
    webhookSecret?: string;
  }) =>
    request<{ success: boolean; config: PaymentGatewayPublicConfig; message: string }>('/admin/gateway/config', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  testPaymentGatewayConnection: () =>
    request<GatewayTestResult>('/admin/gateway/test-connection', {
      method: 'POST',
    }),

  removePaymentGatewayCredentials: () =>
    request<{ success: boolean; config: PaymentGatewayPublicConfig; message: string }>('/admin/gateway/credentials', {
      method: 'DELETE',
    }),

  searchAdminUsers: (q?: string) =>
    request<{ users: UserProfile[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  toggleUserBan: (userId: string) =>
    request<{ success: boolean; user: UserProfile }>(`/admin/users/${userId}/ban`, {
      method: 'POST',
    }),

  adjustUserBalance: (userId: string, amount: number, reason: string) =>
    request<{ success: boolean; user: UserProfile; transaction: Transaction }>(
      `/admin/users/${userId}/adjust-balance`,
      {
        method: 'POST',
        body: JSON.stringify({ amount, reason }),
      }
    ),

  getAdminAuditLogs: () => request<{ logs: AdminAuditLog[] }>('/admin/audit-logs'),

  getTelegramStatus: () =>
    request<{
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
      polling?: {
        isPolling: boolean;
        lastUpdateId: number;
      };
      appUrl?: string;
      suggestedWebhookUrl?: string;
      error?: string;
    }>('/telegram/status'),

  setupTelegramWebhook: (customWebhookUrl?: string) =>
    request<any>('/telegram/setup-webhook', {
      method: 'POST',
      body: JSON.stringify({ customWebhookUrl }),
    }),

  deleteTelegramWebhook: (dropPendingUpdates = false) =>
    request<any>('/telegram/delete-webhook', {
      method: 'POST',
      body: JSON.stringify({ dropPendingUpdates }),
    }),

  startTelegramPolling: () =>
    request<{ success: boolean; message: string }>('/telegram/polling/start', {
      method: 'POST',
    }),

  stopTelegramPolling: () =>
    request<{ success: boolean; message: string }>('/telegram/polling/stop', {
      method: 'POST',
    }),

  sendTelegramTestMessage: (chatId?: number | string, text?: string) =>
    request<{ success: boolean; error?: string; chatId: any }>('/telegram/test-message', {
      method: 'POST',
      body: JSON.stringify({ chatId, text }),
    }),

  getHealth: () => request<any>('/health'),
};
