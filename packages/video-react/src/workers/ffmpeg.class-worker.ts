/// <reference lib="webworker" />
/// <reference lib="dom" />

// @ffmpeg/ffmpeg normally locates this worker relative to its own module. That
// assumption does not survive every consumer bundler (and is especially brittle
// when FFmpeg is created inside our encoding worker), so publish an explicit,
// stable default worker asset alongside the Squisq encoder worker. Advanced
// hosts can still override it through FfmpegWasmLoadConfig.
import '@ffmpeg/ffmpeg/worker';

export {};
