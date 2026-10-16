import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Sparkles,
  MessageSquare,
  PlayCircle,
  Globe,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../services/api.ts';
import type { Task } from '../types/index.ts';

interface TaskModalProps {
  task: Task | null;
  onClose: () => void;
  onSuccess: (newBalance: number) => void;
}

export const TaskModal: React.FC<TaskModalProps> = ({ task, onClose, onSuccess }) => {
  const [started, setStarted] = useState(false);
  const [channelOpened, setChannelOpened] = useState(false);
  const [socialOpened, setSocialOpened] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Social form states
  const [socialHandle, setSocialHandle] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [actionConfirmed, setActionConfirmed] = useState(false);

  useEffect(() => {
    if (task) {
      setStarted(false);
      setChannelOpened(false);
      setSocialOpened(false);
      setSecondsRemaining(task.timerSeconds || (task.taskType === 'channel' ? 0 : 10));
      setError(null);
      setInfoMessage(null);
      setSocialHandle('');
      setVerificationCode('');
      setActionConfirmed(false);
    }
  }, [task]);

  // Timer countdown for video/website/timer tasks
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (started && secondsRemaining > 0) {
      timer = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [started, secondsRemaining]);

  if (!task) return null;

  const totalSeconds = task.timerSeconds || 10;
  const progressPercent =
    totalSeconds > 0 ? Math.min(100, Math.round(((totalSeconds - secondsRemaining) / totalSeconds) * 100)) : 100;

  // 1. VIDEO / WEBSITE START
  const handleStartTimedTask = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.startTask(task.id);
      setStarted(true);
      window.open(task.destinationUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'Failed to start task timer');
    } finally {
      setLoading(false);
    }
  };

  // 2. CHANNEL JOIN CLICK
  const handleOpenChannel = () => {
    setChannelOpened(true);
    setError(null);
    const targetUrl = (task.destinationUrl || '').trim();
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink && (targetUrl.includes('t.me/') || targetUrl.includes('telegram.me/'))) {
      tg.openTelegramLink(targetUrl);
    } else {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // 3. SOCIAL OPEN CLICK
  const handleOpenSocial = async () => {
    setSocialOpened(true);
    setError(null);
    if (task.timerSeconds > 0) {
      try {
        await api.startTask(task.id);
        setStarted(true);
      } catch (err) {
        // ignore
      }
    }
    window.open(task.destinationUrl, '_blank', 'noopener,noreferrer');
  };

  // 4. SUBMIT / CLAIM HANDLER (TYPE-SPECIFIC)
  const handleClaim = async () => {
    setError(null);
    setInfoMessage(null);

    // Frontend validations based on task type
    if (task.taskType === 'video' || task.taskType === 'website') {
      if (secondsRemaining > 0) {
        setError(`Please wait ${secondsRemaining}s more before claiming`);
        return;
      }
    }

    if (task.taskType === 'channel' && !channelOpened) {
      setError('Please click "Join Telegram Channel" first before verifying.');
      return;
    }

    if (task.taskType === 'social') {
      if (!socialOpened) {
        setError('Please open the social link before verifying.');
        return;
      }

      if (task.verificationMethod === 'code_confirmation' && !verificationCode.trim()) {
        setError('Please enter the verification code found in the post description.');
        return;
      }

      if (task.verificationMethod === 'manual_review' && !socialHandle.trim()) {
        setError('Please enter your social username or profile handle.');
        return;
      }

      if (task.verificationMethod === 'timer' && secondsRemaining > 0) {
        setError(`Please engage for ${secondsRemaining}s more before claiming.`);
        return;
      }

      if (
        !task.verificationMethod &&
        !task.timerSeconds &&
        !actionConfirmed
      ) {
        setError('Please confirm that you have followed or completed the social action.');
        return;
      }
    }

    setVerifying(true);
    try {
      const payload: any = {};
      if (task.taskType === 'social') {
        if (socialHandle.trim()) payload.socialHandle = socialHandle.trim();
        if (verificationCode.trim()) payload.verificationCode = verificationCode.trim();
        payload.confirmedAction = actionConfirmed || true;
      }

      const res = await api.completeTask(task.id, payload);

      if (res.pendingReview) {
        setInfoMessage(res.message || 'Task submitted for manual review!');
        setTimeout(() => onClose(), 2200);
        return;
      }

      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#0088cc', '#24a1de', '#10b981', '#f59e0b'],
      });

      if (typeof res.newBalance === 'number') {
        onSuccess(res.newBalance);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const getBadgeIcon = () => {
    switch (task.taskType) {
      case 'video':
        return <PlayCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'website':
        return <Globe className="w-3.5 h-3.5 text-blue-500" />;
      case 'channel':
        return <MessageSquare className="w-3.5 h-3.5 text-[#0088cc]" />;
      case 'social':
        return <Share2 className="w-3.5 h-3.5 text-pink-500" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-amber-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Task Type Header Badge */}
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg uppercase tracking-wider">
            {getBadgeIcon()} {task.taskType}
          </span>
          {task.taskType === 'channel' ? (
            <span className="text-[11px] text-[#0088cc] flex items-center gap-1 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-[#0088cc]" /> Telegram Verification
            </span>
          ) : task.timerSeconds > 0 ? (
            <span className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
              <Clock className="w-3.5 h-3.5 text-slate-400" /> {task.timerSeconds}s Watch Time
            </span>
          ) : null}
        </div>

        <h3 className="text-base font-bold text-slate-900 mb-1.5">{task.title}</h3>
        <p className="text-xs text-slate-600 mb-4 leading-relaxed">{task.description}</p>

        {/* Error Notification */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {/* Info Message */}
        {infoMessage && (
          <div className="mb-4 p-3 bg-sky-50 border border-sky-200 text-[#0088cc] rounded-xl text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Reward preview box */}
        <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl mb-5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-emerald-800 uppercase font-bold tracking-wider">Completion Reward</span>
            <p className="text-2xl font-black text-emerald-700">+₹{task.rewardAmount.toFixed(2)}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-white border border-emerald-200 flex items-center justify-center text-emerald-600 text-xl font-bold shadow-2xs">
            💰
          </div>
        </div>

        {/* ========================================================
            CHANNEL TASK INTERFACE
            ======================================================== */}
        {task.taskType === 'channel' && (
          <div className="space-y-3">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-[#0088cc]" />
                Target Channel: <span className="text-[#0088cc] font-mono">{task.channelId || task.destinationUrl}</span>
              </p>
              <p className="text-slate-500 text-[11px]">
                Step 1: Join the channel using the link below.
                <br />
                Step 2: Return and click &quot;Verify Channel Membership&quot;.
              </p>
            </div>

            <button
              onClick={handleOpenChannel}
              className="w-full py-3 px-4 bg-[#0088cc] hover:bg-[#0077b5] text-white font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-2 text-xs active:scale-98"
            >
              <ExternalLink className="w-4 h-4" /> 1. Join Telegram Channel
            </button>

            <button
              onClick={handleClaim}
              disabled={verifying}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-sm transition flex items-center justify-center gap-2 disabled:opacity-50 text-xs active:scale-98"
            >
              {verifying ? (
                <>
                  <Clock className="w-4 h-4 animate-spin text-white" /> Verifying Membership with Telegram...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" /> 2. Verify Channel Membership & Claim
                </>
              )}
            </button>
          </div>
        )}

        {/* ========================================================
            VIDEO / WEBSITE TASK INTERFACE
            ======================================================== */}
        {(task.taskType === 'video' || task.taskType === 'website') && (
          <div className="space-y-4">
            {started && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-600">
                    {secondsRemaining > 0
                      ? `${task.taskType === 'video' ? 'Watching' : 'Visiting'} in progress...`
                      : 'Observation complete!'}
                  </span>
                  <span className="text-[#0088cc] font-bold">{progressPercent}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#0088cc] to-[#24a1de] transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {!started ? (
              <button
                onClick={handleStartTimedTask}
                disabled={loading}
                className="w-full py-3.5 px-4 tg-btn-primary font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 text-xs active:scale-98"
              >
                <ExternalLink className="w-4 h-4" /> Open Link & Start {task.timerSeconds}s {task.taskType === 'video' ? 'Watch' : 'Visit'}
              </button>
            ) : secondsRemaining > 0 ? (
              <button
                disabled
                className="w-full py-3.5 px-4 bg-slate-100 border border-slate-200 text-slate-500 font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-wait text-xs"
              >
                <Clock className="w-4 h-4 animate-spin text-amber-500" /> Wait {secondsRemaining} seconds...
              </button>
            ) : (
              <button
                onClick={handleClaim}
                disabled={verifying}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition flex items-center justify-center gap-2 text-xs active:scale-98"
              >
                {verifying ? (
                  'Claiming...'
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Claim +₹{task.rewardAmount.toFixed(2)} Now!
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* ========================================================
            SOCIAL TASK INTERFACE
            ======================================================== */}
        {task.taskType === 'social' && (
          <div className="space-y-3">
            <button
              onClick={handleOpenSocial}
              className="w-full py-3 px-4 bg-[#0088cc] hover:bg-[#0077b5] text-white font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-2 text-xs active:scale-98"
            >
              <ExternalLink className="w-4 h-4" /> 1. Open {task.socialPlatform || 'Social'} Target Link
            </button>

            {/* Verification specific field */}
            {task.verificationMethod === 'code_confirmation' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Secret Verification Code (from post/description)
                </label>
                <input
                  type="text"
                  placeholder="Enter secret code..."
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-mono focus:bg-white focus:border-[#0088cc] focus:outline-none"
                />
              </div>
            )}

            {task.verificationMethod === 'manual_review' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Your Social Handle / Username
                </label>
                <input
                  type="text"
                  placeholder="e.g. @myusername or profile link"
                  value={socialHandle}
                  onChange={(e) => setSocialHandle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs focus:bg-white focus:border-[#0088cc] focus:outline-none"
                />
              </div>
            )}

            {task.verificationMethod === 'timer' && task.timerSeconds > 0 && started && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Engagement timer</span>
                  <span className="text-[#0088cc] font-bold">{secondsRemaining}s left</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0088cc] transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {!task.verificationMethod && (
              <label className="flex items-start gap-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={actionConfirmed}
                  onChange={(e) => setActionConfirmed(e.target.checked)}
                  className="mt-0.5 rounded text-[#0088cc] focus:ring-0"
                />
                <span>I have completed the follow / like / subscribe action on {task.socialPlatform || 'the social page'}.</span>
              </label>
            )}

            <button
              onClick={handleClaim}
              disabled={verifying}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 text-xs active:scale-98"
            >
              {verifying ? (
                <>
                  <Clock className="w-4 h-4 animate-spin text-white" /> Verifying...
                </>
              ) : task.verificationMethod === 'manual_review' ? (
                'Submit for Admin Review'
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> 2. Verify & Claim +₹{task.rewardAmount.toFixed(2)}
                </>
              )}
            </button>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400 mt-4">
          Anti-cheat active: Task completions are verified by server-authoritative checks.
        </p>
      </div>
    </div>
  );
};
