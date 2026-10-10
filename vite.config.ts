import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    // "npm run dev" style development: forward the game connection to the Node server
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
