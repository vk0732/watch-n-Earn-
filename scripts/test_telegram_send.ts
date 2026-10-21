import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL || 'http://178.93.119.55:3002';
  const chatId = process.env.PAYOUT_ADMIN_CHAT_ID || '2022247489';

  console.log('Testing Telegram Bot API sendMessage...');
  console.log('App URL:', appUrl);
  console.log('Chat ID:', chatId);

  // 1. Try sending with web_app URL
  const res1 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Test message with web_app button',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Open App', web_app: { url: appUrl } }]
        ]
      }
    })
  });
  const data1 = await res1.json();
  console.log('Response with web_app:', JSON.stringify(data1, null, 2));

  // 2. Try sending simple message without web_app
  const res2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Test message without web_app',
    })
  });
  const data2 = await res2.json();
  console.log('Response without web_app:', JSON.stringify(data2, null, 2));
}

main().catch(console.error);
