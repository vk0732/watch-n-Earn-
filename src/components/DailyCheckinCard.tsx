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
        colors: ['#0088cc', '#24a1de', '#10b981', '#f59e0b'],
      });
      onClaimed(res.newBalance, res.streak);
    } catch (err: any) {
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
        <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
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
            <Sparkles className="w-4 h-4" /> Claim Day {currentStreak + 1} Bonus (+₹{baseReward + Math.min(currentStreak * 2, 14)})
          </>
        )}
      </button>
    </div>
  );
};
