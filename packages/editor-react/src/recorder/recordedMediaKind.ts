import type { RecorderSource } from './hooks/useMediaRecorder.js';

export type RecordedMediaKind = 'audio' | 'video';

/**
 * Classify the file that was actually recorded.
 *
 * The acquired stream is authoritative when it is still available: a browser
 * can negotiate a `video/webm` container even when the stream contains only
 * audio. MIME and requested source are retained as fallbacks for hosts that
 * construct a save result without exposing the stream.
 */
export function recordedMediaKind(
  source: RecorderSource,
  stream: Pick<MediaStream, 'getVideoTracks'> | null,
  mimeType: string | null | undefined,
): RecordedMediaKind {
  if (stream) return stream.getVideoTracks().length > 0 ? 'video' : 'audio';
  if (mimeType?.toLowerCase().startsWith('audio/')) return 'audio';
  return source === 'mic' ? 'audio' : 'video';
}
