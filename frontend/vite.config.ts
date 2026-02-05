import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/transcript': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/meetings': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
