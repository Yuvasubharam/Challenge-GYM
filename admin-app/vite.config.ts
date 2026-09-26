import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the local admin worker (wrangler dev -c wrangler.admin.toml).
// In production, Pages Functions (functions/api/[[path]].ts) forward /api to the worker.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
