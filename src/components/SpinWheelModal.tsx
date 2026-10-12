import React, { useState } from 'react';
import { X, Sparkles, AlertCircle, RefreshCw, Trophy, Gift, ArrowRight } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api.ts';
import type { UserGamificationState, SpinRewardSegment } from '../types/index.ts';

interface SpinWheelModalProps {
  isOpen: boolean;
  onClose: () => void;
  gamState: UserGamificationState | null;
  onSpinSuccess: (newBalance: number, remainingSpins: number, wonSegment: SpinRewardSegment) => void;
  onRefreshGamification: () => void;
}

export const SpinWheelModal: React.FC<SpinWheelModalProps> = ({
  isOpen,
  onClose,
  gamState,
  onSpinSuccess,
  onRefreshGamification,
}) => {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [wonResult, setWonResult] = useState<SpinRewardSegment | null>(null);

  if (!isOpen || !gamState) return null;

  const segments = gamState.spinSegments.length >= 2 ? gamState.spinSegments : [
    { id: '1', label: '₹5 Coins', rewardType: 'coins', amount: 5, probability: 35, color: '#10b981', isEnabled: true },
    { id: '2', label: '₹10 Bonus', rewardType: 'bonus', amount: 10, probability: 25, color: '#3b82f6', isEnabled: true },
    { id: '3', label: '₹20 Jackpot', rewardType: 'bonus', amount: 20, probability: 10, color: '#8b5cf6', isEnabled: true },
    { id: '4', label: '₹2 Coins', rewardType: 'coins', amount: 2, probability: 20, color: '#f59e0b', isEnabled: true },
    { id: '5', label: 'Try Again', rewardType: 'no_reward', amount: 0, probability: 10, color: '#ef4444', isEnabled: true },
  ];

  const numSegments = segments.length;
  const degreesPerSegment = 360 / numSegments;

  const handleSpin = async () => {
    if (spinning || gamState.availableSpins <= 0) return;

    setSpinning(true);
    setSpinError(null);
    setWonResult(null);

    try {
      // Backend selects winner FIRST to prevent client manipulation
      const res = await api.spinWheel();

      // Find the segment index
      const targetIndex = res.segmentIndex >= 0 ? res.segmentIndex : 0;

      // The pointer is positioned at the TOP (270 degrees or 90 degrees depending on wheel rotation)
      // Wheel center of segment i is at (i * degreesPerSegment + degreesPerSegment / 2)
      // Pointer is at the top (0 degrees or 360 degrees).
      // To align the target segment with top pointer, rotation = (360 - (targetIndex * degreesPerSegment + degreesPerSegment / 2))
      const targetSegmentAngle = targetIndex * degreesPerSegment + degreesPerSegment / 2;
      const targetStopAngle = (360 - targetSegmentAngle) % 360;

      // Add 5-8 full rotations for exciting animation
      const fullRotations = 360 * 6;
      const currentMod = rotation % 360;
      const deltaToTarget = ((targetStopAngle - currentMod) + 360) % 360;
      const finalRotation = rotation + fullRotations + deltaToTarget;

      setRotation(finalRotation);

      // Animation duration: 4.5 seconds
      setTimeout(() => {
        setSpinning(false);
        setWonResult(res.winningSegment);

        if (res.winningSegment.amount > 0) {
          try {
            confetti({
              particleCount: 80,
              spread: 70,
              origin: { y: 0.6 },
            });
          } catch (e) {
            // Ignore if confetti not supported
          }
        }

        onSpinSuccess(res.newBalance, res.availableSpinsRemaining, res.winningSegment);
        onRefreshGamification();
      }, 4500);
    } catch (err: any) {
      setSpinning(false);
      setSpinError(err.message || 'Unable to spin wheel. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-emerald-500/30 p-5 shadow-2xl text-center overflow-hidden">
        {/* Glow Accents */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-teal-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 flex items-center justify-center text-slate-950 font-bold">
              🎡
            </div>
            <div className="text-left">
              <h3 className="text-sm font-black text-white">Lucky Spin Wheel</h3>
              <p className="text-[10px] text-slate-400">Complete tasks to win rewards</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={spinning}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Available Spins Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Available Spins: {gamState.availableSpins}</span>
        </div>

        {/* The Wheel Visual */}
        <div className="relative mx-auto w-64 h-64 my-1 flex items-center justify-center">
          {/* Wheel Pointer (Indicator pointing down into top of wheel) */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[24px] border-t-amber-400 drop-shadow-md" />

          {/* Wheel Outer Border Ring */}
          <div className="w-60 h-60 rounded-full p-2 bg-gradient-to-br from-amber-400 via-emerald-500 to-teal-600 shadow-2xl relative flex items-center justify-center">
            {/* Spinning Wheel Disk */}
            <div
              className="w-full h-full rounded-full relative overflow-hidden transition-transform ease-out"
              style={{
                transform: `rotate(${rotation}deg)`,
                transitionDuration: spinning ? '4500ms' : '0ms',
                transitionTimingFunction: 'cubic-bezier(0.15, 0.95, 0.35, 1)',
              }}
            >
              {/* SVG Conic/Segment slices */}
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {segments.map((seg, i) => {
                  const startAngle = (i * degreesPerSegment * Math.PI) / 180;
                  const endAngle = (((i + 1) * degreesPerSegment) * Math.PI) / 180;

                  const x1 = 50 + 50 * Math.sin(startAngle);
                  const y1 = 50 - 50 * Math.cos(startAngle);
                  const x2 = 50 + 50 * Math.sin(endAngle);
                  const y2 = 50 - 50 * Math.cos(endAngle);

                  const largeArcFlag = degreesPerSegment > 180 ? 1 : 0;
                  const pathData = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

                  return (
                    <path
                      key={seg.id}
                      d={pathData}
                      fill={seg.color}
                      stroke="#0f172a"
                      strokeWidth="0.8"
                    />
                  );
                })}
              </svg>

              {/* Segment Labels radiating from center */}
              {segments.map((seg, i) => {
                const angle = i * degreesPerSegment + degreesPerSegment / 2;
                return (
                  <div
                    key={`lbl-${seg.id}`}
                    className="absolute top-0 left-0 w-full h-full flex justify-center items-start pt-3 pointer-events-none"
                    style={{
                      transform: `rotate(${angle}deg)`,
                      transformOrigin: '50% 50%',
                    }}
                  >
                    <span
                      className="text-[10px] font-black tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                      style={{
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        maxHeight: '75px',
                        overflow: 'hidden',
                      }}
                    >
                      {seg.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Wheel Center Button / Hub */}
            <div className="absolute z-10 w-14 h-14 rounded-full bg-slate-950 border-4 border-amber-400 shadow-xl flex items-center justify-center">
              <span className="text-base select-none">🎯</span>
            </div>
          </div>
        </div>

        {/* Win Notification Card */}
        {wonResult && (
          <div className="mt-3 p-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider mb-0.5">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Result: {wonResult.label}</span>
            </div>
            <p className="text-[11px] text-slate-300">
              {wonResult.amount > 0
                ? `Credited +₹${wonResult.amount} directly to your wallet!`
                : 'Better luck on your next spin! Complete more tasks to earn spins.'}
            </p>
          </div>
        )}

        {/* Error notification */}
        {spinError && (
          <div className="mt-2 p-2.5 rounded-xl bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-[11px] text-left leading-tight">{spinError}</span>
          </div>
        )}

        {/* Spin Actions */}
        <div className="mt-4 space-y-2">
          <button
            onClick={handleSpin}
            disabled={spinning || gamState.availableSpins <= 0}
            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {spinning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Spinning Wheel...</span>
              </>
            ) : gamState.availableSpins > 0 ? (
              <>
                <Sparkles className="w-4 h-4" />
                <span>SPIN NOW ({gamState.availableSpins} Left)</span>
              </>
            ) : (
              <span>NO SPINS AVAILABLE</span>
            )}
          </button>

          {/* Progress hint */}
          <div className="p-2.5 bg-slate-950/60 rounded-xl text-[11px] text-slate-400 flex items-center justify-between">
            <span>Next Spin in:</span>
            <span className="font-bold text-white font-mono">
              {gamState.tasksRequiredPerSpin - gamState.progressToNextSpin} more tasks
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
