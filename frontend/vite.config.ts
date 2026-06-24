import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      // Brain endpoints → the DEPLOYED Railway brain (test the live deploy from local UI).
      // Revert all three to 'http://127.0.0.1:8000' to go back to the local brain.
      // 127.0.0.1, not localhost — avoids IPv6 (::1) vs the dev servers' IPv4 bind.
      '/chatkit': {
        target: 'https://steg-brain-production.up.railway.app', // deployed brain (uvicorn)
        changeOrigin: true,
      },
      '/agent': {
        target: 'https://steg-brain-production.up.railway.app', // deployed brain — read-only mm card
        changeOrigin: true,
      },
      '/provision': {
        target: 'https://steg-brain-production.up.railway.app', // deployed brain — onboarding SSE + queue
        changeOrigin: true,
      },
      '/api': {
        // Repointed to the DEPLOYED worker to test it from the local UI.
        // Revert to 'http://127.0.0.1:8787' for the local wrangler worker.
        target: 'https://steg-agent-card.estmcmxci.workers.dev', // deployed CF Worker
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
