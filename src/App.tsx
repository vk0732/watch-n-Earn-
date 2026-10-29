/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Home, PlayCircle, Users, Wallet, ShieldAlert, AlertTriangle } from 'lucide-react';
import { api, setApiAuth, onForceJoinRequired } from './services/api.ts';
import { getClientDeviceFingerprint, getStoredDeviceToken, saveDeviceToken } from './services/device.ts';
import type { UserProfile, Task, AppSettings, ForceJoinChannel, UserGamificationState } from './types/index.ts';
import { Header } from './components/Header.tsx';
import { HomeView } from './views/HomeView.tsx';
import { AppPreloader } from './components/AppPreloader.tsx';
import {
  TasksViewSkeleton,
  ReferralViewSkeleton,
  WalletHeroSkeleton,
  RedemptionListSkeleton,
  AdminViewSkeleton,
} from './components/Skeleton.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// Code-split heavy views and modals for sub-second first paint & minimal initial bundle
const TasksView = lazy(() => import('./views/TasksView.tsx').then((m) => ({ default: m.TasksView })));
const ReferralsView = lazy(() => import('./views/ReferralsView.tsx').then((m) => ({ default: m.ReferralsView })));
const WalletView = lazy(() => import('./views/WalletView.tsx').then((m) => ({ default: m.WalletView })));
const AdminView = lazy(() => import('./views/AdminView.tsx').then((m) => ({ default: m.AdminView })));

