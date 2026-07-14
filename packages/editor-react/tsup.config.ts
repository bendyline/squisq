import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/monaco.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  external: ['react', 'react-dom', '@bendyline/squisq', '@bendyline/squisq-react', 'monaco-editor'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
