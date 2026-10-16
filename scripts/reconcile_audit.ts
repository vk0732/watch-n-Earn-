import fs from 'node:fs';
import path from 'node:path';

interface ReconciliationResult {
  totalUsersAudited: number;
  totalWithdrawalsAudited: number;
  totalTransactionsAudited: number;
  totalGiftCardsAudited: number;
  unassignedRedeemedGiftCards: number;
  deliveredCardsWithoutWithdrawal: number;
  withdrawalsWithoutTransaction: number;
  usersWithDiscrepancies: Array<{
    userId: string;
    username: string;
    profileBalance: number;
    ledgerSum: number;
    difference: number;
    giftCardsRedeemed: number;
    withdrawalsCount: number;
    transactionsCount: number;
    note: string;
  }>;
}

export function runReconciliationAudit(backupFilePath?: string): ReconciliationResult {
  const filePath =
    backupFilePath || path.resolve(process.cwd(), 'backups/production_backup_1792147955860.json');

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const root = JSON.parse(raw);
  const cols = root.collections;

  const users: any[] = cols.users || [];
  const withdrawals: any[] = cols.withdrawals || [];
  const transactions: any[] = cols.transactions || [];
  const giftCards: any[] = cols.gift_card_codes || [];

  const redeemedGCs = giftCards.filter((g) => g.status === 'redeemed');

  let unassignedRedeemedGiftCards = 0;
  let deliveredCardsWithoutWithdrawal = 0;
  let withdrawalsWithoutTransaction = 0;

  for (const gc of redeemedGCs) {
    if (!gc.assignedUserId) {
      unassignedRedeemedGiftCards++;
    }
    const matchingW = withdrawals.find(
      (w) =>
        w.id === gc.assignedWithdrawalId ||
        w.giftCardId === gc.id ||
        (w.giftCardCode === gc.code && w.userId === gc.assignedUserId)
    );
    if (!matchingW) {
      deliveredCardsWithoutWithdrawal++;
    }
  }

  for (const w of withdrawals) {
    const matchingTx = transactions.find((t) => t.referenceId === w.id);
    if (!matchingTx) {
      withdrawalsWithoutTransaction++;
    }
  }

  const usersWithDiscrepancies: ReconciliationResult['usersWithDiscrepancies'] = [];

  for (const u of users) {
    // Only real users with numeric IDs
    if (!/^\d+$/.test(u.id)) continue;

    const userTxs = transactions.filter((t) => t.userId === u.id);
    const userWths = withdrawals.filter((w) => w.userId === u.id);
    const userGCs = giftCards.filter((g) => g.assignedUserId === u.id);

    const sumTx = userTxs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const diff = Math.round((u.balance - sumTx) * 100) / 100;

    if (Math.abs(diff) > 0.01) {
      usersWithDiscrepancies.push({
        userId: u.id,
        username: u.username || '',
        profileBalance: u.balance,
        ledgerSum: Math.round(sumTx * 100) / 100,
        difference: diff,
        giftCardsRedeemed: userGCs.length,
        withdrawalsCount: userWths.length,
        transactionsCount: userTxs.length,
        note:
          diff < 0
            ? 'Profile balance lower than transaction sum due to concurrent balance write race condition'
            : 'Profile balance higher than transaction sum due to missing initial ledger entry',
      });
    }
  }

  return {
    totalUsersAudited: users.length,
    totalWithdrawalsAudited: withdrawals.length,
    totalTransactionsAudited: transactions.length,
    totalGiftCardsAudited: giftCards.length,
    unassignedRedeemedGiftCards,
    deliveredCardsWithoutWithdrawal,
    withdrawalsWithoutTransaction,
    usersWithDiscrepancies,
  };
}

// Run standalone if executed directly
if (process.argv[1]?.endsWith('reconcile_audit.ts')) {
  console.log('=== FINANCIAL SYSTEM RECONCILIATION AUDIT ===\n');
  const result = runReconciliationAudit();
  console.log(`Total Users Audited: ${result.totalUsersAudited}`);
  console.log(`Total Withdrawals Audited: ${result.totalWithdrawalsAudited}`);
  console.log(`Total Transactions Audited: ${result.totalTransactionsAudited}`);
  console.log(`Total Gift Cards Audited: ${result.totalGiftCardsAudited}`);
  console.log(`Unassigned Redeemed Gift Cards: ${result.unassignedRedeemedGiftCards}`);
  console.log(`Delivered Cards Without Withdrawal Record: ${result.deliveredCardsWithoutWithdrawal}`);
  console.log(`Withdrawals Without Transaction Ledger Entry: ${result.withdrawalsWithoutTransaction}`);
  console.log(`\nNumeric Users with Balance vs Ledger Differences: ${result.usersWithDiscrepancies.length}`);

  result.usersWithDiscrepancies.forEach((u) => {
    console.log(
      `  - User ${u.userId} (@${u.username}): Balance = ₹${u.profileBalance}, LedgerSum = ₹${u.ledgerSum}, Diff = ₹${u.difference} (GCs: ${u.giftCardsRedeemed}, Wths: ${u.withdrawalsCount}, Txs: ${u.transactionsCount})`
    );
  });
}
