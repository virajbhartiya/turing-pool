import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/state': 'http://localhost:4021',
      '/demo': 'http://localhost:4021',
      '/health': 'http://localhost:4021',
      '/quote': 'http://localhost:4021',
      '/wallet': 'http://localhost:4021',
      '/vaults': 'http://localhost:4021',
    },
  },
});
