import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/apiRouter.ts';
import { startBotPolling } from './server/bot.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount API routes
app.use('/api', apiRouter);

// Serve static frontend in production
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Fallback to index.html for Single Page Application
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`[TeleEarn Server] Running on http://0.0.0.0:${port}`);
  const appUrl =
    process.env.APP_URL ||
    'https://ais-dev-zve67xotyi6i3w6zawha3s-504198372090.asia-southeast1.run.app';
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startBotPolling(appUrl).catch((err) => {
      console.error('[Telegram Bot Auto-Polling]:', err.message);
    });
  }
});
