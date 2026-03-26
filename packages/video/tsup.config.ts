import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@bendyline/squisq', '@bendyline/squisq-react', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
});
