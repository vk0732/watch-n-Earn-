import fs from 'node:fs';
import path from 'node:path';
import type { UserProfile, BroadcastTask, BroadcastPreview } from '../src/types/index.ts';
import { getAllUsers, recordAdminAudit } from './db.ts';

// In-memory store for broadcast jobs
const activeBroadcasts = new Map<string, BroadcastTask>();
let latestBroadcastId: string | null = null;

// Lock to prevent concurrent overlapping broadcasts
let isBroadcastRunning = false;

export const BROADCAST_BATCH_SIZE = 25;

export interface BroadcastStartOptions {
  /** Optional explicit subset of Telegram IDs for small-group testing before a full broadcast */
  targetTelegramIds?: number[];
  /** Optional custom fetch implementation for isolated automated testing */
  customFetch?: typeof fetch;
  /** Optional override for per-message pacing in milliseconds (defaults to 38ms in live mode, 1ms in mock mode) */
  pacingMs?: number;
  /** Optional override for HTTP 429 wait multiplier in tests */
  rateLimitDelayMultiplierMs?: number;
}

function resolveValidTelegramId(u: Partial<UserProfile> | null | undefined): number | null {
  if (!u) return null;
  const direct = Number(u.telegramId);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }
  const rawId = String(u.id || '').replace(/^user_/, '');
  const fromId = Number(rawId);
  if (Number.isInteger(fromId) && fromId > 0) {
    return fromId;
  }
  return null;
}

/**
 * Loads the complete registered user snapshot without any hardcoded limit.
 * Reconciles in-memory users with disk registries (authoritative_users.json and authoritative_store.json)
 * so zero registered users are ever missed, and deduplicates by numeric Telegram ID.
 */
export async function getBroadcastUserSnapshot(): Promise<{
  totalRegisteredUsers: number;
  eligibleUsers: UserProfile[];
  excludedCount: number;
}> {
  const memUsers = await getAllUsers();
  const seenUserIds = new Set<string>();
  const seenTelegramIds = new Set<number>();
  const combinedUsers: UserProfile[] = [];

  for (const u of memUsers) {
    if (!u) continue;
    if (u.id) seenUserIds.add(String(u.id));
    const tgId = resolveValidTelegramId(u);
    if (tgId !== null) seenTelegramIds.add(tgId);
    combinedUsers.push(u);
  }

  // Merge any users present in on-disk authoritative registries that were not yet in memUsers
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const authUsersPath = path.join(dataDir, 'authoritative_users.json');
    if (fs.existsSync(authUsersPath)) {
      const raw = fs.readFileSync(authUsersPath, 'utf-8');
      const diskUsers = JSON.parse(raw);
      if (Array.isArray(diskUsers)) {
        for (const u of diskUsers) {
          if (!u) continue;
          const uid = String(u.id || '');
          const tgId = resolveValidTelegramId(u);
          if ((uid && seenUserIds.has(uid)) || (tgId !== null && seenTelegramIds.has(tgId))) {
            continue;
          }
          if (uid) seenUserIds.add(uid);
          if (tgId !== null) seenTelegramIds.add(tgId);
          combinedUsers.push(u);
        }
      }
    }

    const authStorePath = path.join(dataDir, 'authoritative_store.json');
    if (fs.existsSync(authStorePath)) {
      const rawStore = fs.readFileSync(authStorePath, 'utf-8');
      const store = JSON.parse(rawStore);
      if (store && Array.isArray(store.users)) {
        for (const u of store.users) {
          if (!u) continue;
          const uid = String(u.id || '');
          const tgId = resolveValidTelegramId(u);
          if ((uid && seenUserIds.has(uid)) || (tgId !== null && seenTelegramIds.has(tgId))) {
            continue;
          }
          if (uid) seenUserIds.add(uid);
          if (tgId !== null) seenTelegramIds.add(tgId);
          combinedUsers.push(u);
        }
      }
    }
  } catch (err) {
    console.warn('[Broadcast] Disk user registry merge warning:', err);
  }

  const eligibleByTelegramId = new Map<number, UserProfile>();
  const allUniqueTelegramIds = new Set<number>();

  for (const u of combinedUsers) {
    const tgId = resolveValidTelegramId(u);
    if (tgId !== null) {
      allUniqueTelegramIds.add(tgId);
    }
    if (!u.isBanned && tgId !== null && !eligibleByTelegramId.has(tgId)) {
      eligibleByTelegramId.set(tgId, {
        ...u,
        telegramId: tgId,
      });
    }
  }

  const eligibleUsers = Array.from(eligibleByTelegramId.values());
  const totalRegisteredUsers = Math.max(allUniqueTelegramIds.size, eligibleUsers.length);
  const excludedCount = Math.max(0, totalRegisteredUsers - eligibleUsers.length);

  return {
    totalRegisteredUsers,
    eligibleUsers,
    excludedCount,
  };
}

