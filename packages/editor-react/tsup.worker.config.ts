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
  // Self-contained means the whole parser stack rides along — remark, parse5
  // for inline HTML, and the icon catalog for {[icon]} tokens — so minify it.
  minify: true,
  noExternal: [/.*/],
  esbuildOptions(options) {
    // The entity decoder has a DOM-based browser build and a DOM-free worker
    // build. Keep browser-safe vfile resolution while selecting worker exports.
    options.conditions = ['worker', 'browser'];
  },
  // Its own label: reusing the main build's 'esm' would overwrite that
  // metadata and drop the main entries' bundled packages from the inventory.
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'document-parse-worker')],
});
