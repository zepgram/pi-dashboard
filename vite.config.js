import { defineConfig } from 'vite';

// Dev and preview servers forward API calls to the backend, so the frontend
// always uses relative /api and /mcp URLs.
const target = process.env.PI_DASH_API || 'http://127.0.0.1:3001';
const proxy = {
  '/api': { target, changeOrigin: true },
  '/mcp': { target, changeOrigin: true }
};

export default defineConfig({
  root: 'src',
  server: { port: 5173, host: true, proxy },
  preview: { port: 4173, host: true, proxy },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
