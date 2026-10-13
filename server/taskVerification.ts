import { checkTelegramChannelMembership } from './telegram.ts';
import type { Task, UserProfile } from '../src/types/index.ts';

export interface TaskVerificationResult {
  success: boolean;
  error?: string;
  message?: string;
  pendingReview?: boolean;
}

/**
 * CHANNEL TASK VERIFICATION:
 * - Checks that task is channel type
 * - Resolves channel identifier (@username or -100 numeric chat ID)
 * - Checks membership using Telegram Bot API getChatMember
 * - Validates membership status (creator, administrator, member, restricted with is_member=true)
 * - Handles bot permissions and API errors
 * - If not joined: returns "Please join the channel and try again."
 */
export async function verifyChannelTask(
  user: UserProfile,
  task: Task
): Promise<TaskVerificationResult> {
  if (task.taskType !== 'channel') {
    return { success: false, error: 'Task is not a Channel task' };
  }

  // 1. Resolve channel identifier
  let channelIdentifier = (task.channelId || '').trim();

  // If channelId was accidentally filled with a private invite link:
  if (
    channelIdentifier.includes('t.me/+') ||
    channelIdentifier.includes('t.me/joinchat/') ||
    (channelIdentifier.startsWith('+') && !/^\+\d{10,}$/.test(channelIdentifier))
  ) {
    return {
      success: false,
      error:
        'The configured Channel ID is a private invite link. Private channels require a numeric Channel ID (starting with -100) for server verification.',
    };
  }

  // Fallback to destinationUrl only if channelId is not set
  if (!channelIdentifier && task.destinationUrl) {
    const rawUrl = task.destinationUrl.trim();
    if (rawUrl.includes('t.me/+') || rawUrl.includes('t.me/joinchat/')) {
      return {
        success: false,
        error:
          'This private channel task is missing its numeric Channel ID (e.g. -10020877627202664). Please configure the numeric Channel ID in the task settings.',
      };
    }
    if (rawUrl.includes('t.me/')) {
      const parts = rawUrl.split('t.me/')[1]?.split('/')[0]?.split('?')[0]?.replace('+', '');
      if (parts) {
        channelIdentifier = parts.startsWith('@') ? parts : `@${parts}`;
      }
    }
  }

  if (!channelIdentifier) {
    return {
      success: false,
      error: 'Telegram channel username or numeric chat ID is not configured for this task.',
    };
  }

  // 2. Validate user Telegram numeric ID
  if (!user.telegramId || typeof user.telegramId !== 'number') {
    return {
      success: false,
      error: 'Telegram User ID is missing or invalid. Please open the Mini App inside Telegram.',
    };
  }

  // 3. Query Telegram Bot API getChatMember
  const result = await checkTelegramChannelMembership(channelIdentifier, user.telegramId);

  if (!result.isMember) {
    // If user has not joined
    if (
      result.status === 'left' ||
      result.status === 'kicked' ||
      result.status === 'user_not_found'
    ) {
      return {
        success: false,
        error: 'Please join the channel and try again.',
      };
    }

    // Bot not admin / permissions issue
    if (result.status === 'bot_not_admin') {
      return {
        success: false,
        error: result.error || `Bot must be added as an Administrator to verify membership in ${channelIdentifier}.`,
      };
    }

    // Channel not found / invalid identifier
    if (result.status === 'chat_not_found') {
      return {
        success: false,
        error: result.error || `Channel ${channelIdentifier} was not found or is inaccessible.`,
      };
    }

    // Telegram Bot Token missing or API error
    return {
      success: false,
      error: result.error || 'Telegram cannot verify membership at this time. Please try again.',
    };
  }

  return { success: true };
}

/**
 * VIDEO TASK VERIFICATION:
 * - Checks that task is video type
 * - Enforces minimum watch time on server
 * - Rejects if session wasn't started or timer has not elapsed
 */
export async function verifyVideoTask(
  user: UserProfile,
  task: Task,
  sessionStartedAt?: number
): Promise<TaskVerificationResult> {
  if (task.taskType !== 'video') {
    return { success: false, error: 'Task is not a Video task' };
  }

  if (task.timerSeconds > 0) {
    if (!sessionStartedAt) {
      return {
        success: false,
        error: 'Please start watching the video before claiming your reward.',
      };
    }

    const elapsedSeconds = (Date.now() - sessionStartedAt) / 1000;
    if (elapsedSeconds < task.timerSeconds - 1) {
      const remaining = Math.ceil(task.timerSeconds - elapsedSeconds);
      return {
        success: false,
        error: `Please complete the required ${task.timerSeconds}s watch time. ${remaining}s remaining.`,
      };
    }
  }

  return { success: true };
}

