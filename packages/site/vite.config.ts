import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Connect, Plugin } from 'vite';
import { SQUISQ_DEV_PORT, SQUISQ_E2E_PORT } from '../../scripts/portUtils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const crossOriginHeaders = {
  // GIF export and the video fallback use ffmpeg.wasm/SharedArrayBuffer.
  // COEP: require-corp blocks blob: URL iframes used by frame capture, so use
  // credentialless: it permits those frames while preserving isolation.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/**
 * Vite plugin to serve content sample .zip files from the repo-root
 * `samplecontent/` directory under the `/samples/` URL prefix.
 *
 * - Dev + preview: middleware intercepts `/samples/*` and streams from disk.
 * - Build: copies every *.zip into `dist/samples/` (for static deploys).
 *
 * Both the dev server (`vite`) and the preview server (`vite preview`) share
 * the same middleware so a sample streams the current bytes off disk in
 * either mode. Previously only the dev server had a middleware and preview
 * relied entirely on the `writeBundle` copy — so `vite preview` against a
 * `dist/` built before a sample was added served the SPA fallback instead of
 * the file, and the sample failed to load.
 */
function sampleContentPlugin(): Plugin {
  const sampleDir = path.resolve(__dirname, '../../samplecontent');

  const serveSamples: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/samples/')) return next();

    let relative: string;
    try {
      relative = decodeURIComponent(req.url.slice('/samples/'.length));
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const filePath = path.resolve(sampleDir, relative);

    // Path-traversal guard
    if (!filePath.startsWith(sampleDir + path.sep)) return next();
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.zip'
        ? 'application/zip'
        : ext === '.dbk'
          ? 'application/zip'
          : 'application/octet-stream';
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  };

  return {
    name: 'sample-content',

    configureServer(server) {
      server.middlewares.use(serveSamples);
    },

    configurePreviewServer(server) {
      server.middlewares.use(serveSamples);
    },

    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      if (!fs.existsSync(sampleDir)) return;

      const destDir = path.join(outDir, 'samples');
      fs.mkdirSync(destDir, { recursive: true });

      for (const file of fs.readdirSync(sampleDir)) {
        if (file.endsWith('.zip') || file.endsWith('.dbk')) {
          fs.copyFileSync(path.join(sampleDir, file), path.join(destDir, file));
        }
      }
    },
  };
}

/**
 * Serve and publish ffmpeg.wasm's pinned core beside the demo site. GIF export
 * always needs the core, and a same-origin module avoids CDN/CORS failures in
 * cross-origin-isolated workers.
 */
function ffmpegCorePlugin(): Plugin {
  const coreDir = path.resolve(__dirname, '../../node_modules/@ffmpeg/core/dist/esm');
  const allowedFiles = new Set(['ffmpeg-core.js', 'ffmpeg-core.wasm']);

  const serveCore: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = req.url?.split('?', 1)[0] ?? '';
    if (!pathname.startsWith('/ffmpeg-core/')) return next();
    const fileName = pathname.slice('/ffmpeg-core/'.length);
    if (!allowedFiles.has(fileName)) return next();

    const filePath = path.join(coreDir, fileName);
    if (!fs.existsSync(filePath)) return next();
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Type',
      fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8',
    );
    fs.createReadStream(filePath).pipe(res);
  };

  return {
    name: 'ffmpeg-core',
    configureServer(server) {
      server.middlewares.use(serveCore);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveCore);
    },
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const destDir = path.join(outDir, 'ffmpeg-core');
      fs.mkdirSync(destDir, { recursive: true });
      for (const fileName of allowedFiles) {
        fs.copyFileSync(path.join(coreDir, fileName), path.join(destDir, fileName));
      }
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), sampleContentPlugin(), ffmpegCorePlugin()],
  resolve: {
    // Ensure workspace packages resolve to their source
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: SQUISQ_DEV_PORT,
    strictPort: true,
    open: true,
    headers: crossOriginHeaders,
  },
  preview: {
    host: '127.0.0.1',
    port: SQUISQ_E2E_PORT,
    strictPort: true,
    headers: crossOriginHeaders,
  },
  // Optimise the exact Monaco entry points used by editor-react's lazy loader.
  // Listing only `monaco-editor` is not sufficient: Vite treats the two deep
  // import specifiers in `editor-react/monaco` as newly discovered dependencies
  // the first time Source view mounts, optimises them on demand, and reloads the
  // page. Pre-bundling those specifiers at startup keeps the first Source-view
  // transition in-app. Exclude the workspace packages
  // so Vite serves their `dist/` straight — otherwise pre-bundling caches
  // a snapshot at `node_modules/.vite/` and rebuilds of editor-react et al.
  // don't show up until the dev server is restarted or the cache is cleared.
  optimizeDeps: {
    include: [
      'monaco-editor/esm/vs/editor/editor.main.js',
      'monaco-editor/esm/vs/editor/editor.api',
    ],
    exclude: [
      '@bendyline/squisq',
      '@bendyline/squisq-core',
      '@bendyline/squisq-editor-react',
      '@bendyline/squisq-react',
      '@bendyline/squisq-formats',
      // squisq-video-react ships a separate `dist/workers/encode.worker.js`
      // that the runtime spawns via `new URL(...)`. Pre-bundling collapses
      // the worker into the dep cache and breaks the URL resolution.
      '@bendyline/squisq-video-react',
    ],
  },
  // The squisq-video-react encode worker uses `await import('@ffmpeg/ffmpeg')`
  // for the ffmpeg.wasm fallback path. That dynamic import forces
  // code-splitting, which Vite's default `iife` worker output cannot
  // emit. Switch to ESM workers so the build can produce the extra
  // chunks the worker needs.
  worker: {
    format: 'es',
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom)[\\/]/,
              priority: 30,
            },
            {
              name: 'monaco-vendor',
              test: /node_modules[\\/](@monaco-editor|monaco-editor)[\\/]/,
              priority: 20,
            },
            {
              name: 'tiptap-vendor',
              test: /node_modules[\\/]@tiptap[\\/]/,
              priority: 19,
            },
            {
              name: 'fontawesome-vendor',
              test: /node_modules[\\/]@fortawesome[\\/]/,
              priority: 18,
            },
            {
              name: 'squisq-standalone-player',
              test: /packages[\\/]react[\\/](src|dist)[\\/]standalone-source/,
              priority: 17,
            },
            {
              name: (id) => {
                if (id.includes('/packages/core/')) return 'squisq-core';
                if (id.includes('/packages/react/')) return 'squisq-react';
                if (id.includes('/packages/formats/')) return 'squisq-formats';
                if (id.includes('/packages/editor-react/')) return 'squisq-editor';
                if (id.includes('/packages/video-react/')) return 'squisq-video-react';
                if (id.includes('/packages/video/')) return 'squisq-video';
                return null;
              },
              test: /packages[\\/](core|react|formats|editor-react|video|video-react)[\\/]/,
              priority: 16,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 5,
            },
          ],
        },
      },
    },
    // This dev/demo app intentionally loads the full editor surface. Monaco is
    // a legitimate large chunk; keep the warning focused on accidental larger
    // regressions while real app code remains split into smaller chunks.
    chunkSizeWarningLimit: 4000,
  },
});
