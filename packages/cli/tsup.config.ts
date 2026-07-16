import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig([
  // CLI binary entry point
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    clean: true,
    esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'binary')],
    target: 'node22',
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: [
      '@bendyline/squisq',
      '@bendyline/squisq-formats',
      '@bendyline/squisq-video',
      'commander',
      'playwright-core',
    ],
  },
  // Programmatic API entry point (no CLI banner)
  {
    entry: {
      api: 'src/api.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'api')],
    target: 'node22',
    external: [
      '@bendyline/squisq',
      '@bendyline/squisq-formats',
      '@bendyline/squisq-video',
      'playwright-core',
    ],
  },
]);
