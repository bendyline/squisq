import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    '@bendyline/prodcore',
    '@bendyline/prodcore-react',
    'monaco-editor',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
