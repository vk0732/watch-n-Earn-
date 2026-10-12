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
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg">
            <Clock className="w-3 h-3" /> Pending
          </span>
        );
      case 'processing':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-lg">
            <RefreshCw className="w-3 h-3 animate-spin" /> Processing
          </span>
        );
      case 'rejected':
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[11px] font-bold text-red-400 bg-red-500/10 px-2.5 py-1 rounded-lg">
            <XCircle className="w-3 h-3" /> Rejected
          </span>
        );
    }
  };

  const progressToMin = Math.min(
    100,
    Math.round((user.balance / settings.minWithdrawalAmount) * 100)
  );

  return (
    <div className="space-y-4 pb-20">
      {/* Wallet Card */}
      <div className="p-6 bg-gradient-to-br from-slate-900 to-slate-850 border border-slate-700/80 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              My Wallet
            </span>
          </div>
          <span className="text-xs text-slate-400">Payout Method: <strong className="text-white">UPI</strong></span>
        </div>

        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-4xl sm:text-5xl font-black text-white">
            ₹{user.balance.toFixed(2)}
          </span>
          <span className="text-xs text-slate-400">Available</span>
        </div>

        {/* Progress bar towards minimum withdrawal & limits notice */}
        <div className="space-y-1.5 mb-5">
          <div className="flex justify-between text-xs text-slate-400 font-medium">
            <span>
              Min: ₹{settings.minWithdrawalAmount}
              {settings.maxWithdrawalAmount ? ` • Max: ₹${settings.maxWithdrawalAmount}` : ''}
            </span>
            <span className={user.balance >= settings.minWithdrawalAmount ? 'text-emerald-400 font-bold' : ''}>
              {user.balance >= settings.minWithdrawalAmount ? 'Eligible' : `${progressToMin}%`}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                user.balance >= settings.minWithdrawalAmount
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                  : 'bg-emerald-500/60'
              }`}
              style={{ width: `${progressToMin}%` }}
            />
          </div>
        </div>

        <button
          onClick={onOpenWithdrawal}
          disabled={user.balance < settings.minWithdrawalAmount}
          className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowUpRight className="w-4 h-4" /> Request UPI Withdrawal
        </button>
      </div>

      {/* Tabs Switcher */}
      <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab('withdrawals')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
            tab === 'withdrawals'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" /> Withdrawal History ({withdrawals.length})
        </button>
        <button
          onClick={() => setTab('transactions')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
            tab === 'transactions'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Transactions ({transactions.length})
        </button>
      </div>

      {/* Withdrawals List */}
      {tab === 'withdrawals' && (
        <div className="space-y-2.5">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-400" />
              Loading withdrawal orders...
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl">
              <p className="text-sm text-slate-400">No withdrawal requests yet.</p>
              <p className="text-xs text-slate-500 mt-1">
                Once you reach ₹{settings.minWithdrawalAmount}, tap Request UPI Withdrawal above.
              </p>
            </div>
          ) : (
            withdrawals.map((w) => (
              <div
                key={w.id}
                onClick={() => setSelectedWithdrawal(w)}
                className="p-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-2xl cursor-pointer transition flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-black text-white">₹{w.amount.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({w.id})</span>
                  </div>
                  <p className="text-xs text-slate-400">UPI: <span className="text-slate-300 font-mono">{w.upiId}</span></p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
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
        <div className="space-y-2.5">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-400" />
              Loading ledger...
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 text-xs">
              No transactions recorded yet.
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between text-xs"
              >
                <div className="min-w-0 pr-2">
                  <p className="font-bold text-white truncate">{tx.description}</p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(tx.createdAt).toLocaleString()} • Balance after: ₹{tx.balanceAfter.toFixed(2)}
                  </p>
                </div>
                <span
                  className={`font-black text-sm shrink-0 ${
                    tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-white mb-4">Withdrawal Details</h3>
            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Order ID:</span>
                <span className="font-mono text-white">{selectedWithdrawal.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Amount:</span>
                <span className="font-bold text-emerald-400 text-sm">₹{selectedWithdrawal.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">UPI Address:</span>
                <span className="font-mono text-white">{selectedWithdrawal.upiId}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Status:</span>
                <span>{getStatusBadge(selectedWithdrawal.status)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Requested:</span>
                <span>{new Date(selectedWithdrawal.createdAt).toLocaleString()}</span>
              </div>

              {selectedWithdrawal.failureReason && (
                <div className="p-2.5 bg-red-950/60 border border-red-500/30 text-red-300 rounded-xl">
                  <span className="font-bold block mb-0.5">Rejection / Failure Note:</span>
                  <span>{selectedWithdrawal.failureReason}</span>
                </div>
              )}

              {selectedWithdrawal.providerResponse && (
                <div className="p-2.5 bg-slate-800 border border-slate-700 text-slate-400 rounded-xl">
                  <span className="font-bold text-slate-300 block mb-0.5">System Reference:</span>
                  <span className="font-mono text-[11px] break-all">{selectedWithdrawal.providerResponse}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedWithdrawal(null)}
              className="w-full mt-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
