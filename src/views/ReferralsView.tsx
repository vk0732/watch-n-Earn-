import React, { useState, useEffect } from 'react';
import {
  Users,
  Copy,
  Check,
  Share2,
  Award,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  Lock,
  CheckCircle2,
  History,
} from 'lucide-react';
import { api } from '../services/api.ts';
import type {
  UserProfile,
  AppSettings,
  UserGamificationState,
  WithdrawalReferralEligibility,
} from '../types/index.ts';
import { ReferralViewSkeleton } from '../components/Skeleton.tsx';

function getOrdinalWithdrawalLabel(num: number): string {
  switch (num) {
    case 1:
      return 'First withdrawal';
    case 2:
      return 'Second withdrawal';
    case 3:
      return 'Third withdrawal';
    case 4:
      return 'Fourth withdrawal';
    case 5:
      return 'Fifth withdrawal';
    default:
      return `Withdrawal #${num}`;
  }
}

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
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'current' | 'historical'>('all');

  useEffect(() => {
    loadReferralStats();
  }, []);

  const loadReferralStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getReferralStats();
      setStats(data);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to load referral statistics. Please check your connection.');
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

  if (loading && !stats) {
    return <ReferralViewSkeleton />;
  }

  if (error && !stats) {
    return (
      <div className="p-6 bg-white border border-rose-100 rounded-2xl shadow-xs text-center space-y-3">
        <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-bold text-slate-800 text-sm">Failed to Load Referral Stats</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">{error}</p>
        </div>
        <button
          onClick={loadReferralStats}
          className="px-4 py-2 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-bold rounded-xl transition shadow-xs"
        >
          Retry Connection
        </button>
      </div>
    );
  }

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

      {/* Stats Cards: Current Campaign vs Lifetime History vs Total Earned */}
      {(() => {
        const activeCampaignId = stats?.referralCampaignId ?? settings.referralCampaignId ?? 1;
        const currentCampaignValid =
          stats?.currentCampaignValidReferrals ?? stats?.totalReferrals ?? 0;
        const lifetimeValid = stats?.lifetimeValidReferrals ?? stats?.totalReferrals ?? 0;
        const totalRecorded = stats?.totalReferrals ?? 0;
        const eligibility: WithdrawalReferralEligibility | undefined = stats?.withdrawalEligibility;
        const historyList: any[] = Array.isArray(stats?.history) ? stats.history : [];
        const hasHistoricalCampaigns =
          activeCampaignId > 1 ||
          historyList.some((r) => (r.referralCampaignId ?? 1) !== activeCampaignId);

        const filteredHistory = historyList.filter((r) => {
          const recCamp = r.referralCampaignId ?? 1;
          if (historyFilter === 'current') return recCamp === activeCampaignId;
          if (historyFilter === 'historical') return recCamp !== activeCampaignId;
          return true;
        });

        const nextNum = eligibility ? eligibility.nextWithdrawalNumber ?? eligibility.completedWithdrawals + 1 : 1;
        const ordLabel = getOrdinalWithdrawalLabel(nextNum);
        const progressPct =
          eligibility && eligibility.requiredReferrals > 0
            ? Math.min(100, Math.round((eligibility.currentReferrals / eligibility.requiredReferrals) * 100))
            : 100;

        return (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3.5 bg-white border border-sky-200/80 rounded-2xl shadow-xs">
                <div className="flex items-center justify-between gap-1 text-slate-500 text-[11px] mb-1">
                  <span className="font-semibold text-slate-700 truncate">Current</span>
                  <span className="px-1.5 py-0.5 rounded bg-sky-50 text-[#0088cc] font-bold text-[9px]">
                    #{activeCampaignId}
                  </span>
                </div>
                <p className="text-2xl font-black text-[#0088cc]">{currentCampaignValid}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Active campaign valid</p>
              </div>

              <div className="p-3.5 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
                <div className="flex items-center gap-1.5 text-slate-500 text-[11px] mb-1">
                  <History className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span className="font-semibold text-slate-700 truncate">Lifetime</span>
                </div>
                <p className="text-2xl font-black text-slate-900">{lifetimeValid}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {totalRecorded !== lifetimeValid ? `${totalRecorded} total records` : 'All-time valid'}
                </p>
              </div>

              <div className="p-3.5 bg-white border border-slate-200/80 rounded-2xl shadow-xs">
                <div className="flex items-center gap-1.5 text-slate-500 text-[11px] mb-1">
                  <Award className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-slate-700 truncate">Earned</span>
                </div>
                <p className="text-xl font-black text-emerald-700 truncate">
                  ₹{(stats?.totalEarned ?? user.referralEarnings).toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Referral rewards</p>
              </div>
            </div>

            {/* Cumulative Withdrawal Referral Milestone Card */}
            {eligibility && eligibility.applies && (
              <div
                className={`p-4 rounded-2xl border shadow-xs space-y-2.5 ${
                  eligibility.eligible
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-white border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        eligibility.eligible
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {eligibility.eligible ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 truncate">
                        {ordLabel}: {eligibility.currentReferrals}/{eligibility.requiredReferrals} valid referrals
                      </h4>
                      <p className="text-[10px] text-slate-500">
                        Rule: {eligibility.perWithdrawalRequirement ?? settings.withdrawalMinReferralsRequired ?? 1} valid referral(s) per withdrawal • Completed: {eligibility.completedWithdrawals}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide shrink-0 ${
                      eligibility.eligible
                        ? 'bg-emerald-600 text-white'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {eligibility.eligible ? 'Available' : 'Locked'}
                  </span>
                </div>

                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      eligibility.eligible ? 'bg-emerald-500' : 'bg-[#0088cc]'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {eligibility.eligible
                    ? `${ordLabel} referral milestone reached (${eligibility.currentReferrals}/${eligibility.requiredReferrals}). Next withdrawal after this will require ${
                        (nextNum + 1) * (eligibility.perWithdrawalRequirement ?? 1)
                      } valid referrals.`
                    : `Invite ${Math.max(
                        0,
                        eligibility.requiredReferrals - eligibility.currentReferrals
                      )} more valid friend(s) in Campaign #${activeCampaignId} to unlock your ${ordLabel.toLowerCase()}.`}
                </p>
              </div>
            )}

            {/* Referral History Ledger (Permanent History Preserved Across Resets) */}
            <div className="p-5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#0088cc]" /> Referral History
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Current campaign progress & permanent historical referral records
                  </p>
                </div>
                <button
                  onClick={loadReferralStats}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0088cc]' : ''}`} />
                </button>
              </div>

              {hasHistoricalCampaigns && (
                <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                  {(
                    [
                      { key: 'all', label: `All (${historyList.length})` },
                      {
                        key: 'current',
                        label: `Campaign #${activeCampaignId} (${
                          historyList.filter((r) => (r.referralCampaignId ?? 1) === activeCampaignId).length
                        })`,
                      },
                      {
                        key: 'historical',
                        label: `Past History (${
                          historyList.filter((r) => (r.referralCampaignId ?? 1) !== activeCampaignId).length
                        })`,
                      },
                    ] as const
                  ).map((tabItem) => (
                    <button
                      key={tabItem.key}
                      type="button"
                      onClick={() => setHistoryFilter(tabItem.key)}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition ${
                        historyFilter === tabItem.key
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {tabItem.label}
                    </button>
                  ))}
                </div>
              )}

              {filteredHistory.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  <p>
                    {historyFilter === 'current' && historyList.length > 0
                      ? `No referrals in Campaign #${activeCampaignId} yet. Switch to "All" or "Past History" to view your ${historyList.length} preserved historical referral(s)!`
                      : 'No referrals yet. Share your link above to start earning!'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredHistory.map((r: any) => {
                    const recCamp = r.referralCampaignId ?? 1;
                    const isCurrent = recCamp === activeCampaignId;
                    const isCredited = r.status === 'credited';
                    return (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-slate-900 truncate">@{r.refereeUsername || 'user'}</p>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                isCurrent
                                  ? 'bg-sky-50 text-[#0088cc] border border-sky-200/70'
                                  : 'bg-slate-200/70 text-slate-600'
                              }`}
                            >
                              {isCurrent ? `Campaign #${recCamp}` : `History • #${recCamp}`}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                isCredited
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                              }`}
                            >
                              {isCredited ? 'Valid' : 'Invalid'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {new Date(r.createdAt).toLocaleDateString()} • ID: {r.id.slice(0, 14)}
                          </p>
                        </div>
                        <span
                          className={`font-extrabold px-2 py-0.5 rounded-lg shrink-0 ${
                            isCredited
                              ? 'text-emerald-700 bg-emerald-50 border border-emerald-200/60'
                              : 'text-slate-400 bg-slate-100 border border-slate-200'
                          }`}
                        >
                          {isCredited ? `+₹${Number(r.rewardAmount || 0).toFixed(2)}` : '₹0.00'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        );
      })()}

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
