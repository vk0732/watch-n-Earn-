import React from 'react';
import { AlertCircle, RefreshCw, Sparkles, ShieldCheck } from 'lucide-react';

interface AppPreloaderProps {
  error?: string | null;
  onRetry?: () => void;
  onSwitchUser?: (userId: string, name: string) => void;
}

export const AppPreloader: React.FC<AppPreloaderProps> = ({ error, onRetry, onSwitchUser }) => {
  return (
    <div className="min-h-screen bg-[#f4f6fb] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto select-none">
      {/* Brand Icon with Pulsing Glow */}
      <div className="relative mb-5">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-[#0088cc] via-[#1aa3eb] to-[#38bdf8] p-0.5 shadow-xl shadow-sky-500/25 flex items-center justify-center animate-preloader-pulse">
          <div className="w-full h-full rounded-[22px] bg-white flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-sky-50/50 to-transparent pointer-events-none" />
            <span className="text-3xl select-none">🎁</span>
          </div>
        </div>

        {/* Floating Coin Accent */}
        <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-300 border-2 border-white shadow-md flex items-center justify-center text-xs">
          🪙
        </div>
      </div>

      {/* App Title */}
      <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center justify-center gap-1.5">
        <span>TeleEarn</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0088cc] bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
          Mini App
        </span>
      </h1>
      <p className="text-xs text-slate-500 mt-1 font-medium">Watch & Earn • Instant Amazon Gift Cards</p>

      {/* Error or Loading State */}
      {error ? (
        <div className="mt-6 w-full max-w-xs p-4 bg-white border border-red-200 rounded-2xl shadow-sm text-center">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-2">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h2 className="text-xs font-bold text-slate-900">Connection Failed</h2>
          <p className="text-[11px] text-slate-500 mt-1 mb-3.5 leading-relaxed">{error}</p>
          <div className="space-y-2">
            <button
              onClick={onRetry}
              className="w-full py-2.5 px-4 bg-[#0088cc] hover:bg-[#0077b5] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 active:scale-98"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </button>

            {onSwitchUser && (
              <button
                onClick={() => onSwitchUser('987654321', 'Normal User')}
                className="w-full py-2 px-3 text-[11px] text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-lg transition"
              >
                Open in Demo Sandbox Mode
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-3 w-full max-w-xs">
          {/* Subtle Progress Shimmer Bar */}
          <div className="w-48 mx-auto h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#0088cc] to-sky-400 rounded-full animate-pulse" />
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Verifying Telegram session & ledger...</span>
          </div>
        </div>
      )}
    </div>
  );
};
