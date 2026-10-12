import React from 'react';
import {
  Wallet,
  PlayCircle,
  Users,
  ArrowUpRight,
  Sparkles,
  TrendingUp,
  ChevronRight,
  ShieldCheck,
  Headphones,
} from 'lucide-react';
import type { UserProfile, Task, AppSettings, UserGamificationState } from '../types/index.ts';
import { DailyCheckinCard } from '../components/DailyCheckinCard.tsx';

interface HomeViewProps {
  user: UserProfile;
  settings: AppSettings;
  tasks: Task[];
  gamState: UserGamificationState | null;
  onOpenWithdrawal: () => void;
  onOpenSpinWheel: () => void;
  onOpenScratchCards: () => void;
  onSelectTask: (task: Task) => void;
  onNavigateTab: (tab: 'home' | 'tasks' | 'referrals' | 'wallet' | 'admin') => void;
  onClaimedCheckin: (newBalance: number, streak: number) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  user,
  settings,
  tasks,
  gamState,
  onOpenWithdrawal,
  onOpenSpinWheel,
  onOpenScratchCards,
  onSelectTask,
  onNavigateTab,
  onClaimedCheckin,
}) => {
  const uncompletedTasks = tasks.filter((t) => !t.completed).slice(0, 3);

  return (
    <div className="space-y-5 pb-20">
      {/* Hero Balance Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-950 border border-emerald-500/30 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 w-44 h-44 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Available Balance
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300">
              Min Wth: ₹{settings.minWithdrawalAmount}
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">
              ₹{user.balance.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-medium">INR Coins</span>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 mb-5 p-3 rounded-2xl bg-slate-900/80 border border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Total Earned</p>
                <p className="text-sm font-bold text-white truncate">₹{user.lifetimeEarnings.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400 shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Referral Bonus</p>
                <p className="text-sm font-bold text-white truncate">₹{user.referralEarnings.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Primary Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onOpenWithdrawal}
              className="py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
            >
              <ArrowUpRight className="w-4 h-4" /> Withdraw UPI
            </button>
            <button
              onClick={() => onNavigateTab('tasks')}
              className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-slate-700 transition flex items-center justify-center gap-2"
            >
              <PlayCircle className="w-4 h-4 text-emerald-400" /> Watch & Earn
            </button>
          </div>
        </div>
      </div>

      {/* Daily Check-In Component */}
      <DailyCheckinCard
        user={user}
        baseReward={settings.dailyCheckinBaseReward}
        onClaimed={onClaimedCheckin}
      />

      {/* Gamification: Task Completion Spin Wheel Card */}
      {gamState && gamState.spinWheelEnabled && (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-950/70 via-slate-900 to-slate-950 border border-purple-500/30 p-5 shadow-xl">
          <div className="absolute top-0 right-0 w-36 h-36 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎡</span>
              <div>
                <h4 className="text-sm font-black text-white">Lucky Spin Wheel</h4>
                <p className="text-[10px] text-purple-300">
                  Earn 1 free spin every {gamState.tasksRequiredPerSpin} completed tasks!
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-bold font-mono">
              {gamState.availableSpins} Spin(s)
            </span>
          </div>

          {/* Progress Bar to next spin */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-slate-400 font-medium">Progress to next spin:</span>
              <span className="text-white font-bold font-mono">
                {gamState.progressToNextSpin} / {gamState.tasksRequiredPerSpin} tasks
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{
                  width: `${(gamState.progressToNextSpin / gamState.tasksRequiredPerSpin) * 100}%`,
                }}
              />
            </div>
          </div>

          <button
            onClick={onOpenSpinWheel}
            className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 ${
              gamState.availableSpins > 0
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white shadow-lg shadow-purple-500/20'
                : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700'
            }`}
          >
            <span>{gamState.availableSpins > 0 ? '🎡 Spin The Wheel Now' : 'View Spin Wheel Rewards'}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Gamification: Referral Scratch Cards Banner if unrevealed cards exist */}
      {gamState && gamState.scratchCardEnabled && gamState.unrevealedScratchCards > 0 && (
        <div
          onClick={onOpenScratchCards}
          className="p-4 rounded-2xl bg-gradient-to-r from-teal-950/80 via-slate-900 to-slate-950 border border-teal-500/40 flex items-center justify-between cursor-pointer hover:border-teal-400/60 transition shadow-lg group"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl group-hover:scale-110 transition">🎁</span>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-white">Unrevealed Scratch Cards</h4>
                <span className="px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-[10px] font-bold">
                  {gamState.unrevealedScratchCards} New
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Scratch to reveal bonus cash from your referral invites!
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-teal-400 group-hover:translate-x-1 transition" />
        </div>
      )}

      {/* Featured Tasks Section */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white text-base">Watch & Earn Tasks</h3>
          </div>
          <button
            onClick={() => onNavigateTab('tasks')}
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition"
          >
            View All ({tasks.length}) <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {uncompletedTasks.length === 0 ? (
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center">
            <p className="text-sm text-slate-400">🎉 You have completed all featured tasks today!</p>
            <p className="text-xs text-slate-500 mt-1">Check back later or invite friends to keep earning.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {uncompletedTasks.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectTask(t)}
                className="flex items-center justify-between p-3.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/40 rounded-2xl cursor-pointer transition group shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 group-hover:bg-emerald-500/10 border border-slate-700 group-hover:border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 transition">
                    <PlayCircle className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-bold text-white truncate group-hover:text-emerald-300 transition">
                      {t.title}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {t.timerSeconds}s Watch • {t.taskType.toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-extrabold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                    +₹{t.rewardAmount.toFixed(2)}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refer & Earn Banner */}
      <div
        onClick={() => onNavigateTab('referrals')}
        className="p-4 bg-gradient-to-r from-teal-950/60 to-slate-900 border border-teal-500/30 rounded-2xl cursor-pointer hover:border-teal-500/50 transition flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Invite Friends & Earn More</h4>
            <p className="text-xs text-slate-300">
              Get <span className="text-teal-400 font-bold">+₹{settings.referralReward}</span> for every friend who joins!
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-teal-400 shrink-0" />
      </div>

      {/* Trust & Support Footer Card */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Instant UPI Payouts Supported</span>
        </div>
        <a
          href={`https://t.me/${settings.supportTelegramUsername || 'TeleEarnSupport'}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-slate-300 hover:text-white transition"
        >
          <Headphones className="w-3.5 h-3.5" /> Help
        </a>
      </div>
    </div>
  );
};
