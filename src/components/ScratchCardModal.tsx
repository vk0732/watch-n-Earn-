import React, { useRef, useState, useEffect } from 'react';
import { X, Sparkles, AlertCircle, RefreshCw, Trophy, Gift, CheckCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api.ts';
import type { ScratchCardItem } from '../types/index.ts';

interface ScratchCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: ScratchCardItem[];
  onScratchSuccess: (newBalance: number, cardId: string, wonAmount: number) => void;
  onRefreshCards: () => void;
}

export const ScratchCardModal: React.FC<ScratchCardModalProps> = ({
  isOpen,
  onClose,
  cards,
  onScratchSuccess,
  onRefreshCards,
}) => {
  const [selectedCard, setSelectedCard] = useState<ScratchCardItem | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [scratchProgress, setScratchProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  // Initialize selected card to first unrevealed card
  useEffect(() => {
    if (isOpen && cards.length > 0) {
      const firstUnrevealed = cards.find((c) => !c.isRevealed) || cards[0];
      setSelectedCard(firstUnrevealed);
      setIsRevealed(firstUnrevealed.isRevealed);
      setScratchProgress(firstUnrevealed.isRevealed ? 100 : 0);
      setError(null);
    }
  }, [isOpen, cards]);

  // Setup Scratch Canvas when a card is selected
  useEffect(() => {
    if (!selectedCard || selectedCard.isRevealed) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset canvas dimensions
    canvas.width = 240;
    canvas.height = 140;

    // Draw opaque metallic scratch cover
    const grad = ctx.createLinearGradient(0, 0, 240, 140);
    grad.addColorStop(0, '#0d9488'); // teal-600
    grad.addColorStop(0.5, '#059669'); // emerald-600
    grad.addColorStop(1, '#0284c7'); // sky-600

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 240, 140);

    // Decorative texture & pattern
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 0; i < 240; i += 16) {
      ctx.fillRect(i, 0, 4, 140);
    }

    // Centered label on scratch cover
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✨ SCRATCH HERE ✨', 120, 75);

    setIsRevealed(false);
    setScratchProgress(0);
  }, [selectedCard]);

  if (!isOpen) return null;

  const handleSelectCard = (card: ScratchCardItem) => {
    setSelectedCard(card);
    setIsRevealed(card.isRevealed);
    setScratchProgress(card.isRevealed ? 100 : 0);
    setError(null);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isRevealed || revealing) return;
    isDrawing.current = true;
    scratch(e);
  };

  const handlePointerUp = () => {
    isDrawing.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || isRevealed || revealing) return;
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
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();

    // Check scratch progress
    calculateProgress();
  };

  const calculateProgress = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
      setScratchProgress(ratio);

      // Once user scratches > 40%, automatically complete the reveal securely
      if (ratio > 40 && !isRevealed && !revealing && selectedCard) {
        triggerCompleteReveal(selectedCard.id);
      }
    } catch (e) {
      // Fallback
    }
  };

  const triggerCompleteReveal = async (cardId: string) => {
    if (revealing || isRevealed) return;
    setRevealing(true);
    setError(null);

    try {
      // Backend validates ownership and credits atomically
      const res = await api.revealScratchCard(cardId);

      setIsRevealed(true);
      setScratchProgress(100);

      // Clear the canvas completely
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (res.card.rewardAmount > 0) {
        try {
          confetti({
            particleCount: 70,
            spread: 60,
            origin: { y: 0.6 },
          });
        } catch (e) {
          // Ignore
        }
      }

      onScratchSuccess(res.newBalance, cardId, res.card.rewardAmount);
      onRefreshCards();
    } catch (err: any) {
      setError(err.message || 'Failed to reveal scratch card');
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-teal-500/30 p-5 shadow-2xl text-center overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-teal-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 p-0.5 flex items-center justify-center text-slate-950 font-bold">
              🎁
            </div>
            <div className="text-left">
              <h3 className="text-sm font-black text-white">Referral Scratch Cards</h3>
              <p className="text-[10px] text-slate-400">Exclusive bonus for verified invites</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={revealing}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {cards.length === 0 ? (
          <div className="py-8 px-4 text-center space-y-2">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400">
              <Gift className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-white">No Scratch Cards Yet</h4>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
              Invite friends to TeleEarn using your referral link. When they qualify, you unlock unique reward scratch cards!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Card selector chips */}
            {cards.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none justify-center">
                {cards.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectCard(c)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                      selectedCard?.id === c.id
                        ? 'bg-teal-500 text-slate-950 shadow-md'
                        : c.isRevealed
                        ? 'bg-slate-850 text-slate-400 border border-slate-800'
                        : 'bg-teal-950/80 text-teal-300 border border-teal-500/40'
                    }`}
                  >
                    <span>Card #{i + 1}</span>
                    {c.isRevealed ? (
                      <CheckCircle className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* The Scratch Card Canvas Box */}
            {selectedCard && (
              <div className="relative mx-auto w-[240px] h-[140px] rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-teal-500/40 shadow-inner overflow-hidden flex items-center justify-center select-none">
                {/* Revealed Content underneath */}
                <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                  <div className="w-9 h-9 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-400 mb-1">
                    <Trophy className="w-5 h-5 text-amber-400" />
                  </div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">
                    Referral: @{selectedCard.refereeUsername}
                  </span>
                  <div className="text-2xl font-black text-white tracking-tight mt-0.5">
                    {selectedCard.rewardAmount > 0
                      ? `+₹${selectedCard.rewardAmount}`
                      : 'Better Luck Next Time'}
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold">
                    {selectedCard.rewardAmount > 0 ? 'Credited to Wallet' : 'Try Another Referral'}
                  </span>
                </div>

                {/* Scratch Surface Canvas (Overlaid on top) */}
                {!isRevealed && (
                  <canvas
                    ref={canvasRef}
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUp}
                    onPointerMove={handlePointerMove}
                    className="absolute inset-0 w-full h-full cursor-crosshair touch-none z-10 rounded-2xl"
                  />
                )}
              </div>
            )}

            {/* Instruction / One-Click Reveal */}
            <div className="space-y-2">
              {!isRevealed ? (
                <>
                  <p className="text-xs text-slate-300 font-medium">
                    Swipe or drag across the card to scratch and reveal your reward!
                  </p>
                  <button
                    onClick={() => selectedCard && triggerCompleteReveal(selectedCard.id)}
                    disabled={revealing}
                    className="py-2 px-4 bg-slate-800 hover:bg-slate-700 text-teal-400 hover:text-white text-xs font-bold rounded-xl transition border border-teal-500/30 flex items-center justify-center gap-1.5 mx-auto disabled:opacity-50"
                  >
                    {revealing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{revealing ? 'Revealing...' : 'Instant Reveal'}</span>
                  </button>
                </>
              ) : (
                <div className="p-2.5 rounded-xl bg-teal-950/40 border border-teal-500/30 text-teal-300 text-xs font-bold">
                  Card Revealed Successfully!
                </div>
              )}

              {error && (
                <div className="p-2 bg-red-950/60 border border-red-500/30 text-red-300 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="text-left text-[11px]">{error}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