/**
 * WEBSITE TASK VERIFICATION:
 * - Checks that task is website type
 * - Enforces minimum visit time on server
 * - Rejects if session wasn't started or timer has not elapsed
 */
export async function verifyWebsiteTask(
  user: UserProfile,
  task: Task,
  sessionStartedAt?: number
): Promise<TaskVerificationResult> {
  if (task.taskType !== 'website') {
    return { success: false, error: 'Task is not a Website task' };
  }

  if (task.timerSeconds > 0) {
    if (!sessionStartedAt) {
      return {
        success: false,
        error: 'Please visit the website before claiming your reward.',
      };
    }

    const elapsedSeconds = (Date.now() - sessionStartedAt) / 1000;
    if (elapsedSeconds < task.timerSeconds - 1) {
      const remaining = Math.ceil(task.timerSeconds - elapsedSeconds);
      return {
        success: false,
        error: `Please stay on the website for ${task.timerSeconds}s. ${remaining}s remaining.`,
      };
    }
  }

  return { success: true };
}

/**
 * SOCIAL TASK VERIFICATION:
 * - Checks that task is social type
 * - Does NOT automatically assume follow/like was completed
 * - Supports verification methods:
 *   1. 'code_confirmation': Validates secret verification code from post
 *   2. 'manual_review': Accepts user profile handle and queues for admin review
 *   3. 'timer': Enforces required engagement timer
 *   4. default: Requires explicit user action confirmation with engagement validation
 */
export async function verifySocialTask(
  user: UserProfile,
  task: Task,
  payload?: {
    socialHandle?: string;
    verificationCode?: string;
    confirmedAction?: boolean;
  },
  sessionStartedAt?: number
): Promise<TaskVerificationResult> {
  if (task.taskType !== 'social') {
    return { success: false, error: 'Task is not a Social task' };
  }

  // Method 1: Secret verification code
  if (task.verificationMethod === 'code_confirmation') {
    const code = (payload?.verificationCode || '').trim();
    if (!code) {
      return {
        success: false,
        error: 'Secret verification code is required. Please check the post/video description for the code.',
      };
    }

    const expected = (task.verificationCode || '').trim();
    if (expected && code.toLowerCase() !== expected.toLowerCase()) {
      return {
        success: false,
        error: 'Incorrect verification code. Please check the post and try again.',
      };
    }

    return { success: true };
  }

  // Method 2: Manual review
  if (task.verificationMethod === 'manual_review') {
    const handle = (payload?.socialHandle || '').trim();
    if (!handle) {
      return {
        success: false,
        error: 'Please provide your social handle or username so our team can verify your action.',
      };
    }

    return {
      success: true,
      pendingReview: true,
      message: 'Submission received! Your social task has been submitted for manual admin review.',
    };
  }

  // Method 3: Timer-based engagement
  if (task.verificationMethod === 'timer' && task.timerSeconds > 0) {
    if (!sessionStartedAt) {
      return {
        success: false,
        error: 'Please open the social link and complete the required engagement time before claiming.',
      };
    }

    const elapsedSeconds = (Date.now() - sessionStartedAt) / 1000;
    if (elapsedSeconds < task.timerSeconds - 1) {
      const remaining = Math.ceil(task.timerSeconds - elapsedSeconds);
      return {
        success: false,
        error: `Please engage with the page for ${task.timerSeconds}s. ${remaining}s remaining.`,
      };
    }

    return { success: true };
  }

  // Method 4: Action Confirmation with engagement validation
  if (!payload?.confirmedAction) {
    return {
      success: false,
      error: 'Please complete the social follow/like and confirm your action before claiming.',
    };
  }

  if (task.timerSeconds > 0 && sessionStartedAt) {
    const elapsedSeconds = (Date.now() - sessionStartedAt) / 1000;
    if (elapsedSeconds < Math.min(2, task.timerSeconds)) {
      return {
        success: false,
        error: 'Please open the link and complete the action before confirming.',
      };
    }
  }

  return { success: true };
}
