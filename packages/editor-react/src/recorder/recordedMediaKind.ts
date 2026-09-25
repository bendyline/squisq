import type { RecorderSource } from './hooks/useMediaRecorder.js';

export type RecordedMediaKind = 'audio' | 'video';

/**
 * Classify the file that was actually recorded.
 *
 * The acquired stream is authoritative when it is still available: a browser
 * can negotiate a `video/webm` container even when the stream contains only
 * audio. MIME and requested source are retained as fallbacks for hosts that
 * construct a save result without exposing the stream.
 *
 * `stream` is structural rather than `Pick<MediaStream, …>`: mediabunny's
 * `@types/dom-mediacapture-transform` overloads `getVideoTracks`, which no
 * plain stub can satisfy, and only the track count matters here.
 */
export function recordedMediaKind(
  source: RecorderSource,
  stream: { getVideoTracks(): readonly unknown[] } | null,
  mimeType: string | null | undefined,
): RecordedMediaKind {
  if (stream) return stream.getVideoTracks().length > 0 ? 'video' : 'audio';
  if (mimeType?.toLowerCase().startsWith('audio/')) return 'audio';
  return source === 'mic' ? 'audio' : 'video';
}
