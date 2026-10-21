import React, { useState } from 'react';
import { X, Gift, ShieldCheck, AlertCircle, CheckCircle2, Copy, Check, Sparkles, ExternalLink, ShieldAlert, Users } from 'lucide-react';
import { api } from '../services/api.ts';
import type { ForceJoinChannel, WithdrawalReferralEligibility } from '../types/index.ts';

interface WithdrawalModalProps {
  isOpen: boolean;
  availableBalance: number;
  minWithdrawal: number;
  maxWithdrawal?: number;
  onClose: () => void;
  onSuccess: (orderId: string, remainingBalance: number) => void;
}

export const WithdrawalModal: React.FC<WithdrawalModalProps> = ({
  isOpen,
  availableBalance,
  minWithdrawal,
  maxWithdrawal,
  onClose,
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>(minWithdrawal ? minWithdrawal.toString() : '10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unjoinedChannels, setUnjoinedChannels] = useState<ForceJoinChannel[] | null>(null);
  const [referralEligibility, setReferralEligibility] = useState<WithdrawalReferralEligibility | null>(null);
  const [copied, setCopied] = useState(false);
  const [successResult, setSuccessResult] = useState<{
    orderId: string;
    code: string;
    denomination: number;
    message: string;
  } | null>(null);

  React.useEffect(() => {
    if (minWithdrawal) {
      setAmount(minWithdrawal.toString());
    }
  }, [minWithdrawal]);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessResult(null);
      setUnjoinedChannels(null);
      if (minWithdrawal) {
        setAmount(minWithdrawal.toString());
      }
      api
        .getWithdrawalEligibility()
        .then((res) => {
          if (res?.eligibility) {
            setReferralEligibility(res.eligibility);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, minWithdrawal]);

  if (!isOpen) return null;

  const isFixedAmount = maxWithdrawal && maxWithdrawal === minWithdrawal;

  const handleCopyCode = () => {
    if (successResult?.code) {
      navigator.clipboard.writeText(successResult.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenChannel = (url: string) => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink && (url.includes('t.me/') || url.includes('telegram.me/'))) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const numAmount = Number(amount);

    if (!numAmount || isNaN(numAmount) || numAmount < minWithdrawal) {
      setError(`Minimum withdrawal amount is ₹${minWithdrawal}`);
      return;
    }

    if (maxWithdrawal && maxWithdrawal > 0 && numAmount > maxWithdrawal) {
      setError(`Amount exceeds the allowed maximum limit of ₹${maxWithdrawal}`);
      return;
    }

    if (numAmount > availableBalance) {
      setError(`Insufficient balance. You currently have ₹${availableBalance.toFixed(2)}`);
      return;
    }

    setLoading(true);
    try {
      const idempotencyKey = 'wth_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const res = await api.redeemGiftCard(numAmount, idempotencyKey);
      setSuccessResult({
        orderId: res.orderId,
        code: res.giftCardCode,
        denomination: res.denomination || numAmount,
        message: res.message || 'Amazon Gift Card Code redeemed successfully!',
      });
      setUnjoinedChannels(null);
      onSuccess(res.orderId, res.remainingBalance);
    } catch (err: any) {
      if (err.eligibility) {
        setReferralEligibility(err.eligibility);
      }
      if (err.forceJoinRequired && err.unjoinedChannels && err.unjoinedChannels.length > 0) {
        setUnjoinedChannels(err.unjoinedChannels);
        setError('Channel membership check failed: Please join the required sponsor channel(s) below to continue.');
      } else {
        setError(err.message || 'Gift card redemption failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
        >
          <X className="w-5 h-5" />
        </button>

        {successResult ? (
          <div className="text-center py-2 space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full mb-1.5">
                <Sparkles className="w-3 h-3 text-amber-500" /> Instant Amazon Gift Card
              </span>
              <h3 className="text-xl font-black text-slate-900">Code Redeemed!</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Your ₹{successResult.denomination} Amazon Gift Card code is ready to use.
              </p>
            </div>

            {/* Gift Card Code Display Box */}
            <div className="p-4 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/60 border border-amber-200/90 rounded-2xl text-left space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                  Amazon Gift Card Code
                </span>
                <span className="text-xs font-black text-amber-800">
                  ₹{successResult.denomination}
                </span>
              </div>

              <div className="flex items-center justify-between bg-white border border-amber-300 rounded-xl p-2.5 shadow-inner">
                <span className="font-mono font-black text-base tracking-wider text-slate-900 select-all break-all">
                  {successResult.code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="ml-2 px-3 py-1.5 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-bold rounded-lg transition flex items-center gap-1 shrink-0 active:scale-95 shadow-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy Code
                    </>
                  )}
                </button>
              </div>

              <div className="text-[11px] text-amber-900/80 leading-relaxed pt-1 border-t border-amber-200/60">
                <span className="font-bold">How to apply:</span> Open Amazon App → Amazon Pay → <strong>Add Gift Card</strong> → Paste this code.
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 space-y-1 text-left">
              <div className="flex justify-between">
                <span className="text-slate-400">Order Reference:</span>
                <span className="text-slate-900 font-mono font-semibold">{successResult.orderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Saved In:</span>
                <span className="text-slate-900 font-medium">Wallet History & Transactions</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3.5 px-4 tg-btn-primary font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition"
            >
              Done & Return to Wallet
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                <Gift className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Redeem Amazon Gift Card</h3>
                <p className="text-xs text-slate-500">
                  Available Balance:{' '}
                  <span className="text-[#0088cc] font-bold">₹{availableBalance.toFixed(2)}</span>
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Withdrawal Referral Requirement Banner (only shown when rule applies to this user) */}
            {referralEligibility && referralEligibility.applies && (
              <div
                className={`p-3.5 rounded-2xl border ${
                  referralEligibility.eligible
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                } space-y-1.5`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Users className={`w-4 h-4 ${referralEligibility.eligible ? 'text-emerald-600' : 'text-amber-600'}`} />
                    Withdrawal Referral Requirement
                  </span>
                  <span
                    className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
                      referralEligibility.eligible
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {referralEligibility.currentReferrals} / {referralEligibility.requiredReferrals} Referrals
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  {referralEligibility.message ||
                    (referralEligibility.eligible
                      ? 'Referral requirement satisfied for this withdrawal.'
                      : `Invite at least ${referralEligibility.requiredReferrals} valid referral(s) to unlock this withdrawal.`)}
                </p>
              </div>
            )}

            {/* Denomination Card / Input */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Gift Card Value (₹)
                </label>
                {maxWithdrawal && !isFixedAmount && (
                  <span className="text-[10px] text-slate-400">
                    Min: ₹{minWithdrawal} • Max: ₹{maxWithdrawal}
                  </span>
                )}
              </div>

              {isFixedAmount ? (
                <div className="p-3.5 bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-200 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-[#0088cc] text-white flex items-center justify-center font-black text-sm">
                      ₹
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900">Amazon Gift Card Voucher</span>
                      <p className="text-[10px] text-slate-500">Fixed denomination per withdrawal</p>
                    </div>
                  </div>
                  <span className="text-xl font-black text-[#0088cc]">₹{minWithdrawal}</span>
                </div>
              ) : (
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₹</span>
                  <input
                    type="number"
                    min={minWithdrawal}
                    max={maxWithdrawal ? Math.min(availableBalance, maxWithdrawal) : availableBalance}
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Min ${minWithdrawal}${maxWithdrawal ? ` - Max ${maxWithdrawal}` : ''}`}
                    className="w-full pl-8 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0088cc] rounded-xl text-slate-900 font-bold text-sm focus:outline-none transition"
                    required
                  />
                </div>
              )}
            </div>

            {/* Mandatory Channels Required For Withdrawal */}
            {unjoinedChannels && unjoinedChannels.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-900">Sponsor Channel Verification Required</h4>
                    <p className="text-[11px] text-amber-700">
                      You must be an active member of our official channels to redeem rewards:
                    </p>
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {unjoinedChannels.map((ch, idx) => (
                    <div
                      key={ch.id || idx}
                      className="p-2.5 bg-white border border-amber-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-slate-900 truncate">{ch.title}</p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{ch.channelId || ch.username}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenChannel(ch.inviteLink)}
                        className="px-3 py-1 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-bold rounded-lg shadow-2xs transition flex items-center gap-1 shrink-0"
                      >
                        Join <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-amber-800">
                  After joining, click &quot;Verify &amp; Continue&quot; below. The system checks membership in real time.
                </p>
              </div>
            )}

            {/* Fulfillment & Delivery Notice */}
            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Delivery:</span>
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Instant Code on Screen
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fulfillment Fee:</span>
                <span className="text-emerald-700 font-semibold">₹0.00 (Free)</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] pt-1 border-t border-slate-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>One unique code atomically assigned. Stored permanently in your Wallet.</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={
                loading ||
                availableBalance < minWithdrawal ||
                (Boolean(referralEligibility?.applies) && !referralEligibility?.eligible)
              }
              className="w-full py-3.5 px-4 tg-btn-primary font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98"
            >
              {loading ? (
                'Verifying & Redeeming...'
              ) : unjoinedChannels && unjoinedChannels.length > 0 ? (
                <>
                  <ShieldCheck className="w-4 h-4" /> Verify & Continue
                </>
              ) : referralEligibility?.applies && !referralEligibility?.eligible ? (
                <>
                  <Users className="w-4 h-4" /> Valid Referral Required
                </>
              ) : availableBalance < minWithdrawal ? (
                `Need ₹${(minWithdrawal - availableBalance).toFixed(2)} more to redeem`
              ) : (
                <>
                  <Gift className="w-4 h-4" /> Redeem ₹{amount} Gift Card
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
