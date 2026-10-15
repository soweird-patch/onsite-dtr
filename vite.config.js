import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'pwa-assets',
  build: { outDir: 'dist', rollupOptions: { output: { entryFileNames: 'app.js' } } }
});
