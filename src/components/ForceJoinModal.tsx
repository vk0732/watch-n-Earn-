import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, AlertCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import type { ForceJoinChannel } from '../types/index.ts';
import { api } from '../services/api.ts';

interface ForceJoinModalProps {
  isOpen: boolean;
  channels: ForceJoinChannel[];
  onVerified: () => void;
}

export const ForceJoinModal: React.FC<ForceJoinModalProps> = ({
  isOpen,
  channels,
  onVerified,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelStatuses, setChannelStatuses] = useState<Record<string, boolean>>({});

  const [channelErrors, setChannelErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const handleOpenChannel = (url: string) => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink && (url.includes('t.me/') || url.includes('telegram.me/'))) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.verifyForceJoin();
      const statusMap: Record<string, boolean> = {};
      const errorMap: Record<string, string> = {};

      res.channels.forEach((c) => {
        statusMap[c.id] = c.isMember;
        if (!c.isMember && c.error) {
          errorMap[c.id] = c.error;
        }
      });
      setChannelStatuses(statusMap);
      setChannelErrors(errorMap);

      if (res.allJoined) {
        onVerified();
      } else {
        setError(res.failureReason || 'Please make sure you have joined all mandatory channels listed below.');
      }
    } catch (err: any) {
      setError(err.message || 'Verification check failed. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Join Required Channels</h2>
            <p className="text-xs text-slate-400">Complete verification to unlock Watch & Earn</p>
          </div>
        </div>

        <p className="text-sm text-slate-300 mb-5 leading-relaxed">
          To prevent bots and unlock instant cash withdrawals, our community sponsors require you to join the official channels below:
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-500/40 rounded-xl flex items-start gap-2 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        <div className="space-y-3 mb-6">
          {channels.map((ch, idx) => {
            const isVerified = channelStatuses[ch.id];
            const chError = channelErrors[ch.id];
            return (
              <div
                key={ch.id}
                className="p-3.5 bg-slate-800/80 border border-slate-700/60 rounded-xl hover:border-slate-600 transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-xs flex items-center justify-center font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <div className="truncate">
                      <p className="text-sm font-semibold text-white truncate">{ch.title}</p>
                      <p className="text-xs text-slate-400 truncate">{ch.channelId || ch.username}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isVerified ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold px-2 py-1 bg-emerald-500/10 rounded-lg">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Joined
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenChannel(ch.inviteLink)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                      >
                        Join <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {!isVerified && chError && (
                  <p className="text-[11px] text-amber-400 mt-2 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                    ⚠️ {chError}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Verifying Membership...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" /> I Have Joined (Verify Now)
            </>
          )}
        </button>

        <p className="text-center text-xs text-slate-500 mt-3">
          Channel status is checked in real-time via Telegram Bot API
        </p>
      </div>
    </div>
  );
};
