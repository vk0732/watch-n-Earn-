import React, { useRef, useState, useEffect } from 'react';
import { Sparkles, ExternalLink, RefreshCw, Trophy, Gift, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
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
  const [isVerified, setIsVerified] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [channelsList, setChannelsList] = useState<Array<ForceJoinChannel & { isMember?: boolean }>>(channels || []);
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

      // If initial channels provided, use them; otherwise fetch fresh list
      if (channels && channels.length > 0) {
        setChannelsList(channels);
        setUnjoinedList(channels);
      } else {
        api.verifyForceJoin().then((res) => {
          if (res.channels) {
            setChannelsList(res.channels);
            setUnjoinedList(res.channels.filter((c) => !c.isMember));
            if (res.allJoined) setIsVerified(true);
          }
        }).catch(() => {});
      }

      setError(null);
      setSuccessMessage(null);
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

    // Metallic Telegram Blue gradient
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
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✨ SCRATCH TO REVEAL ✨', 140, 72);

    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(`Win up to ₹${maxBonus} Signup Bonus`, 140, 94);
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
          origin: { y: 0.5 },
          colors: ['#0088cc', '#10b981', '#f59e0b', '#8b5cf6'],
        });
      }
    } catch {
      // Fallback
    }
  };

  // Step 3: Verify Channel Membership
  const handleVerifyMembership = async () => {
    if (verifyLoading) return;
    setVerifyLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await api.verifyForceJoin();

      if (res.channels) {
        setChannelsList(res.channels);
        const unjoined = res.channels.filter((c) => !c.isMember);
        setUnjoinedList(unjoined);

        if (res.allJoined || unjoined.length === 0) {
          setIsVerified(true);
          setSuccessMessage('✅ Channel membership verified! Tap "Claim Signup Bonus" below to receive your reward.');
        } else {
          setIsVerified(false);
          const missingNames = unjoined.map((c) => c.title).join(', ');
          setError(`Please join the required channel(s): ${missingNames}`);
        }
      } else if (res.allJoined) {
        setIsVerified(true);
        setSuccessMessage('✅ Channel membership verified! Tap "Claim Signup Bonus" below to receive your reward.');
      } else {
        setIsVerified(false);
        setError(res.failureReason || 'Please join all required channels to verify membership.');
      }
    } catch (err: any) {
      setIsVerified(false);
      setError(err.message || 'Verification service temporarily unavailable. Please retry.');
    } finally {
      setVerifyLoading(false);
    }
  };

  // Step 4: Claim Signup Bonus
  const handleClaimBonus = async () => {
    if (claimLoading || !isVerified) return;
    setClaimLoading(true);
    setError(null);

    try {
      const res = await api.claimSignupScratchBonus(user.deviceId, user.deviceFingerprint);

      // Celebrate success
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#10b981', '#0088cc', '#f59e0b'],
      });

      setSuccessMessage(`🎉 ₹${res.claimedAmount} Signup Bonus Claimed Successfully! Redirecting to Home...`);

      // Wait a moment so user sees the celebration, then redirect to Home
      setTimeout(() => {
        onClaimSuccess(res.newBalance, res.user, res.claimedAmount);
      }, 1200);
    } catch (err: any) {
      if (err.unjoinedChannels && err.unjoinedChannels.length > 0) {
        setUnjoinedList(err.unjoinedChannels);
        setIsVerified(false);
      }
      setError(err.message || 'Failed to claim signup bonus. Please retry.');
    } finally {
      setClaimLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl animate-in zoom-in-95 duration-150 my-auto">
        {/* Header (Exact requirement: Heading: Scratch & Win, Subtitle: Win up to ₹10 Signup Bonus) */}
        <div className="text-center mb-3">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-sky-50 border border-sky-100 items-center justify-center text-[#0088cc] shadow-2xs mb-2">
            <Gift className="w-6 h-6 animate-bounce" />
          </div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">
            Scratch &amp; Win
          </h1>
          <p className="text-xs font-semibold text-slate-500 mt-0.5">
            Win up to ₹{maxBonus} Signup Bonus
          </p>
        </div>

        {/* Scratch Card Interactive Area */}
        <div className="relative w-[280px] h-[150px] mx-auto rounded-2xl overflow-hidden shadow-md border-2 border-sky-200 bg-gradient-to-br from-amber-50 via-sky-50 to-emerald-50 flex items-center justify-center mb-3">
          {/* Revealed Reward Background (Beneath Canvas) */}
          <div className="text-center p-4 select-none">
            <Trophy className="w-8 h-8 text-amber-500 mx-auto mb-1 animate-pulse" />
            <div className="text-3xl font-black text-[#0088cc] tracking-tight">
              ₹{bonusAmount}
            </div>
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mt-0.5">
              Guaranteed Welcome Reward
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

        {/* Instructions when not yet scratched */}
        {!isRevealed && (
          <p className="text-center text-xs text-slate-500 font-medium mb-2">
            👆 Rub or scratch the blue surface above to reveal your bonus!
          </p>
        )}

        {/* Status / Error Alerts */}
        {error && (
          <div className="mb-3 p-3 rounded-xl text-xs bg-red-50 border border-red-200 text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-3 p-3 rounded-xl text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <span className="leading-snug">{successMessage}</span>
          </div>
        )}

        {/* Revealed Section: You won ₹X! + Join & Verify + Claim Buttons */}
        {isRevealed && (
          <div className="space-y-3 mb-2 animate-in fade-in duration-200">
            {/* Prominent Win Banner */}
            <div className="p-3 bg-gradient-to-r from-sky-50 via-emerald-50 to-sky-50 border border-sky-200 rounded-xl text-center">
              <span className="text-base font-black text-slate-900">
                🎉 You won <span className="text-[#0088cc]">₹{bonusAmount}</span>!
              </span>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Complete the two quick steps below to claim your bonus:
              </p>
            </div>

            {/* List of Required Channels */}
            {channelsList.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {channelsList.map((ch, idx) => {
                  const isJoined = ch.isMember || !unjoinedList.some((u) => u.channelId === ch.channelId);
                  return (
                    <div
                      key={ch.id || idx}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-slate-900 truncate">{ch.title}</p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{ch.channelId || ch.username}</p>
                      </div>
                      {isJoined ? (
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-lg border border-emerald-200 flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Joined
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenChannel(ch.inviteLink)}
                          className="px-2.5 py-1 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-bold rounded-lg shadow-2xs transition flex items-center gap-1 shrink-0"
                        >
                          Join <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Step 3: Verify Membership Button */}
            <button
              type="button"
              onClick={handleVerifyMembership}
              disabled={verifyLoading || claimLoading}
              className={`w-full py-2.5 px-4 font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2 ${
                isVerified
                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                  : 'bg-slate-900 hover:bg-slate-800 text-white shadow-md'
              }`}
            >
              {verifyLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying Membership...
                </>
              ) : isVerified ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Membership Verified ✓
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" /> Verify Membership
                </>
              )}
            </button>

            {/* Step 4: Claim Signup Bonus Button (Unlocked only after verification) */}
            <button
              type="button"
              onClick={handleClaimBonus}
              disabled={!isVerified || claimLoading}
              className={`w-full py-3 px-4 font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition flex items-center justify-center gap-2 ${
                isVerified
                  ? 'tg-btn-primary hover:opacity-95 cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
              }`}
            >
              {claimLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Claiming Bonus...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Claim Signup Bonus (₹{bonusAmount})
                </>
              )}
            </button>

            {!isVerified && (
              <p className="text-center text-[10px] text-slate-400 font-medium">
                🔒 Tap "Verify Membership" first to unlock the Claim button
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
