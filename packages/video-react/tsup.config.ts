import { defineConfig } from 'tsup';
import { bundleLicenseMetadata } from '../../scripts/bundle-license-plugin.mjs';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'components/index': 'src/entries/components.ts',
    'cover-image/index': 'src/entries/cover-image.ts',
    'dashboard-image/index': 'src/entries/dashboard-image.ts',
    'hooks/index': 'src/entries/hooks.ts',
    'encoder/index': 'src/entries/encoder.ts',
    // The encoder worker is loaded at runtime via `new URL('./workers/encode.worker.js', import.meta.url)`
    // (see workerEncoder.ts), so it must ship as a separate file alongside dist/index.js.
    'workers/encode.worker': 'src/workers/encode.worker.ts',
    'workers/ffmpeg.class-worker': 'src/workers/ffmpeg.class-worker.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  esbuildPlugins: [bundleLicenseMetadata(import.meta.dirname, 'esm')],
  external: [
    'react',
    'react-dom',
    '@bendyline/squisq',
    '@bendyline/squisq-react',
    '@bendyline/squisq-video',
    '@ffmpeg/ffmpeg',
    '@ffmpeg/util',
    'html2canvas',
  ],
  // mp4-muxer is a legacy implementation detail whose declaration package
  // installs conflicting global WebCodecs types. Bundle its runtime so those
  // types never enter a consumer dependency tree.
  noExternal: ['@ffmpeg/ffmpeg/worker', 'mp4-muxer'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
