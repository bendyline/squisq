import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // The Web Worker script, self-contained after bundling (zero runtime
    // deps), spawned via new URL('./worker/index.js', import.meta.url).
    'worker/index': 'src/worker/entry.ts',
  },
  format: ['esm'],
  // No shared chunks: the worker entry must be a single file loaded by URL.
  splitting: false,
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
});
