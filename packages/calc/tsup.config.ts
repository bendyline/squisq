import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ironcalc/index': 'src/ironcalc/index.ts',
    // The Web Worker script — fully self-contained after bundling (zero
    // runtime deps), spawned via new URL('./worker/index.js', import.meta.url).
    'worker/index': 'src/worker/entry.ts',
  },
  format: ['esm'],
  // No shared chunks: the worker entry must be a SINGLE self-contained file
  // (spawned by URL; chunk imports complicate asset emission), and the other
  // entries stay independently loadable. Costs some duplication, buys
  // deployment simplicity.
  splitting: false,
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  // The wasm engine is an OPTIONAL PEER reached only via dynamic import()
  // in the /ironcalc entry — never bundled or statically imported. A
  // published-shape guardrail pins this.
  external: ['@ironcalc/wasm'],
});
