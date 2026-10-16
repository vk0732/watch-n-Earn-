import React, { useState, useEffect } from 'react';
import { Users, Copy, Check, Share2, Award, ShieldAlert, Sparkles, RefreshCw, ChevronRight } from 'lucide-react';
import { api } from '../services/api.ts';
import type { UserProfile, AppSettings, UserGamificationState } from '../types/index.ts';

interface ReferralsViewProps {
  user: UserProfile;
  settings: AppSettings;
  gamState?: UserGamificationState | null;
  onOpenScratchCards?: () => void;
}

export const ReferralsView: React.FC<ReferralsViewProps> = ({
  user,
  settings,
  gamState,
  onOpenScratchCards,
}) => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadReferralStats();
  }, []);

  const loadReferralStats = async () => {
    setLoading(true);
    try {
      const data = await api.getReferralStats();
      setStats(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const cleanBotUsername = (username?: string) => {
    if (!username) return 'WatchXEarnBot';
    return (
      username
        .trim()
        .replace(/^https?:\/\/t\.me\//i, '')
        .replace(/^@+/, '')
        .replace(/\/+$/, '')
        .trim() || 'WatchXEarnBot'
    );
  };

  const botUsername = cleanBotUsername(settings.botUsername);
  const referralCode = stats?.referralCode || user.referralCode;

  // Ensure clean valid deep link format: https://t.me/BOT_USERNAME?start=REFERRAL_CODE
  const referralLink = stats?.referralLink
    ? stats.referralLink.replace(/t\.me\/@+/i, 't.me/').trim()
    : `https://t.me/${botUsername}?start=${referralCode}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareTelegram = () => {
    const text = encodeURIComponent(
      `🔥 Join TeleEarn and earn real cash daily by watching videos! Get an instant ₹${settings.signupBonus} bonus on signup:`
    );
    const url = encodeURIComponent(referralLink);
    const shareUrl = `https://t.me/share/url?url=${url}&text=${text}`;

    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Referral Hero Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0088cc] via-[#1095d9] to-[#24a1de] text-white p-6 shadow-xl shadow-sky-500/15">
        <div className="absolute top-0 right-0 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white">
            <Users className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-sky-100">
            Referral Program
          </span>
        </div>

        <h2 className="text-2xl font-black text-white mb-1 tracking-tight">
          Earn +₹{settings.referralReward} Per Friend
        </h2>
        <p className="text-xs text-sky-100 mb-5 leading-relaxed">
          Invite friends to TeleEarn using your unique link. You receive <strong className="text-white">₹{settings.referralReward}</strong> coins instantly when they join, and your friend gets a <strong className="text-white">₹{settings.signupBonus}</strong> welcome bonus!
        </p>

        {/* Link Copy Box */}
        <div className="space-y-1.5 mb-4">
          <label className="block text-[11px] font-bold text-sky-100 uppercase tracking-wider">
            Your Unique Referral Link
          </label>
          <div className="flex items-center gap-2 p-1.5 bg-black/15 border border-white/20 rounded-xl backdrop-blur-xs">
            <input
              type="text"
              readOnly
              value={referralLink}
              className="bg-transparent text-xs text-white font-mono px-2 py-1.5 w-full focus:outline-none select-all"
            />
            <button
              onClick={handleCopy}
              className={`py-1.5 px-3 rounded-lg font-bold text-xs flex items-center gap-1.5 shrink-0 transition ${
                copied
                  ? 'bg-emerald-400 text-slate-900 shadow-sm'
                  : 'bg-white hover:bg-slate-50 text-[#0088cc] shadow-sm'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Share Button */}
        <button
          onClick={handleShareTelegram}
          className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-[#0088cc] font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 active:scale-98"
        >
          <Share2 className="w-4 h-4" /> Share Directly on Telegram
        </button>
      </div>

      {/* Gamification: Referral Scratch Card Entry */}
      {gamState && gamState.scratchCardEnabled && (
        <div className="p-4 rounded-2xl bg-white border border-teal-200 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-xl shrink-0">
              🎁
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-slate-900">Referral Scratch Cards</h4>
                <span className="px-2 py-0.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-[10px] font-bold">
                  {gamState.unrevealedScratchCards} Unrevealed
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Every qualifying referral grants a secret scratch card bonus!
              </p>
            </div>
          </div>

          <button
            onClick={onOpenScratchCards}
            className="py-2 px-3.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs transition shrink-0 flex items-center gap-1 active:scale-98"
          >
            <span>Scratch</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
            <Users className="w-4 h-4 text-[#0088cc]" />
            <span className="font-medium">Total Referrals</span>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {stats?.totalReferrals ?? user.dailyStreak ?? 0}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Qualified joined users</p>
        </div>

        <div className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
            <Award className="w-4 h-4 text-emerald-600" />
            <span className="font-medium">Total Earned</span>
          </div>
          <p className="text-2xl font-black text-emerald-700">
            ₹{(stats?.totalEarned ?? user.referralEarnings).toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Credited to your balance</p>
        </div>
      </div>

      {/* Referral History Ledger */}
      <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0088cc]" /> Referral Ledger
          </h3>
          <button
            onClick={loadReferralStats}
            className="p-1 text-slate-400 hover:text-slate-600 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0088cc]' : ''}`} />
          </button>
        </div>

        {!stats?.history || stats.history.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs">
            <p>No referrals yet. Share your link above to start earning!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stats.history.map((r: any) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs"
              >
                <div>
                  <p className="font-bold text-slate-900">@{r.refereeUsername}</p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-lg">
                  +₹{r.rewardAmount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fair Play Notice */}
      <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 shadow-2xs">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed">
          <strong className="text-amber-950 font-bold">Anti-Fraud Protection:</strong> Self-referrals and emulated accounts are permanently blocked by server verification filters. Legitimate invites are credited instantly.
        </p>
      </div>
    </div>
  );
};
