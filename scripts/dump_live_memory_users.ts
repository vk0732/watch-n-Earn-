import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
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

async function dumpLiveUsers() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('No TELEGRAM_BOT_TOKEN found');
    process.exit(1);
  }

  const adminTelegramId = 2022247489;
  const initData = generateValidInitData(adminTelegramId, 'AdminUser', botToken);

  console.log('--- FETCHING DASHBOARD STATS FROM LIVE SERVER ---');
  const dashRes = await fetch('http://127.0.0.1:3002/api/admin/dashboard', {
    headers: { 'x-telegram-init-data': initData },
  });
  const dash = (await dashRes.json()) as any;
  console.log('Target totalUsers according to dashboard:', dash.stats?.totalUsers);

  console.log('--- EXTRACTING ALL LIVE USERS VIA FILTERED QUERIES ---');
  const userMap = new Map<string, any>();

  // Query each digit 0-9 to collect all users
  const queries = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'e', 'i', 'o', 'u'];

  for (const q of queries) {
    try {
      const res = await fetch(`http://127.0.0.1:3002/api/admin/users?q=${encodeURIComponent(q)}`, {
        headers: { 'x-telegram-init-data': initData },
      });
      const data = (await res.json()) as any;
      if (Array.isArray(data.users)) {
        for (const u of data.users) {
          userMap.set(String(u.id), u);
        }
      }
    } catch (err: any) {
      console.warn(`Query ${q} error:`, err.message);
    }
  }

  console.log(`Total unique live users harvested: ${userMap.size} (out of expected ${dash.stats?.totalUsers})`);

  const allLiveUsers = Array.from(userMap.values());
  const backupPath = path.join('/opt/watchxearn-clone/backups', `live_full_users_dump_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(allLiveUsers, null, 2), { mode: 0o600 });
  console.log(`✓ Saved complete live users dump to: ${backupPath}`);

  // Also check if we can save them directly into data/authoritative_users.json
  const dataDir = path.join('/opt/watchxearn-clone', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const authUsersPath = path.join(dataDir, 'authoritative_users.json');
  fs.writeFileSync(authUsersPath, JSON.stringify(allLiveUsers, null, 2), { mode: 0o600 });
  console.log(`✓ Saved to authoritative persistent store: ${authUsersPath}`);
}

dumpLiveUsers().catch(console.error);
