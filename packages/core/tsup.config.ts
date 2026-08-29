import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'schemas/index': 'src/schemas/index.ts',
    'spatial/index': 'src/spatial/index.ts',
    'doc/index': 'src/doc/index.ts',
    'storage/index': 'src/storage/index.ts',
    'markdown/index': 'src/markdown/index.ts',
    'timing/index': 'src/timing/index.ts',
    'random/index': 'src/random/index.ts',
    'generate/index': 'src/generate/index.ts',
    'transform/index': 'src/transform/index.ts',
    'versions/index': 'src/versions/index.ts',
    'jsonForm/index': 'src/jsonForm/index.ts',
    'imageEdit/index': 'src/imageEdit/index.ts',
    'icons/index': 'src/icons/index.ts',
    'icons/inlineIconMarker': 'src/icons/inlineIconMarker.ts',
    'recommend/index': 'src/recommend/index.ts',
    'narration/index': 'src/narration/index.ts',
    'fence/index': 'src/fence/index.ts',
    'proof/index': 'src/proof/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  external: ['ngeohash', 'localforage', 'genson-js'],
});
