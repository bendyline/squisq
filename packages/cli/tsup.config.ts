import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI binary entry point
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node22',
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: [
      '@bendyline/squisq',
      '@bendyline/squisq-formats',
      '@bendyline/squisq-react',
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
    sourcemap: true,
    target: 'node22',
    external: [
      '@bendyline/squisq',
      '@bendyline/squisq-formats',
      '@bendyline/squisq-react',
      '@bendyline/squisq-video',
      'playwright-core',
    ],
  },
]);
