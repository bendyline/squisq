import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'player/index': 'src/entries/player.ts',
    'page/index': 'src/entries/page.ts',
    'layers/index': 'src/entries/layers.ts',
    'hooks/index': 'src/entries/hooks.ts',
    'markdown/index': 'src/entries/markdown.ts',
    'json-view/index': 'src/entries/json-view.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  external: ['react', 'react-dom', '@bendyline/squisq', 'mermaid'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
