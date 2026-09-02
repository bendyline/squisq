import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  // NOTE: never enable `minify` here — the worker kernel ships as
  // `tableKernel.toString()` (see src/store/kernel.ts), and minification
  // would mangle the embedded source. A guard test pins this.
  external: ['react', 'react-dom', '@bendyline/squisq', '@tanstack/react-virtual'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
