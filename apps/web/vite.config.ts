import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
export default defineConfig({
  root: resolve(__dirname),
  plugins: [
    react(),
    {
      name: 'lumina-offline-shell',
      apply: 'build',
      writeBundle(output) {
        if (!output.dir) throw new Error('La aplicación offline requiere un directorio de salida.');
        const files = [
          '/',
          ...readdirSync(resolve(output.dir, 'assets'))
            .filter((file) => /\.(?:js|css|woff2?)$/.test(file))
            .sort()
            .map((file) => '/assets/' + file),
        ];
        const version = createHash('sha256')
          .update(JSON.stringify(files))
          .digest('hex')
          .slice(0, 20);
        const source = readFileSync(resolve(__dirname, 'src/offline/worker.js'), 'utf8')
          .replace('__LUMINA_SHELL_VERSION__', version)
          .replace('__LUMINA_SHELL_FILES__', JSON.stringify(files));
        writeFileSync(resolve(output.dir, 'sw.js'), source);
      },
    },
  ],
  optimizeDeps: { include: ['@lumina/contracts', '@lumina/reporting'] },
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
    commonjsOptions: { include: [/node_modules/, /packages[\\/](contracts|reporting)[\\/]dist/] },
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          contracts: ['@lumina/contracts'],
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
