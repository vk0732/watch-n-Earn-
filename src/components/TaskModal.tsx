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
  CheckSquare,
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
        colors: ['#10b981', '#3b82f6', '#f59e0b'],
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
        return <PlayCircle className="w-3.5 h-3.5 text-red-400" />;
      case 'website':
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
      case 'channel':
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />;
      case 'social':
        return <Share2 className="w-3.5 h-3.5 text-pink-400" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Task Type Header Badge */}
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold rounded-lg uppercase tracking-wider">
            {getBadgeIcon()} {task.taskType}
          </span>
          {task.taskType === 'channel' ? (
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" /> Telegram Membership Verification
            </span>
          ) : task.timerSeconds > 0 ? (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {task.timerSeconds}s Watch Time
            </span>
          ) : null}
        </div>

        <h3 className="text-xl font-bold text-white mb-2">{task.title}</h3>
        <p className="text-sm text-slate-300 mb-5 leading-relaxed">{task.description}</p>

        {/* Error Notification */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/70 border border-red-500/30 text-red-300 rounded-xl text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {/* Info Message */}
        {infoMessage && (
          <div className="mb-4 p-3 bg-blue-950/70 border border-blue-500/30 text-blue-300 rounded-xl text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Reward preview box */}
        <div className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl mb-5 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 uppercase font-semibold">Completion Reward</span>
            <p className="text-2xl font-extrabold text-emerald-400">+₹{task.rewardAmount.toFixed(2)}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl font-bold">
            💰
          </div>
        </div>

        {/* ========================================================
            CHANNEL TASK INTERFACE
            ======================================================== */}
        {task.taskType === 'channel' && (
          <div className="space-y-3">
            <div className="p-3 bg-slate-800/60 border border-slate-700 rounded-xl text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-white flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                Target Channel: <span className="text-emerald-400 font-mono">{task.channelId || task.destinationUrl}</span>
              </p>
              <p className="text-slate-400 text-[11px]">
                Step 1: Join the channel using the link below.
                <br />
                Step 2: Return and click &quot;Verify Channel Membership&quot;.
              </p>
            </div>

            <button
              onClick={handleOpenChannel}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-xs"
            >
              <ExternalLink className="w-4 h-4" /> 1. Join Telegram Channel
            </button>

            <button
              onClick={handleClaim}
              disabled={verifying}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-extrabold rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            >
              {verifying ? (
                <>
                  <Clock className="w-4 h-4 animate-spin text-slate-950" /> Verifying Membership with Telegram...
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
                  <span className="text-slate-400">
                    {secondsRemaining > 0
                      ? `${task.taskType === 'video' ? 'Watching' : 'Visiting'} in progress...`
                      : 'Observation complete!'}
                  </span>
                  <span className="text-emerald-400 font-bold">{progressPercent}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {!started ? (
              <button
                onClick={handleStartTimedTask}
                disabled={loading}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
              >
                <ExternalLink className="w-4 h-4" /> Open Link & Start {task.timerSeconds}s {task.taskType === 'video' ? 'Watch' : 'Visit'}
              </button>
            ) : secondsRemaining > 0 ? (
              <button
                disabled
                className="w-full py-3.5 px-4 bg-slate-800 border border-slate-700 text-slate-400 font-bold rounded-xl transition flex items-center justify-center gap-2 cursor-wait text-sm"
              >
                <Clock className="w-4 h-4 animate-spin text-amber-400" /> Wait {secondsRemaining} seconds...
              </button>
            ) : (
              <button
                onClick={handleClaim}
                disabled={verifying}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-extrabold rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2 animate-bounce text-sm"
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
              className="w-full py-3 px-4 bg-pink-600 hover:bg-pink-500 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-xs"
            >
              <ExternalLink className="w-4 h-4" /> 1. Open {task.socialPlatform || 'Social'} Target Link
            </button>

            {/* Verification specific field */}
            {task.verificationMethod === 'code_confirmation' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Secret Verification Code (from post/description)
                </label>
                <input
                  type="text"
                  placeholder="Enter secret code..."
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
                />
              </div>
            )}

            {task.verificationMethod === 'manual_review' && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-300">
                  Your Social Handle / Username
                </label>
                <input
                  type="text"
                  placeholder="e.g. @myusername or profile link"
                  value={socialHandle}
                  onChange={(e) => setSocialHandle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                />
              </div>
            )}

            {task.verificationMethod === 'timer' && task.timerSeconds > 0 && started && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Engagement timer</span>
                  <span className="text-pink-400 font-bold">{secondsRemaining}s left</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className="h-full bg-pink-500 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {!task.verificationMethod && (
              <label className="flex items-start gap-2.5 p-2.5 bg-slate-800/60 border border-slate-700 rounded-xl cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={actionConfirmed}
                  onChange={(e) => setActionConfirmed(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-500 focus:ring-0"
                />
                <span>I have completed the follow / like / subscribe action on {task.socialPlatform || 'the social page'}.</span>
              </label>
            )}

            <button
              onClick={handleClaim}
              disabled={verifying}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-extrabold rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            >
              {verifying ? (
                <>
                  <Clock className="w-4 h-4 animate-spin text-slate-950" /> Verifying...
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

        <p className="text-center text-xs text-slate-500 mt-4">
          Anti-cheat active: Task completions are verified by server-authoritative checks.
        </p>
      </div>
    </div>
  );
};
