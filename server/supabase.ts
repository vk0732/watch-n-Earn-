import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile, Transaction, Withdrawal, GiftCardCode } from '../src/types/index.ts';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

export let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[Supabase] Initialized client for:', supabaseUrl);
  } catch (err) {
    console.warn('[Supabase] Client initialization failed:', err);
    supabase = null;
  }
}

export function isSupabaseEnabled(): boolean {
  return Boolean(supabase);
}

/**
 * Execute atomic gift card redemption via Supabase PostgreSQL procedure with row-level locks
 */
export async function supabaseRedeemGiftCard(
  userId: string,
  denomination: number,
  idempotencyKey?: string
): Promise<{
  success: boolean;
  withdrawal?: Withdrawal;
  transaction?: Transaction;
  user?: UserProfile;
  giftCardCode?: string;
  error?: string;
}> {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  try {
    const { data, error } = await supabase.rpc('redeem_gift_card_atomic', {
      p_user_id: userId,
      p_denomination: denomination,
      p_idempotency_key: idempotencyKey ? idempotencyKey.trim() : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      withdrawal: {
        id: data.withdrawal_id,
        userId,
        userTelegramId: 0,
        amount: data.amount,
        status: data.status || 'success',
        payoutMode: 'gift_card',
        giftCardCode: data.gift_card_code,
        giftCardDenomination: data.amount,
        idempotencyKey: idempotencyKey ? idempotencyKey.trim() : undefined,
        createdAt: data.created_at || new Date().toISOString(),
        processedAt: data.created_at || new Date().toISOString(),
      },
      transaction: {
        id: data.transaction_id || `tx_${data.withdrawal_id}`,
        userId,
        type: 'withdrawal_deduct',
        amount: -data.amount,
        balanceAfter: data.balance_after,
        description: `Amazon Gift Card ₹${data.amount} Code Redeemed (${data.withdrawal_id})`,
        referenceId: data.withdrawal_id,
        createdAt: data.created_at || new Date().toISOString(),
      },
      giftCardCode: data.gift_card_code,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Supabase RPC error' };
  }
}

/**
 * Credit user balance atomically via Supabase PostgreSQL procedure
 */
export async function supabaseCreditBalance(
  userId: string,
  amount: number,
  type: string,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  try {
    const { data, error } = await supabase.rpc('credit_user_balance_atomic', {
      p_user_id: userId,
      p_amount: amount,
      p_type: type,
      p_description: description,
      p_reference_id: referenceId || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Supabase credit error' };
  }
}

/**
 * Bulk reset all user balances via Supabase PostgreSQL procedure
 */
export async function supabaseBulkResetBalances(
  adminId: string,
  newGeneration: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  try {
    const { data, error } = await supabase.rpc('bulk_reset_user_balances_atomic', {
      p_admin_id: adminId,
      p_new_generation: newGeneration,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Supabase bulk reset error' };
  }
}

