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
 * cross-origin-isolated workers. The GPL notice and license travel with those
 * files; the repo-level MIT license and complete third-party notice are also
 * published under /legal so a static deployment is self-describing.
 */
function ffmpegCorePlugin(): Plugin {
  const repoDir = path.resolve(__dirname, '../..');
  const coreDir = path.resolve(__dirname, '../../node_modules/@ffmpeg/core/dist/esm');
  const ffmpegNoticeDir = path.join(repoDir, 'third_party', 'ffmpeg-core');
  const publishedFiles = new Map<string, string>([
    ['/ffmpeg-core/ffmpeg-core.js', path.join(coreDir, 'ffmpeg-core.js')],
    ['/ffmpeg-core/ffmpeg-core.wasm', path.join(coreDir, 'ffmpeg-core.wasm')],
    ['/ffmpeg-core/NOTICE.md', path.join(ffmpegNoticeDir, 'NOTICE.md')],
    ['/ffmpeg-core/COPYING.GPL-2.0.txt', path.join(ffmpegNoticeDir, 'COPYING.GPL-2.0.txt')],
    ['/legal/LICENSE.txt', path.join(repoDir, 'LICENSE')],
    ['/legal/NOTICE.md', path.join(repoDir, 'NOTICE.md')],
  ]);

  const servePublishedFile: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = req.url?.split('?', 1)[0] ?? '';
    const filePath = publishedFiles.get(pathname);
    if (!filePath) return next();
    if (!fs.existsSync(filePath)) return next();
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);
    const contentType = pathname.endsWith('.wasm')
      ? 'application/wasm'
      : pathname.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : pathname.endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'text/plain; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  };

  return {
    name: 'ffmpeg-core',
    configureServer(server) {
      server.middlewares.use(servePublishedFile);
    },
    configurePreviewServer(server) {
      server.middlewares.use(servePublishedFile);
    },
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      for (const [publicPath, sourcePath] of publishedFiles) {
        const destinationPath = path.join(outDir, ...publicPath.slice(1).split('/'));
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
      }
    },
  };
}

/**
 * Serve and publish harper.js's WASM binary beside the demo site — the
 * reference implementation of the host side of the proofing capability:
 * the host serves the engine same-origin (correct MIME for
 * instantiateStreaming) and passes a provider pointed at it. The
 * Apache-2.0 license travels with the binary.
 */
function harperCorePlugin(): Plugin {
  const harperDir = path.resolve(__dirname, '../../node_modules/harper.js');
  const publishedFiles = new Map<string, string>([
    ['/harper/harper_wasm_bg.wasm', path.join(harperDir, 'dist', 'harper_wasm_bg.wasm')],
    // The 'full' engine derives this sibling URL by filename substitution
    // and loads BOTH binaries — hosts must serve the pair side by side.
    ['/harper/harper_wasm_slim_bg.wasm', path.join(harperDir, 'dist', 'harper_wasm_slim_bg.wasm')],
    ['/harper/LICENSE.txt', path.join(harperDir, 'LICENSE')],
  ]);

  const servePublishedFile: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = req.url?.split('?', 1)[0] ?? '';
    const filePath = publishedFiles.get(pathname);
    if (!filePath) return next();
    if (!fs.existsSync(filePath)) return next();
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Type',
      pathname.endsWith('.wasm') ? 'application/wasm' : 'text/plain; charset=utf-8',
    );
    fs.createReadStream(filePath).pipe(res);
  };

  return {
    name: 'harper-core',
    configureServer(server) {
      server.middlewares.use(servePublishedFile);
    },
    configurePreviewServer(server) {
      server.middlewares.use(servePublishedFile);
    },
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      for (const [publicPath, sourcePath] of publishedFiles) {
        const destinationPath = path.join(outDir, ...publicPath.slice(1).split('/'));
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
      }
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), sampleContentPlugin(), ffmpegCorePlugin(), harperCorePlugin()],
  resolve: {
    // The editor package's CSS is bundled into dist/ only by its one-shot
    // build. Its tsup dev watchers rebuild JS and declarations, so resolving
    // the package style export here can briefly fail while dist/ is changing
    // and CSS source edits are otherwise invisible to Vite. Point the demo
    // site at the stable source entry so Vite owns CSS watching and HMR.
    alias: {
      '@bendyline/squisq-editor-react/styles': path.resolve(
        __dirname,
        '../editor-react/src/styles/index.css',
      ),
    },
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
  // Optimise Monaco's typed API entry used by editor-react's lazy loader.
  // The feature and language contribution modules stay behind Squisq's own
  // demand-driven imports; pre-bundling `editor.main` here would rebuild the
  // full Monaco profile we intentionally avoid. Exclude the workspace packages
  // so Vite serves their `dist/` straight — otherwise pre-bundling caches
  // a snapshot at `node_modules/.vite/` and rebuilds of editor-react et al.
  // don't show up until the dev server is restarted or the cache is cleared.
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.api.js'],
    exclude: [
      '@bendyline/squisq',
      '@bendyline/squisq-core',
      '@bendyline/squisq-calc',
      '@bendyline/squisq-editor-react',
      '@bendyline/squisq-react',
      '@bendyline/squisq-grid-react',
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
    // The site targets modern ESM browsers. Vite's module-preload polyfill
    // hoists dependencies shared by dynamic Monaco chunks into the initial
    // graph, defeating the editor's demand boundary and eagerly fetching rich
    // features. Native dynamic imports preserve the intended request timing.
    modulePreload: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom)[\\/]/,
              priority: 30,
            },
            // Keep Monaco out of named manual groups. Its editor modules have
            // circular internal dependencies, so forcing core, features, and
            // languages into separate groups creates static cross-chunk edges
            // that pull the demand-only chunks back into the entry graph.
            // Native dynamic-import boundaries preserve the correct timing.
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
              name: 'pdf-vendor',
              test: /node_modules[\\/]pdfjs-dist[\\/]/,
              priority: 17,
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
                if (id.includes('/packages/editor-react/')) {
                  // These modules are reached only through Source/code/diff
                  // demand. Folding them into the statically imported editor
                  // package chunk makes Vite modulepreload Monaco at startup.
                  if (
                    /packages[\\/]editor-react[\\/](?:src|dist)[\\/]monaco(?:Features|Suggestions)?(?:[.-])/.test(
                      id,
                    )
                  ) {
                    return null;
                  }
                  return 'squisq-editor';
                }
                if (id.includes('/packages/video-react/')) return 'squisq-video-react';
                if (id.includes('/packages/video/')) return 'squisq-video';
                return null;
              },
              test: /packages[\\/](core|react|formats|editor-react|video|video-react)[\\/]/,
              priority: 16,
            },
            {
              name: 'vendor',
              // Monaco must remain governed by its native dynamic-import
              // graph; putting it in this static vendor group eagerly loads
              // the entire editor and every language contribution.
              test: /node_modules[\\/](?!monaco-editor[\\/])/,
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
