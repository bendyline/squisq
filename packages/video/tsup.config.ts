import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  external: ['@bendyline/squisq', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
});
