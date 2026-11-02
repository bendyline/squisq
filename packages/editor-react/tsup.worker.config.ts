import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

// A worker loaded by URL must not contain bare package imports or shared chunks.
// Run after the main build so its clean step cannot erase this entry.
export default defineConfig({
  entry: { 'document-parse-worker/index': 'src/document-parse-worker/index.js' },
  format: ['esm'],
  platform: 'browser',
  splitting: false,
  dts: false,
  sourcemap: false,
  clean: false,
  noExternal: [/.*/],
  esbuildOptions(options) {
    // The entity decoder has a DOM-based browser build and a DOM-free worker
    // build. Keep browser-safe vfile resolution while selecting worker exports.
    options.conditions = ['worker', 'browser'];
  },
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
});
