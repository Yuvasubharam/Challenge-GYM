import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: /api → local member worker (run-local.ps1 member). Prod: Pages Function → service binding.
export default defineConfig({
  plugins: [react()],
  server: { host: true, proxy: { '/api': { target: 'http://127.0.0.1:8789', changeOrigin: false } } },
  build: { sourcemap: false },
});
