import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // The encoder worker is loaded at runtime via `new URL('./workers/encode.worker.js', import.meta.url)`
    // (see workerEncoder.ts), so it must ship as a separate file alongside dist/index.js.
    'workers/encode.worker': 'src/workers/encode.worker.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    '@bendyline/squisq',
    '@bendyline/squisq-react',
    '@bendyline/squisq-video',
    '@ffmpeg/ffmpeg',
    '@ffmpeg/util',
    'html2canvas',
    'mp4-muxer',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
