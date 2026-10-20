import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  PlayCircle,
  Radio,
  Settings,
  CreditCard,
  Wallet,
  UserCheck,
  Search,
  Plus,
  Trash2,
  Edit3,
  RefreshCw,
  Send,
  XCircle,
  Activity,
  Key,
  Bot,
  Globe,
  Zap,
  Lock,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  ShieldCheck,
  Check,
  Gift,
  Disc,
  Ticket,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import type {
  DashboardStats,
  Task,
  ForceJoinChannel,
  AppSettings,
  Withdrawal,
  UserProfile,
  AdminAuditLog,
  PaymentGatewayPublicConfig,
  GatewayTestResult,
  GamificationSettings,
  GamificationStats,
  SpinRewardSegment,
  ScratchRewardOption,
  GiftCardCode,
  GiftCardInventoryStats,
  BulkBalanceResetPreview,
  BroadcastPreview,
  BroadcastTask,
} from '../types/index.ts';

interface AdminViewProps {
  currentUser: UserProfile;
}

export const AdminView: React.FC<AdminViewProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<
    'stats' | 'giftcards' | 'gamification' | 'withdrawals' | 'bot' | 'channels' | 'tasks' | 'settings' | 'users' | 'broadcast' | 'logs'
  >('stats');

  // Gamification & Rewards State
  const [gamSettings, setGamSettings] = useState<GamificationSettings | null>(null);
  const [gamStats, setGamStats] = useState<GamificationStats | null>(null);
  const [gamSaving, setGamSaving] = useState(false);

  // State
  const [stats, setStats] = useState<DashboardStats | null>(null);

  // Gift Card Inventory State
  const [gcStats, setGcStats] = useState<GiftCardInventoryStats | null>(null);
  const [gcCodes, setGcCodes] = useState<GiftCardCode[]>([]);
  const [gcFilter, setGcFilter] = useState<'all' | 'available' | 'redeemed' | 'invalidated'>('all');
  const [gcDenomFilter, setGcDenomFilter] = useState<number>(0);
  const [gcInputMode, setGcInputMode] = useState<'single' | 'bulk'>('bulk');
  const [gcSingleCode, setGcSingleCode] = useState('');
  const [gcBulkCodes, setGcBulkCodes] = useState('');
  const [gcDenomination, setGcDenomination] = useState<number>(10);
  const [gcSubmitting, setGcSubmitting] = useState(false);
  const [gcActionId, setGcActionId] = useState<string | null>(null);
  const [gcCopiedId, setGcCopiedId] = useState<string | null>(null);

  const [channels, setChannels] = useState<ForceJoinChannel[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Telegram Bot Live Status State
  const [botStatus, setBotStatus] = useState<any>(null);
  const [checkingBot, setCheckingBot] = useState(false);
  const [customWebhookInput, setCustomWebhookInput] = useState('');
  const [testChatIdInput, setTestChatIdInput] = useState('');
  const [testMessageInput, setTestMessageInput] = useState('');
  const [botActionLoading, setBotActionLoading] = useState(false);

  // Channel Edit/Add modal
  const [editingChannel, setEditingChannel] = useState<Partial<ForceJoinChannel> | null>(null);
  // Task Edit/Add modal
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [testingAccess, setTestingAccess] = useState(false);
  // User Search
  const [userSearchQuery, setUserSearchQuery] = useState('');
  // User Balance Adjust modal
  const [adjustingUser, setAdjustingUser] = useState<UserProfile | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  // Reject reason modal
  const [rejectingOrder, setRejectingOrder] = useState<Withdrawal | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Bulk Balance Reset State
  const [resetPreview, setResetPreview] = useState<BulkBalanceResetPreview | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetting, setResetting] = useState(false);

  // Broadcast Message State
  const [broadcastPreview, setBroadcastPreview] = useState<BroadcastPreview | null>(null);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastParseMode, setBroadcastParseMode] = useState<'HTML' | 'Markdown' | 'None'>('HTML');
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [activeBroadcastTask, setActiveBroadcastTask] = useState<BroadcastTask | null>(null);
  const [showBroadcastConfirmModal, setShowBroadcastConfirmModal] = useState(false);

  useEffect(() => {
    loadTabContent();
  }, [activeTab]);

  // Polling for active broadcast progress
  useEffect(() => {
    let interval: any = null;
    if (activeBroadcastTask && (activeBroadcastTask.status === 'in_progress' || activeBroadcastTask.status === 'pending')) {
      interval = setInterval(async () => {
        try {
          const res = await api.getBroadcastStatus(activeBroadcastTask.id);
          if (res?.task) {
            setActiveBroadcastTask(res.task);
          }
        } catch (e) {
          // ignore transient poll error
        }
      }, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeBroadcastTask?.status, activeBroadcastTask?.id]);

  const showNotify = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadGiftCardsData = async (filter = gcFilter, denom = gcDenomFilter) => {
    try {
      const [sRes, cRes] = await Promise.all([
        api.getAdminGiftCardStats(),
        api.getAdminGiftCards(filter, denom),
      ]);
      setGcStats(sRes.stats);
      setGcCodes(cRes.codes || []);
    } catch (err: any) {
      showNotify(err.message || 'Failed to load gift cards data', 'error');
    }
  };

  const handleImportGiftCards = async (e: React.FormEvent) => {
    e.preventDefault();
    const codesToImport = gcInputMode === 'single' ? [gcSingleCode.trim()] : gcBulkCodes;
    if (!codesToImport || (Array.isArray(codesToImport) && !codesToImport[0])) {
      showNotify('Please enter at least one gift card code.', 'error');
      return;
    }

    setGcSubmitting(true);
    try {
      const res = await api.addAdminGiftCards(codesToImport, gcDenomination);
      showNotify(res.message || `Imported ${res.added} code(s).`, 'success');
      setGcSingleCode('');
      setGcBulkCodes('');
      await loadGiftCardsData();
    } catch (err: any) {
      showNotify(err.message || 'Failed to import gift card codes.', 'error');
    } finally {
      setGcSubmitting(false);
    }
  };

  const handleInvalidateGiftCard = async (id: string) => {
    if (!window.confirm('Are you sure you want to invalidate this gift card code? It will not be assigned to users.')) {
      return;
    }
    setGcActionId(id);
    try {
      await api.invalidateAdminGiftCard(id, 'Admin manual invalidation');
      showNotify('Gift card code invalidated successfully.', 'success');
      await loadGiftCardsData();
    } catch (err: any) {
      showNotify(err.message || 'Failed to invalidate code.', 'error');
    } finally {
      setGcActionId(null);
    }
  };

  const handleDeleteGiftCard = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this unredeemed code from inventory?')) {
      return;
    }
    setGcActionId(id);
    try {
      await api.deleteAdminGiftCard(id);
      showNotify('Gift card code deleted.', 'success');
      await loadGiftCardsData();
    } catch (err: any) {
      showNotify(err.message || 'Failed to delete code.', 'error');
    } finally {
      setGcActionId(null);
    }
  };

  const handleCopyGcCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setGcCopiedId(id);
    setTimeout(() => setGcCopiedId(null), 2000);
  };

  const loadTabContent = async () => {
    setLoading(true);
    try {
      if (activeTab === 'stats') {
        const [res, gcRes] = await Promise.all([
          api.getAdminDashboard(),
          api.getAdminGiftCardStats().catch(() => null),
        ]);
        setStats(res.stats);
        if (gcRes) setGcStats(gcRes.stats);
        setSettings(res.settings);
      } else if (activeTab === 'giftcards') {
        await loadGiftCardsData();
      } else if (activeTab === 'bot') {
        await refreshTelegramStatus();
      } else if (activeTab === 'channels') {
        const res = await api.getAdminChannels();
        setChannels(res.channels || []);
      } else if (activeTab === 'tasks') {
        const res = await api.getAdminTasks();
        setTasks(res.tasks || []);
      } else if (activeTab === 'gamification') {
        const res = await api.getAdminGamification();
        setGamSettings(res.settings);
        setGamStats(res.stats);
      } else if (activeTab === 'settings') {
        const res = await api.getAdminSettings();
        setSettings(res.settings);
      } else if (activeTab === 'withdrawals') {
        const res = await api.getAdminWithdrawals('all');
        setWithdrawals(res.withdrawals || []);
      } else if (activeTab === 'users') {
        const res = await api.searchAdminUsers(userSearchQuery);
        setUsersList(res.users || []);
      } else if (activeTab === 'broadcast') {
        const [prev, latest] = await Promise.all([
          api.getBroadcastPreview(),
          api.getLatestBroadcast().catch(() => null),
        ]);
        setBroadcastPreview(prev);
        if (latest?.task) setActiveBroadcastTask(latest.task);
      } else if (activeTab === 'logs') {
        const res = await api.getAdminAuditLogs();
        setAuditLogs(res.logs || []);
      }
    } catch (err: any) {
      showNotify(err.message || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const refreshTelegramStatus = async () => {
    setCheckingBot(true);
    try {
      const res = await api.getTelegramStatus();
      setBotStatus(res);
      if (res.suggestedWebhookUrl && !customWebhookInput) {
        setCustomWebhookInput(res.suggestedWebhookUrl);
      }
    } catch (err: any) {
      showNotify(err.message || 'Failed to fetch Telegram bot status', 'error');
    } finally {
      setCheckingBot(false);
    }
  };

  const handleStartPolling = async () => {
    setBotActionLoading(true);
    try {
      const res = await api.startTelegramPolling();
      showNotify(res.message);
      await refreshTelegramStatus();
    } catch (err: any) {
      showNotify(err.message, 'error');
    } finally {
      setBotActionLoading(false);
    }
  };

  const handleStopPolling = async () => {
    setBotActionLoading(true);
    try {
      const res = await api.stopTelegramPolling();
      showNotify(res.message);
      await refreshTelegramStatus();
    } catch (err: any) {
      showNotify(err.message, 'error');
    } finally {
      setBotActionLoading(false);
    }
  };

  const handleRegisterWebhook = async () => {
    setBotActionLoading(true);
    try {
      const res = await api.setupTelegramWebhook(customWebhookInput);
      if (res.result?.success) {
        showNotify(`Webhook set successfully to ${res.webhookUrl}`);
      } else {
        showNotify(res.result?.description || 'Webhook configuration failed', 'error');
      }
      await refreshTelegramStatus();
    } catch (err: any) {
      showNotify(err.message, 'error');
    } finally {
      setBotActionLoading(false);
    }
  };

  const handleDeleteWebhook = async () => {
    if (!confirm('Remove current webhook? This allows switching to Polling mode.')) return;
    setBotActionLoading(true);
    try {
      const res = await api.deleteTelegramWebhook(false);
      showNotify(res.result?.description || 'Webhook removed successfully');
      await refreshTelegramStatus();
    } catch (err: any) {
      showNotify(err.message, 'error');
    } finally {
      setBotActionLoading(false);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setBotActionLoading(true);
    try {
      const targetId = testChatIdInput.trim() || currentUser.telegramId;
      const res = await api.sendTelegramTestMessage(targetId, testMessageInput.trim() || undefined);
      if (res.success) {
        showNotify(`✅ Test message delivered to Telegram chat ${targetId}!`);
        setTestMessageInput('');
      } else {
        showNotify(`Failed: ${res.error || 'Message not sent'}`, 'error');
      }
    } catch (err: any) {
      showNotify(err.message, 'error');
    } finally {
      setBotActionLoading(false);
    }
  };

  /* Channel Actions */
  const handleSaveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel?.title || !editingChannel?.channelId || !editingChannel?.inviteLink) {
      showNotify('Please fill in Title, Channel ID, and Invite Link', 'error');
      return;
    }

    const rawId = (editingChannel.channelId || '').trim();
    if (
      rawId.includes('t.me/+') ||
      rawId.includes('t.me/joinchat/') ||
      (rawId.startsWith('+') && !/^\+\d{10,}$/.test(rawId))
    ) {
      showNotify(
        'Channel ID cannot be a private invite link. Use the numeric Channel ID (e.g. -10020877627202664) or @username.',
        'error'
      );
      return;
    }

    let formattedId = rawId;
    const cMatch = rawId.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/c\/(\d+)(?:\/\d+)?/i);
    if (cMatch) {
      formattedId = `-100${cMatch[1]}`;
    } else if (/^-?\d+$/.test(rawId) || /^100\d+$/.test(rawId)) {
      if (rawId.startsWith('-100')) formattedId = rawId;
      else if (rawId.startsWith('-')) formattedId = `-100${rawId.slice(1)}`;
      else if (rawId.startsWith('100')) formattedId = `-${rawId}`;
      else formattedId = `-100${rawId}`;
    } else if (rawId.startsWith('https://') || rawId.startsWith('http://') || rawId.startsWith('t.me/')) {
      const clean = rawId.replace(/^https?:\/\//i, '').replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, '');
      const slug = clean.split('/')[0]?.split('?')[0]?.replace('@', '');
      if (slug) formattedId = `@${slug}`;
    } else if (!rawId.startsWith('@')) {
      formattedId = `@${rawId}`;
    }

    const inviteLink = (editingChannel.inviteLink || '').trim();
    if (
      formattedId.startsWith('-100') &&
      (!inviteLink || inviteLink === 'https://' || (!inviteLink.includes('t.me/+') && !inviteLink.includes('t.me/joinchat/')))
    ) {
      showNotify(
        'Private channels require a valid Telegram invite URL (https://t.me/+...) in Invite Link.',
        'error'
      );
      return;
    }

    try {
      await api.saveAdminChannel({
        ...editingChannel,
        channelId: formattedId,
      } as ForceJoinChannel);
      showNotify('Channel saved successfully!');
      setEditingChannel(null);
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm('Are you sure you want to delete this channel requirement?')) return;
    try {
      await api.deleteAdminChannel(id);
      showNotify('Channel deleted');
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  const handleTestChannelAccess = async (channelIdInput: string) => {
    if (!channelIdInput.trim()) {
      showNotify('Please enter a Channel ID or username first', 'error');
      return;
    }
    setTestingAccess(true);
    try {
      const res = await api.testChannelAccess(channelIdInput.trim());
      if (res.ok) {
        alert(
          `✅ Channel Verification Successful!\n\nChannel: ${res.channelTitle || channelIdInput}\nType: ${res.isPrivate ? 'Private Channel (-100)' : 'Public Channel'}\nBot Status: Administrator (@${res.botUsername || 'WatchXEarnBot'})\n\nBot has full access to verify subscribers.`
        );
      } else {
        alert(
          `❌ Channel Verification Issue:\n\n${res.error || 'Bot cannot verify members in this channel.'}\n\n👉 Ensure the bot (@${res.botUsername || 'WatchXEarnBot'}) is added to the channel as an Administrator with 'View members' permissions.`
        );
      }
    } catch (err: any) {
      showNotify(err.message || 'Failed to test channel access', 'error');
    } finally {
      setTestingAccess(false);
    }
  };

  const handleTestChannelDiagnostic = async (id: string) => {
    try {
      const res = await api.testChannelDiagnostic(id);
      const isOk = res.botAccess ? res.botAccess.ok : res.diagnostic?.isMember;
      alert(
        `Telegram Bot Channel Diagnostic:\n\nChannel: ${res.channel.title} (${res.channel.channelId})\nBot Access: ${res.botAccess?.ok ? 'VERIFIED ADMIN' : res.botAccess?.status || 'Check below'}\n${res.botAccess?.error ? `Error: ${res.botAccess.error}\n\n` : ''}${res.diagnostic?.error ? `Membership Check: ${res.diagnostic.error}` : 'Bot permissions verified!'}`
      );
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  const handleTestTaskDiagnostic = async (taskId: string) => {
    try {
      const res = await api.testTaskChannelDiagnostic(taskId);
      if (res.botAccess?.ok) {
        alert(
          `✅ Task Channel Diagnostic: PASS\n\nTask: ${res.task.title}\nChannel: ${res.botAccess.channelTitle} (${res.task.channelId})\nBot Status: Administrator (@${res.botAccess.botUsername})\nAdmin Membership: ${res.membershipCheck?.isMember ? 'Joined' : 'Not Joined'}\n\nMembership verification is operational!`
        );
      } else {
        alert(
          `❌ Task Channel Diagnostic: ISSUE FOUND\n\nTask: ${res.task.title}\nChannel ID: ${res.task.channelId}\n\nError: ${res.botAccess?.error || res.membershipCheck?.error || 'Bot access failed'}\n\n👉 Add the bot as an Administrator in your Telegram channel to resolve.`
        );
      }
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  /* Task Actions */
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask?.title || editingTask?.rewardAmount === undefined) {
      showNotify('Please fill in Title and Reward Amount', 'error');
      return;
    }

    const payload = { ...editingTask } as Task;

    if (payload.taskType === 'channel') {
      const rawId = (payload.channelId || '').trim();
      const rawUrl = (payload.destinationUrl || '').trim();

      if (!rawId && !rawUrl) {
        showNotify('Please provide Channel Username/ID and Join URL', 'error');
        return;
      }

      if (
        rawId.includes('t.me/+') ||
        rawId.includes('t.me/joinchat/') ||
        (rawId.startsWith('+') && !/^\+\d{10,}$/.test(rawId))
      ) {
        showNotify(
          'Channel ID cannot be a private invite link. Please enter the numeric Channel ID (e.g. -10020877627202664) in Channel ID, and the invite link in Join URL.',
          'error'
        );
        return;
      }

      let formattedId = rawId;
      const cMatch = rawId.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/c\/(\d+)(?:\/\d+)?/i);
      if (cMatch) {
        formattedId = `-100${cMatch[1]}`;
      } else if (/^-?\d+$/.test(rawId) || /^100\d+$/.test(rawId)) {
        if (rawId.startsWith('-100')) formattedId = rawId;
        else if (rawId.startsWith('-')) formattedId = `-100${rawId.slice(1)}`;
        else if (rawId.startsWith('100')) formattedId = `-${rawId}`;
        else formattedId = `-100${rawId}`;
      } else if (rawId.startsWith('https://') || rawId.startsWith('http://') || rawId.startsWith('t.me/')) {
        const clean = rawId.replace(/^https?:\/\//i, '').replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, '');
        const slug = clean.split('/')[0]?.split('?')[0]?.replace('@', '');
        if (slug) formattedId = `@${slug}`;
      } else if (rawId && !rawId.startsWith('@')) {
        formattedId = `@${rawId}`;
      }

      let finalJoinUrl = rawUrl;
      if (finalJoinUrl.startsWith('t.me/') || finalJoinUrl.startsWith('telegram.me/')) {
        finalJoinUrl = `https://${finalJoinUrl}`;
      }
      if ((!finalJoinUrl || finalJoinUrl === 'https://') && formattedId.startsWith('@')) {
        finalJoinUrl = `https://t.me/${formattedId.replace('@', '')}`;
      } else if (
        formattedId.startsWith('-100') &&
        (!finalJoinUrl ||
          finalJoinUrl === 'https://' ||
          (!finalJoinUrl.includes('t.me/+') && !finalJoinUrl.includes('t.me/joinchat/')))
      ) {
        showNotify(
          'Private channels require a valid private invite URL (https://t.me/+...) in Join URL so users can join.',
          'error'
        );
        return;
      }

      payload.channelId = formattedId;
      payload.destinationUrl = finalJoinUrl;
    } else {
      if (!payload.destinationUrl || payload.destinationUrl === 'https://') {
        showNotify('Please provide a valid destination URL', 'error');
        return;
      }
    }

    try {
      await api.saveAdminTask(payload);
      showNotify('Task saved successfully!');
      setEditingTask(null);
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await api.deleteAdminTask(id);
      showNotify('Task deleted');
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  /* Gamification Settings Actions */
  const handleSaveGamification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gamSettings) return;
    setGamSaving(true);
    try {
      const res = await api.saveAdminGamification(gamSettings);
      setGamSettings(res.settings);
      setGamStats(res.stats);
      showNotify(res.message || 'Gamification & Rewards settings saved successfully!');
    } catch (err: any) {
      showNotify(err.message || 'Failed to save gamification settings', 'error');
    } finally {
      setGamSaving(false);
    }
  };

  /* Settings Actions */
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    // Validate withdrawal settings
    if (!settings.minWithdrawalAmount || settings.minWithdrawalAmount <= 0) {
      showNotify('Minimum withdrawal amount must be greater than 0', 'error');
      return;
    }

    if (settings.maxWithdrawalAmount !== undefined && settings.maxWithdrawalAmount > 0) {
      if (settings.maxWithdrawalAmount < settings.minWithdrawalAmount) {
        showNotify(
          `Maximum withdrawal amount (₹${settings.maxWithdrawalAmount}) cannot be lower than minimum withdrawal amount (₹${settings.minWithdrawalAmount})`,
          'error'
        );
        return;
      }
    }

    if (settings.dailyWithdrawalLimitEnabled) {
      if (!settings.maxWithdrawalRequestsPer24h || settings.maxWithdrawalRequestsPer24h <= 0) {
        showNotify('Maximum requests per 24 hours must be at least 1', 'error');
        return;
      }
      if (!settings.maxWithdrawalAmountPer24h || settings.maxWithdrawalAmountPer24h <= 0) {
        showNotify('Maximum total amount per 24 hours must be greater than 0', 'error');
        return;
      }
    }

    try {
      const res = await api.updateAdminSettings(settings);
      if (res && res.settings) {
        setSettings(res.settings);
      }
      showNotify('Settings updated successfully!');
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  /* Withdrawal Actions */
  const handleWithdrawalDecision = async (
    orderId: string,
    action: 'approve' | 'reject' | 'process_payout',
    reason?: string
  ) => {
    try {
      await api.handleWithdrawalAction(orderId, action, reason);
      showNotify(`Withdrawal order ${orderId} marked as ${action}!`);
      setRejectingOrder(null);
      setRejectReason('');
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  /* User Actions */
  const handleToggleBan = async (userId: string) => {
    try {
      const res = await api.toggleUserBan(userId);
      showNotify(`User account ${res.user.isBanned ? 'SUSPENDED' : 'ACTIVATED'}`);
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingUser) return;
    const amount = Number(adjustAmount);
    if (isNaN(amount) || amount === 0) {
      showNotify('Please enter a valid positive or negative amount', 'error');
      return;
    }
    try {
      await api.adjustUserBalance(adjustingUser.id, amount, adjustReason);
      showNotify(`Adjusted balance by ₹${amount}`);
      setAdjustingUser(null);
      setAdjustAmount('');
      setAdjustReason('');
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  /* Bulk Balance Reset Actions */
  const handleOpenResetModal = async () => {
    setLoading(true);
    try {
      const prev = await api.getBulkBalanceResetPreview();
      setResetPreview(prev);
      setResetPhrase('');
      setShowResetModal(true);
    } catch (err: any) {
      showNotify(err.message || 'Failed to fetch reset preview', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async () => {
    if (resetPhrase.trim() !== 'RESET ALL BALANCES') {
      showNotify('Please type "RESET ALL BALANCES" exactly to confirm.', 'error');
      return;
    }
    setResetting(true);
    try {
      const res = await api.executeBulkBalanceReset(resetPhrase.trim());
      showNotify(`Reset successful! ${res.affectedUsers} users reset (₹${res.totalBalanceReset.toFixed(2)} cleared). Generation is now ${res.newResetGeneration}.`);
      setShowResetModal(false);
      setResetPhrase('');
      loadTabContent();
    } catch (err: any) {
      showNotify(err.message || 'Reset failed', 'error');
    } finally {
      setResetting(false);
    }
  };

  /* Broadcast Actions */
  const handleStartBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      showNotify('Please enter a message to broadcast.', 'error');
      return;
    }
    setBroadcastLoading(true);
    try {
      const res = await api.sendBroadcast(broadcastMessage.trim(), broadcastParseMode);
      showNotify(`Broadcast initiated: Task ID ${res.task.id}`);
      setShowBroadcastConfirmModal(false);
      setActiveBroadcastTask(res.task);
    } catch (err: any) {
      showNotify(err.message || 'Failed to initiate broadcast', 'error');
    } finally {
      setBroadcastLoading(false);
    }
  };

  const handleCancelBroadcast = async (taskId: string) => {
    try {
      await api.cancelBroadcast(taskId);
      showNotify('Broadcast cancellation requested.');
      const res = await api.getBroadcastStatus(taskId);
      if (res?.task) {
        setActiveBroadcastTask(res.task);
      }
    } catch (err: any) {
      showNotify(err.message || 'Failed to cancel broadcast', 'error');
    }
  };

  const handleSetupWebhook = async () => {
    try {
      const res = await api.setupTelegramWebhook();
      alert(`Webhook Setup Result:\n\n${JSON.stringify(res, null, 2)}`);
    } catch (err: any) {
      showNotify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Admin Header */}
      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shadow-2xs">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Administrator Control Panel</h2>
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-mono rounded">
                SECURE
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Logged in as Telegram ID: <span className="font-mono text-white">{currentUser.id}</span>
            </p>
          </div>
        </div>

        <button
          onClick={loadTabContent}
          className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-950/70 border border-emerald-500/30 text-emerald-300'
              : 'bg-red-950/70 border border-red-500/30 text-red-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Admin Tab Switcher */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'stats', label: 'Dashboard', icon: Activity },
          { id: 'giftcards', label: 'Gift Card Inventory', icon: Ticket },
          { id: 'gamification', label: 'Gamification & Rewards', icon: Gift },
          { id: 'withdrawals', label: 'Withdrawals', icon: Clock },
          { id: 'bot', label: 'Telegram Bot', icon: Bot },
          { id: 'channels', label: 'Force Join', icon: Radio },
          { id: 'tasks', label: 'Tasks', icon: PlayCircle },
          { id: 'users', label: 'Users', icon: Users },
          { id: 'broadcast', label: 'Broadcast', icon: Send },
          { id: 'settings', label: 'Settings', icon: Settings },
          { id: 'logs', label: 'Audit Logs', icon: Key },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                activeTab === t.id
                  ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
                  : 'bg-slate-900 text-slate-500 border border-slate-200/80 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: DASHBOARD STATS */}
      {activeTab === 'stats' && stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Total Users</span>
              <p className="text-2xl font-black text-slate-900">{stats.totalUsers}</p>
            </div>
            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Active Today</span>
              <p className="text-2xl font-black text-emerald-400">{stats.activeUsersToday}</p>
            </div>
            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Tasks Completed</span>
              <p className="text-2xl font-black text-slate-900">{stats.totalTaskCompletions}</p>
            </div>
            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Total Rewards Credited</span>
              <p className="text-2xl font-black text-emerald-400">₹{stats.totalRewardsCredited.toFixed(2)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-amber-400 uppercase">Pending Withdrawals</span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold">
                  {stats.pendingWithdrawalsCount} Requests
                </span>
              </div>
              <p className="text-3xl font-black text-slate-900">₹{stats.pendingWithdrawalsAmount.toFixed(2)}</p>
              <button
                onClick={() => setActiveTab('withdrawals')}
                className="mt-3 text-xs text-amber-400 hover:underline font-bold"
              >
                Go to Withdrawals Queue →
              </button>
            </div>

            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-emerald-400 uppercase">Settled Payouts</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">
                  {stats.successfulPayoutsCount} Paid
                </span>
              </div>
              <p className="text-3xl font-black text-slate-900">₹{stats.successfulPayoutsAmount.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-2">
                Failed / Rejected: <strong className="text-red-400">{stats.failedPayoutsCount}</strong>
              </p>
            </div>
          </div>

          {/* Gift Card Inventory Status Banner */}
          <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Ticket className="w-4 h-4 text-amber-500" /> Amazon Gift Card Inventory
              </h4>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                  gcStats && gcStats.availableCodes > 0
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {gcStats && gcStats.availableCodes > 0
                  ? `${gcStats.availableCodes} CODES IN STOCK`
                  : 'OUT OF STOCK'}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              All user withdrawals are fulfilled via instant Amazon Gift Card Code redemption.
              {gcStats && ` Currently ₹${gcStats.totalAvailableValue} total inventory value available across denominations.`}
            </p>
            <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Available: <strong className="text-slate-900">{gcStats?.availableCodes || 0}</strong> • Redeemed: <strong className="text-slate-900">{gcStats?.redeemedCodes || 0}</strong>
              </span>
              <button
                onClick={() => setActiveTab('giftcards')}
                className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-lg transition"
              >
                Manage Inventory →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: GIFT CARD INVENTORY */}
      {activeTab === 'giftcards' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Header & Refresh */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Ticket className="w-5 h-5 text-amber-500" />
                Amazon Gift Card Inventory
              </h3>
              <p className="text-xs text-slate-500">
                Manage stock of ₹10 Amazon Gift Card codes for instant withdrawal redemption
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadGiftCardsData()}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh Stock
            </button>
          </div>

          {/* Stock KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl shadow-xs">
              <span className="text-[10px] text-emerald-800 uppercase font-bold tracking-wider block mb-1">
                Available ₹10 Codes
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-black text-emerald-700">
                  {gcStats?.availableByDenomination?.[10] ?? 0}
                </span>
                <span className="text-xs font-semibold text-emerald-600">codes</span>
              </div>
              <p className="text-[10px] text-emerald-700/80 mt-1">Ready for instant redemption</p>
            </div>

            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-1">
                Total Available Value
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-black text-slate-900">
                  ₹{gcStats?.totalAvailableValue ?? 0}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Sum of active inventory</p>
            </div>

            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-1">
                Redeemed Codes
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-black text-[#0088cc]">
                  {gcStats?.redeemedCodes ?? 0}
                </span>
                <span className="text-xs font-semibold text-slate-400">delivered</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Claimed by users</p>
            </div>

            <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-1">
                Invalidated / Void
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-black text-slate-400">
                  {gcStats?.invalidatedCodes ?? 0}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Blocked from redemption</p>
            </div>
          </div>

          {/* Import / Add New Gift Card Codes Card */}
          <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-600" />
                  Add Gift Card Codes to Inventory
                </h4>
                <p className="text-xs text-slate-500">
                  Add a single code or paste multiple codes in bulk. Duplicates are automatically detected and skipped.
                </p>
              </div>

              {/* Mode switch */}
              <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold gap-1">
                <button
                  type="button"
                  onClick={() => setGcInputMode('bulk')}
                  className={`px-3 py-1 rounded-lg transition ${
                    gcInputMode === 'bulk'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Bulk Paste (Multiline)
                </button>
                <button
                  type="button"
                  onClick={() => setGcInputMode('single')}
                  className={`px-3 py-1 rounded-lg transition ${
                    gcInputMode === 'single'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Single Code
                </button>
              </div>
            </div>

            <form onSubmit={handleImportGiftCards} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Denomination (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">₹</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={gcDenomination}
                      onChange={(e) => setGcDenomination(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-2 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0088cc] rounded-xl text-xs font-bold text-slate-900"
                      required
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Default: ₹10</p>
                </div>

                <div className="sm:col-span-3">
                  {gcInputMode === 'bulk' ? (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Paste Amazon Gift Card Codes (One code per line)
                      </label>
                      <textarea
                        rows={4}
                        value={gcBulkCodes}
                        onChange={(e) => setGcBulkCodes(e.target.value)}
                        placeholder={`Paste multiple codes here, one per line:\nAMZN-ABCD-1234\nAMZN-EFGH-5678\nAMZN-9988-7766`}
                        className="w-full p-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0088cc] rounded-xl text-xs font-mono text-slate-900 placeholder:text-slate-400 resize-y"
                        required
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Single Amazon Gift Card Code
                      </label>
                      <input
                        type="text"
                        value={gcSingleCode}
                        onChange={(e) => setGcSingleCode(e.target.value)}
                        placeholder="e.g. AMZN-ABCD-1234-EFGH"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0088cc] rounded-xl text-xs font-mono text-slate-900"
                        required
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={gcSubmitting || (gcInputMode === 'bulk' ? !gcBulkCodes.trim() : !gcSingleCode.trim())}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {gcSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Importing Codes...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" /> Import to Inventory
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Codes Inventory Table */}
          <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Inventory Records</h4>
                <p className="text-xs text-slate-500">
                  {gcCodes.length} codes listed for current filter
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'available', 'redeemed', 'invalidated'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setGcFilter(st);
                      loadGiftCardsData(st, gcDenomFilter);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold capitalize transition ${
                      gcFilter === st
                        ? 'bg-[#0088cc] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0088cc]" />
                Loading inventory codes...
              </div>
            ) : gcCodes.length === 0 ? (
              <div className="py-12 text-center bg-slate-50 rounded-xl border border-slate-100">
                <Ticket className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-600">No codes found</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Import codes above to start fulfilling instant Amazon Gift Card redemptions.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                      <th className="py-2.5 px-3">Voucher Code</th>
                      <th className="py-2.5 px-3">Value</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Assigned User / Order</th>
                      <th className="py-2.5 px-3">Redeemed At</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gcCodes.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900">
                            <span>{item.code}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyGcCode(item.id, item.code)}
                              className="p-1 hover:bg-slate-200 rounded transition text-slate-400 hover:text-slate-700"
                              title="Copy code"
                            >
                              {gcCopiedId === item.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-emerald-700">
                          ₹{item.denomination}
                        </td>
                        <td className="py-2.5 px-3">
                          {item.status === 'available' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Available
                            </span>
                          )}
                          {item.status === 'redeemed' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                              Redeemed
                            </span>
                          )}
                          {item.status === 'invalidated' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                              Invalidated
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {item.assignedUserId ? (
                            <div>
                              <span className="font-semibold text-slate-800">
                                {item.assignedUsername ? `@${item.assignedUsername}` : `User ${item.assignedUserId}`}
                              </span>
                              {item.assignedWithdrawalId && (
                                <p className="font-mono text-[10px] text-slate-400">
                                  {item.assignedWithdrawalId}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-500">
                          {item.redeemedAt ? new Date(item.redeemedAt).toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {item.status === 'available' && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={gcActionId === item.id}
                                onClick={() => handleInvalidateGiftCard(item.id)}
                                className="px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 transition"
                              >
                                Invalidate
                              </button>
                              <button
                                type="button"
                                disabled={gcActionId === item.id}
                                onClick={() => handleDeleteGiftCard(item.id)}
                                className="p-1 text-slate-400 hover:text-red-600 rounded transition"
                                title="Delete code"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: GAMIFICATION & REWARDS */}
      {activeTab === 'gamification' && gamSettings && (
        <div className="space-y-4">
          {/* Gamification Statistics Overview */}
          {gamStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Spins Earned</span>
                <p className="text-2xl font-black text-slate-900">{gamStats.spinsEarned}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Used: {gamStats.spinsUsed}</p>
              </div>
              <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Spin Rewards Paid</span>
                <p className="text-2xl font-black text-purple-400">₹{gamStats.spinTotalCost.toFixed(2)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{gamStats.spinRewardsGranted} winning spins</p>
              </div>
              <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Scratch Cards</span>
                <p className="text-2xl font-black text-teal-400">{gamStats.scratchCardsIssued}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Revealed: {gamStats.scratchCardsRevealed}</p>
              </div>
              <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Scratch Rewards Paid</span>
                <p className="text-2xl font-black text-emerald-400">₹{gamStats.scratchTotalCost.toFixed(2)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{gamStats.scratchRewardsGranted} winning cards</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSaveGamification} className="space-y-4">
            {/* 1. Spin Wheel Configuration Card */}
            <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🎡</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Task Completion → Spin Wheel</h3>
                    <p className="text-xs text-slate-500">
                      Users unlock 1 spin after completing a threshold of verified tasks
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gamSettings.spinWheelEnabled}
                    onChange={(e) => setGamSettings({ ...gamSettings, spinWheelEnabled: e.target.checked })}
                    className="w-4 h-4 text-purple-600 rounded bg-slate-800 border-slate-200"
                  />
                  <span className="text-xs font-bold text-slate-900">
                    {gamSettings.spinWheelEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </label>
              </div>

              {/* Tasks Required Per Spin (2, 3, or 4) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tasks Required Per Spin (Default 3) <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={gamSettings.tasksRequiredPerSpin}
                    onChange={(e) =>
                      setGamSettings({
                        ...gamSettings,
                        tasksRequiredPerSpin: Number(e.target.value) as 2 | 3 | 4,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-bold"
                  >
                    <option value={2}>2 Tasks Completed</option>
                    <option value={3}>3 Tasks Completed (Recommended)</option>
                    <option value={4}>4 Tasks Completed</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Configurable range: 2–4 verified tasks</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Daily Spin Limit (0 = Unlimited)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={gamSettings.dailySpinLimit}
                    onChange={(e) =>
                      setGamSettings({
                        ...gamSettings,
                        dailySpinLimit: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Cap maximum spins allowed per user per day</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Max Daily Spin Budget (₹)
                  </label>
                  <input
                    type="number"
                    min={100}
                    value={gamSettings.maxDailySpinRewardBudget}
                    onChange={(e) =>
                      setGamSettings({
                        ...gamSettings,
                        maxDailySpinRewardBudget: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Financial ceiling limit for spin payouts</p>
                </div>
              </div>

              {/* Spin Segments Editor */}
              <div className="space-y-2 pt-2 border-t border-slate-200/80">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Wheel Reward Segments & Probabilities
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const newSeg: SpinRewardSegment = {
                        id: `seg_${Date.now()}`,
                        label: '₹5 Coins',
                        rewardType: 'coins',
                        amount: 5,
                        probability: 10,
                        color: '#10b981',
                        textColor: '#ffffff',
                        isEnabled: true,
                      };
                      setGamSettings({
                        ...gamSettings,
                        spinSegments: [...gamSettings.spinSegments, newSeg],
                      });
                    }}
                    className="py-1 px-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold rounded-lg border border-slate-200"
                  >
                    + Add Segment
                  </button>
                </div>

                <div className="space-y-2">
                  {gamSettings.spinSegments.map((seg, idx) => (
                    <div
                      key={seg.id || idx}
                      className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl grid grid-cols-1 sm:grid-cols-5 gap-2 items-center text-xs"
                    >
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Label</label>
                        <input
                          type="text"
                          value={seg.label}
                          onChange={(e) => {
                            const updated = [...gamSettings.spinSegments];
                            updated[idx].label = e.target.value;
                            setGamSettings({ ...gamSettings, spinSegments: updated });
                          }}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">Amount (₹)</label>
                        <input
                          type="number"
                          min={0}
                          value={seg.amount}
                          onChange={(e) => {
                            const updated = [...gamSettings.spinSegments];
                            const amt = Number(e.target.value);
                            updated[idx].amount = amt;
                            if (amt === 0) updated[idx].rewardType = 'no_reward';
                            setGamSettings({ ...gamSettings, spinSegments: updated });
                          }}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">Chance / Weight</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={seg.probability}
                          onChange={(e) => {
                            const updated = [...gamSettings.spinSegments];
                            updated[idx].probability = Number(e.target.value);
                            setGamSettings({ ...gamSettings, spinSegments: updated });
                          }}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                        />
                      </div>

                      <div className="flex items-center gap-2 justify-end sm:pt-4">
                        <input
                          type="color"
                          value={seg.color}
                          onChange={(e) => {
                            const updated = [...gamSettings.spinSegments];
                            updated[idx].color = e.target.value;
                            setGamSettings({ ...gamSettings, spinSegments: updated });
                          }}
                          className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                          title="Segment Color"
                        />
                        <button
                          type="button"
                          disabled={gamSettings.spinSegments.length <= 2}
                          onClick={() => {
                            const updated = gamSettings.spinSegments.filter((_, i) => i !== idx);
                            setGamSettings({ ...gamSettings, spinSegments: updated });
                          }}
                          className="p-1.5 text-red-400 hover:text-red-300 disabled:opacity-30"
                          title="Remove Segment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 2. Referral Scratch Card Configuration Card */}
            <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🎁</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Successful Referral → Scratch Card</h3>
                    <p className="text-xs text-slate-500">
                      Grant a unique scratch-to-reveal card when an invited user qualifies
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gamSettings.scratchCardEnabled}
                    onChange={(e) => setGamSettings({ ...gamSettings, scratchCardEnabled: e.target.checked })}
                    className="w-4 h-4 text-teal-600 rounded bg-slate-800 border-slate-200"
                  />
                  <span className="text-xs font-bold text-slate-900">
                    {gamSettings.scratchCardEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </label>
              </div>

              {/* Referral Eligibility Conditions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Scratch Card Grant Condition <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={gamSettings.scratchCondition}
                    onChange={(e) =>
                      setGamSettings({
                        ...gamSettings,
                        scratchCondition: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-bold"
                  >
                    <option value="registration">Immediate on Verified Referral Signup</option>
                    <option value="channel_verification">After Referee Joins Mandatory Channels</option>
                    <option value="task_completion">After Referee Completes Minimum Tasks</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Rule governing scratch card entitlement issuance</p>
                </div>

                {gamSettings.scratchCondition === 'task_completion' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tasks Required by Referee
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={gamSettings.scratchTasksRequired || 1}
                      onChange={(e) =>
                        setGamSettings({
                          ...gamSettings,
                          scratchTasksRequired: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Number of tasks referee must complete first</p>
                  </div>
                )}
              </div>

              {/* Scratch Rewards Options Editor */}
              <div className="space-y-2 pt-2 border-t border-slate-200/80">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Scratch Card Reward Probabilities
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const newOpt: ScratchRewardOption = {
                        id: `scr_${Date.now()}`,
                        label: '₹10 Bonus',
                        rewardType: 'bonus',
                        amount: 10,
                        probability: 20,
                        isEnabled: true,
                      };
                      setGamSettings({
                        ...gamSettings,
                        scratchRewardOptions: [...gamSettings.scratchRewardOptions, newOpt],
                      });
                    }}
                    className="py-1 px-2.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-xs font-bold rounded-lg border border-slate-200"
                  >
                    + Add Reward Option
                  </button>
                </div>

                <div className="space-y-2">
                  {gamSettings.scratchRewardOptions.map((opt, idx) => (
                    <div
                      key={opt.id || idx}
                      className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl grid grid-cols-1 sm:grid-cols-4 gap-2 items-center text-xs"
                    >
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-500 block mb-0.5">Label</label>
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const updated = [...gamSettings.scratchRewardOptions];
                            updated[idx].label = e.target.value;
                            setGamSettings({ ...gamSettings, scratchRewardOptions: updated });
                          }}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">Reward (₹)</label>
                        <input
                          type="number"
                          min={0}
                          value={opt.amount}
                          onChange={(e) => {
                            const updated = [...gamSettings.scratchRewardOptions];
                            const val = Number(e.target.value);
                            updated[idx].amount = val;
                            if (val === 0) updated[idx].rewardType = 'no_reward';
                            setGamSettings({ ...gamSettings, scratchRewardOptions: updated });
                          }}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                        />
                      </div>

                      <div className="flex items-center gap-2 justify-end sm:pt-4">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={opt.probability}
                          onChange={(e) => {
                            const updated = [...gamSettings.scratchRewardOptions];
                            updated[idx].probability = Number(e.target.value);
                            setGamSettings({ ...gamSettings, scratchRewardOptions: updated });
                          }}
                          className="w-16 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                          title="Weight / Chance"
                        />
                        <button
                          type="button"
                          disabled={gamSettings.scratchRewardOptions.length <= 2}
                          onClick={() => {
                            const updated = gamSettings.scratchRewardOptions.filter((_, i) => i !== idx);
                            setGamSettings({ ...gamSettings, scratchRewardOptions: updated });
                          }}
                          className="p-1.5 text-red-400 hover:text-red-300 disabled:opacity-30"
                          title="Remove Option"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <button
              type="submit"
              disabled={gamSaving}
              className="w-full py-3 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {gamSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              <span>Save Gamification & Rewards Configuration</span>
            </button>
          </form>
        </div>
      )}


      {/* TAB: TELEGRAM BOT INTEGRATION & LIVE STATUS */}
      {activeTab === 'bot' && (
        <div className="space-y-4">
          {/* Header & Refresh */}
          <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Live Telegram Bot Integration</h3>
                <p className="text-[11px] text-slate-500">
                  Real-time connectivity status verified with official Telegram Bot API (getMe)
                </p>
              </div>
            </div>
            <button
              onClick={refreshTelegramStatus}
              disabled={checkingBot}
              className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingBot ? 'animate-spin' : ''}`} />
              <span>Verify Now</span>
            </button>
          </div>

          {/* Status Card */}
          <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Connection Status
              </span>
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${
                  botStatus?.ok
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}
              >
                {botStatus?.ok ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Connected (getMe OK)</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Disconnected / Invalid Token</span>
                  </>
                )}
              </span>
            </div>

            {botStatus?.ok && botStatus.bot && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80 text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Bot Username:</span>
                  <a
                    href={`https://t.me/${botStatus.bot.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-blue-400 hover:underline flex items-center gap-1 mt-0.5"
                  >
                    @{botStatus.bot.username}
                  </a>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Bot Display Name:</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">{botStatus.bot.first_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Telegram Bot ID:</span>
                  <span className="font-mono text-slate-700 mt-0.5 block">{botStatus.bot.id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Active Mode:</span>
                  <span className="font-bold text-amber-300 mt-0.5 block">
                    {botStatus.webhook?.url ? 'Webhook Mode' : botStatus.polling?.isPolling ? 'Long Polling Mode' : 'Idle (No Listener)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Token Source:</span>
                  <span className="font-mono text-emerald-400 mt-0.5 block">Server Secrets (Secure)</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Pending Updates:</span>
                  <span className="font-bold text-slate-800 mt-0.5 block">
                    {botStatus.webhook?.pending_update_count ?? 0} queued
                  </span>
                </div>
              </div>
            )}

            {!botStatus?.ok && (
              <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-xl space-y-2">
                <p className="text-xs text-red-300 font-medium">
                  <strong>API Error:</strong> {botStatus?.error || 'TELEGRAM_BOT_TOKEN is missing or unauthorized.'}
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  To connect your real bot, obtain your API token from <strong>@BotFather</strong> on Telegram, and set it as the server secret <strong>TELEGRAM_BOT_TOKEN</strong> in project Settings.
                </p>
              </div>
            )}
          </div>

          {/* Webhook vs Long Polling Switcher */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Mode 1: Long Polling */}
            <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <h4 className="text-sm font-bold text-slate-900">Long Polling (Preview & Local)</h4>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    botStatus?.polling?.isPolling
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {botStatus?.polling?.isPolling ? 'POLLING ACTIVE' : 'STOPPED'}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Ideal for testing inside browser previews or local dev where Telegram cannot send inbound HTTPS webhooks. Polling calls Telegram getUpdates directly from the backend.
              </p>

              <div className="pt-2 flex gap-2">
                {botStatus?.polling?.isPolling ? (
                  <button
                    onClick={handleStopPolling}
                    disabled={botActionLoading}
                    className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold text-xs rounded-xl transition"
                  >
                    Stop Polling Mode
                  </button>
                ) : (
                  <button
                    onClick={handleStartPolling}
                    disabled={botActionLoading || !botStatus?.ok}
                    className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl transition disabled:opacity-50"
                  >
                    Start Long Polling Now
                  </button>
                )}
              </div>
            </div>

            {/* Mode 2: Webhook Mode */}
            <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  <h4 className="text-sm font-bold text-slate-900">Webhook Mode (Production)</h4>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    botStatus?.webhook?.url
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {botStatus?.webhook?.url ? 'WEBHOOK SET' : 'NO WEBHOOK'}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Used for persistent deployments (Cloud Run / VPS / custom domain). Telegram pushes updates instantly via HTTPS POST to <code>/api/telegram/webhook</code>.
              </p>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Target HTTPS Webhook URL:
                </label>
                <input
                  type="url"
                  value={customWebhookInput}
                  onChange={(e) => setCustomWebhookInput(e.target.value)}
                  placeholder="https://your-domain.com/api/telegram/webhook"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                />
              </div>

              {botStatus?.webhook?.url && (
                <div className="p-2.5 bg-slate-50 rounded-xl text-[11px] text-slate-700 space-y-1">
                  <div>Current Webhook: <span className="font-mono text-emerald-400 break-all">{botStatus.webhook.url}</span></div>
                  {botStatus.webhook.last_error_message && (
                    <div className="text-red-400">Last Error: {botStatus.webhook.last_error_message}</div>
                  )}
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  onClick={handleRegisterWebhook}
                  disabled={botActionLoading || !botStatus?.ok}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition disabled:opacity-50"
                >
                  Register Webhook
                </button>
                {botStatus?.webhook?.url && (
                  <button
                    onClick={handleDeleteWebhook}
                    disabled={botActionLoading}
                    className="py-2 px-3 bg-red-950/60 hover:bg-red-900 text-red-300 font-bold text-xs rounded-xl transition"
                  >
                    Delete Webhook
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Test Live Message Delivery */}
          <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-400" /> Send Live Test Message
            </h4>
            <p className="text-xs text-slate-500">
              Trigger a test message from your bot to your personal Telegram account to verify message delivery.
            </p>

            <form onSubmit={handleSendTestMessage} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Recipient Telegram Chat ID:
                  </label>
                  <input
                    type="text"
                    value={testChatIdInput}
                    onChange={(e) => setTestChatIdInput(e.target.value)}
                    placeholder={`e.g. ${currentUser.telegramId} (Default: Admin)`}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Custom Message (HTML supported):
                  </label>
                  <input
                    type="text"
                    value={testMessageInput}
                    onChange={(e) => setTestMessageInput(e.target.value)}
                    placeholder="Hello from TeleEarn server!"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={botActionLoading || !botStatus?.ok}
                className="py-2 px-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Test Message via Bot</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: FORCE JOIN CHANNELS */}
      {activeTab === 'channels' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-900">Configured Force Join Channels</h3>
            <button
              onClick={() =>
                setEditingChannel({
                  id: '',
                  title: '',
                  channelId: '@',
                  inviteLink: 'https://t.me/',
                  isPrivate: false,
                  isEnabled: true,
                  order: channels.length + 1,
                })
              }
              className="py-1.5 px-3 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Channel
            </button>
          </div>

          <div className="space-y-2.5">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-slate-900 truncate">{ch.title}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        ch.isEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {ch.isEnabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                    {ch.isPrivate && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">
                        PRIVATE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    ID: <span className="font-mono text-slate-700">{ch.channelId}</span> • Link: {ch.inviteLink}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleTestChannelDiagnostic(ch.id)}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-blue-400 rounded-lg text-xs font-semibold"
                    title="Test Bot API Membership Verification"
                  >
                    Test Diagnostic
                  </button>
                  <button
                    onClick={() => setEditingChannel(ch)}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                    title="Edit"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteChannel(ch.id)}
                    className="p-2 bg-slate-800 hover:bg-red-950 text-red-400 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Edit/Add Channel Modal */}
          {editingChannel && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <form
                onSubmit={handleSaveChannel}
                className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4 shadow-2xl"
              >
                <h3 className="text-base font-bold text-slate-900">
                  {editingChannel.id ? 'Edit Force Join Channel' : 'Add Force Join Channel'}
                </h3>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Channel Title</label>
                  <input
                    type="text"
                    value={editingChannel.title || ''}
                    onChange={(e) => setEditingChannel({ ...editingChannel, title: e.target.value })}
                    placeholder="e.g. Official Announcements"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700">
                      Channel ID / Username
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestChannelAccess(editingChannel.channelId || '')}
                      disabled={testingAccess || !editingChannel.channelId}
                      className="text-[11px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/30 transition disabled:opacity-50"
                    >
                      {testingAccess ? 'Testing...' : 'Test Bot Access'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editingChannel.channelId || ''}
                    onChange={(e) => setEditingChannel({ ...editingChannel, channelId: e.target.value })}
                    placeholder="@mychannel or -100..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    For private channels: Enter numeric ID starting with <code className="text-amber-400 font-mono">-100...</code>
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Invite Link (Join URL)
                  </label>
                  <input
                    type="url"
                    value={editingChannel.inviteLink || ''}
                    onChange={(e) => setEditingChannel({ ...editingChannel, inviteLink: e.target.value })}
                    placeholder="https://t.me/..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    For private channels, paste invite link (e.g. <code className="text-slate-700 font-mono">https://t.me/+...</code>)
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingChannel.isEnabled)}
                      onChange={(e) => setEditingChannel({ ...editingChannel, isEnabled: e.target.checked })}
                    />
                    <span>Active & Enforced</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingChannel.isPrivate)}
                      onChange={(e) => setEditingChannel({ ...editingChannel, isPrivate: e.target.checked })}
                    />
                    <span>Private Channel</span>
                  </label>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingChannel(null)}
                    className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl"
                  >
                    Save Channel
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TASK MANAGEMENT */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-900">Configured Watch & Earn Tasks</h3>
            <button
              onClick={() =>
                setEditingTask({
                  id: '',
                  title: '',
                  description: '',
                  destinationUrl: 'https://',
                  rewardAmount: 20,
                  taskType: 'video',
                  timerSeconds: 15,
                  isActive: true,
                  sortOrder: tasks.length + 1,
                })
              }
              className="py-1.5 px-3 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Create Task
            </button>
          </div>

          <div className="space-y-2.5">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-slate-900 truncate">{t.title}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                      +₹{t.rewardAmount.toFixed(2)}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        t.isActive ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {t.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    {t.isMandatoryForCheckin && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 border border-sky-500/30">
                        MANDATORY FOR CHECK-IN
                      </span>
                    )}
                    {t.isMandatoryForWithdrawal && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30">
                        MANDATORY FOR WITHDRAWAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Type: <strong className="text-white uppercase">{t.taskType}</strong> • Timer: {t.timerSeconds}s
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {t.taskType === 'channel' && (
                    <button
                      type="button"
                      onClick={() => handleTestTaskDiagnostic(t.id)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-blue-400 rounded-lg text-xs font-semibold"
                      title="Test Bot API Membership Verification for this Task"
                    >
                      Test Diagnostic
                    </button>
                  )}
                  <button
                    onClick={() => setEditingTask(t)}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                    title="Edit"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteTask(t.id)}
                    className="p-2 bg-slate-800 hover:bg-red-950 text-red-400 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Edit/Create Task Modal */}
          {editingTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
              <form
                onSubmit={handleSaveTask}
                className="w-full max-w-md max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-white border border-slate-200 rounded-3xl shadow-2xl shadow-2xl overflow-hidden my-auto"
              >
                {/* Modal Header */}
                <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between shrink-0 bg-slate-900">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {editingTask.id ? 'Edit Task' : 'Create Watch & Earn Task'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingTask(null)}
                    className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
                    aria-label="Close"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Title</label>
                    <input
                      type="text"
                      value={editingTask.title || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                    <textarea
                      value={editingTask.description || ''}
                      onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Reward (₹ Coins)</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={editingTask.rewardAmount || ''}
                        onChange={(e) => setEditingTask({ ...editingTask, rewardAmount: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Task Type</label>
                      <select
                        value={editingTask.taskType || 'video'}
                        onChange={(e) => {
                          const newType = e.target.value as any;
                          setEditingTask({
                            ...editingTask,
                            taskType: newType,
                            timerSeconds: newType === 'channel' ? 0 : editingTask.timerSeconds || 15,
                            destinationUrl:
                              newType === 'channel' && editingTask.destinationUrl === 'https://'
                                ? ''
                                : editingTask.destinationUrl,
                          });
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-bold"
                      >
                        <option value="video">Video</option>
                        <option value="website">Website</option>
                        <option value="channel">Channel</option>
                        <option value="social">Social</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(editingTask.isActive)}
                        onChange={(e) => setEditingTask({ ...editingTask, isActive: e.target.checked })}
                      />
                      <span>Active Task (Visible to users)</span>
                    </label>
                  </div>

                  {/* ================= TYPE-SPECIFIC FIELDS ================= */}
                  {/* 1. CHANNEL TASK FIELDS */}
                  {editingTask.taskType === 'channel' && (
                    <div className="space-y-3 p-3.5 bg-slate-800/40 border border-slate-200/80 rounded-xl">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-emerald-400">
                            Channel Username or Numeric Chat ID
                          </label>
                          <button
                            type="button"
                            onClick={() => handleTestChannelAccess(editingTask.channelId || '')}
                            disabled={testingAccess || !editingTask.channelId}
                            className="text-[11px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/30 transition disabled:opacity-50"
                          >
                            {testingAccess ? 'Testing...' : 'Test Bot Access'}
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="e.g. @teleearnofficial or -1001234567890"
                          value={editingTask.channelId || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, channelId: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                          required
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                          For private channels: Enter numeric ID starting with <code className="text-amber-400 font-mono">-100...</code>
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Telegram Join URL (Public link or Private Invite Link)
                        </label>
                        <input
                          type="text"
                          placeholder="https://t.me/teleearnofficial or https://t.me/+inviteCode"
                          value={editingTask.destinationUrl === 'https://' ? '' : (editingTask.destinationUrl || '')}
                          onChange={(e) => setEditingTask({ ...editingTask, destinationUrl: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                          For private channels, paste the full invite link (e.g. <code className="text-slate-700 font-mono">https://t.me/+...</code>)
                        </p>
                      </div>
                      <div className="text-[11px] text-amber-400/90 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20 leading-relaxed">
                        💡 <strong>Telegram Bot API Requirement:</strong> The bot checks membership using <code>getChatMember</code> with the numeric Channel ID. Ensure your bot is an Administrator in this channel with &quot;View members&quot; permissions.
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-700/50">
                        <input
                          type="checkbox"
                          id="isMandatoryForCheckin"
                          checked={Boolean(editingTask.isMandatoryForCheckin)}
                          onChange={(e) => setEditingTask({ ...editingTask, isMandatoryForCheckin: e.target.checked })}
                          className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300"
                        />
                        <label htmlFor="isMandatoryForCheckin" className="text-xs font-semibold text-sky-400 cursor-pointer">
                          Mandatory for Daily Check-In (Re-verified before every daily check-in claim)
                        </label>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          id="isMandatoryForWithdrawal"
                          checked={Boolean(editingTask.isMandatoryForWithdrawal)}
                          onChange={(e) => setEditingTask({ ...editingTask, isMandatoryForWithdrawal: e.target.checked })}
                          className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300"
                        />
                        <label htmlFor="isMandatoryForWithdrawal" className="text-xs font-semibold text-amber-400 cursor-pointer">
                          Mandatory for Withdrawal (Re-verified before every gift card redemption)
                        </label>
                      </div>
                    </div>
                  )}

                  {/* 2. VIDEO TASK FIELDS */}
                  {editingTask.taskType === 'video' && (
                    <div className="space-y-3 p-3.5 bg-slate-800/40 border border-slate-200/80 rounded-xl">
                      <div>
                        <label className="block text-xs font-semibold text-red-400 mb-1">Video URL</label>
                        <input
                          type="url"
                          placeholder="https://youtube.com/watch?v=..."
                          value={editingTask.destinationUrl || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, destinationUrl: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Required Watch Timer (Seconds)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={editingTask.timerSeconds || 15}
                          onChange={(e) => setEditingTask({ ...editingTask, timerSeconds: Number(e.target.value) })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* 3. WEBSITE TASK FIELDS */}
                  {editingTask.taskType === 'website' && (
                    <div className="space-y-3 p-3.5 bg-slate-800/40 border border-slate-200/80 rounded-xl">
                      <div>
                        <label className="block text-xs font-semibold text-blue-400 mb-1">Website URL</label>
                        <input
                          type="url"
                          placeholder="https://example.com"
                          value={editingTask.destinationUrl || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, destinationUrl: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Required Visit Timer (Seconds)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={editingTask.timerSeconds || 15}
                          onChange={(e) => setEditingTask({ ...editingTask, timerSeconds: Number(e.target.value) })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* 4. SOCIAL TASK FIELDS */}
                  {editingTask.taskType === 'social' && (
                    <div className="space-y-3 p-3.5 bg-slate-800/40 border border-slate-200/80 rounded-xl">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-pink-400 mb-1">Social Platform</label>
                          <select
                            value={editingTask.socialPlatform || 'youtube'}
                            onChange={(e) => setEditingTask({ ...editingTask, socialPlatform: e.target.value as any })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-semibold"
                          >
                            <option value="youtube">YouTube</option>
                            <option value="twitter">X / Twitter</option>
                            <option value="instagram">Instagram</option>
                            <option value="telegram">Telegram</option>
                            <option value="discord">Discord</option>
                            <option value="facebook">Facebook</option>
                            <option value="other">Other Platform</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Verification Method</label>
                          <select
                            value={editingTask.verificationMethod || ''}
                            onChange={(e) => setEditingTask({ ...editingTask, verificationMethod: e.target.value as any })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                          >
                            <option value="">Direct Action Confirmation (Instant)</option>
                            <option value="manual_review">Manual Review (User Handle)</option>
                            <option value="code_confirmation">Secret Verification Code</option>
                            <option value="timer">Engagement Timer</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Target Social URL</label>
                        <input
                          type="url"
                          placeholder="https://x.com/... or https://instagram.com/..."
                          value={editingTask.destinationUrl || ''}
                          onChange={(e) => setEditingTask({ ...editingTask, destinationUrl: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                          required
                        />
                      </div>

                      {editingTask.verificationMethod === 'code_confirmation' && (
                        <div>
                          <label className="block text-xs font-semibold text-amber-400 mb-1">
                            Secret Code (In Post Description)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. SECRET2025"
                            value={editingTask.verificationCode || ''}
                            onChange={(e) => setEditingTask({ ...editingTask, verificationCode: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                            required
                          />
                        </div>
                      )}

                      {editingTask.verificationMethod === 'timer' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Engagement Timer (Seconds)
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={editingTask.timerSeconds || 15}
                            onChange={(e) => setEditingTask({ ...editingTask, timerSeconds: Number(e.target.value) })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                            required
                          />
                        </div>
                      )}

                      {editingTask.verificationMethod === 'manual_review' && (
                        <div className="text-[11px] text-blue-400/90 bg-blue-500/10 p-2 rounded-lg border border-blue-500/20">
                          Users will submit their social username / profile link for verification.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Modal Fixed/Sticky Footer */}
                <div className="p-3.5 sm:p-4 bg-slate-900 border-t border-slate-200/80 flex gap-2 shrink-0 sticky bottom-0 z-10 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setEditingTask(null)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-700 text-slate-700 font-bold text-xs rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-600/30 transition flex items-center justify-center gap-1.5"
                  >
                    Save Task
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: WITHDRAWALS MANAGEMENT */}
      {activeTab === 'withdrawals' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-900">All Withdrawal Orders ({withdrawals.length})</h3>
            <button
              onClick={loadTabContent}
              className="text-xs text-slate-500 hover:text-white flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {withdrawals.length === 0 ? (
            <div className="p-8 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs text-slate-500 text-xs">
              No withdrawal orders found.
            </div>
          ) : (
            <div className="space-y-3">
              {withdrawals.map((w) => (
                <div
                  key={w.id}
                  className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-base font-black text-slate-900">₹{w.amount.toFixed(2)}</span>
                      <span className="text-xs text-slate-500 ml-2 font-mono">Order: {w.id}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        w.status === 'success'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : w.status === 'pending'
                          ? 'bg-amber-500/15 text-amber-400'
                          : w.status === 'processing'
                          ? 'bg-blue-500/15 text-blue-400'
                          : w.status === 'reversed'
                          ? 'bg-purple-500/15 text-purple-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {w.status === 'reversed' ? 'REVERSED (REFUNDED)' : w.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-700 grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl">
                    <div>User ID: <span className="font-mono text-white">{w.userId}</span></div>
                    <div>Username: <span className="text-white">@{w.username || 'unknown'}</span></div>
                    {w.giftCardCode ? (
                      <div>Gift Card Code: <span className="font-mono text-amber-500 font-bold">{w.giftCardCode}</span></div>
                    ) : (
                      <div>Fulfillment: <span className="font-bold text-slate-800">Gift Card Voucher</span></div>
                    )}
                    <div>Requested: <span className="text-slate-500">{new Date(w.createdAt).toLocaleString()}</span></div>
                    {w.payoutTransactionId && (
                      <div className="col-span-2">
                        UTR / Ref ID: <span className="font-mono text-emerald-400 font-bold">{w.payoutTransactionId}</span>
                      </div>
                    )}
                  </div>

                  {w.failureReason && (
                    <div className="p-2 bg-red-950/60 border border-red-500/30 text-red-300 rounded-lg text-xs">
                      Rejection / Failure: {w.failureReason}
                    </div>
                  )}

                  {/* Actions for Pending/Processing orders */}
                  {(w.status === 'pending' || w.status === 'processing') && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => handleWithdrawalDecision(w.id, 'approve')}
                        className="flex-1 min-w-[120px] py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition"
                      >
                        ✓ Mark Delivered
                      </button>
                      <button
                        onClick={() => setRejectingOrder(w)}
                        className="py-1.5 px-3 bg-red-900/60 hover:bg-red-800 text-red-200 font-bold text-xs rounded-lg transition"
                      >
                        ✕ Reject & Refund
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Reject Reason Modal */}
          {rejectingOrder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 space-y-3 shadow-2xl">
                <h4 className="text-sm font-bold text-slate-900">
                  Reject & Refund Order {rejectingOrder.id}
                </h4>
                <p className="text-xs text-slate-500">
                  Rejecting will safely restore ₹{rejectingOrder.amount} back to the user's available balance.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Rejection Reason</label>
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Ineligible / Duplicate request"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setRejectingOrder(null)}
                    className="flex-1 py-2 bg-slate-800 text-slate-700 rounded-xl text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleWithdrawalDecision(rejectingOrder.id, 'reject', rejectReason)}
                    className="flex-1 py-2 bg-red-600 text-white rounded-xl text-xs font-bold"
                  >
                    Confirm Rejection & Refund
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* BULK BALANCE RESET ACTION CARD */}
          <div className="p-4 bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-2xl shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">Bulk Reset User Balances</h3>
                    <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                      DANGER ZONE
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Reset all users&apos; current balances to ₹0.00 while fully preserving user accounts, Telegram IDs, referral ties, task histories, and past transactions. Increments campaign generation, allowing users to re-claim signup rewards once.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenResetModal}
                className="shrink-0 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-xs transition active:scale-95"
              >
                Reset All User Balances
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Search user by Telegram ID, name, or username..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200/80 rounded-xl shadow-xs text-white text-xs"
              />
            </div>
            <button
              onClick={loadTabContent}
              className="px-4 py-2 bg-red-600 text-white font-bold text-xs rounded-xl"
            >
              Search
            </button>
          </div>

          <div className="space-y-2.5">
            {usersList.map((u) => (
              <div
                key={u.id}
                className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-slate-900">
                      {u.firstName} {u.lastName || ''}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">(@{u.username || 'none'})</span>
                    {u.isBanned && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                        BANNED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    ID: <span className="font-mono text-slate-700">{u.id}</span> • Balance:{' '}
                    <strong className="text-emerald-400 font-bold">₹{u.balance.toFixed(2)}</strong> • Earned:{' '}
                    ₹{u.lifetimeEarnings.toFixed(2)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setAdjustingUser(u)}
                    className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold"
                  >
                    Adjust ₹
                  </button>
                  <button
                    onClick={() => handleToggleBan(u.id)}
                    className={`p-2 rounded-lg text-xs font-bold ${
                      u.isBanned
                        ? 'bg-emerald-950 text-emerald-400 hover:bg-emerald-900'
                        : 'bg-red-950 text-red-400 hover:bg-red-900'
                    }`}
                  >
                    {u.isBanned ? 'Unban' : 'Suspend'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Adjust Balance Modal */}
          {adjustingUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <form
                onSubmit={handleAdjustBalance}
                className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 space-y-3 shadow-2xl"
              >
                <h4 className="text-sm font-bold text-slate-900">
                  Adjust Balance for {adjustingUser.firstName} ({adjustingUser.id})
                </h4>
                <p className="text-xs text-slate-500">
                  Current Balance: <strong className="text-emerald-400">₹{adjustingUser.balance}</strong>
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount (Use +50 for credit or -50 for debit)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="e.g. 50 or -50"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Audit Reason</label>
                  <input
                    type="text"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="e.g. Campaign contest winner bonus"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    required
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAdjustingUser(null)}
                    className="flex-1 py-2 bg-slate-800 text-slate-700 rounded-xl text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold"
                  >
                    Apply Adjustment
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Double-Confirmation Modal for Bulk Balance Reset */}
          {showResetModal && resetPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Confirm Bulk Balance Reset</h3>
                    <p className="text-xs text-red-600 font-semibold">This action cannot be undone!</p>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Users:</span>
                    <strong className="text-slate-900 font-mono">{resetPreview.totalUsers} users</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Balance to Clear:</span>
                    <strong className="text-red-600 font-bold font-mono">₹{resetPreview.totalBalance.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Current Campaign Generation:</span>
                    <span className="text-slate-700 font-mono">Gen {resetPreview.currentGeneration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Next Campaign Generation:</span>
                    <span className="text-emerald-600 font-bold font-mono">Gen {resetPreview.nextGeneration}</span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    All registered users will have their available balance set to <strong>₹0.00</strong>.
                  </p>
                  <p>
                    User profiles, Telegram chat IDs, task histories, referral ties, and past transaction records will be <strong>preserved</strong>.
                  </p>
                  <p className="text-emerald-700 font-medium">
                    Users will be eligible to re-claim the starting signup reward once under Generation {resetPreview.nextGeneration}.
                  </p>
                </div>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-xs font-bold text-slate-700">
                    Type <code className="text-red-600 font-mono select-all bg-red-50 px-1.5 py-0.5 rounded border border-red-200">RESET ALL BALANCES</code> to confirm:
                  </label>
                  <input
                    type="text"
                    value={resetPhrase}
                    onChange={(e) => setResetPhrase(e.target.value)}
                    placeholder="RESET ALL BALANCES"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono text-xs font-bold focus:bg-white focus:border-red-500"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={() => {
                      setShowResetModal(false);
                      setResetPhrase('');
                    }}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={resetting || resetPhrase.trim() !== 'RESET ALL BALANCES'}
                    onClick={handleConfirmReset}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-xs transition"
                  >
                    {resetting ? 'Resetting Balances...' : 'Confirm Bulk Reset'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: USER BROADCAST */}
      {activeTab === 'broadcast' && (
        <div className="space-y-4">
          <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0088cc]">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Broadcast Message</h3>
                <p className="text-xs text-slate-500">
                  Send a Telegram notification to all registered users via the Telegram Bot API.
                </p>
              </div>
            </div>

            {/* Recipient Counter & Rate Limit Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Valid Telegram Recipients</span>
                <p className="text-xl font-black text-[#0088cc]">{broadcastPreview?.recipientCount ?? '...'}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Estimated Delivery Time</span>
                <p className="text-xl font-black text-emerald-600">
                  {broadcastPreview?.recipientCount ? `~${Math.ceil(broadcastPreview.recipientCount / 25)}s` : 'Instant'}
                </p>
              </div>
            </div>

            {/* Formatting mode toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">Message Content</label>
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  {(['HTML', 'Markdown', 'None'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setBroadcastParseMode(mode)}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${
                        broadcastParseMode === mode
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {mode === 'None' ? 'Plain' : mode}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                rows={5}
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder={
                  broadcastParseMode === 'HTML'
                    ? '<b>📢 New Announcement!</b>\n\nEarn ₹50 extra coins today by completing tasks!\n<a href="https://t.me/...">Tap here to learn more</a>'
                    : broadcastParseMode === 'Markdown'
                    ? '*📢 New Announcement!*\n\nEarn ₹50 extra coins today!\n[Tap here](https://t.me/...) to check it out'
                    : 'Enter plain text announcement message...'
                }
                className="w-full p-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0088cc] rounded-xl text-slate-900 text-xs font-mono transition"
              />
              <p className="text-[11px] text-slate-400">
                Pacing: ~25 messages/second with automated HTTP 429 backoff. Blocked users are recorded safely.
              </p>
            </div>

            {/* Live Message Preview */}
            {broadcastMessage.trim() && (
              <div className="p-3.5 bg-sky-50/50 border border-sky-100 rounded-xl space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-800">
                  Telegram Bubble Preview ({broadcastParseMode})
                </span>
                <div className="p-3 bg-white border border-sky-200 rounded-xl text-xs text-slate-800 whitespace-pre-wrap font-sans shadow-2xs">
                  {broadcastMessage}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={broadcastLoading || !broadcastMessage.trim() || !broadcastPreview?.recipientCount}
                onClick={() => setShowBroadcastConfirmModal(true)}
                className="px-5 py-2.5 bg-[#0088cc] hover:bg-[#0077b5] disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-2 active:scale-95"
              >
                <Send className="w-4 h-4" />
                <span>Send Broadcast to {broadcastPreview?.recipientCount ?? 0} Users</span>
              </button>
            </div>
          </div>

          {/* Active / Recent Broadcast Task Progress */}
          {activeBroadcastTask && (
            <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900">Broadcast Task Status</h4>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase ${
                      activeBroadcastTask.status === 'in_progress' || activeBroadcastTask.status === 'pending'
                        ? 'bg-amber-100 text-amber-800 animate-pulse'
                        : activeBroadcastTask.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-800'
                        : activeBroadcastTask.status === 'cancelled'
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {activeBroadcastTask.status}
                  </span>
                </div>

                {(activeBroadcastTask.status === 'in_progress' || activeBroadcastTask.status === 'pending') && (
                  <button
                    type="button"
                    onClick={() => handleCancelBroadcast(activeBroadcastTask.id)}
                    className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-xs font-bold transition"
                  >
                    Abort Broadcast
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              {activeBroadcastTask.totalRecipients > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-500 font-semibold">
                    <span>
                      Progress: {activeBroadcastTask.sentCount + activeBroadcastTask.failedCount + activeBroadcastTask.blockedCount} / {activeBroadcastTask.totalRecipients}
                    </span>
                    <span>
                      {Math.round(
                        ((activeBroadcastTask.sentCount + activeBroadcastTask.failedCount + activeBroadcastTask.blockedCount) /
                          activeBroadcastTask.totalRecipients) *
                          100
                      )}
                      %
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((activeBroadcastTask.sentCount + activeBroadcastTask.failedCount + activeBroadcastTask.blockedCount) /
                              activeBroadcastTask.totalRecipients) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Metric stats */}
              <div className="grid grid-cols-4 gap-2 pt-1 text-center">
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-semibold">Total</span>
                  <p className="text-sm font-bold text-slate-900">{activeBroadcastTask.totalRecipients}</p>
                </div>
                <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                  <span className="text-[10px] text-emerald-600 font-semibold">Sent</span>
                  <p className="text-sm font-bold text-emerald-700">{activeBroadcastTask.sentCount}</p>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg border border-amber-100">
                  <span className="text-[10px] text-amber-600 font-semibold">Blocked</span>
                  <p className="text-sm font-bold text-amber-700">{activeBroadcastTask.blockedCount}</p>
                </div>
                <div className="p-2 bg-red-50 rounded-lg border border-red-100">
                  <span className="text-[10px] text-red-600 font-semibold">Failed</span>
                  <p className="text-sm font-bold text-red-700">{activeBroadcastTask.failedCount}</p>
                </div>
              </div>
            </div>
          )}

          {/* Broadcast Confirmation Modal */}
          {showBroadcastConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 space-y-4 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0088cc]">
                    <Send className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Confirm Telegram Broadcast</h3>
                    <p className="text-xs text-slate-500">
                      Targeting {broadcastPreview?.recipientCount} registered Telegram users
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1.5 text-slate-600">
                  <p>
                    The message will be sent in the background at ~25 messages/second. You can track progress or cancel at any time.
                  </p>
                </div>

                <div className="p-3 bg-sky-50 border border-sky-100 rounded-2xl text-xs text-slate-800 whitespace-pre-wrap max-h-40 overflow-y-auto font-sans">
                  {broadcastMessage}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={broadcastLoading}
                    onClick={() => setShowBroadcastConfirmModal(false)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={broadcastLoading}
                    onClick={handleStartBroadcast}
                    className="flex-1 py-2.5 bg-[#0088cc] hover:bg-[#0077b5] text-white font-bold text-xs rounded-xl shadow-xs transition"
                  >
                    {broadcastLoading ? 'Starting...' : 'Confirm & Send'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: SETTINGS */}
      {activeTab === 'settings' && (
        <ErrorBoundary fallbackTitle="Settings View Error" onReset={loadTabContent}>
          {loading && !settings ? (
            <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
              <p className="text-xs text-slate-500">Loading system settings...</p>
            </div>
          ) : !settings ? (
            <div className="p-6 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
              <p className="text-xs text-slate-500">Settings could not be loaded from server.</p>
              <button
                type="button"
                onClick={loadTabContent}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition"
              >
                Retry Loading Settings
              </button>
            </div>
          ) : (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="p-4 sm:p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Global Rewards & Operations Settings</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Welcome Signup Bonus (₹)</label>
                    <input
                      type="number"
                      value={settings.signupBonus ?? 20}
                      onChange={(e) => setSettings({ ...settings, signupBonus: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Referral Reward (₹)</label>
                    <input
                      type="number"
                      value={settings.referralReward ?? 10}
                      onChange={(e) => setSettings({ ...settings, referralReward: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                        Withdrawal Limits & Daily Controls
                      </h4>
                      <p className="text-[11px] text-slate-500">Configure minimum/maximum caps and rolling 24-hour limits</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Minimum Withdrawal Amount (₹)</label>
                      <input
                        type="number"
                        min="1"
                        value={settings.minWithdrawalAmount ?? 10}
                        onChange={(e) => setSettings({ ...settings, minWithdrawalAmount: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-semibold"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">Lower threshold per request</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Maximum Withdrawal Amount (₹)</label>
                      <input
                        type="number"
                        min={settings.minWithdrawalAmount || 1}
                        value={settings.maxWithdrawalAmount ?? 5000}
                        onChange={(e) => setSettings({ ...settings, maxWithdrawalAmount: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-semibold"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">Upper limit per request (≥ min amount)</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80/80 space-y-3">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(settings.dailyWithdrawalLimitEnabled)}
                        onChange={(e) => setSettings({ ...settings, dailyWithdrawalLimitEnabled: e.target.checked })}
                        className="rounded bg-slate-800 border-slate-200 text-emerald-500 focus:ring-emerald-500/20"
                      />
                      <span>Enable 24-Hour Rolling Withdrawal Limit</span>
                    </label>

                    {settings.dailyWithdrawalLimitEnabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-5 border-l-2 border-emerald-500/30 animate-in fade-in duration-200">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Max Requests per 24 Hours
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={settings.maxWithdrawalRequestsPer24h ?? 3}
                            onChange={(e) => setSettings({ ...settings, maxWithdrawalRequestsPer24h: Number(e.target.value) })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                          />
                          <p className="text-[10px] text-slate-500 mt-0.5">Maximum payout requests in rolling 24h</p>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Max Total Amount per 24 Hours (₹)
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={settings.maxWithdrawalAmountPer24h ?? 5000}
                            onChange={(e) => setSettings({ ...settings, maxWithdrawalAmountPer24h: Number(e.target.value) })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                          />
                          <p className="text-[10px] text-slate-500 mt-0.5">Maximum cumulative amount in rolling 24h</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Daily Check-In Base (₹)</label>
                    <input
                      type="number"
                      min="1"
                      value={settings.dailyCheckinBaseReward ?? 5}
                      onChange={(e) => setSettings({ ...settings, dailyCheckinBaseReward: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                    <p className="text-[10px] text-slate-500 mt-0.5">Day 1 baseline reward (default: ₹5)</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Daily Check-In Reward Difference (₹)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={settings.dailyCheckinRewardDifference ?? 2}
                      onChange={(e) => setSettings({ ...settings, dailyCheckinRewardDifference: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                    <p className="text-[10px] text-slate-500 mt-0.5">Increment per day across the 7-day streak cycle (default: ₹2)</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Telegram Bot Username (for Referral Links)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-xs text-slate-500 font-mono">https://t.me/</span>
                      <input
                        type="text"
                        value={(settings.botUsername || '').replace(/^@+/, '')}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/^https?:\/\/t\.me\//i, '').replace(/^@+/, '').trim();
                          setSettings({ ...settings, botUsername: cleaned });
                        }}
                        placeholder="WatchXEarnBot"
                        className="w-full pl-28 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Must be without '@' (e.g. WatchXEarnBot)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Support Telegram Username</label>
                    <input
                      type="text"
                      value={settings.supportTelegramUsername || ''}
                      onChange={(e) => setSettings({ ...settings, supportTelegramUsername: e.target.value })}
                      placeholder="TeleEarnSupport"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telegram Bot Welcome Message (/start)
                  </label>
                  <textarea
                    rows={4}
                    value={settings.templates?.welcomeMessage || ''}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        templates: {
                          ...(settings.templates || {}),
                          welcomeMessage: e.target.value,
                        },
                      })
                    }
                    placeholder="🎁 Welcome to TeleEarn!..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-[#0088cc] text-xs font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Displayed when joining channels is required. Supports Telegram HTML formatting.
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200/80">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.maintenanceMode)}
                      onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                    />
                    <span>Maintenance Mode (Temporarily lock Mini App for users)</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-lg transition"
                >
                  Save Configuration Settings
                </button>
              </div>

              {/* Telegram Webhook trigger */}
              <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Telegram Bot Webhook Setup</h4>
                  <p className="text-[11px] text-slate-500">
                    Register this server's endpoint as your Telegram Bot webhook URL
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSetupWebhook}
                  className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition"
                >
                  Sync Webhook
                </button>
              </div>
            </form>
          )}
        </ErrorBoundary>
      )}

      {/* TAB 7: AUDIT LOGS */}
      {activeTab === 'logs' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Security & Administrator Audit Trail</h3>
            <span className="text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg">
              Anti-Fraud Protected
            </span>
          </div>
          {auditLogs.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-xs bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              No audit records logged yet.
            </div>
          ) : (
            auditLogs.map((log) => {
              const isFraudLog = log.action.includes('ANTI_FRAUD') || log.action.includes('DUPLICATE_DEVICE');
              return (
                <div
                  key={log.id}
                  className={`p-3 rounded-xl text-xs space-y-1.5 transition ${
                    isFraudLog
                      ? 'bg-amber-950/30 border border-amber-500/30'
                      : 'bg-white border border-slate-200/80 shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                        isFraudLog
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-700'
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-800">{log.details}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>Admin/System: {log.adminId}</span>
                    {log.targetUserId && <span>Target User: {log.targetUserId}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
