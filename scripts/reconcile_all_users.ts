import fs from 'fs';
import path from 'path';

interface MinimalUser {
  id: string;
  telegramId?: number;
  username?: string;
  firstName?: string;
  balance?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

async function reconcile() {
  console.log('=== RECONCILING ALL HISTORICAL USERS FROM ALL BACKUPS ===');

  const liveUsersFile = '/opt/watchxearn-clone/data/authoritative_users.json';
  const oldBackupFile = '/opt/watchxearn-clone/backups/production_backup_1792147955860.json';
  const dumpFile = '/opt/watchxearn-clone/backups/production_full_dump_1792763504790.json';

  const userMap = new Map<string, MinimalUser>();
  const telegramIdMap = new Map<number, string>();

  function registerUser(u: any, source: string) {
    if (!u || (!u.id && !u.telegramId)) return;
    const id = String(u.id || `user_${u.telegramId}`);
    const tgId = u.telegramId ? Number(u.telegramId) : undefined;

    // Check if user already exists
    const existing = userMap.get(id) || (tgId && telegramIdMap.has(tgId) ? userMap.get(telegramIdMap.get(tgId)!) : undefined);

    if (existing) {
      // Merge properties safely, keeping the most complete profile
      if (!existing.telegramId && tgId) existing.telegramId = tgId;
      if (!existing.username && u.username) existing.username = u.username;
      if (!existing.firstName && u.firstName) existing.firstName = u.firstName;
      if (u.balance !== undefined && (existing.balance === undefined || existing.balance === 0)) {
        existing.balance = u.balance;
      }
      if (!existing.createdAt && u.createdAt) existing.createdAt = u.createdAt;
      return;
    }

    const cleanUser: MinimalUser = {
      ...u,
      id,
      telegramId: tgId,
      username: u.username || '',
      firstName: u.firstName || 'User',
      balance: typeof u.balance === 'number' ? u.balance : 0,
      lifetimeEarnings: typeof u.lifetimeEarnings === 'number' ? u.lifetimeEarnings : (typeof u.totalEarned === 'number' ? u.totalEarned : 0),
      referralEarnings: typeof u.referralEarnings === 'number' ? u.referralEarnings : 0,
      referralCode: u.referralCode || `ref_${id}`,
      referralCount: typeof u.referralCount === 'number' ? u.referralCount : 0,
      completedTaskIds: Array.isArray(u.completedTaskIds) ? u.completedTaskIds : [],
      dailyStreak: typeof u.dailyStreak === 'number' ? u.dailyStreak : 0,
      lastDailyCheckIn: u.lastDailyCheckIn || '',
      signupBonusClaimed: Boolean(u.signupBonusClaimed),
      pendingSignupBonus: typeof u.pendingSignupBonus === 'number' ? u.pendingSignupBonus : 0,
      isBanned: Boolean(u.isBanned),
      createdAt: u.createdAt || new Date().toISOString(),
      updatedAt: u.updatedAt || new Date().toISOString(),
    };

    userMap.set(id, cleanUser);
    if (tgId) telegramIdMap.set(tgId, id);
  }

  // 1. Load Live Users (1090 harvested users)
  if (fs.existsSync(liveUsersFile)) {
    const live = JSON.parse(fs.readFileSync(liveUsersFile, 'utf-8'));
    console.log(`Loaded ${live.length} live users from authoritative_users.json`);
    for (const u of live) registerUser(u, 'live');
  }

  // 2. Load Old Oct 21 Backup (237 users)
  if (fs.existsSync(oldBackupFile)) {
    const old = JSON.parse(fs.readFileSync(oldBackupFile, 'utf-8'));
    const oldUsers = old.collections?.users ? Object.values(old.collections.users) : [];
    console.log(`Loaded ${oldUsers.length} users from production_backup_1792147955860.json`);
    for (const u of oldUsers) registerUser(u, 'oct21_backup');
  }

  // 3. Load Oct 23 Full Dump (50 users)
  if (fs.existsSync(dumpFile)) {
    const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf-8'));
    const dumpUsers = Array.isArray(dump.users) ? dump.users : [];
    console.log(`Loaded ${dumpUsers.length} users from production_full_dump_1792763504790.json`);
    for (const u of dumpUsers) registerUser(u, 'oct23_dump');
  }

  console.log(`\nTOTAL RECONCILED AUTHORITATIVE USERS: ${userMap.size}`);
  console.log(`TOTAL UNIQUE TELEGRAM IDS: ${telegramIdMap.size}`);

  const reconciledList = Array.from(userMap.values());

  // Save the master authoritative users list
  const masterFile = '/opt/watchxearn-clone/data/authoritative_users.json';
  fs.writeFileSync(masterFile, JSON.stringify(reconciledList, null, 2), { mode: 0o600 });
  console.log(`✓ Master authoritative users saved to: ${masterFile} (${reconciledList.length} users)`);

  // Also update data/authoritative_store.json to include all users
  const storeFile = '/opt/watchxearn-clone/data/authoritative_store.json';
  if (fs.existsSync(storeFile)) {
    const store = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
    store.users = reconciledList;
    if (store.dashboard && store.dashboard.stats) {
      store.dashboard.stats.totalUsers = reconciledList.length;
    }
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), { mode: 0o600 });
    console.log(`✓ Updated authoritative_store.json with all ${reconciledList.length} users`);
  }
}

reconcile().catch(console.error);
