import React, { useState } from 'react';
import { Calendar, Sparkles, Check, Clock, ShieldAlert, ExternalLink, RefreshCw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api.ts';
import type { UserProfile, ForceJoinChannel } from '../types/index.ts';

interface DailyCheckinCardProps {
  user: UserProfile;
  baseReward: number;
  rewardDifference?: number;
  onClaimed: (newBalance: number, streak: number) => void;
}

export const DailyCheckinCard: React.FC<DailyCheckinCardProps> = ({
  user,
  baseReward,
  rewardDifference,
  onClaimed,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApiError, setIsApiError] = useState(false);
  const [unjoinedChannels, setUnjoinedChannels] = useState<ForceJoinChannel[]>([]);

  const todayUTC = new Date().toISOString().split('T')[0];
  const isClaimedToday = user.lastDailyCheckIn === todayUTC;
  const currentStreak = user.dailyStreak || 0;
  const diff = typeof rewardDifference === 'number' && rewardDifference > 0 ? rewardDifference : 2;

  // Determine which day of the 7-day cycle we are currently on:
  let cycleDay = 1;
  let isStreakBroken = false;

  if (user.lastDailyCheckIn) {
    const lastDate = new Date(user.lastDailyCheckIn);
    const todayDate = new Date(todayUTC);
    const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
    if (diffDays === 0) {
      // Claimed today: the day claimed today is in currentStreak (clamped to 1..7)
      cycleDay = currentStreak >= 7 ? 7 : (currentStreak % 7 || 7);
    } else if (diffDays === 1) {
      // Not claimed today, but consecutive from yesterday
      // 7-day cycle: if previous streak reached 7, roll over to Day 1
      cycleDay = currentStreak >= 7 ? 1 : currentStreak + 1;
    } else {
      // Missed one or more days: streak broken, reset to Day 1
      isStreakBroken = true;
      cycleDay = 1;
    }
  } else {
    cycleDay = 1;
  }

  const days = [1, 2, 3, 4, 5, 6, 7];

  const handleOpenChannel = (url: string) => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink && (url.includes('t.me/') || url.includes('telegram.me/'))) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleClaim = async () => {
    if (isClaimedToday || loading) return;
    setLoading(true);
    setError(null);
    setIsApiError(false);
    setUnjoinedChannels([]);
    try {
      const res = await api.claimDailyCheckin();
      // Fire festive reward confetti
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#0088cc', '#24a1de', '#10b981', '#f59e0b'],
      });
      onClaimed(res.newBalance, res.streak);
    } catch (err: any) {
      if (err.unjoinedChannels && err.unjoinedChannels.length > 0) {
        setUnjoinedChannels(err.unjoinedChannels);
      }
      setIsApiError(Boolean(err.isApiError));
      setError(err.message || 'Failed to claim daily reward');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs relative overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0088cc]">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Daily Check-In</h3>
            <p className="text-[11px] text-slate-500">Streak: <span className="text-[#0088cc] font-bold">{currentStreak} Days</span></p>
          </div>
        </div>

        {isClaimedToday ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-full">
            <Check className="w-3.5 h-3.5" /> Claimed Today
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-50 border border-sky-200 text-[#0088cc] text-xs font-semibold rounded-full animate-pulse">
            <Sparkles className="w-3.5 h-3.5" /> Ready to Claim
          </span>
        )}
      </div>

      {error && (
        <div className={`mb-3 p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 ${
          isApiError
            ? 'bg-amber-50 border border-amber-200 text-amber-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <span>{error}</span>
          {isApiError && (
            <button
              type="button"
              onClick={handleClaim}
              disabled={loading}
              className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg shrink-0 flex items-center gap-1 transition"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Retry
            </button>
          )}
        </div>
      )}

      {/* Mandatory Channels Required For Daily Check-In */}
      {unjoinedChannels.length > 0 && (
        <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-amber-900">Mandatory Channels Required</h4>
              <p className="text-[11px] text-amber-700">
                You must join our partner channels to claim your daily check-in:
              </p>
            </div>
          </div>

          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {unjoinedChannels.map((ch, idx) => (
              <div
                key={ch.id || idx}
                className="p-2 bg-white border border-amber-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs"
              >
                <div className="min-w-0 pr-2">
                  <p className="text-xs font-bold text-slate-900 truncate">{ch.title}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{ch.channelId || ch.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenChannel(ch.inviteLink)}
                  className="px-2.5 py-1 bg-[#0088cc] hover:bg-[#0077b5] text-white text-[11px] font-bold rounded-lg shadow-2xs transition flex items-center gap-1 shrink-0"
                >
                  Join <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleClaim}
            disabled={loading}
            className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Verify &amp; Claim
          </button>
        </div>
      )}

      {/* 7-Day Streak Tracker */}
      <div className="grid grid-cols-7 gap-1.5 mb-4">
        {days.map((day) => {
          const rewardAmount = baseReward + (day - 1) * diff;
          let isDone = false;
          let isCurrent = false;

          if (isClaimedToday) {
            isDone = day <= cycleDay;
            isCurrent = day === cycleDay;
          } else {
            if (isStreakBroken || currentStreak >= 7) {
              isDone = false;
              isCurrent = day === 1;
            } else {
              isDone = day < cycleDay;
              isCurrent = day === cycleDay;
            }
          }

          return (
            <div
              key={day}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border text-center transition ${
                isDone
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : isCurrent
                  ? 'bg-sky-50 border-sky-300 text-[#0088cc] ring-2 ring-sky-200 shadow-2xs'
                  : 'bg-slate-50 border-slate-200/80 text-slate-400'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider mb-0.5">D{day}</span>
              <span className={`text-xs font-black ${isDone ? 'text-emerald-700' : isCurrent ? 'text-[#0088cc]' : 'text-slate-700'}`}>
                ₹{rewardAmount}
              </span>
              <div className="mt-1">
                {isDone ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <div className={`w-1.5 h-1.5 rounded-full ${isCurrent ? 'bg-[#0088cc] animate-ping' : 'bg-slate-300'}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleClaim}
        disabled={isClaimedToday || loading}
        className={`w-full py-2.5 px-4 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 ${
          isClaimedToday
            ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed'
            : 'tg-btn-primary shadow-sm hover:shadow-md'
        }`}
      >
        {loading ? (
          'Verifying...'
        ) : isClaimedToday ? (
          <>
            <Clock className="w-4 h-4" /> Next Check-In tomorrow (00:00 UTC)
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" /> Claim Day {cycleDay} Bonus (+₹{baseReward + (cycleDay - 1) * diff})
          </>
        )}
      </button>
    </div>
  );
};
