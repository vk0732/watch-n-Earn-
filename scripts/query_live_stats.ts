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

  console.log('Querying live stats from http://127.0.0.1:3002/api/admin/gift-cards/stats ...');
  const res = await fetch('http://127.0.0.1:3002/api/admin/gift-cards/stats', {
    headers: {
      'x-telegram-init-data': initData,
    },
  });

  console.log('HTTP Status:', res.status);
  const data = await res.json();
  console.log('Stats Response:', JSON.stringify(data, null, 2));

  console.log('\nQuerying /api/admin/gift-cards ...');
  const resCards = await fetch('http://127.0.0.1:3002/api/admin/gift-cards', {
    headers: {
      'x-telegram-init-data': initData,
    },
  });
  console.log('Cards HTTP Status:', resCards.status);
  const cardsData = await resCards.json();
  const codes = cardsData.codes || [];
  console.log(`Received ${codes.length} gift card records from live server`);

  // Mask codes
  const maskedSample = codes.slice(0, 5).map((c: any) => ({
    id: c.id,
    denomination: c.denomination,
    status: c.status,
    assignedUserId: c.assignedUserId,
    assignedWithdrawalId: c.assignedWithdrawalId,
    codeMasked: c.code ? `${c.code.substring(0, 2)}***${c.code.substring(c.code.length - 2)}` : ''
  }));
  console.log('Sample records:', maskedSample);

  console.log('\nQuerying /api/admin/withdrawals ...');
  const resWth = await fetch('http://127.0.0.1:3002/api/admin/withdrawals', {
    headers: {
      'x-telegram-init-data': initData,
    },
  });
  console.log('Withdrawals HTTP Status:', resWth.status);
  const wthData = await resWth.json();
  const withdrawals = wthData.withdrawals || [];
  console.log(`Received ${withdrawals.length} withdrawals from live server`);

  // Save secure snapshot of the live server's current state
  const fs = await import('fs');
  const path = await import('path');
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const liveBackupFile = path.join(backupDir, `live_memory_backup_${ts}.json`);
  fs.writeFileSync(
    liveBackupFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        stats: data,
        giftCardCodesCount: codes.length,
        withdrawalsCount: withdrawals.length,
        giftCardCodes: codes,
        withdrawals: withdrawals,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(`\n✓ Live memory backup saved to: ${liveBackupFile}`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
