/**
 * Standalone IIFE Build Configuration
 *
 * Builds a self-contained squisq-player.iife.js that bundles:
 * - Preact (aliased as React via preact/compat)
 * - @bendyline/squisq core (schemas, templates, doc utilities)
 * - All squisq-react rendering components (DocPlayer, BlockRenderer, layers, hooks)
 * - doc-animations.css (injected at runtime)
 *
 * The output is a single IIFE that exposes `window.SquisqPlayer`.
 */

import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  entry: { 'squisq-player': 'src/standalone-entry.tsx' },
  format: ['iife'],
  globalName: 'SquisqPlayer',
  outDir: 'dist',
  // Bundle everything — no external dependencies
  noExternal: [/.*/],
  minify: true,
  sourcemap: true,
  // Don't clean dist — the main tsup build already wrote ESM there
  clean: false,
  // Tree-shake to drop unused code (spatial, storage, etc.)
  treeshake: true,
  // Disable CSS injection — we handle CSS as a text import
  injectStyle: false,
  esbuildOptions(options) {
    options.jsx = 'automatic';
    // Alias React to Preact for the standalone bundle
    options.alias = {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react/jsx-runtime': 'preact/jsx-runtime',
    };
    // Inject version constant
    options.define = {
      ...options.define,
      __SQUISQ_VERSION__: JSON.stringify(pkg.version),
    };
    // Handle CSS imports as text (for runtime injection instead of CSS extraction)
    options.loader = {
      ...options.loader,
      '.css': 'text',
    };
  },
});
