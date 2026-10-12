# Security Specification for TeleEarn Mini App

## Data Invariants & Zero-Trust Architecture
1. **Server-Authoritative Balances**: Balances cannot be increased, decreased, or manipulated directly by web clients. All balance changes (signup bonus, daily check-in, task reward, withdrawal request, refund) MUST be executed through the trusted backend server via atomic operations after cryptographic Telegram `initData` verification.
2. **Double-Claim Prevention**: A user cannot claim a task twice; compound keys `${userId}_${taskId}` enforce unique completions.
3. **Daily Claim Idempotency**: Daily check-in is gated on server-side calendar date timestamps (`lastDailyCheckIn !== today`).
4. **Referral Integrity**: A user cannot refer themselves (`referrerId !== refereeId`), nor claim referral bonuses repeatedly.
5. **Withdrawal Atomicity**: When a withdrawal is created, the user balance is atomically decremented. Rejected withdrawals atomically restore funds with an audit transaction record.
6. **Force Join Enforceability**: Access to dashboard tasks and withdrawals is blocked until server verifies Telegram channel membership.
7. **Admin Access Control**: Only explicitly configured Telegram Admin IDs can perform admin actions (task CRUD, channel settings, withdrawal processing, user adjustments).

## The Dirty Dozen Payloads (Must be blocked or rejected)
1. **Direct Balance Modification**: Client attempts to update `balance` directly in `/users/{userId}` -> BLOCKED.
2. **Duplicate Task Completion**: Attacker sends multiple completion requests for the same taskId -> BLOCKED (idempotent key check).
3. **Ghost Task Verification**: Client claims reward without watching video / waiting timer -> BLOCKED (server verifies start timestamp and minimum duration).
4. **Self-Referral**: Attacker sets `referredBy` to their own ID -> BLOCKED.
5. **Duplicate Referral Payout**: Replaying `/start ref_code` multiple times -> BLOCKED (ledger check).
6. **Concurrent Double Withdrawal**: Two parallel withdrawal requests exceeding available balance -> BLOCKED (atomic Firestore transaction).
7. **Negative or Zero Withdrawal**: Attacker requests withdrawal of -100 or 0 -> BLOCKED (server checks `amount >= minWithdrawal`).
8. **Invalid UPI ID Injection**: Attacker submits malformed or script-injection UPI string -> BLOCKED (strict regex validation).
9. **Fake Payment Success**: Admin/user tries to mark payment success without provider verification -> BLOCKED (only verified provider webhooks or signed confirmations).
10. **Admin Escalation**: Non-admin attempts to access `/api/admin/*` endpoints -> BLOCKED (403 Forbidden with security logging).
11. **Tampered initData**: Attacker modifies user ID or hash in Telegram `initData` -> BLOCKED (HMAC-SHA256 signature mismatch).
12. **Replayed initData**: Attacker uses expired Telegram initData (older than 24 hours) -> BLOCKED (`auth_date` staleness check).
