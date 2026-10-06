export { supportsWebCodecs, supportsWebCodecsH264, createEncoder } from '../mainThreadEncoder.js';
export type { MainThreadEncoder, EncoderConfig, EncoderFrameSource } from '../mainThreadEncoder.js';
export { supportsWebCodecsAac, renderAudioTimeline } from '../audioTrack.js';
export type { FfmpegWasmLoadConfig, AudioTimelineClip } from '@bendyline/squisq-video';
export {
  createAudioFileEncoder,
  supportedAudioFileFormats,
} from '../audioFile/audioFileEncoder.js';
export type {
  AudioFileEncoder,
  AudioFileEncoderOptions,
  AudioFileFormat,
} from '../audioFile/audioFileEncoder.js';
export { renderDocumentAudio } from '../documentAudio.js';
export type { RenderDocumentAudioOptions } from '../documentAudio.js';
