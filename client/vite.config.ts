import { defineConfig } from 'vite';

export default defineConfig({
  base: '/redalert/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
