import React, { useState } from 'react';
import { X, Send, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api.ts';

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
  const [amount, setAmount] = useState<string>(minWithdrawal.toString());
  const [upiId, setUpiId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{ orderId: string; message: string } | null>(null);

  if (!isOpen) return null;

  const quickAmounts = [minWithdrawal, 250, 500, 1000].filter(
    (q) => !maxWithdrawal || q <= maxWithdrawal
  );

  const handleQuickAmount = (val: number) => {
    setAmount(val.toString());
  };

  const handleMaxAmount = () => {
    const effectiveCap = maxWithdrawal ? Math.min(availableBalance, maxWithdrawal) : availableBalance;
    setAmount(Math.floor(effectiveCap).toString());
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

    const cleanUpi = upiId.trim();
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9]{2,32}$/;
    if (!upiRegex.test(cleanUpi)) {
      setError('Please enter a valid UPI ID (e.g. username@okhdfcbank or 9876543210@paytm)');
      return;
    }

    setLoading(true);
    try {
      const res = await api.requestWithdrawal(numAmount, cleanUpi);
      setSuccessResult({
        orderId: res.orderId,
        message: res.message,
      });
      onSuccess(res.orderId, res.remainingBalance);
    } catch (err: any) {
      setError(err.message || 'Withdrawal submission failed');
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
          <div className="text-center py-4 space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Withdrawal Submitted!</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Your request for <span className="font-bold text-emerald-700">₹{amount}</span> has been received.
            </p>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 space-y-1.5 text-left">
              <div className="flex justify-between">Order ID: <span className="text-slate-900 font-mono font-semibold">{successResult.orderId}</span></div>
              <div className="flex justify-between">UPI Destination: <span className="text-slate-900 font-mono font-medium">{upiId}</span></div>
              <div className="flex justify-between">Status: <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold">Pending Review</span></div>
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 px-4 tg-btn-primary font-bold text-xs rounded-xl shadow-md transition"
            >
              Done & Return to Wallet
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0088cc] font-black text-lg">
                ₹
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Withdraw Funds</h3>
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

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Amount (Min: ₹{minWithdrawal}{maxWithdrawal ? ` • Max: ₹${maxWithdrawal}` : ''})
                </label>
                {maxWithdrawal && (
                  <span className="text-[10px] text-slate-400">Max limit: ₹{maxWithdrawal}</span>
                )}
              </div>
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

              <div className="flex items-center gap-1.5 mt-2">
                {quickAmounts.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleQuickAmount(q)}
                    className="flex-1 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg transition"
                  >
                    ₹{q}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleMaxAmount}
                  className="flex-1 py-1 text-xs font-bold bg-sky-50 text-[#0088cc] hover:bg-sky-100 border border-sky-200 rounded-lg transition"
                >
                  MAX
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Recipient UPI ID (VPA)
              </label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. yourname@okhdfcbank or 9876543210@paytm"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#0088cc] rounded-xl text-slate-900 font-medium text-xs focus:outline-none transition placeholder:text-slate-400"
                required
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Make sure your UPI ID is registered to receive instant payments.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Processing Fee:</span>
                <span className="text-emerald-700 font-semibold">₹0.00 (Free)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Transfer Method:</span>
                <span className="font-semibold text-slate-900">Instant UPI</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] pt-1 border-t border-slate-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Protected by atomic balance reservation & transaction logging</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || availableBalance < minWithdrawal}
              className="w-full py-3.5 px-4 tg-btn-primary font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98"
            >
              {loading ? (
                'Submitting Request...'
              ) : availableBalance < minWithdrawal ? (
                `Need ₹${(minWithdrawal - availableBalance).toFixed(2)} more to withdraw`
              ) : (
                <>
                  <Send className="w-4 h-4" /> Request ₹{amount} Withdrawal
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
