import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'player/index': 'src/entries/player.ts',
    'page/index': 'src/entries/page.ts',
    'layers/index': 'src/entries/layers.ts',
    'hooks/index': 'src/entries/hooks.ts',
    'markdown/index': 'src/entries/markdown.ts',
    'json-view/index': 'src/entries/json-view.ts',
    'diagram-pictures/index': 'src/export/diagramPictures.ts',
    'graph/index': 'src/entries/graph.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  external: ['react', 'react-dom', '@bendyline/squisq', '@bendyline/squisq-graph', 'mermaid'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
