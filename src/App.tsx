/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Home, PlayCircle, Users, Wallet, ShieldAlert, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react';
import { api, setApiAuth, onForceJoinRequired } from './services/api.ts';
import { getClientDeviceFingerprint, getStoredDeviceToken, saveDeviceToken } from './services/device.ts';
import type { UserProfile, Task, AppSettings, ForceJoinChannel, UserGamificationState } from './types/index.ts';
import { Header } from './components/Header.tsx';
import { HomeView } from './views/HomeView.tsx';
import { TasksView } from './views/TasksView.tsx';
import { ReferralsView } from './views/ReferralsView.tsx';
import { WalletView } from './views/WalletView.tsx';
import { AdminView } from './views/AdminView.tsx';
import { TaskModal } from './components/TaskModal.tsx';
import { WithdrawalModal } from './components/WithdrawalModal.tsx';
import { ForceJoinModal } from './components/ForceJoinModal.tsx';
import { SpinWheelModal } from './components/SpinWheelModal.tsx';
import { ScratchCardModal } from './components/ScratchCardModal.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

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
  const [error, setError] = useState<string | null>(null);

  // Core App State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSimulatedAuth, setIsSimulatedAuth] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    signupBonus: 50,
    referralReward: 25,
    dailyCheckinBaseReward: 10,
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

      // 4. Fetch Tasks, App Settings, and Gamification Status
      const [tasksRes, settingsRes, gamRes] = await Promise.all([
        api.getTasks().catch(() => ({ tasks: [] })),
        api.getConfig().catch(() => ({
          settings: {
            signupBonus: 20,
            referralReward: 10,
            dailyCheckinBaseReward: 5,
            minWithdrawalAmount: 10,
            supportTelegramUsername: 'TeleEarnSupport',
            maintenanceMode: false,
            payoutLiveEnabled: false,
            botUsername: 'WatchXEarnBot',
          },
        })),
        api.getGamificationStatus().catch(() => null),
      ]);

      setTasks(tasksRes.tasks || []);
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
    } finally {
      setLoading(false);
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
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-2xl mb-4 animate-pulse">
          <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
            <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
          </div>
        </div>
        <h2 className="text-lg font-bold text-white tracking-wide">Connecting to TeleEarn</h2>
        <p className="text-xs text-slate-400 mt-1">Verifying Telegram session & database sync...</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-950/70 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-white">Connection Issue</h2>
        <p className="text-xs text-slate-300 max-w-sm mt-2 mb-5 leading-relaxed">{error}</p>
        <button
          onClick={() => initApp()}
          className="py-2.5 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans max-w-md mx-auto relative shadow-2xl">
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
      <main className="flex-1 px-4 pt-4">
        {deviceWarning && (
          <div className="mb-4 p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-center gap-3 text-xs text-amber-300 font-medium">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>{deviceWarning}</span>
          </div>
        )}

        {/* Lucky Spin Unlocked Notification Banner */}
        {gamState && gamState.spinWheelEnabled && gamState.availableSpins > 0 && (
          <div className="mb-4 p-3 bg-gradient-to-r from-emerald-500/20 via-teal-500/20 to-emerald-500/10 border border-emerald-500/40 rounded-2xl flex items-center justify-between gap-3 text-xs text-emerald-300 shadow-lg animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🎡</span>
              <div>
                <p className="font-bold text-white text-xs">Lucky Spin Unlocked!</p>
                <p className="text-[11px] text-emerald-400">
                  You have <strong className="font-black text-white">{gamState.availableSpins}</strong> spin(s) ready to play!
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSpinModal(true)}
              className="py-1.5 px-3 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-[11px] rounded-xl shadow-md transition shrink-0"
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
          <TasksView tasks={tasks} onSelectTask={setSelectedTask} />
        )}

        {activeTab === 'referrals' && (
          <ReferralsView
            user={user}
            settings={settings}
            gamState={gamState}
            onOpenScratchCards={() => setShowScratchModal(true)}
          />
        )}

        {activeTab === 'wallet' && (
          <WalletView
            user={user}
            settings={settings}
            onOpenWithdrawal={() => setShowWithdrawalModal(true)}
          />
        )}

        {activeTab === 'admin' && isAdmin && (
          <ErrorBoundary fallbackTitle="Admin Panel Error">
            <AdminView currentUser={user} />
          </ErrorBoundary>
        )}
      </main>

      {/* Interactive Modals */}
      <ForceJoinModal
        isOpen={forceJoinRequired && unjoinedChannels.length > 0}
        channels={unjoinedChannels}
        onVerified={handleForceJoinVerified}
      />

      <TaskModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onSuccess={handleTaskSuccess}
      />

      <WithdrawalModal
        isOpen={showWithdrawalModal}
        availableBalance={user.balance}
        minWithdrawal={settings.minWithdrawalAmount}
        maxWithdrawal={settings.maxWithdrawalAmount}
        onClose={() => setShowWithdrawalModal(false)}
        onSuccess={handleWithdrawalSuccess}
      />

      <SpinWheelModal
        isOpen={showSpinModal}
        onClose={() => setShowSpinModal(false)}
        gamState={gamState}
        onSpinSuccess={(newBal) => {
          if (user) setUser({ ...user, balance: newBal });
        }}
        onRefreshGamification={refreshGamification}
      />

      <ScratchCardModal
        isOpen={showScratchModal}
        onClose={() => setShowScratchModal(false)}
        cards={gamState?.scratchCards || []}
        onScratchSuccess={(newBal) => {
          if (user) setUser({ ...user, balance: newBal });
        }}
        onRefreshCards={refreshGamification}
      />

      {/* Bottom Mobile Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 px-2 py-2">
        <div className="flex items-center justify-around">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'home'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Home className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Home</span>
          </button>

          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'tasks'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlayCircle className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Tasks</span>
          </button>

          <button
            onClick={() => setActiveTab('referrals')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'referrals'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Referrals</span>
          </button>

          <button
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              activeTab === 'wallet'
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400 hover:text-slate-200'
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
                  ? 'text-red-400 font-bold'
                  : 'text-slate-400 hover:text-red-300'
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
