import { handleTelegramBotUpdate } from '../server/bot.ts';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const userId = 2022247489;
  const appUrl = process.env.APP_URL || 'http://178.93.119.55:3002';

  console.log(`Sending live /start command for user ${userId} with appUrl ${appUrl}...`);
  await handleTelegramBotUpdate(
    {
      update_id: 999999,
      message: {
        message_id: 99999,
        from: {
          id: userId,
          first_name: 'VK SUPERTECH',
          username: 'vksupertechofficial',
        },
        chat: { id: userId, type: 'private' },
        text: '/start',
      },
    },
    appUrl
  );
  console.log('✅ handleTelegramBotUpdate completed!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
