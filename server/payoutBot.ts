import { getAppSettings } from './db.ts';
import { sendTelegramMessage } from './telegram.ts';
import type { Withdrawal, UserProfile } from '../src/types/index.ts';


export function maskUsername(name?: string): string {
  if (!name) return 'User***';
  if (name.length <= 3) return `${name[0]}***`;
  return `${name.slice(0, 2)}***${name.slice(-1)}`;
}

/**
 * Send notification to Admin Group/Chat when a new withdrawal is created
 */
export async function notifyAdminNewWithdrawal(withdrawal: Withdrawal, user: UserProfile) {
  const settings = await getAppSettings();
  const adminChat = settings.payoutAdminChatId || process.env.PAYOUT_ADMIN_CHAT_ID;
  if (!adminChat) return;

  const text = `🔔 <b>NEW WITHDRAWAL REQUEST</b>\n\n` +
    `👤 <b>User:</b> ${user.firstName} (@${user.username || 'none'})\n` +
    `🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
    `💰 <b>Amount:</b> <b>₹${withdrawal.amount.toFixed(2)}</b>\n` +
    `💳 <b>Method:</b> <code>Amazon Gift Card</code>\n` +
    `📦 <b>Order ID:</b> <code>${withdrawal.id}</code>\n` +
    `⏰ <b>Requested At:</b> ${new Date(withdrawal.createdAt).toLocaleString()}\n\n` +
    `👉 <i>Log into the Admin Panel to review gift card inventory and redemptions.</i>`;

  const token = settings.payoutBotToken || process.env.PAYOUT_BOT_TOKEN;
  await sendTelegramMessage(adminChat, text, undefined, token);
}

/**
 * Broadcast official payment proof receipt to the public Telegram Payout Channel
 */
export async function broadcastPayoutProof(withdrawal: Withdrawal): Promise<{ success: boolean; messageId?: number }> {
  const settings = await getAppSettings();
  const channel = settings.payoutChannelId || process.env.PAYOUT_CHANNEL_ID;
  if (!channel) return { success: false };

  const template = settings.templates?.payoutProofBroadcast ||
    `💸 <b>NEW CASHBACK PAID!</b>\n\n` +
    `👤 Recipient: {masked_user}\n` +
    `💰 Amount: <b>₹{amount}</b>\n` +
    `💳 Reward: <b>Amazon Gift Card</b>\n` +
    `🆔 Order ID: <code>{order_id}</code>\n` +
    `⚡ Status: <b>SUCCESS (Instant Delivery)</b>\n\n` +
    `🤖 <i>Earn daily with TeleEarn Bot!</i>`;

  const maskedUser = maskUsername(withdrawal.username);
  const rewardMethod = 'Amazon Gift Card';

  const messageText = template
    .replace('{masked_user}', maskedUser)
    .replace('{amount}', withdrawal.amount.toFixed(2))
    .replace('{masked_upi}', rewardMethod)
    .replace('{order_id}', withdrawal.id)
    .replace('{txn_id}', withdrawal.payoutTransactionId || `PAY-${Date.now().toString().slice(-6)}`);

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🚀 Start Earning Now',
          url: `https://t.me/${settings.botUsername || 'TeleEarnBot'}`,
        },
      ],
    ],
  };

  const token = settings.payoutBotToken || process.env.PAYOUT_BOT_TOKEN;
  const res = await sendTelegramMessage(channel, messageText, keyboard, token);
  return { success: res.success };
}

/**
 * Send private message to the user informing them of their withdrawal approval or rejection
 */
export async function notifyUserWithdrawalResult(
  withdrawal: Withdrawal,
  result: 'approved' | 'rejected' | boolean,
  reason?: string
) {
  const isApproved = result === 'approved' || result === true;
  const settings = await getAppSettings();
  if (isApproved) {
    const code = withdrawal.giftCardCode || 'Code Assigned';
    const text = `🎉 <b>AMAZON GIFT CARD CODE DELIVERED!</b>\n\n` +
      `Your <b>₹${withdrawal.amount.toFixed(2)}</b> Amazon Gift Card code is:\n` +
      `<code>${code}</code>\n\n` +
      `📦 <b>Order ID:</b> <code>${withdrawal.id}</code>\n` +
      `💡 <b>How to Redeem:</b> Open Amazon App → Amazon Pay → Add Gift Card → Paste code.\n\n` +
      `Thank you for using TeleEarn! Keep completing tasks to earn more.`;
    await sendTelegramMessage(withdrawal.userTelegramId, text);
  } else {
    const text = `⚠️ <b>Withdrawal Request Rejected & Refunded</b>\n\n` +
      `Your withdrawal request for <b>₹${withdrawal.amount.toFixed(2)}</b> (Order: <code>${withdrawal.id}</code>) could not be processed.\n\n` +
      `<b>Reason:</b> ${reason || 'Administrator review'}\n` +
      `💰 <b>Refund:</b> ₹${withdrawal.amount.toFixed(2)} has been safely credited back to your balance.`;
    await sendTelegramMessage(withdrawal.userTelegramId, text);
  }
}
