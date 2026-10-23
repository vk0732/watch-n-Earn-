import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';

function generateValidInitData(telegramId: number, username: string, botToken: string): string {
  const userObj = {
    id: telegramId,
    first_name: 'Admin',
    last_name: 'User',
    username,
    language_code: 'en',
    allows_write_to_pm: true,
  };
  const authDate = Math.floor(Date.now() / 1000).toString();
  const userJson = JSON.stringify(userObj);

  const params = new URLSearchParams();
  params.set('auth_date', authDate);
  params.set('query_id', 'AAHdF60uAAAAAN0XrS4uI_3x');
  params.set('user', userJson);

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((key) => `${key}=${params.get(key)}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

async function run() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('No TELEGRAM_BOT_TOKEN found');
    process.exit(1);
  }

  const adminTelegramId = 2022247489;
  const initData = generateValidInitData(adminTelegramId, 'AdminUser', botToken);

  console.log('Querying audit report from http://127.0.0.1:3002/api/admin/gift-cards/audit-report ...');
  const res = await fetch('http://127.0.0.1:3002/api/admin/gift-cards/audit-report', {
    headers: {
      'x-telegram-init-data': initData,
    },
  });

  console.log('HTTP Status:', res.status);
  const data = await res.json();
  console.log('Audit Report:', JSON.stringify(data, null, 2));
}

run().catch(console.error);
