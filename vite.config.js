import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: { outDir: 'dist', rollupOptions: { output: { entryFileNames: 'app.js' } } }
});
