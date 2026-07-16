/** Builds light and full self-contained browser IIFE players. */
import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));

const common = {
  format: ['iife'] as const,
  platform: 'browser' as const,
  globalName: 'SquisqPlayer',
  outDir: 'dist',
  minify: true,
  sourcemap: false,
  clean: false,
  treeshake: true,
  injectStyle: false,
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.alias = {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react/jsx-runtime': 'preact/jsx-runtime',
    };
    options.define = {
      ...options.define,
      __SQUISQ_VERSION__: JSON.stringify(pkg.version),
    };
    options.loader = { ...options.loader, '.css': 'text' };
  },
};

export default defineConfig([
  {
    ...common,
    entry: { 'squisq-player': 'src/standalone-entry.tsx' },
    esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'standalone-light')],
    // Mermaid is optional in the default player. An import map can provide it
    // on demand; documents that need a zero-configuration Mermaid renderer can
    // choose the full variant instead.
    noExternal: [/.*/],
    esbuildOptions(options) {
      common.esbuildOptions(options);
      options.alias = {
        ...options.alias,
        mermaid: resolve(import.meta.dirname, 'src/standalone-mermaid-stub.ts'),
      };
    },
  },
  {
    ...common,
    entry: { 'squisq-player.full': 'src/standalone-entry.tsx' },
    esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'standalone-full')],
    noExternal: [/.*/],
  },
]);