const TaskModal = lazy(() => import('./components/TaskModal.tsx').then((m) => ({ default: m.TaskModal })));
const WithdrawalModal = lazy(() => import('./components/WithdrawalModal.tsx').then((m) => ({ default: m.WithdrawalModal })));
const ForceJoinModal = lazy(() => import('./components/ForceJoinModal.tsx').then((m) => ({ default: m.ForceJoinModal })));
const SpinWheelModal = lazy(() => import('./components/SpinWheelModal.tsx').then((m) => ({ default: m.SpinWheelModal })));
const ScratchCardModal = lazy(() => import('./components/ScratchCardModal.tsx').then((m) => ({ default: m.ScratchCardModal })));
const SignupScratchModal = lazy(() => import('./components/SignupScratchModal.tsx').then((m) => ({ default: m.SignupScratchModal })));

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          };
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
      };
    };
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Core App State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSimulatedAuth, setIsSimulatedAuth] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    signupBonus: 50,
    referralReward: 25,
    dailyCheckinEnabled: true,
    dailyCheckinRewards: [5, 7, 9, 11, 13, 15, 17],
    dailyCheckinBaseReward: 5,
    dailyCheckinRewardDifference: 2,
    minWithdrawalAmount: 100,
    supportTelegramUsername: 'TeleEarnSupport',
    maintenanceMode: false,
    payoutLiveEnabled: false,
    botUsername: 'WatchXEarnBot',
  });

  // Force Join Gate State
  const [forceJoinRequired, setForceJoinRequired] = useState(false);
  const [unjoinedChannels, setUnjoinedChannels] = useState<ForceJoinChannel[]>([]);
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);

  // Navigation
  const [activeTab, setActiveTab] = useState<'home' | 'tasks' | 'referrals' | 'wallet' | 'admin'>('home');

  // Modals & Gamification
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [showSpinModal, setShowSpinModal] = useState(false);
  const [showScratchModal, setShowScratchModal] = useState(false);
  const [gamState, setGamState] = useState<UserGamificationState | null>(null);
  const [newSpinNotice, setNewSpinNotice] = useState<string | null>(null);

  useEffect(() => {
    onForceJoinRequired((unjoined) => {
      setForceJoinRequired(true);
      setUnjoinedChannels(unjoined);
    });
    initApp();
  }, []);

  const initApp = async (customMockId?: string, customName?: string) => {
    setLoading(true);
    setTasksLoading(true);
    setError(null);

    try {
      // 1. Initialize Telegram WebApp SDK if available
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
      }

      // 2. Extract initData or referral code
      const urlParams = new URLSearchParams(window.location.search);
      const startParam = tg?.initDataUnsafe?.start_param || urlParams.get('ref') || urlParams.get('start');

      let rawInitData = tg?.initData || '';

      // If in browser preview without Telegram wrapper, construct safe sandbox initData
      if (!rawInitData) {
        const mockId = customMockId || localStorage.getItem('teleearn_mock_id') || '987654321';
        const mockFirstName = customName || 'Normal User';
        const mockUsername = 'normal_user';

        const mockUserObj = {
          id: Number(mockId),
          first_name: mockFirstName,
          username: mockUsername,
        };

        rawInitData = `user=${encodeURIComponent(JSON.stringify(mockUserObj))}&auth_date=${Math.floor(
          Date.now() / 1000
        )}&hash=dummy_preview_hash&is_simulated=true`;

        setApiAuth(rawInitData, mockId);
      } else {
        setApiAuth(rawInitData);
      }

      // Kick off config fetch early in parallel with device and auth
      const configPromise = api.getConfig().catch(() => ({
        settings: {
          signupBonus: 20,
          referralReward: 10,
          dailyCheckinEnabled: true,
          dailyCheckinRewards: [5, 7, 9, 11, 13, 15, 17],
          dailyCheckinBaseReward: 5,
          dailyCheckinRewardDifference: 2,
          minWithdrawalAmount: 10,
          supportTelegramUsername: 'TeleEarnSupport',
          maintenanceMode: false,
          payoutLiveEnabled: false,
          botUsername: 'WatchXEarnBot',
        },
      }));

      // 3. Authenticate with backend and verify device context
      const [deviceFp, storedDeviceToken] = await Promise.all([
        getClientDeviceFingerprint(),
        Promise.resolve(getStoredDeviceToken()),
      ]);

      const authRes = await api.verifyTelegramAuth(
        rawInitData,
        startParam || undefined,
        storedDeviceToken || undefined,
        deviceFp
      );

      if (authRes.deviceToken) {
        saveDeviceToken(authRes.deviceToken);
      }
      if (authRes.deviceWarning) {
        setDeviceWarning(authRes.deviceWarning);
      } else {
        setDeviceWarning(null);
      }

      setUser(authRes.user);
      setIsAdmin(authRes.isAdmin);
      setIsSimulatedAuth(authRes.isSimulatedAuth);
      setForceJoinRequired(authRes.forceJoinRequired);
      setUnjoinedChannels(authRes.unjoinedChannels || []);

      // Unblock primary screen rendering immediately upon auth completion
      setLoading(false);

      // 4. Concurrently fetch Tasks, Settings and Gamification Status in background
      const [tasksRes, settingsRes, gamRes] = await Promise.all([
        api.getTasks().catch(() => ({ tasks: [] })),
        configPromise,
        api.getGamificationStatus().catch(() => null),
      ]);

      setTasks(tasksRes.tasks || []);
      setTasksLoading(false);

      if (settingsRes.settings) {
        setSettings(settingsRes.settings);
      }
      if (gamRes) {
        setGamState(gamRes);
        if (gamRes.canSpinNow) {
          setNewSpinNotice(`🎡 You have ${gamRes.availableSpins} Lucky Spin(s) available!`);
        }
      }
    } catch (err: any) {
      console.error('App init error:', err);
      setError(err.message || 'Unable to connect to TeleEarn servers');
      setLoading(false);
      setTasksLoading(false);
    }
  };

  const refreshGamification = async () => {
    try {
      const state = await api.getGamificationStatus();
      setGamState(state);
      if (state.canSpinNow) {
        setNewSpinNotice(`🎡 You have ${state.availableSpins} Lucky Spin(s) available!`);
      }
    } catch (err) {
      console.warn('Failed to refresh gamification:', err);
    }
  };

  const handleSwitchUser = (userId: string, name: string) => {
    localStorage.setItem('teleearn_mock_id', userId);
    initApp(userId, name);
  };

  const handleSignupScratchSuccess = (newBalance: number, updatedUser: UserProfile) => {
    setUser({ ...updatedUser, balance: newBalance, signupBonusClaimed: true });
    setForceJoinRequired(false);
    setActiveTab('home');
  };

  const handleForceJoinVerified = () => {
    setForceJoinRequired(false);
    setUnjoinedChannels([]);
    initApp();
  };

  const handleClaimedDaily = (newBalance: number, streak: number) => {
    if (user) {
      setUser({
        ...user,
        balance: newBalance,
        dailyStreak: streak,
        lastDailyCheckIn: new Date().toISOString().split('T')[0],
      });
    }
  };

  const handleTaskSuccess = (newBalance: number) => {
    if (user && selectedTask) {
      setUser({
        ...user,
        balance: newBalance,
        lifetimeEarnings: user.lifetimeEarnings + selectedTask.rewardAmount,
      });
      // Mark task completed in local list
      setTasks((prev) =>
        prev.map((t) => (t.id === selectedTask.id ? { ...t, completed: true } : t))
      );
      // Refresh gamification status to check if a new spin is unlocked!
      refreshGamification();
    }
  };

  const handleWithdrawalSuccess = (orderId: string, remainingBalance: number) => {
    if (user) {
      setUser({
        ...user,
        balance: remainingBalance,
      });
    }
  };

  if (loading) {
    return <AppPreloader />;
  }

  if (error || !user) {
    return (
      <AppPreloader
        error={error || 'User profile could not be loaded'}
        onRetry={() => initApp()}
        onSwitchUser={handleSwitchUser}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-900 flex flex-col font-sans max-w-md mx-auto relative shadow-xl border-x border-slate-200/60">
      {/* Header */}
      <Header
        user={user}
        isAdmin={isAdmin}
        activeTab={activeTab}
        onNavigateTab={setActiveTab}
        onSwitchUser={handleSwitchUser}
        isSimulatedAuth={isSimulatedAuth}
      />

      {/* Main Content Area */}
      <main className="flex-1 px-4 pt-4 pb-24">
        {deviceWarning && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-xs text-amber-800 font-medium shadow-2xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{deviceWarning}</span>
          </div>
        )}

        {/* Lucky Spin Unlocked Notification Banner */}
        {gamState && gamState.spinWheelEnabled && gamState.availableSpins > 0 && (
          <div className="mb-4 p-3.5 bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50 border border-sky-200 rounded-2xl flex items-center justify-between gap-3 text-xs shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🎡</span>
              <div>
                <p className="font-bold text-slate-900 text-xs">Lucky Spin Unlocked!</p>
                <p className="text-[11px] text-[#0088cc] font-medium">
                  You have <strong className="font-extrabold text-slate-900">{gamState.availableSpins}</strong> spin(s) ready to play!
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSpinModal(true)}
              className="py-1.5 px-3 bg-[#0088cc] hover:bg-[#0077b5] text-white font-bold text-[11px] rounded-xl shadow-sm transition shrink-0"
            >
              Spin Now →
            </button>
          </div>
        )}

        {activeTab === 'home' && (
          <HomeView
            user={user}
            settings={settings}
            tasks={tasks}
            tasksLoading={tasksLoading}
            gamState={gamState}
            onOpenWithdrawal={() => setShowWithdrawalModal(true)}
            onOpenSpinWheel={() => setShowSpinModal(true)}
            onOpenScratchCards={() => setShowScratchModal(true)}
            onSelectTask={setSelectedTask}
            onNavigateTab={setActiveTab}
            onClaimedCheckin={handleClaimedDaily}
          />
        )}

        {activeTab === 'tasks' && (
          <Suspense fallback={<TasksViewSkeleton />}>
            <TasksView tasks={tasks} loading={tasksLoading} onSelectTask={setSelectedTask} />
          </Suspense>
        )}

        {activeTab === 'referrals' && (
          <Suspense fallback={<ReferralViewSkeleton />}>
            <ReferralsView
              user={user}
              settings={settings}
              gamState={gamState}
              onOpenScratchCards={() => setShowScratchModal(true)}
            />
          </Suspense>
        )}

        {activeTab === 'wallet' && (
          <Suspense
            fallback={
              <div className="space-y-4 pb-4">
                <WalletHeroSkeleton />
                <RedemptionListSkeleton count={2} />
              </div>
            }
          >
            <WalletView
              user={user}
              settings={settings}
              onOpenWithdrawal={() => setShowWithdrawalModal(true)}
            />
          </Suspense>
        )}

        {activeTab === 'admin' && isAdmin && (
          <ErrorBoundary fallbackTitle="Admin Panel Error">
            <Suspense fallback={<AdminViewSkeleton />}>
              <AdminView currentUser={user} />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>

      {/* Interactive Modals - Lazy Loaded on Demand */}
      <Suspense fallback={null}>
        {user && !user.signupBonusClaimed && (
          <SignupScratchModal
            isOpen={true}
            user={user}
            channels={unjoinedChannels}
            maxBonus={settings.maxScratchSignupBonus || 10}
            initialBonusAmount={user.pendingSignupBonus}
            onClaimSuccess={handleSignupScratchSuccess}
          />
        )}

        {user && user.signupBonusClaimed && forceJoinRequired && unjoinedChannels.length > 0 && (
          <ForceJoinModal
            isOpen={true}
            channels={unjoinedChannels}
            onVerified={handleForceJoinVerified}
          />
        )}

        {selectedTask && (
          <TaskModal
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onSuccess={handleTaskSuccess}
          />
        )}

        {showWithdrawalModal && (
          <WithdrawalModal
            isOpen={showWithdrawalModal}
            availableBalance={user.balance}
            minWithdrawal={settings.minWithdrawalAmount}
            maxWithdrawal={settings.maxWithdrawalAmount}
            onClose={() => setShowWithdrawalModal(false)}
            onSuccess={handleWithdrawalSuccess}
          />
        )}

        {showSpinModal && (
          <SpinWheelModal
            isOpen={showSpinModal}
            onClose={() => setShowSpinModal(false)}
            gamState={gamState}
            onSpinSuccess={(newBal) => {
              if (user) setUser({ ...user, balance: newBal });
            }}
            onRefreshGamification={refreshGamification}
          />
        )}

        {showScratchModal && (
          <ScratchCardModal
            isOpen={showScratchModal}
            onClose={() => setShowScratchModal(false)}
            cards={gamState?.scratchCards || []}
            onScratchSuccess={(newBal) => {
              if (user) setUser({ ...user, balance: newBal });
            }}
            onRefreshCards={refreshGamification}
          />
        )}
      </Suspense>

      {/* Bottom Mobile Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 px-2 py-2 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-around">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'home'
                ? 'text-[#0088cc] font-bold'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Home</span>
          </button>

          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'tasks'
                ? 'text-[#0088cc] font-bold'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <PlayCircle className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Tasks</span>
          </button>

          <button
            onClick={() => setActiveTab('referrals')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'referrals'
                ? 'text-[#0088cc] font-bold'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Referrals</span>
          </button>

          <button
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'wallet'
                ? 'text-[#0088cc] font-bold'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Wallet className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Wallet</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
                activeTab === 'admin'
                  ? 'text-red-600 font-bold'
                  : 'text-slate-400 hover:text-red-500'
              }`}
            >
              <ShieldAlert className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">Admin</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
