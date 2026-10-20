import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3018',
      '/assets': 'http://127.0.0.1:3018',
      '/stores': 'http://127.0.0.1:3018',
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            'three',
            'three/examples/jsm/loaders/GLTFLoader.js',
            'three/examples/jsm/controls/OrbitControls.js',
          ],
        },
      },
    },
  },
});
