import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

import express from 'express';
import { apiRouter } from './server/apiRouter.ts';
import { startBotPolling } from './server/bot.ts';

function apiPlugin() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRouter);

  return {
    name: 'api-server-middleware',
    configureServer(server: any) {
      server.middlewares.use(app);

      // Auto-start bot long polling for preview & testing if token configured
      const appUrl =
        process.env.APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      if (process.env.TELEGRAM_BOT_TOKEN) {
        startBotPolling(appUrl).catch((err) => {
          console.error('[Telegram Bot Auto-Polling]:', err.message);
        });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
