import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'ironcalc/index': 'src/ironcalc/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  // The wasm engine is an OPTIONAL PEER reached only via dynamic import()
  // in the /ironcalc entry — never bundled or statically imported. A
  // published-shape guardrail pins this.
  external: ['@ironcalc/wasm'],
});
