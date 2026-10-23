import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, getColName } from '../server/db.ts';
import { collection, getDocs } from 'firebase/firestore';

function maskCode(code: string): string {
  if (!code) return '(empty)';
  const hash = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex').substring(0, 10);
  const len = code.length;
  const start = code.substring(0, 2);
  const end = code.substring(len - 2);
  return `${start}***${end} (hash:${hash}, len:${len})`;
}

async function run() {
  console.log('==================================================');
  console.log('  DEEP INSPECTION OF ALL COLLECTIONS');
  console.log('==================================================');
  console.log('DB_PREFIX:', process.env.DB_PREFIX || '(none)');

  const candidateCollections = [
    'gift_card_codes',
    'clone_gift_card_codes',
    'withdrawals',
    'clone_withdrawals',
    'users',
    'clone_users'
  ];

  const results: Record<string, any[]> = {};

  for (const colName of candidateCollections) {
    try {
      const snap = await getDocs(collection(db, colName));
      console.log(`Collection [${colName}]: ${snap.size} documents found`);
      const docs: any[] = [];
      snap.forEach(d => {
        docs.push({ id: d.id, ...d.data() });
      });
      results[colName] = docs;
    } catch (err: any) {
      console.warn(`Error reading [${colName}]:`, err.message);
    }
  }

  // Check backup dir
  const backupDir = path.join(process.cwd(), 'backups');
  if (fs.existsSync(backupDir)) {
    const backupFiles = fs.readdirSync(backupDir);
    console.log('\nFiles in /backups:', backupFiles);
    for (const bf of backupFiles) {
      if (bf.endsWith('.json')) {
        const fullPath = path.join(backupDir, bf);
        const stat = fs.statSync(fullPath);
        console.log(`- ${bf} (${stat.size} bytes)`);
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          console.log(`  Keys:`, Object.keys(parsed));
          for (const k of Object.keys(parsed)) {
            if (Array.isArray(parsed[k])) {
              console.log(`    ${k}: array of ${parsed[k].length} items`);
            }
          }
        } catch (e: any) {
          console.log(`  Could not parse JSON:`, e.message);
        }
      }
    }
  }

  // Now analyze gift cards found across collections
  const allGiftCards = results['gift_card_codes']?.length
    ? results['gift_card_codes']
    : (results['clone_gift_card_codes'] || []);

  const allWithdrawals = results['withdrawals']?.length
    ? results['withdrawals']
    : (results['clone_withdrawals'] || []);

  console.log(`\nActive Gift Cards Pool analyzed: ${allGiftCards.length} records`);
  console.log(`Active Withdrawals Pool analyzed: ${allWithdrawals.length} records`);

  const statusMap: Record<string, number> = {};
  const codeToGcDocs = new Map<string, any[]>();
  for (const gc of allGiftCards) {
    const s = gc.status || 'unknown';
    statusMap[s] = (statusMap[s] || 0) + 1;
    const norm = (gc.code || '').trim().toUpperCase();
    if (!codeToGcDocs.has(norm)) codeToGcDocs.set(norm, []);
    codeToGcDocs.get(norm)!.push(gc);
  }
  console.log('Gift Card Status Counts:', statusMap);

  // Check withdrawals
  const codeToWithdrawals = new Map<string, any[]>();
  for (const w of allWithdrawals) {
    if (w.status === 'success' && w.giftCardCode) {
      const norm = w.giftCardCode.trim().toUpperCase();
      if (!codeToWithdrawals.has(norm)) codeToWithdrawals.set(norm, []);
      codeToWithdrawals.get(norm)!.push(w);
    }
  }

  console.log(`Unique GV codes in successful withdrawals: ${codeToWithdrawals.size}`);
  let duplicates = 0;
  for (const [normCode, wList] of codeToWithdrawals.entries()) {
    if (wList.length > 1) {
      duplicates++;
      console.log(`\n🚨 DUPLICATE DISTRIBUTION FOUND: ${maskCode(normCode)}`);
      console.log(`   Given to ${wList.length} users/withdrawals:`);
      for (const w of wList) {
        console.log(`   - Withdrawal ID: ${w.id}, User: ${w.userId} (Telegram: ${w.userTelegramId}), Amount: ₹${w.amount}, Date: ${w.createdAt}`);
      }
      const inv = codeToGcDocs.get(normCode) || [];
      console.log(`   Inventory doc(s) status:`, inv.map(i => ({ id: i.id, status: i.status, assignedUserId: i.assignedUserId, assignedWithdrawalId: i.assignedWithdrawalId })));
    }
  }

  console.log(`\nTotal duplicate codes: ${duplicates}`);

  // Create authoritative snapshot backup right now!
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapFile = path.join(backupDir, `authoritative_snapshot_${ts}.json`);
  fs.writeFileSync(snapFile, JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(`\nAuthoritative snapshot saved to: ${snapFile}`);

  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
