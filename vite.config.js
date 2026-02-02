import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: '../dist'
  }
});
