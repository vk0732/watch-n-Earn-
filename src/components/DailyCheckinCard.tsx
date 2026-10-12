import React, { useState } from 'react';
import { Calendar, Sparkles, Check, Clock } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api.ts';
import type { UserProfile } from '../types/index.ts';

interface DailyCheckinCardProps {
  user: UserProfile;
  baseReward: number;
  onClaimed: (newBalance: number, streak: number) => void;
}

export const DailyCheckinCard: React.FC<DailyCheckinCardProps> = ({
  user,
  baseReward,
  onClaimed,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayUTC = new Date().toISOString().split('T')[0];
  const isClaimedToday = user.lastDailyCheckIn === todayUTC;
  const currentStreak = user.dailyStreak || 0;

  const days = [1, 2, 3, 4, 5, 6, 7];

  const handleClaim = async () => {
    if (isClaimedToday || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.claimDailyCheckin();
      // Fire festive reward confetti
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#10b981', '#f59e0b', '#3b82f6', '#ec4899'],
      });
      onClaimed(res.newBalance, res.streak);
    } catch (err: any) {
      setError(err.message || 'Failed to claim daily reward');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700/80 rounded-2xl p-5 shadow-xl relative overflow-hidden">
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Daily Check-In</h3>
            <p className="text-xs text-slate-400">Streak: <span className="text-amber-400 font-bold">{currentStreak} Days</span></p>
          </div>
        </div>

        {isClaimedToday ? (
          <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-full">
            <Check className="w-3.5 h-3.5" /> Claimed Today
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold rounded-full animate-pulse">
            <Sparkles className="w-3.5 h-3.5" /> Ready to Claim
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2.5 bg-red-950/70 border border-red-500/30 text-red-300 rounded-lg text-xs">
          {error}
        </div>
      )}

      {/* 7-Day Streak Tracker */}
      <div className="grid grid-cols-7 gap-1.5 mb-4">
        {days.map((day) => {
          const rewardAmount = baseReward + Math.min((day - 1) * 2, 14);
          const isDone = isClaimedToday ? day <= currentStreak : day < currentStreak;
          const isCurrent = isClaimedToday ? day === currentStreak : day === currentStreak + 1;

          return (
            <div
              key={day}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border text-center transition ${
                isDone
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : isCurrent
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 ring-2 ring-amber-500/30'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
              }`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider mb-0.5">D{day}</span>
              <span className="text-xs font-extrabold text-white">₹{rewardAmount}</span>
              <div className="mt-1">
                {isDone ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <div className={`w-1.5 h-1.5 rounded-full ${isCurrent ? 'bg-amber-400 animate-ping' : 'bg-slate-600'}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleClaim}
        disabled={isClaimedToday || loading}
        className={`w-full py-3 px-4 font-bold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-lg ${
          isClaimedToday
            ? 'bg-slate-800 border border-slate-700 text-slate-400 cursor-not-allowed'
            : 'bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 shadow-amber-500/20'
        }`}
      >
        {loading ? (
          'Verifying...'
        ) : isClaimedToday ? (
          <>
            <Clock className="w-4 h-4" /> Next Check-In available tomorrow (00:00 UTC)
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" /> Claim Day {currentStreak + 1} Bonus (+₹{baseReward + Math.min(currentStreak * 2, 14)})
          </>
        )}
      </button>
    </div>
  );
};
