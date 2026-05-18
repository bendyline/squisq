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
    '@bendyline/squisq',
    '@bendyline/squisq-react',
    '@bendyline/squisq-recorder-react',
    'monaco-editor',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
