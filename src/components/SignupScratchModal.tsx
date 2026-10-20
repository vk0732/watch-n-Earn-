import React, { useRef, useState, useEffect } from 'react';
import { Sparkles, ShieldAlert, ExternalLink, RefreshCw, Trophy, Gift, CheckCircle2, AlertCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api.ts';
import type { UserProfile, ForceJoinChannel } from '../types/index.ts';

interface SignupScratchModalProps {
  isOpen: boolean;
  user: UserProfile;
  channels: ForceJoinChannel[];
  maxBonus?: number;
  initialBonusAmount?: number;
  onClaimSuccess: (newBalance: number, user: UserProfile, claimedAmount: number) => void;
}

export const SignupScratchModal: React.FC<SignupScratchModalProps> = ({
  isOpen,
  user,
  channels,
  maxBonus = 10,
  initialBonusAmount,
  onClaimSuccess,
}) => {
  const [bonusAmount, setBonusAmount] = useState<number>(initialBonusAmount || user.pendingSignupBonus || 5);
  const [isRevealed, setIsRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApiError, setIsApiError] = useState(false);
  const [unjoinedList, setUnjoinedList] = useState<ForceJoinChannel[]>(channels || []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  // Fetch or confirm assigned scratch card bonus on open
  useEffect(() => {
    if (isOpen) {
      if (initialBonusAmount && initialBonusAmount > 0) {
        setBonusAmount(initialBonusAmount);
      } else if (user.pendingSignupBonus && user.pendingSignupBonus > 0) {
        setBonusAmount(user.pendingSignupBonus);
      } else {
        api.getSignupScratchCard().then((res) => {
          if (res.amount > 0) {
            setBonusAmount(res.amount);
          }
        }).catch((err) => {
          console.warn('[SignupScratch] Could not assign scratch card:', err);
        });
      }
      setUnjoinedList(channels);
      setError(null);
    }
  }, [isOpen, initialBonusAmount, user.pendingSignupBonus, channels]);

  // Setup Canvas
  useEffect(() => {
    if (!isOpen || isRevealed) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 280;
    canvas.height = 150;

    // Rich metallic Telegram Blue gradient
    const grad = ctx.createLinearGradient(0, 0, 280, 150);
    grad.addColorStop(0, '#0088cc');
    grad.addColorStop(0.5, '#24a1de');
    grad.addColorStop(1, '#0284c7');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 280, 150);

    // Decorative texture stripes
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 0; i < 280; i += 20) {
      ctx.fillRect(i, 0, 6, 150);
    }

    // Centered label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✨ SCRATCH TO REVEAL ✨', 140, 75);

    ctx.font = 'normal 11px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('Up to ₹' + maxBonus + ' Welcome Bonus', 140, 95);
  }, [isOpen, isRevealed, maxBonus]);

  if (!isOpen) return null;

  const handleOpenChannel = (url: string) => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink && (url.includes('t.me/') || url.includes('telegram.me/'))) {
      tg.openTelegramLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isRevealed) return;
    isDrawing.current = true;
    scratch(e);
  };

  const handlePointerUp = () => {
    isDrawing.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || isRevealed) return;
    scratch(e);
  };

  const scratch = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();

    calculateProgress();
  };

  const calculateProgress = () => {
    const canvas = canvasRef.current;
    if (!canvas || isRevealed) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      let clearPixels = 0;
      const totalPixels = data.length / 4;

      for (let i = 3; i < data.length; i += 16) {
        if (data[i] === 0) clearPixels++;
      }

      const ratio = Math.min(100, Math.round((clearPixels / (totalPixels / 4)) * 100));

      // Auto reveal once 35% is cleared
      if (ratio > 35 && !isRevealed) {
        setIsRevealed(true);
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#0088cc', '#10b981', '#f59e0b', '#8b5cf6'],
        });
      }
    } catch {
      // Fallback
    }
  };

  const handleClaim = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setIsApiError(false);

    try {
      const res = await api.claimSignupScratchBonus(user.deviceId, user.deviceFingerprint);

      // Celebrate success
      confetti({
        particleCount: 100,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#10b981', '#0088cc', '#f59e0b'],
      });

      onClaimSuccess(res.newBalance, res.user, res.claimedAmount);
    } catch (err: any) {
      if (err.unjoinedChannels && err.unjoinedChannels.length > 0) {
        setUnjoinedList(err.unjoinedChannels);
      }
      setIsApiError(Boolean(err.isApiError));
      setError(err.message || 'Failed to claim signup bonus. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="text-center mb-4">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-sky-50 border border-sky-100 items-center justify-center text-[#0088cc] shadow-2xs mb-2">
            <Gift className="w-6 h-6 animate-bounce" />
          </div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Scratch &amp; Win — Up to ₹{maxBonus} Signup Bonus!
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isRevealed
              ? 'Join all required channels below to claim your bonus'
              : 'Scratch the card to reveal your guaranteed welcome cash'}
          </p>
        </div>

        {/* Scratch Card Interactive Area */}
        <div className="relative w-[280px] h-[150px] mx-auto rounded-2xl overflow-hidden shadow-md border-2 border-sky-200 bg-gradient-to-br from-amber-50 via-sky-50 to-emerald-50 flex items-center justify-center mb-4">
          {/* Revealed Reward Background (Beneath Canvas) */}
          <div className="text-center p-4 select-none">
            <Trophy className="w-8 h-8 text-amber-500 mx-auto mb-1 animate-pulse" />
            <div className="text-3xl font-black text-[#0088cc] tracking-tight">
              ₹{bonusAmount}
            </div>
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mt-0.5">
              Welcome Bonus
            </p>
          </div>

          {/* Scratchable Canvas Overlay */}
          {!isRevealed && (
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerMove={handlePointerMove}
              className="absolute inset-0 cursor-crosshair touch-none select-none z-10 transition-opacity"
            />
          )}
        </div>

        {/* Error / Alert Display */}
        {error && (
          <div className={`mb-3.5 p-3 rounded-xl text-xs flex items-start gap-2 ${
            isApiError
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="leading-snug">{error}</span>
              {isApiError && (
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={loading}
                  className="mt-1.5 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg flex items-center gap-1 transition"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Retry Verification
                </button>
              )}
            </div>
          </div>
        )}

        {/* Flow Stage 2: Channels to Join Once Card Is Revealed */}
        {isRevealed && (
          <div className="space-y-3 mb-4 animate-in fade-in duration-200">
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900 leading-snug">
              🎉 <strong>You won ₹{bonusAmount}!</strong> Join all required channels and verify to claim your signup bonus:
            </div>

            {unjoinedList.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {unjoinedList.map((ch, idx) => (
                  <div
                    key={ch.id || idx}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-slate-900 truncate">{ch.title}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{ch.channelId || ch.username}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenChannel(ch.inviteLink)}
                      className="px-2.5 py-1 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-bold rounded-lg shadow-2xs transition flex items-center gap-1 shrink-0"
                    >
                      Join <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main CTA Action */}
        <div className="space-y-2">
          {isRevealed ? (
            <button
              type="button"
              onClick={handleClaim}
              disabled={loading}
              className="w-full py-3 px-4 tg-btn-primary font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Verifying &amp; Claiming...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Verify &amp; Claim ₹{bonusAmount} Bonus
                </>
              )}
            </button>
          ) : (
            <p className="text-center text-[11px] text-slate-400 font-medium">
              👆 Rub or scratch the blue surface above to reveal your bonus
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
