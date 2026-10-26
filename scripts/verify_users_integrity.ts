import fs from 'fs';
import path from 'path';

async function verifyUsers() {
  const filePath = path.join(process.cwd(), 'data', 'authoritative_users.json');
  if (!fs.existsSync(filePath)) {
    console.error(`File does not exist: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const users = JSON.parse(raw);
  console.log('Total users in authoritative_users.json:', users.length);

  const tgIds = new Set<number>();
  const userIds = new Set<string>();
  let duplicates = 0;
  let invalid = 0;
  let minDate = '9999';
  let maxDate = '0000';

  for (const u of users) {
    if (!u.id || !u.telegramId) {
      invalid++;
    }
    if (tgIds.has(u.telegramId)) {
      duplicates++;
    }
    tgIds.add(u.telegramId);
    userIds.add(u.id);

    if (u.createdAt) {
      if (u.createdAt < minDate) minDate = u.createdAt;
      if (u.createdAt > maxDate) maxDate = u.createdAt;
    }
  }

  console.log('Integrity Verification Results:');
  console.log(`  - Total user records: ${users.length}`);
  console.log(`  - Unique Telegram IDs: ${tgIds.size}`);
  console.log(`  - Unique User IDs: ${userIds.size}`);
  console.log(`  - Duplicates: ${duplicates}`);
  console.log(`  - Invalid/Missing ID: ${invalid}`);
  console.log(`  - Earliest User Registration: ${minDate}`);
  console.log(`  - Latest User Registration: ${maxDate}`);
}

verifyUsers().catch(console.error);
