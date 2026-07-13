import type { FfmpegWasmLoadConfig } from '@bendyline/squisq-video';

const baseUrl = import.meta.env.BASE_URL;

/** Same-origin ffmpeg.wasm core assets published by the site's Vite plugin. */
export const SITE_FFMPEG_WASM_CONFIG: FfmpegWasmLoadConfig = {
  coreURL: `${baseUrl}ffmpeg-core/ffmpeg-core.js`,
  wasmURL: `${baseUrl}ffmpeg-core/ffmpeg-core.wasm`,
};
