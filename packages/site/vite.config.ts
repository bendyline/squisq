import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

/**
 * Vite plugin to serve content sample .zip files from the repo-root
 * `samplecontent/` directory under the `/samples/` URL prefix.
 *
 * - Dev: middleware intercepts `/samples/*` and streams from disk.
 * - Build: copies every *.zip into `dist/samples/`.
 */
function sampleContentPlugin(): Plugin {
  const sampleDir = path.resolve(__dirname, '../../samplecontent');

  return {
    name: 'sample-content',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/samples/')) return next();

        const relative = decodeURIComponent(req.url.slice('/samples/'.length));
        const filePath = path.resolve(sampleDir, relative);

        // Path-traversal guard
        if (!filePath.startsWith(sampleDir + path.sep)) return next();
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

        const stat = fs.statSync(filePath);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Type', 'application/zip');
        fs.createReadStream(filePath).pipe(res);
      });
    },

    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      if (!fs.existsSync(sampleDir)) return;

      const destDir = path.join(outDir, 'samples');
      fs.mkdirSync(destDir, { recursive: true });

      for (const file of fs.readdirSync(sampleDir)) {
        if (file.endsWith('.zip')) {
          fs.copyFileSync(path.join(sampleDir, file), path.join(destDir, file));
        }
      }
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), sampleContentPlugin()],
  resolve: {
    // Ensure workspace packages resolve to their source
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5199,
    strictPort: true,
    open: true,
  },
  // Optimise monaco-editor: tell Vite to pre-bundle it so workers are served
  // from the local dev server instead of CDN.
  optimizeDeps: {
    include: ['monaco-editor'],
  },
});
