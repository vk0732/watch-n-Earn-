import React, { useState, useEffect } from 'react';
import { Users, Copy, Check, Share2, Award, ShieldAlert, Sparkles, RefreshCw, Gift, ChevronRight } from 'lucide-react';
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
    <div className="space-y-4 pb-20">
      {/* Referral Hero Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-950 via-slate-900 to-slate-950 border border-teal-500/30 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 w-44 h-44 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-xl bg-teal-500/20 flex items-center justify-center text-teal-400">
            <Users className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-teal-400">
            Referral Program
          </span>
        </div>

        <h2 className="text-2xl font-black text-white mb-1">
          Earn +₹{settings.referralReward} Per Friend
        </h2>
        <p className="text-xs text-slate-300 mb-5 leading-relaxed">
          Invite friends to TeleEarn using your unique link. You receive <span className="text-teal-400 font-bold">₹{settings.referralReward}</span> coins instantly when they join, and your friend gets a <span className="text-emerald-400 font-bold">₹{settings.signupBonus}</span> welcome bonus!
        </p>

        {/* Link Copy Box */}
        <div className="space-y-2 mb-4">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Your Unique Referral Link
          </label>
          <div className="flex items-center gap-2 p-1.5 bg-slate-950/80 border border-slate-800 rounded-xl">
            <input
              type="text"
              readOnly
              value={referralLink}
              className="bg-transparent text-xs text-slate-200 font-mono px-2 py-1.5 w-full focus:outline-none select-all"
            />
            <button
              onClick={handleCopy}
              className={`p-2 rounded-lg font-bold text-xs flex items-center gap-1.5 shrink-0 transition ${
                copied
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
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
          className="w-full py-3 px-4 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-bold text-sm rounded-xl shadow-lg shadow-teal-500/20 transition flex items-center justify-center gap-2"
        >
          <Share2 className="w-4 h-4" /> Share Directly on Telegram
        </button>
      </div>

      {/* Gamification: Referral Scratch Card Entry */}
      {gamState && gamState.scratchCardEnabled && (
        <div className="p-4 rounded-2xl bg-gradient-to-br from-teal-950/80 via-slate-900 to-slate-950 border border-teal-500/40 shadow-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center text-teal-400 text-xl shrink-0">
              🎁
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-black text-white">Referral Scratch Cards</h4>
                <span className="px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-[10px] font-bold">
                  {gamState.unrevealedScratchCards} Unrevealed
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Every qualifying referral grants a secret scratch card bonus!
              </p>
            </div>
          </div>

          <button
            onClick={onOpenScratchCards}
            className="py-2 px-3.5 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-xl shadow-md transition shrink-0 flex items-center gap-1"
          >
            <span>Scratch</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Users className="w-4 h-4 text-teal-400" />
            <span>Total Referrals</span>
          </div>
          <p className="text-2xl font-black text-white">
            {stats?.totalReferrals ?? user.dailyStreak ?? 0}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Qualified joined users</p>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Award className="w-4 h-4 text-emerald-400" />
            <span>Total Earned</span>
          </div>
          <p className="text-2xl font-black text-emerald-400">
            ₹{(stats?.totalEarned ?? user.referralEarnings).toFixed(2)}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Credited to your balance</p>
        </div>
      </div>

      {/* Referral History Ledger */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-400" /> Referral Ledger
          </h3>
          <button
            onClick={loadReferralStats}
            className="p-1 text-slate-400 hover:text-white transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!stats?.history || stats.history.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            <p>No referrals yet. Share your link above to start earning!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stats.history.map((r: any) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-3 bg-slate-850 border border-slate-800 rounded-xl text-xs"
              >
                <div>
                  <p className="font-bold text-white">@{r.refereeUsername}</p>
                  <p className="text-[10px] text-slate-500">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="font-extrabold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg">
                  +₹{r.rewardAmount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fair Play Notice */}
      <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex items-start gap-2.5 text-xs text-slate-400">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed">
          <strong className="text-slate-300">Anti-Fraud Protection:</strong> Self-referrals and emulated accounts are permanently blocked by our server verification filters. Legitimate invites are credited instantly.
        </p>
      </div>
    </div>
  );
};
