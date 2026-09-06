import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: Number(process.env.FOLIO_WEB_PORT ?? 5173), strictPort: true,
    watch: { ignored: ['**/.local/**', '**/test-results/**', '**/playwright-report/**'] },
    proxy: { '/api': { target: process.env.FOLIO_API_TARGET ?? 'http://127.0.0.1:3001', changeOrigin: true } },
  },
});
