import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5397, open: false, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 }
});
