import type { UserProfile, BroadcastTask, BroadcastPreview } from '../src/types/index.ts';
import { searchUsers, recordAdminAudit } from './db.ts';

// In-memory store for broadcast jobs
const activeBroadcasts = new Map<string, BroadcastTask>();
let latestBroadcastId: string | null = null;

// Lock to prevent concurrent overlapping broadcasts
let isBroadcastRunning = false;

/**
 * Returns eligible bot users (active, not banned, valid telegramId)
 */
export async function getBroadcastEligibleUsers(): Promise<UserProfile[]> {
  const users = await searchUsers();
  return users.filter((u) => !u.isBanned && u.telegramId && typeof u.telegramId === 'number' && u.telegramId > 0);
}

/**
 * Get preview of recipient count
 */
export async function getBroadcastPreview(): Promise<BroadcastPreview> {
  const eligible = await getBroadcastEligibleUsers();
  return {
    recipientCount: eligible.length,
  };
}

/**
 * Get status of a specific broadcast job
 */
export function getBroadcastStatus(broadcastId: string): BroadcastTask | null {
  return activeBroadcasts.get(broadcastId) || null;
}

/**
 * Get status of the latest broadcast job
 */
export function getLatestBroadcast(): BroadcastTask | null {
  if (!latestBroadcastId) return null;
  return activeBroadcasts.get(latestBroadcastId) || null;
}

/**
 * Cancel a running broadcast
 */
export function cancelBroadcast(broadcastId: string): boolean {
  const job = activeBroadcasts.get(broadcastId);
  if (job && job.status === 'in_progress') {
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    isBroadcastRunning = false;
    return true;
  }
  return false;
}

/**
 * Start background broadcast to all eligible bot users
 */
export async function startBroadcast(
  adminId: string,
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'HTML'
): Promise<BroadcastTask> {
  if (isBroadcastRunning) {
    throw new Error('A broadcast is already in progress. Please wait for it to complete or cancel it.');
  }

  const trimmedMsg = (message || '').trim();
  if (!trimmedMsg) {
    throw new Error('Broadcast message text cannot be empty.');
  }

  const eligibleUsers = await getBroadcastEligibleUsers();
  if (eligibleUsers.length === 0) {
    throw new Error('No eligible bot users found to receive broadcast.');
  }

  const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const task: BroadcastTask = {
    id: broadcastId,
    adminId,
    message: trimmedMsg,
    parseMode,
    totalRecipients: eligibleUsers.length,
    sentCount: 0,
    failedCount: 0,
    blockedCount: 0,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
  };

  activeBroadcasts.set(broadcastId, task);
  latestBroadcastId = broadcastId;
  isBroadcastRunning = true;

  // Execute in background
  executeBroadcastQueue(task, eligibleUsers).catch((err) => {
    console.error(`[Broadcast ${broadcastId}] Unexpected error:`, err);
    task.status = 'failed';
    task.errorMessage = err.message || 'Broadcast failed unexpectedly';
    task.completedAt = new Date().toISOString();
    isBroadcastRunning = false;
  });

  return task;
}

/**
 * Background worker executing controlled, rate-limited delivery
 */
async function executeBroadcastQueue(task: BroadcastTask, recipients: UserProfile[]) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const isMockToken = !token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ');
  const processedTelegramIds = new Set<number>();

  console.log(`[Broadcast ${task.id}] Starting delivery to ${recipients.length} recipients...`);

  for (let i = 0; i < recipients.length; i++) {
    // Check if cancelled
    if (task.status === 'cancelled') {
      console.log(`[Broadcast ${task.id}] Broadcast was cancelled by admin.`);
      break;
    }

    const recipient = recipients[i];
    const tgId = recipient.telegramId;

    // Deduplicate against duplicate IDs
    if (processedTelegramIds.has(tgId)) {
      continue;
    }
    processedTelegramIds.add(tgId);

    // Mock mode
    if (isMockToken) {
      task.sentCount++;
      // Controlled pacing even in mock mode
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }

    // Live Telegram Bot API delivery
    let delivered = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!delivered && attempts < maxAttempts) {
      attempts++;
      try {
        const payload: any = {
          chat_id: tgId,
          text: task.message,
        };
        if (task.parseMode !== 'None') {
          payload.parse_mode = task.parseMode;
        }

        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(6000),
        });

        const resData = (await res.json()) as any;

        if (resData.ok) {
          task.sentCount++;
          delivered = true;
          break;
        }

        // Handle HTTP 429 Rate Limiting
        if (res.status === 429 || resData.error_code === 429) {
          const retryAfterSec = resData.parameters?.retry_after || 2;
          console.warn(`[Broadcast Rate Limit 429] Waiting ${retryAfterSec}s before retrying recipient ${tgId}...`);
          await new Promise((r) => setTimeout(r, retryAfterSec * 1000 + 100));
          continue; // Retry this recipient
        }

        const desc = (resData.description || '').toLowerCase();

        // Handle user blocked / deactivated / chat not found
        if (
          res.status === 403 ||
          resData.error_code === 403 ||
          desc.includes('bot was blocked by the user') ||
          desc.includes('user is deactivated') ||
          desc.includes('chat not found')
        ) {
          task.blockedCount++;
          delivered = true; // Finished for this recipient
          break;
        }

        // Handle parsing errors by falling back to plain text
        if (desc.includes("can't parse entities") || desc.includes('tag') || desc.includes('parse mode')) {
          try {
            const fallbackRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: tgId, text: task.message }),
              signal: AbortSignal.timeout(6000),
            });
            const fallbackData = (await fallbackRes.json()) as any;
            if (fallbackData.ok) {
              task.sentCount++;
              delivered = true;
              break;
            }
          } catch {
            // fallback failed
          }
        }

        // Any other non-retryable error
        task.failedCount++;
        delivered = true;
        break;
      } catch (err: any) {
        if (attempts >= maxAttempts) {
          task.failedCount++;
          delivered = true;
        } else {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    // Rate limiter pace: 40ms interval ensures ~25 msgs/sec max (under Telegram's 30/sec limit)
    await new Promise((r) => setTimeout(r, 40));
  }

  if (task.status !== 'cancelled') {
    task.status = 'completed';
  }
  task.completedAt = new Date().toISOString();
  isBroadcastRunning = false;

  console.log(
    `[Broadcast ${task.id}] Completed. Sent: ${task.sentCount}, Blocked: ${task.blockedCount}, Failed: ${task.failedCount}`
  );

  // Record admin audit log
  await recordAdminAudit(
    task.adminId,
    'BROADCAST_MESSAGE',
    `Broadcast ${task.id} ${task.status}: Sent ${task.sentCount}, Blocked ${task.blockedCount}, Failed ${task.failedCount} out of ${task.totalRecipients} recipients.`
  ).catch((err) => console.warn('[Broadcast Audit Log Error]:', err));
}
