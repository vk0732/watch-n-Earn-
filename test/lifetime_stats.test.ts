import fs from 'node:fs';
import path from 'node:path';
import {
  memStore,
  getDashboardStats,
  getGiftCardInventoryStats,
  reconcileGVRegistry,
} from '../server/db.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runLifetimeStatsTests() {
  process.env.NODE_ENV = 'test';
  const dataDir = path.join(process.cwd(), 'data');
  const backupFiles = new Map<string, Buffer | null>();
  for (const fname of [
    'authoritative_users.json',
    'authoritative_store.json',
    'authoritative_withdrawals.json',
    'gv_authoritative_registry.json',
  ]) {
    const fpath = path.join(dataDir, fname);
    backupFiles.set(fpath, fs.existsSync(fpath) ? fs.readFileSync(fpath) : null);
  }

  try {
    console.log('\n==========================================================');
    console.log('  ADMIN DASHBOARD LIFETIME STATISTICS VERIFICATION SUITE');
    console.log('==========================================================\n');

    memStore.giftCardCodes.clear();
    memStore.assignedGVCodes.clear();
    memStore.gvAssignmentRecords.clear();
    memStore.withdrawals.clear();

    /* ------------------------------------------------------------------
       SUITE 1: Lifetime Amazon Gift Voucher Distribution
       ------------------------------------------------------------------ */
    console.log('Suite 1: Lifetime Amazon Gift Voucher Distribution');

    // 1. Add 3 redeemed codes (₹10, ₹10, ₹25.50), 2 unused available codes (₹10, ₹50), 1 invalidated code (₹10)
    memStore.giftCardCodes.set('gc_red_1', {
      id: 'gc_red_1',
      code: 'ABCD-111111-AAAA',
      denomination: 10,
      status: 'redeemed',
      assignedUserId: '5001001',
      assignedWithdrawalId: 'WTH-1001',
      redeemedAt: '2026-10-21T10:00:00.000Z',
      createdAt: '2026-10-21T09:00:00.000Z',
    });
    memStore.giftCardCodes.set('gc_red_2', {
      id: 'gc_red_2',
      code: 'EFGH-222222-BBBB',
      denomination: 10,
      status: 'redeemed',
      assignedUserId: '5001002',
      assignedWithdrawalId: 'WTH-1002',
      redeemedAt: '2026-10-22T10:00:00.000Z',
      createdAt: '2026-10-22T09:00:00.000Z',
    });
    memStore.giftCardCodes.set('gc_red_3', {
      id: 'gc_red_3',
      code: 'IJKL-333333-CCCC',
      denomination: 25.5,
      status: 'redeemed',
      assignedUserId: '5001003',
      assignedWithdrawalId: 'WTH-1003',
      redeemedAt: '2026-10-23T10:00:00.000Z',
      createdAt: '2026-10-23T09:00:00.000Z',
    });

    // Duplicate doc for same redeemed code ABCD-111111-AAAA -> must NOT be double-counted
    memStore.giftCardCodes.set('gc_red_1_dup', {
      id: 'gc_red_1_dup',
      code: 'abcd-111111-aaaa',
      denomination: 10,
      status: 'redeemed',
      assignedUserId: '5001001',
      assignedWithdrawalId: 'WTH-1001',
      redeemedAt: '2026-10-21T10:00:00.000Z',
      createdAt: '2026-10-21T09:00:00.000Z',
    });

    // Unused inventory (available) -> must be excluded from distributed total
    memStore.giftCardCodes.set('gc_avail_1', {
      id: 'gc_avail_1',
      code: 'AVAL-444444-DDDD',
      denomination: 10,
      status: 'available',
      createdAt: '2026-10-24T09:00:00.000Z',
    });
    memStore.giftCardCodes.set('gc_avail_2', {
      id: 'gc_avail_2',
      code: 'AVAL-555555-EEEE',
      denomination: 50,
      status: 'available',
      createdAt: '2026-10-24T09:00:00.000Z',
    });

    // Invalidated code -> must be excluded from distributed and available totals
    memStore.giftCardCodes.set('gc_inv_1', {
      id: 'gc_inv_1',
      code: 'INVL-666666-FFFF',
      denomination: 10,
      status: 'invalidated',
      createdAt: '2026-10-24T09:00:00.000Z',
    });

    // Legacy historical assignment in gvAssignmentRecords not yet in giftCardCodes -> must be reconciled and included
    memStore.gvAssignmentRecords.set('HIST-777777-GGGG', {
      code: 'HIST-777777-GGGG',
      orderId: 'WTH-1004',
      userId: '5001004',
      assignedAt: '2026-10-25T12:00:00.000Z',
    });
    memStore.assignedGVCodes.add('HIST-777777-GGGG');

    /* ------------------------------------------------------------------
       SUITE 2: Lifetime Settled Payouts & Exclusion of Pending/Failed/Rejected/Cancelled
       ------------------------------------------------------------------ */
    console.log('\nSuite 2: Lifetime Settled Payouts & Non-Success Exclusion');

    // 4 successful historical payouts: ₹10 + ₹10 + ₹25.50 + ₹10 = ₹55.50
    memStore.withdrawals.set('WTH-1001', {
      id: 'WTH-1001',
      userId: '5001001',
      userTelegramId: 5001001,
      amount: 10,
      status: 'success',
      payoutMode: 'gift_card',
      giftCardCode: 'ABCD-111111-AAAA',
      giftCardDenomination: 10,
      createdAt: '2026-10-21T10:00:00.000Z',
    });
    memStore.withdrawals.set('WTH-1002', {
      id: 'WTH-1002',
      userId: '5001002',
      userTelegramId: 5001002,
      amount: 10,
      status: 'success',
      payoutMode: 'gift_card',
      giftCardCode: 'EFGH-222222-BBBB',
      giftCardDenomination: 10,
      createdAt: '2026-10-22T10:00:00.000Z',
    });
    memStore.withdrawals.set('WTH-1003', {
      id: 'WTH-1003',
      userId: '5001003',
      userTelegramId: 5001003,
      amount: 25.5,
      status: 'success',
      payoutMode: 'gift_card',
      giftCardCode: 'IJKL-333333-CCCC',
      giftCardDenomination: 25.5,
      createdAt: '2026-10-23T10:00:00.000Z',
    });
    memStore.withdrawals.set('WTH-1004', {
      id: 'WTH-1004',
      userId: '5001004',
      userTelegramId: 5001004,
      amount: 10,
      status: 'success',
      payoutMode: 'gift_card',
      giftCardCode: 'HIST-777777-GGGG',
      giftCardDenomination: 10,
      createdAt: '2026-10-25T12:00:00.000Z',
    });

    // Pending, processing, failed, rejected, cancelled, and reversed withdrawals -> MUST NOT count in Settled Payouts or GV Distribution
    memStore.withdrawals.set('WTH-PEND-1', {
      id: 'WTH-PEND-1',
      userId: '5001005',
      userTelegramId: 5001005,
      amount: 10.25,
      status: 'pending',
      createdAt: '2026-10-26T10:00:00.000Z',
    });
    memStore.withdrawals.set('WTH-FAIL-1', {
      id: 'WTH-FAIL-1',
      userId: '5001006',
      userTelegramId: 5001006,
      amount: 20,
      status: 'failed',
      createdAt: '2026-10-26T11:00:00.000Z',
    });
    memStore.withdrawals.set('WTH-REJ-1', {
      id: 'WTH-REJ-1',
      userId: '5001007',
      userTelegramId: 5001007,
      amount: 30,
      status: 'rejected',
      createdAt: '2026-10-26T12:00:00.000Z',
    });
    memStore.withdrawals.set('WTH-CANC-1', {
      id: 'WTH-CANC-1',
      userId: '5001008',
      userTelegramId: 5001008,
      amount: 40,
      status: 'cancelled',
      createdAt: '2026-10-26T13:00:00.000Z',
    });

    reconcileGVRegistry();
    const gcStats1 = await getGiftCardInventoryStats();
    const dashStats1 = await getDashboardStats();

    assert(
      gcStats1.redeemedCodes === 4,
      `Lifetime GV Codes Distributed is 4 (3 redeemed docs deduplicated + 1 reconciled historical assignment; actual=${gcStats1.redeemedCodes})`
    );
    assert(
      gcStats1.totalRedeemedValue === 55.5,
      `Lifetime GV Amount Distributed is ₹55.50 (10 + 10 + 25.50 + 10; actual=${gcStats1.totalRedeemedValue})`
    );
    assert(
      gcStats1.availableCodes === 2 && gcStats1.totalAvailableValue === 60,
      `Unused available inventory excluded from distributed totals (availableCodes=${gcStats1.availableCodes}, value=${gcStats1.totalAvailableValue})`
    );
    assert(
      gcStats1.invalidatedCodes === 1,
      `Invalidated codes excluded from distributed totals (invalidatedCodes=${gcStats1.invalidatedCodes})`
    );
    assert(
      dashStats1.successfulPayoutsCount === 4,
      `Lifetime Settled Payouts count is 4 (excluded pending, failed, rejected, cancelled; actual=${dashStats1.successfulPayoutsCount})`
    );
    assert(
      dashStats1.successfulPayoutsAmount === 55.5,
      `Lifetime Settled Payouts amount is ₹55.50 (actual=${dashStats1.successfulPayoutsAmount})`
    );
    assert(
      dashStats1.pendingWithdrawalsCount === 1 && dashStats1.pendingWithdrawalsAmount === 10.25,
      `Pending withdrawals tracked separately (1 request, ₹10.25)`
    );
    assert(
      dashStats1.failedPayoutsCount === 3,
      `Failed, rejected, and cancelled withdrawals counted under failedPayoutsCount (3)`
    );
    assert(
      dashStats1.lifetimeGvCodesDistributed === 4 && dashStats1.lifetimeGvAmountDistributed === 55.5,
      `DashboardStats includes lifetimeGvCodesDistributed (4) and lifetimeGvAmountDistributed (₹55.50)`
    );

    /* ------------------------------------------------------------------
       SUITE 3: Refresh Idempotency (Zero Double Counting) & Automatic Live Update on Completion
       ------------------------------------------------------------------ */
    console.log('\nSuite 3: Dashboard Refresh Idempotency & Automatic Live Update on New Completed Transaction');

    // Refresh dashboard 5 times in a row -> totals must never double-count
    for (let i = 0; i < 5; i++) {
      reconcileGVRegistry();
      await getGiftCardInventoryStats();
      await getDashboardStats();
    }
    const dashAfterRefreshes = await getDashboardStats();
    assert(
      dashAfterRefreshes.successfulPayoutsCount === 4 && dashAfterRefreshes.successfulPayoutsAmount === 55.5,
      'Repeated dashboard refreshes never double-count settled payouts'
    );
    assert(
      dashAfterRefreshes.lifetimeGvCodesDistributed === 4 && dashAfterRefreshes.lifetimeGvAmountDistributed === 55.5,
      'Repeated dashboard refreshes never double-count distributed GV codes'
    );

    // Complete a new ₹10.00 GV redemption transaction -> statistics must update automatically
    memStore.giftCardCodes.set('gc_avail_1', {
      id: 'gc_avail_1',
      code: 'AVAL-444444-DDDD',
      denomination: 10,
      status: 'redeemed',
      assignedUserId: '5001009',
      assignedWithdrawalId: 'WTH-1005',
      redeemedAt: new Date().toISOString(),
      createdAt: '2026-10-24T09:00:00.000Z',
    });
    memStore.assignedGVCodes.add('AVAL-444444-DDDD');
    memStore.withdrawals.set('WTH-1005', {
      id: 'WTH-1005',
      userId: '5001009',
      userTelegramId: 5001009,
      amount: 10,
      status: 'success',
      payoutMode: 'gift_card',
      giftCardCode: 'AVAL-444444-DDDD',
      giftCardDenomination: 10,
      createdAt: new Date().toISOString(),
    });

    const dashAfterNewTx = await getDashboardStats();
    const gcAfterNewTx = await getGiftCardInventoryStats();

    assert(
      dashAfterNewTx.successfulPayoutsCount === 5 && dashAfterNewTx.successfulPayoutsAmount === 65.5,
      `Automatic update on new completed payout: count 4 -> 5, amount ₹55.50 -> ₹65.50`
    );
    assert(
      gcAfterNewTx.redeemedCodes === 5 && gcAfterNewTx.totalRedeemedValue === 65.5,
      `Automatic update on new GV redemption: codes 4 -> 5, total distributed ₹55.50 -> ₹65.50`
    );
    assert(
      gcAfterNewTx.availableCodes === 1 && gcAfterNewTx.totalAvailableValue === 50,
      `Available inventory automatically decremented: 2 -> 1 code (₹50.00)`
    );
  } finally {
    for (const [fpath, content] of backupFiles.entries()) {
      if (content === null) {
        if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
      } else {
        fs.writeFileSync(fpath, content);
      }
    }
  }

  console.log('\n==========================================================');
  console.log(`  LIFETIME STATS SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==========================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runLifetimeStatsTests().catch((err) => {
  console.error('Fatal lifetime stats test error:', err);
  process.exit(1);
});
