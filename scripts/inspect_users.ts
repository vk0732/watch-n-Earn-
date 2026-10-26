import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

async function inspect() {
  console.log('=== INSPECTING ALL BACKUPS AND LOCAL STORES FOR USERS ===');

  const files = [
    '/opt/watchxearn-clone/backups/production_backup_1792147955860.json',
    '/opt/watchxearn-clone/backups/complete_state_snapshot_1792763463963.json',
    '/opt/watchxearn-clone/backups/live_memory_backup_2026-10-23T13-46-09-800Z.json',
    '/opt/watchxearn-clone/backups/live_memory_backup_2026-10-23T14-36-50-079Z.json',
    '/opt/watchxearn-clone/backups/production_full_dump_1792763504790.json',
    '/opt/watchxearn-clone/data/authoritative_store.json',
    '/opt/watchxearn-clone/data/gv_authoritative_registry.json',
  ];

  const uniqueTelegramIds = new Set<string | number>();
  const uniqueUserIds = new Set<string>();

  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log(`[FILE MISSING] ${f}`);
      continue;
    }
    const stat = fs.statSync(f);
    if (stat.size <= 10) {
      console.log(`[FILE EMPTY] ${path.basename(f)} (${stat.size} bytes)`);
      continue;
    }

    try {
      const content = fs.readFileSync(f, 'utf-8');
      const data = JSON.parse(content);

      let usersList: any[] = [];
      if (Array.isArray(data.users)) {
        usersList = data.users;
      } else if (data.collections && Array.isArray(data.collections.users)) {
        usersList = data.collections.users;
      } else if (data.collections && typeof data.collections.users === 'object') {
        usersList = Object.values(data.collections.users);
      }

      console.log(`[${path.basename(f)}] Size: ${stat.size} bytes | Keys: ${Object.keys(data).join(', ')} | Users array length: ${usersList.length}`);

      if (data.dashboard && data.dashboard.stats) {
        console.log(`   Dashboard stats in backup: totalUsers=${data.dashboard.stats.totalUsers}, activeToday=${data.dashboard.stats.activeUsersToday}`);
      }
      if (data.stats) {
        console.log(`   Stats object: ${JSON.stringify(data.stats)}`);
      }

      for (const u of usersList) {
        if (u.id) uniqueUserIds.add(String(u.id));
        if (u.telegramId) uniqueTelegramIds.add(String(u.telegramId));
      }
    } catch (e: any) {
      console.error(`[ERROR] Parsing ${f}:`, e.message);
    }
  }

  console.log('\n--- CUMULATIVE UNIQUE USERS ACROSS ALL BACKUPS ---');
  console.log(`Unique user IDs: ${uniqueUserIds.size}`);
  console.log(`Unique telegram IDs: ${uniqueTelegramIds.size}`);

  // Now check the live server at port 3002
  console.log('\n--- QUERYING LIVE PROCESS AT PORT 3002 ---');
  try {
    const crypto = await import('crypto');
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const adminTelegramId = 2022247489;
    const userObj = {
      id: adminTelegramId,
      first_name: 'Admin',
      last_name: 'User',
      username: 'AdminUser',
      language_code: 'en',
      allows_write_to_pm: true,
    };
    const authDate = Math.floor(Date.now() / 1000).toString();
    const params = new URLSearchParams();
    params.set('auth_date', authDate);
    params.set('query_id', 'AAHdF60uAAAAAN0XrS4uI_3x');
    params.set('user', JSON.stringify(userObj));
    const keys = Array.from(params.keys()).sort();
    const dataCheckString = keys.map((key) => `${key}=${params.get(key)}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.set('hash', hash);

    const res = await fetch('http://127.0.0.1:3002/api/admin/dashboard', {
      headers: { 'x-telegram-init-data': params.toString() },
    });
    console.log(`Live Dashboard HTTP status: ${res.status}`);
    const dashData: any = await res.json();
    console.log('Live Dashboard Stats:', JSON.stringify(dashData.stats, null, 2));
  } catch (err: any) {
    console.error('Error fetching live dashboard:', err.message);
  }
}

inspect().catch(console.error);
