# TeleEarn - Telegram Watch & Earn Web App + Bot

A production-ready full-stack Telegram Mini App and Bot system with Watch & Earn tasks, daily check-in rewards, multi-channel Force Join gating, referral tracking, and secure UPI withdrawal workflows.

---

## Architecture Overview

- **Frontend**: Mobile-first Telegram Mini App built with React 19, TypeScript, Tailwind CSS, Lucide icons, and canvas-confetti.
- **Backend**: Node.js & Express server with Telegram WebApp cryptographic authentication, Bot webhook handlers, and REST API.
- **Database**: Firebase Firestore (`firebase-blueprint.json` & `firestore.rules`).
- **Security**: Server-authoritative balance ledger, atomic transaction reservations, strict HMAC-SHA256 signature verification, and RBAC admin authorization.
- **Bot Engine**: Telegram Bot API integration supporting `/start`, referral deep-linking (`/start ref_xxx`), dynamic inline buttons, and real-time channel membership verification (`getChatMember`).
- **Payout Gateway**: Safe UPI Payout Provider Adapter with Virtual Payment Address validation, sandbox simulation mode, and atomic fund restoration upon rejection.

---

## Key Features

1. **Telegram Web App Authentication (`initData`)**
   - Cryptographically verifies the HMAC-SHA256 hash using the secret derived from the Telegram Bot Token.
   - Enforces `auth_date` freshness (rejects tokens > 24 hours old) to block replay attacks.
   - Provides a built-in interactive sandbox switcher for testing in web browsers without a Telegram client.

2. **Force Join Channel Verification**
   - Administrators can add multiple public (`@channel`) and private channels (with invite links).
   - Server checks membership via Telegram Bot API before granting access to tasks or withdrawals.
   - Real-time diagnostic testing tool in the Admin Panel to verify bot permissions for any channel.

3. **Configurable Watch & Earn Tasks**
   - Admin can create, edit, activate, deactivate, and delete tasks.
   - Supported types: Videos, Websites, Channels, Social.
   - **Anti-Cheat Verification**: Server requires task initiation timestamp (`/api/tasks/start`) and verifies elapsed viewing duration before awarding rewards (`/api/tasks/complete`). Client-only bypasses are prevented.

4. **Referral Program & Anti-Abuse**
   - Unique referral code per user with deep links: `https://t.me/<BOT>?start=<REF_CODE>`.
   - Inviter receives rewards atomically upon qualified user signup.
   - Self-referrals and duplicate claims are strictly blocked in database transactions.
   - Permanent referral ledger tracking all referees and earnings.

5. **Daily Check-In & Streak Rewards**
   - Calendar date tracking (UTC) guarantees 1 reward claim per user per day.
   - 7-day streak track with escalating bonuses (+₹10 up to +₹24).
   - Festive particle confetti animation on successful claim.

6. **Secure UPI Withdrawal System**
   - Configurable minimum withdrawal amount (default: ₹100).
   - NPCI-standard UPI ID regex validation (`username@bank`).
   - Atomic balance deduction prevents race conditions and double-spends.
   - Unique Order IDs (`WTH-TIMESTAMP-RAND`).
   - Comprehensive status lifecycle: `Pending` ➔ `Processing` ➔ `Success` / `Rejected` / `Failed`.
   - **Safe Refund Invariant**: Rejecting a withdrawal atomically restores the reserved balance to the user's account and records a refund transaction.
   - **Safe Gateway Rule**: Live payouts are disabled by default until provider credentials are authenticated. No fake bank credits are reported.

7. **Admin Panel**
   - Protected by server-side Telegram ID authorization (`ADMIN_TELEGRAM_IDS`).
   - Dashboard metrics: Total users, active users today, task completions, rewards credited, pending withdrawals, settled payouts.
   - Force Join Manager with instant Bot API diagnostics.
   - Task CRUD manager.
   - Global Reward settings (Signup bonus, referral reward, min withdrawal).
   - Withdrawal queue review (Approve, Reject with refund, Process via Gateway).
   - User Management: Search users, inspect balances, suspend/ban, and manual balance adjustments with audit reasons.
   - Immutable administrator audit log.

---

## Environment Variables Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
# Telegram Bot Configuration (from @BotFather)
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
TELEGRAM_BOT_USERNAME="YourEarnBot"

# Admin Telegram Numeric IDs (comma-separated, get from @userinfobot)
ADMIN_TELEGRAM_IDS="504198372,123456789"

# Public App URL (used for Webhooks & Telegram Mini App URL)
APP_URL="https://your-domain.com"

# Webhook Secret Token (optional, for extra webhook security)
WEBHOOK_SECRET="random_secure_token_12345"

# UPI Payout Gateway (Safe by default: DISABLED)
PAYOUT_LIVE_ENABLED="false"
PAYOUT_PROVIDER="sandbox"
PAYOUT_API_KEY="your_payout_api_key"
PAYOUT_API_SECRET="your_payout_secret_key"
```

---

## Local Development & Testing

### 1. Run Development Server
```bash
npm run dev
```
The app runs on `http://localhost:3000` with full API proxy middleware.

### 2. Run Automated Integration Tests
```bash
npm test
```
The test suite executes 34 automated unit & integration assertions covering:
- Telegram HMAC-SHA256 signature verification (valid, tampered, expired)
- First-time user registration & idempotent signup bonus
- UTC daily check-in restrictions and streak counters
- Referral deep-link credit, duplicate prevention, and self-referral blocking
- Watch & Earn task start and timer elapsed verification
- UPI regex validation and insufficient balance handling
- Concurrent withdrawal prevention and atomic balance reservation
- Admin rejection with atomic user balance refund
- Admin authorization enforcement
- Payout gateway safety enforcement

---

## Deployment Guide

### Option 1: Standalone Node.js / VPS / Cloud Run / Render / Heroku
1. Build the frontend:
   ```bash
   npm run build
   ```
2. Start the full-stack server:
   ```bash
   npm run start
   ```
   `server.ts` serves both the Express API and the production React frontend bundle from `dist/`.

### Option 2: Configuring the Telegram Bot
1. Open [@BotFather](https://t.me/BotFather) on Telegram.
2. Create a new bot with `/newbot` and copy the Bot Token to `TELEGRAM_BOT_TOKEN`.
3. Create a Mini App via `/newapp`:
   - Select your bot.
   - Provide title and short description.
   - Set the Web App URL to `https://your-domain.com`.
4. Register the Bot Webhook by calling `/api/telegram/setup-webhook` from the Admin Panel or running:
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-domain.com/api/telegram/webhook"
   ```

---

## Health Check Endpoint

```bash
curl https://your-domain.com/api/health
```
Response:
```json
{
  "status": "ok",
  "timestamp": "2026-10-10T14:35:00.000Z",
  "botConfigured": true,
  "botUsername": "TeleEarnBot",
  "database": "Firebase Firestore"
}
```
