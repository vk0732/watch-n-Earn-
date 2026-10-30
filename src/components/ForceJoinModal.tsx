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

  const validChannels = (channels || []).filter(
    (ch) => ch.healthStatus !== 'bot_not_member' && ch.healthStatus !== 'chat_not_found'
  );

  React.useEffect(() => {
    if (isOpen && validChannels.length === 0) {
      onVerified();
    }
  }, [isOpen, validChannels.length, onVerified]);

  if (!isOpen || validChannels.length === 0) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0088cc] shadow-2xs">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Join Required Channels</h2>
            <p className="text-xs text-slate-500">Complete verification to unlock Watch & Earn</p>
          </div>
        </div>

        <p className="text-xs text-slate-600 mb-4 leading-relaxed">
          To prevent bots and unlock instant cash withdrawals, our community sponsors require you to join the official channels below:
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        <div className="space-y-2.5 mb-5">
          {validChannels.map((ch, idx) => {
            const isVerified = channelStatuses[ch.id];
            const chError = channelErrors[ch.id];
            const cleanChError =
              chError &&
              !chError.toLowerCase().includes('bot is not a member') &&
              !chError.toLowerCase().includes('forbidden')
                ? chError
                : null;
            return (
              <div
                key={ch.id}
                className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-700 text-xs flex items-center justify-center font-bold shrink-0 shadow-2xs">
                      {idx + 1}
                    </span>
                    <div className="truncate">
                      <p className="text-xs font-bold text-slate-900 truncate">{ch.title}</p>
                      <p className="text-[11px] text-slate-500 font-mono truncate">{ch.channelId || ch.username}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isVerified ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-700 font-bold px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Joined
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenChannel(ch.inviteLink)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-bold rounded-lg shadow-2xs transition active:scale-98"
                      >
                        Join <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {!isVerified && cleanChError && (
                  <p className="text-[11px] text-amber-800 mt-2 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                    ⚠️ {cleanChError}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full py-3.5 px-4 tg-btn-primary font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-white" /> Verifying Membership...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" /> I Have Joined (Verify Now)
            </>
          )}
        </button>

        <p className="text-center text-[11px] text-slate-400 mt-3">
          Channel status is checked in real-time via Telegram Bot API
        </p>
      </div>
    </div>
  );
};
