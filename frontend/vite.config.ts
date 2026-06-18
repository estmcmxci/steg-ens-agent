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
      // 127.0.0.1, not localhost — avoids IPv6 (::1) vs the dev servers' IPv4 bind.
      '/chatkit': {
        target: 'http://127.0.0.1:8000', // the brain (uvicorn)
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://127.0.0.1:8000', // the brain — read-only mm state for the portfolio card
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8787', // the CF Worker (wrangler)
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