/**
 * Returns ALL eligible bot users (active, not banned, valid numeric telegramId, deduplicated)
 * with no 50-user cap.
 */
export async function getBroadcastEligibleUsers(): Promise<UserProfile[]> {
  const snapshot = await getBroadcastUserSnapshot();
  return snapshot.eligibleUsers;
}

/**
 * Get preview of total registered users and eligible recipient count
 */
export async function getBroadcastPreview(): Promise<BroadcastPreview> {
  const snapshot = await getBroadcastUserSnapshot();
  return {
    recipientCount: snapshot.eligibleUsers.length,
    totalRegisteredUsers: snapshot.totalRegisteredUsers,
    excludedCount: snapshot.excludedCount,
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
  if (job && (job.status === 'in_progress' || job.status === 'pending')) {
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    job.durationMs = Math.max(0, Date.now() - new Date(job.startedAt).getTime());
    job.remainingCount = Math.max(0, job.totalRecipients - (job.sentCount + job.failedCount + job.blockedCount));
    isBroadcastRunning = false;
    return true;
  }
  return false;
}

/**
 * Start background broadcast campaign to ALL eligible registered users in one click
 * (or to an explicit small test group if options.targetTelegramIds is provided).
 */
export async function startBroadcast(
  adminId: string,
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'HTML',
  options?: BroadcastStartOptions
): Promise<BroadcastTask> {
  if (isBroadcastRunning) {
    throw new Error('A broadcast is already in progress. Please wait for it to complete or cancel it.');
  }

  const trimmedMsg = (message || '').trim();
  if (!trimmedMsg) {
    throw new Error('Broadcast message text cannot be empty.');
  }

  const normalizedMode: 'HTML' | 'Markdown' | 'None' =
    parseMode === 'HTML' || parseMode === 'Markdown' ? parseMode : 'None';

  const snapshot = await getBroadcastUserSnapshot();
  let targetUsers = snapshot.eligibleUsers;

  if (options?.targetTelegramIds && Array.isArray(options.targetTelegramIds) && options.targetTelegramIds.length > 0) {
    const allowedSet = new Set(
      options.targetTelegramIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    );
    targetUsers = targetUsers.filter((u) => allowedSet.has(Number(u.telegramId)));
  }

  if (targetUsers.length === 0) {
    throw new Error('No eligible bot users found to receive broadcast.');
  }

  const totalBatches = Math.ceil(targetUsers.length / BROADCAST_BATCH_SIZE);
  const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const task: BroadcastTask = {
    id: broadcastId,
    adminId,
    message: trimmedMsg,
    parseMode: normalizedMode,
    totalRegisteredUsers: snapshot.totalRegisteredUsers,
    totalRecipients: targetUsers.length,
    sentCount: 0,
    failedCount: 0,
    blockedCount: 0,
    remainingCount: targetUsers.length,
    totalBatches,
    completedBatches: 0,
    batchSize: BROADCAST_BATCH_SIZE,
    retryCount: 0,
    rateLimitHits: 0,
    durationMs: 0,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
  };

  activeBroadcasts.set(broadcastId, task);
  latestBroadcastId = broadcastId;
  isBroadcastRunning = true;

  // Execute automatic background batch processing
  executeBroadcastQueue(task, targetUsers, options).catch((err) => {
    console.error(`[Broadcast ${broadcastId}] Unexpected error:`, err);
    task.status = 'failed';
    task.errorMessage = err.message || 'Broadcast failed unexpectedly';
    task.completedAt = new Date().toISOString();
    task.durationMs = Math.max(0, Date.now() - new Date(task.startedAt).getTime());
    task.remainingCount = Math.max(0, task.totalRecipients - (task.sentCount + task.failedCount + task.blockedCount));
    isBroadcastRunning = false;
  });

  return task;
}

/**
 * Automatic background batch worker executing controlled, rate-limited delivery across all batches.
 */
async function executeBroadcastQueue(
  task: BroadcastTask,
  recipients: UserProfile[],
  options?: BroadcastStartOptions
) {
  const startTimeMs = Date.now();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const fetchFn = options?.customFetch || fetch;
  const isMockToken = !options?.customFetch && (!token || token.includes('ABCdefGHIjklMNOpqrSTUvwxYZ'));
  const pacingMs =
    typeof options?.pacingMs === 'number' && options.pacingMs >= 0
      ? options.pacingMs
      : isMockToken
      ? 1
      : 38; // ~25 messages/sec (safely below Telegram's 30 msgs/sec global limit)
  const rateLimitMultiplierMs =
    typeof options?.rateLimitDelayMultiplierMs === 'number' && options.rateLimitDelayMultiplierMs >= 0
      ? options.rateLimitDelayMultiplierMs
      : 1000;

  // Deduplicate recipients upfront so totalRecipients & remainingCount are exact
  const uniqueRecipients: UserProfile[] = [];
  const seenIds = new Set<number>();
  for (const r of recipients) {
    const tgId = resolveValidTelegramId(r);
    if (tgId !== null && !seenIds.has(tgId)) {
      seenIds.add(tgId);
      uniqueRecipients.push({ ...r, telegramId: tgId });
    }
  }

  task.totalRecipients = uniqueRecipients.length;
  task.remainingCount = uniqueRecipients.length;
  task.totalBatches = Math.ceil(uniqueRecipients.length / BROADCAST_BATCH_SIZE);

  const processedTelegramIds = new Set<number>();

  console.log(
    `[Broadcast ${task.id}] Starting batch delivery to ${uniqueRecipients.length} recipients across ${task.totalBatches} batch(es) (Registered DB Users: ${task.totalRegisteredUsers})...`
  );

  for (let batchIdx = 0; batchIdx < task.totalBatches; batchIdx++) {
    if ((task.status as string) === 'cancelled') {
      console.log(`[Broadcast ${task.id}] Broadcast was cancelled by admin at batch ${batchIdx + 1}/${task.totalBatches}.`);
      break;
    }

    const batchStart = batchIdx * BROADCAST_BATCH_SIZE;
    const batchRecipients = uniqueRecipients.slice(batchStart, batchStart + BROADCAST_BATCH_SIZE);

    for (let i = 0; i < batchRecipients.length; i++) {
      if ((task.status as string) === 'cancelled') {
        break;
      }

      const recipient = batchRecipients[i];
      const tgId = Number(recipient.telegramId);

      // Strict duplicate prevention per campaign
      if (processedTelegramIds.has(tgId)) {
        continue;
      }
      processedTelegramIds.add(tgId);

      if (isMockToken) {
        task.sentCount++;
        task.remainingCount = Math.max(0, task.totalRecipients - (task.sentCount + task.failedCount + task.blockedCount));
        task.durationMs = Date.now() - startTimeMs;
        if (pacingMs > 0) {
          await new Promise((r) => setTimeout(r, pacingMs));
        }
        continue;
      }

      // Live Telegram Bot API delivery with 429 rate-limit handling, temporary error retries, and format fallback
      let delivered = false;
      let attempts = 0;
      let rateLimitRetries = 0;
      const maxAttempts = 3;
      const maxRateLimitRetries = 5;

      while (!delivered && attempts < maxAttempts) {
        attempts++;
        try {
          const payload: Record<string, any> = {
            chat_id: tgId,
            text: task.message,
          };
          if (task.parseMode === 'HTML' || task.parseMode === 'Markdown') {
            payload.parse_mode = task.parseMode;
          }

          const res = await fetchFn(`https://api.telegram.org/bot${token || 'test_token'}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
          });

          const resData = (await res.json().catch(() => ({}))) as any;

          if (res.ok && resData.ok) {
            task.sentCount++;
            delivered = true;
            break;
          }

          // 1. Handle Telegram API HTTP 429 Too Many Requests
          if (res.status === 429 || resData.error_code === 429) {
            const retryAfterSec =
              Number(resData.parameters?.retry_after) > 0 ? Number(resData.parameters.retry_after) : 2;
            task.rateLimitHits = (task.rateLimitHits || 0) + 1;
            task.retryCount = (task.retryCount || 0) + 1;
            rateLimitRetries++;

            if (rateLimitRetries <= maxRateLimitRetries) {
              // Do not consume normal network retry attempt for a 429 rate-limit pause
              attempts--;
              const waitMs = Math.max(20, retryAfterSec * rateLimitMultiplierMs + (rateLimitMultiplierMs >= 100 ? 100 : 0));
              console.warn(
                `[Broadcast ${task.id} Rate Limit 429] Waiting ${retryAfterSec}s before retrying recipient ${tgId} (retry ${rateLimitRetries}/${maxRateLimitRetries})...`
              );
              await new Promise((r) => setTimeout(r, waitMs));
              continue;
            } else {
              task.failedCount++;
              delivered = true;
              break;
            }
          }

          const desc = String(resData.description || '').toLowerCase();

          // 2. Handle Blocked / Deactivated / Unreachable Users (403 Forbidden or invalid/deactivated chat)
          if (
            res.status === 403 ||
            resData.error_code === 403 ||
            desc.includes('bot was blocked by the user') ||
            desc.includes('user is deactivated') ||
            desc.includes('chat not found') ||
            desc.includes("bot can't initiate conversation") ||
            desc.includes('bot was kicked') ||
            desc.includes('user_id_invalid') ||
            desc.includes('peer_id_invalid') ||
            desc.includes('have no rights to send a message')
          ) {
            task.blockedCount++;
            delivered = true;
            break;
          }

          // 3. Handle temporary server failures (500, 502, 503, 504) with automatic backoff retry
          if (res.status >= 500 || (resData.error_code && resData.error_code >= 500)) {
            if (attempts < maxAttempts) {
              task.retryCount = (task.retryCount || 0) + 1;
              await new Promise((r) => setTimeout(r, Math.min(2000, 300 * attempts)));
              continue;
            } else {
              task.failedCount++;
              delivered = true;
              break;
            }
          }

          // 4. Handle entity parsing errors in HTML/Markdown by falling back to Plain Text
          if (
            task.parseMode !== 'None' &&
            (desc.includes("can't parse entities") ||
              desc.includes('find end of the entity') ||
              desc.includes('tag') ||
              desc.includes('parse mode'))
          ) {
            try {
              const fallbackRes = await fetchFn(`https://api.telegram.org/bot${token || 'test_token'}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: tgId, text: task.message }),
                signal: AbortSignal.timeout(8000),
              });
              const fallbackData = (await fallbackRes.json().catch(() => ({}))) as any;
              if (fallbackRes.ok && fallbackData.ok) {
                task.sentCount++;
                delivered = true;
                break;
              }
            } catch {
              // Fallback also failed
            }
          }

          // 5. Any other permanent 4xx error
          task.failedCount++;
          delivered = true;
          break;
        } catch (err: any) {
          // Network timeout or socket error -> automatic retry with backoff
          if (attempts >= maxAttempts) {
            task.failedCount++;
            delivered = true;
          } else {
            task.retryCount = (task.retryCount || 0) + 1;
            await new Promise((r) => setTimeout(r, Math.min(2000, 300 * attempts)));
          }
        }
      }

      task.remainingCount = Math.max(
        0,
        task.totalRecipients - (task.sentCount + task.failedCount + task.blockedCount)
      );
      task.durationMs = Date.now() - startTimeMs;

      if (pacingMs > 0) {
        await new Promise((r) => setTimeout(r, pacingMs));
      }
    }

    if ((task.status as string) !== 'cancelled') {
      task.completedBatches = batchIdx + 1;
    }

    // Yield between batches so API requests and admin polling stay responsive
    await new Promise((r) => setTimeout(r, 5));
  }

  if ((task.status as string) !== 'cancelled') {
    task.status = 'completed';
    task.remainingCount = 0;
  } else {
    task.remainingCount = Math.max(
      0,
      task.totalRecipients - (task.sentCount + task.failedCount + task.blockedCount)
    );
  }
  task.completedAt = new Date().toISOString();
  task.durationMs = Date.now() - startTimeMs;
  isBroadcastRunning = false;

  console.log(
    `[Broadcast ${task.id}] Finished (${task.status}). Registered Users: ${task.totalRegisteredUsers}, Targeted: ${task.totalRecipients}, Sent: ${task.sentCount}, Blocked: ${task.blockedCount}, Failed: ${task.failedCount}, Remaining: ${task.remainingCount}, Batches: ${task.completedBatches}/${task.totalBatches}, Duration: ${task.durationMs}ms`
  );

  // Record admin audit log
  await recordAdminAudit(
    task.adminId,
    'BROADCAST_MESSAGE',
    `Broadcast ${task.id} ${task.status}: Sent ${task.sentCount}, Blocked ${task.blockedCount}, Failed ${task.failedCount}, Remaining ${task.remainingCount} out of ${task.totalRecipients} eligible recipients (${task.totalRegisteredUsers} total registered users).`
  ).catch((err) => console.warn('[Broadcast Audit Log Error]:', err));
}
