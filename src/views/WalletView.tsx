import React, { useState, useEffect } from 'react';
import {
  Wallet,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  History,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../services/api.ts';
import type { UserProfile, Withdrawal, Transaction, AppSettings } from '../types/index.ts';

interface WalletViewProps {
  user: UserProfile;
  settings: AppSettings;
  onOpenWithdrawal: () => void;
}

export const WalletView: React.FC<WalletViewProps> = ({
  user,
  settings,
  onOpenWithdrawal,
}) => {
  const [tab, setTab] = useState<'withdrawals' | 'transactions'>('withdrawals');
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<Withdrawal | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [wRes, tRes] = await Promise.all([
        api.getMyWithdrawals(),
        api.getMyTransactions(),
      ]);
      setWithdrawals(wRes.withdrawals || []);
      setTransactions(tRes.transactions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: Withdrawal['status']) => {
    switch (status) {
      case 'success':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Paid
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
            <Clock className="w-3 h-3 text-amber-600" /> Pending
          </span>
        );
      case 'processing':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-[#0088cc] bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-lg">
            <RefreshCw className="w-3 h-3 animate-spin text-[#0088cc]" /> Processing
          </span>
        );
      case 'rejected':
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg">
            <XCircle className="w-3 h-3 text-red-600" /> Rejected
          </span>
        );
    }
  };

  const progressToMin = Math.min(
    100,
    Math.round((user.balance / settings.minWithdrawalAmount) * 100)
  );

  return (
    <div className="space-y-4 pb-4">
      {/* Wallet Balance Hero Card */}
      <div className="p-6 bg-gradient-to-br from-[#0088cc] via-[#1095d9] to-[#24a1de] text-white rounded-3xl shadow-xl shadow-sky-500/15 relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-sky-100">
              My Wallet
            </span>
          </div>
          <span className="text-xs text-sky-100 font-medium">Payout: <strong className="text-white">UPI</strong></span>
        </div>

        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-4xl sm:text-5xl font-black text-white">
            ₹{user.balance.toFixed(2)}
          </span>
          <span className="text-xs text-sky-100 font-medium">Available</span>
        </div>

        {/* Progress bar towards minimum withdrawal & limits notice */}
        <div className="space-y-1.5 mb-5 p-3 rounded-2xl bg-black/10 backdrop-blur-xs border border-white/15">
          <div className="flex justify-between text-xs text-sky-100 font-medium">
            <span>
              Min: ₹{settings.minWithdrawalAmount}
              {settings.maxWithdrawalAmount ? ` • Max: ₹${settings.maxWithdrawalAmount}` : ''}
            </span>
            <span className={user.balance >= settings.minWithdrawalAmount ? 'text-white font-bold' : ''}>
              {user.balance >= settings.minWithdrawalAmount ? '✓ Eligible' : `${progressToMin}%`}
            </span>
          </div>
          <div className="w-full h-2 bg-black/20 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                user.balance >= settings.minWithdrawalAmount
                  ? 'bg-emerald-300'
                  : 'bg-white/80'
              }`}
              style={{ width: `${progressToMin}%` }}
            />
          </div>
        </div>

        <button
          onClick={onOpenWithdrawal}
          disabled={user.balance < settings.minWithdrawalAmount}
          className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-[#0088cc] font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
        >
          <ArrowUpRight className="w-4 h-4" /> Request UPI Withdrawal
        </button>
      </div>

      {/* Tabs Switcher */}
      <div className="flex bg-slate-100 border border-slate-200/80 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab('withdrawals')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
            tab === 'withdrawals'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <History className="w-3.5 h-3.5" /> Withdrawal History ({withdrawals.length})
        </button>
        <button
          onClick={() => setTab('transactions')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
            tab === 'transactions'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Transactions ({transactions.length})
        </button>
      </div>

      {/* Withdrawals List */}
      {tab === 'withdrawals' && (
        <div className="space-y-2.5">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-xs bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#0088cc]" />
              Loading withdrawal orders...
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="p-8 text-center bg-white border border-slate-200/80 rounded-2xl shadow-xs">
              <p className="text-sm font-medium text-slate-700">No withdrawal requests yet.</p>
              <p className="text-xs text-slate-400 mt-1">
                Once you reach ₹{settings.minWithdrawalAmount}, tap Request UPI Withdrawal above.
              </p>
            </div>
          ) : (
            withdrawals.map((w) => (
              <div
                key={w.id}
                onClick={() => setSelectedWithdrawal(w)}
                className="p-4 bg-white hover:bg-slate-50 border border-slate-200/80 hover:border-sky-300 rounded-2xl cursor-pointer transition flex items-center justify-between shadow-xs"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-black text-slate-900">₹{w.amount.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({w.id})</span>
                  </div>
                  <p className="text-xs text-slate-600">UPI: <span className="text-slate-900 font-mono font-medium">{w.upiId}</span></p>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                    {new Date(w.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>{getStatusBadge(w.status)}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Transactions List */}
      {tab === 'transactions' && (
        <div className="space-y-2">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-xs bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#0088cc]" />
              Loading ledger...
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center bg-white border border-slate-200/80 rounded-2xl text-slate-500 text-xs shadow-xs">
              No transactions recorded yet.
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="p-3.5 bg-white border border-slate-200/80 rounded-2xl flex items-center justify-between text-xs shadow-xs"
              >
                <div className="min-w-0 pr-2">
                  <p className="font-bold text-slate-900 truncate">{tx.description}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(tx.createdAt).toLocaleString()} • Balance after: ₹{tx.balanceAfter.toFixed(2)}
                  </p>
                </div>
                <span
                  className={`font-black text-sm shrink-0 ${
                    tx.amount > 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {tx.amount > 0 ? `+₹${tx.amount.toFixed(2)}` : `-₹${Math.abs(tx.amount).toFixed(2)}`}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Withdrawal Detail Modal */}
      {selectedWithdrawal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-4">Withdrawal Details</h3>
            <div className="space-y-3 text-xs text-slate-600">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400">Order ID:</span>
                <span className="font-mono text-slate-900 font-semibold">{selectedWithdrawal.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400">Amount:</span>
                <span className="font-bold text-emerald-700 text-sm">₹{selectedWithdrawal.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400">UPI Address:</span>
                <span className="font-mono text-slate-900 font-medium">{selectedWithdrawal.upiId}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400">Status:</span>
                <span>{getStatusBadge(selectedWithdrawal.status)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-400">Requested:</span>
                <span>{new Date(selectedWithdrawal.createdAt).toLocaleString()}</span>
              </div>

              {selectedWithdrawal.failureReason && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl">
                  <span className="font-bold block mb-0.5">Rejection / Failure Note:</span>
                  <span>{selectedWithdrawal.failureReason}</span>
                </div>
              )}

              {selectedWithdrawal.providerResponse && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl">
                  <span className="font-bold text-slate-700 block mb-0.5">System Reference:</span>
                  <span className="font-mono text-[10px] break-all">{selectedWithdrawal.providerResponse}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedWithdrawal(null)}
              className="w-full mt-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl transition text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
