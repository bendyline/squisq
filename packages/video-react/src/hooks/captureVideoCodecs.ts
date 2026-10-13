/**
 * Loaded only when capture opens a local video source. Named re-exports let
 * the package bundler discard Mediabunny's unrelated formats while preserving
 * the dynamic import boundary in captureVideoFrames.
 */
export { BlobSource, Input, MATROSKA, MP4, QTFF, VideoSampleSink, WEBM } from 'mediabunny';
