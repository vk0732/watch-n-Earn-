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
import { HomeTasksSkeleton } from '../components/Skeleton.tsx';

interface HomeViewProps {
  user: UserProfile;
  settings: AppSettings;
  tasks: Task[];
  tasksLoading?: boolean;
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
  tasksLoading = false,
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
    <div className="space-y-4 pb-4">
      {/* Hero Balance Card - Telegram Blue Premium Gradient */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0088cc] via-[#1297de] to-[#24a1de] text-white p-6 shadow-xl shadow-sky-500/15">
        <div className="absolute top-0 right-0 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-sky-300/20 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold tracking-wider text-sky-100 uppercase flex items-center gap-1.5 bg-black/10 backdrop-blur-xs px-2.5 py-1 rounded-full border border-white/15">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              Available Balance
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-black/10 backdrop-blur-xs border border-white/15 text-sky-100 font-medium">
              Min Wth: ₹{settings.minWithdrawalAmount}
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">
              ₹{user.balance.toFixed(2)}
            </span>
            <span className="text-xs text-sky-100 font-medium">INR Coins</span>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-2.5 mb-5 p-3 rounded-2xl bg-black/10 backdrop-blur-xs border border-white/15">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-sky-100 uppercase font-semibold">Total Earned</p>
                <p className="text-sm font-black text-white truncate">₹{user.lifetimeEarnings.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-sky-100 uppercase font-semibold">Referral Bonus</p>
                <p className="text-sm font-black text-white truncate">₹{user.referralEarnings.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Primary Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onOpenWithdrawal}
              className="py-3 px-4 bg-white hover:bg-slate-50 text-[#0088cc] font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 active:scale-98"
            >
              <ArrowUpRight className="w-4 h-4" /> Withdraw
            </button>
            <button
              onClick={() => onNavigateTab('tasks')}
              className="py-3 px-4 bg-white/15 hover:bg-white/25 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-white/25 backdrop-blur-xs transition flex items-center justify-center gap-2 active:scale-98"
            >
              <PlayCircle className="w-4 h-4" /> Watch & Earn
            </button>
          </div>
        </div>
      </div>

      {/* Daily Check-In Component */}
      <DailyCheckinCard
        user={user}
        baseReward={settings.dailyCheckinBaseReward}
        rewardDifference={settings.dailyCheckinRewardDifference ?? 2}
        onClaimed={onClaimedCheckin}
      />

      {/* Gamification: Task Completion Spin Wheel Card */}
      {gamState && gamState.spinWheelEnabled && (
        <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-xl">
                🎡
              </div>
              <div>
                <h4 className="text-sm font-black text-slate-900">Lucky Spin Wheel</h4>
                <p className="text-[11px] text-slate-500">
                  Earn 1 free spin every {gamState.tasksRequiredPerSpin} completed tasks!
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-bold font-mono">
              {gamState.availableSpins} Spin(s)
            </span>
          </div>

          {/* Progress Bar to next spin */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-slate-500 font-medium">Progress to next spin:</span>
              <span className="text-slate-800 font-bold font-mono">
                {gamState.progressToNextSpin} / {gamState.tasksRequiredPerSpin} tasks
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-[#0088cc] transition-all duration-300 rounded-full"
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
                ? 'bg-gradient-to-r from-purple-600 to-[#0088cc] hover:from-purple-700 hover:to-[#0077b5] text-white shadow-md shadow-purple-500/20'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
            }`}
          >
            <span>{gamState.availableSpins > 0 ? '🎡 Spin The Wheel Now' : 'View Spin Wheel Rewards'}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Gamification: Referral Scratch Cards Banner */}
      {gamState && gamState.scratchCardEnabled && gamState.unrevealedScratchCards > 0 && (
        <div
          onClick={onOpenScratchCards}
          className="p-4 rounded-2xl bg-white border border-teal-200 flex items-center justify-between cursor-pointer hover:border-teal-300 transition shadow-xs group"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl group-hover:scale-110 transition">🎁</span>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-slate-900">Unrevealed Scratch Cards</h4>
                <span className="px-2 py-0.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-[10px] font-bold">
                  {gamState.unrevealedScratchCards} New
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Scratch to reveal bonus cash from your referral invites!
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-teal-600 group-hover:translate-x-1 transition" />
        </div>
      )}

      {/* Featured Tasks Section */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0088cc]" />
            <h3 className="font-bold text-slate-900 text-sm">Watch & Earn Tasks</h3>
          </div>
          <button
            onClick={() => onNavigateTab('tasks')}
            className="text-xs font-semibold text-[#0088cc] hover:text-[#0077b5] flex items-center gap-1 transition"
          >
            View All ({tasks.length}) <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {tasksLoading ? (
          <HomeTasksSkeleton count={3} />
        ) : uncompletedTasks.length === 0 ? (
          <div className="p-6 bg-white border border-slate-200/80 rounded-2xl text-center shadow-xs">
            <p className="text-sm font-medium text-slate-700">🎉 You have completed all featured tasks today!</p>
            <p className="text-xs text-slate-400 mt-1">Check back later or invite friends to keep earning.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {uncompletedTasks.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectTask(t)}
                className="flex items-center justify-between p-3.5 bg-white hover:bg-slate-50 border border-slate-200/80 hover:border-sky-300 rounded-2xl cursor-pointer transition shadow-xs group"
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 group-hover:bg-sky-100 border border-sky-100 flex items-center justify-center text-[#0088cc] shrink-0 transition">
                    <PlayCircle className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-bold text-slate-900 truncate group-hover:text-[#0088cc] transition">
                      {t.title}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {t.timerSeconds}s Watch • {t.taskType.toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg">
                    +₹{t.rewardAmount.toFixed(2)}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refer & Earn Banner */}
      <div
        onClick={() => onNavigateTab('referrals')}
        className="p-4 bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-200 rounded-2xl cursor-pointer hover:border-sky-300 transition flex items-center justify-between shadow-xs"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-[#0088cc] shrink-0 shadow-2xs">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Invite Friends & Earn More</h4>
            <p className="text-[11px] text-slate-600">
              Get <span className="text-[#0088cc] font-bold">+₹{settings.referralReward}</span> for every friend who joins!
            </p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[#0088cc] shrink-0" />
      </div>

      {/* Trust & Support Footer Card */}
      <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-between text-xs text-slate-500 shadow-2xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span className="text-[11px]">Instant Amazon Gift Cards Supported</span>
        </div>
        <a
          href={`https://t.me/${settings.supportTelegramUsername || 'TeleEarnSupport'}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[#0088cc] hover:text-[#0077b5] font-semibold text-[11px] transition"
        >
          <Headphones className="w-3.5 h-3.5" /> Support
        </a>
      </div>
    </div>
  );
};
