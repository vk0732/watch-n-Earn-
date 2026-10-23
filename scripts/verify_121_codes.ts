import fs from 'fs';
import crypto from 'crypto';

function maskCode(code: string): string {
  if (!code) return '(empty)';
  const hash = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex').substring(0, 8);
  const len = code.length;
  const start = code.substring(0, 2);
  const end = code.substring(len - 2);
  return `${start}***${end} (hash:${hash})`;
}

const b = JSON.parse(fs.readFileSync('/opt/watchxearn-clone/backups/live_memory_backup_2026-10-23T13-46-09-800Z.json', 'utf-8'));
const giftCardCodes: any[] = b.giftCardCodes;
const withdrawals: any[] = b.withdrawals;

// Build set of all used codes in withdrawals
const usedCodesMap = new Map<string, any[]>();
for (const w of withdrawals) {
  if (w.status === 'success' && w.giftCardCode) {
    const norm = w.giftCardCode.trim().toUpperCase();
    if (!usedCodesMap.has(norm)) usedCodesMap.set(norm, []);
    usedCodesMap.get(norm)!.push(w);
  }
}

console.log(`Total withdrawals in backup: ${withdrawals.length}`);
console.log(`Unique codes in withdrawals: ${usedCodesMap.size}`);

const available = giftCardCodes.filter(c => c.status === 'available');
console.log(`Available codes count: ${available.length}`);

let unusedCount = 0;
let alreadyUsedCount = 0;

for (const av of available) {
  const norm = (av.code || '').trim().toUpperCase();
  if (usedCodesMap.has(norm)) {
    alreadyUsedCount++;
    const uses = usedCodesMap.get(norm)!;
    console.log(`- ALREADY ASSIGNED: ID ${av.id}, Code ${maskCode(norm)}, used in ${uses.length} withdrawals`);
  } else {
    unusedCount++;
  }
}

console.log(`\nSummary of the 121 "available" codes:`);
console.log(`  Truly unused pristine codes: ${unusedCount}`);
console.log(`  Previously assigned codes falsely marked available: ${alreadyUsedCount}`);
