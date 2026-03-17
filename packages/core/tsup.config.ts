import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'schemas/index': 'src/schemas/index.ts',
    'spatial/index': 'src/spatial/index.ts',
    'story/index': 'src/doc/index.ts',
    'doc/index': 'src/doc/index.ts',
    'storage/index': 'src/storage/index.ts',
    'markdown/index': 'src/markdown/index.ts',
    'timing/index': 'src/timing/index.ts',
    'random/index': 'src/random/index.ts',
    'generate/index': 'src/generate/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['ngeohash', 'localforage'],
});
