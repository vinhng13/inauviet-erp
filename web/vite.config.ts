import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev: the API runs on :3000 and Vite proxies /api, so the browser sees one origin (same as production behind Caddy).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { antd: ['antd', '@ant-design/icons'], react: ['react', 'react-dom', 'react-router'] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
