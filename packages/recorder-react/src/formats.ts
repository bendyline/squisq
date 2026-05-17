/**
 * Format probing for MediaRecorder.
 *
 * Different browsers expose different container/codec combinations. Chrome
 * and Firefox produce WebM (VP8/VP9 + Opus); Safari produces MP4 (H.264 +
 * AAC). We probe at runtime via `MediaRecorder.isTypeSupported()` and pick
 * the best supported option, falling back to whatever the browser hands
 * back when no probe succeeds.
 */

/** What the recorded stream is intended to capture. */
export type CaptureKind = 'audio' | 'video';

/** A probed format choice — what to pass to `MediaRecorder` and where to write it. */
export interface ResolvedFormat {
  /** MIME type to pass to `new MediaRecorder(stream, { mimeType })`. Empty string means "let the browser pick". */
  mimeType: string;
  /** File extension to use when writing to the container, including the leading dot. */
  extension: string;
  /** Container directory inside the `ContentContainer` (no trailing slash). */
  directory: 'audio' | 'video';
}

/**
 * Preferred MIME types for audio-only recording, in priority order. The
 * first one `MediaRecorder.isTypeSupported()` accepts wins.
 *
 * Opus in a WebM container is the modern default (Chrome, Firefox, Edge).
 * MP4/AAC covers Safari. Bare strings are kept as a final fallback for
 * older browsers that don't accept codec hints.
 */
const AUDIO_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/**
 * Preferred MIME types for video recording. VP9/Opus on top because it
 * yields good quality at modest bitrate in Chrome/Firefox. VP8 follows for
 * older Chromium. MP4/H.264 covers Safari.
 */
const VIDEO_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

/**
 * Map a chosen MIME type to a file extension. Best-effort — if we can't
 * tell, default to `.bin` so the file is at least retrievable.
 */
function extensionForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.startsWith('audio/webm')) return '.webm';
  if (m.startsWith('audio/ogg')) return '.ogg';
  if (m.startsWith('audio/mp4')) return '.m4a';
  if (m.startsWith('audio/mpeg')) return '.mp3';
  if (m.startsWith('audio/wav')) return '.wav';
  if (m.startsWith('video/webm')) return '.webm';
  if (m.startsWith('video/mp4')) return '.mp4';
  return '.bin';
}

/**
 * Probe `MediaRecorder.isTypeSupported()` and return the first supported
 * MIME type from the candidate list. Returns `null` when the
 * MediaRecorder API itself is unavailable or none of the candidates pass.
 */
function probeMimeType(candidates: readonly string[]): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported isn't supposed to throw, but Safari has historically
      // misbehaved on unknown codec strings. Keep probing.
    }
  }
  return null;
}

/**
 * Resolve the format the recorder will use for a given capture kind. If a
 * `preferred` MIME type is supported, it wins; otherwise we fall through
 * the priority list. When nothing matches (extremely old browser), we
 * return an empty `mimeType` — `MediaRecorder` will pick a default and we
 * tag the file with `.webm` as a best guess.
 */
export function resolveFormat(kind: CaptureKind, preferred?: string): ResolvedFormat {
  const candidates = kind === 'audio' ? AUDIO_CANDIDATES : VIDEO_CANDIDATES;
  const probed = (preferred && probeMimeType([preferred])) ?? probeMimeType(candidates) ?? '';
  const directory = kind === 'audio' ? 'audio' : 'video';
  const extension = probed ? extensionForMime(probed) : '.webm';
  return { mimeType: probed, extension, directory };
}

/**
 * `MediaRecorder` support probe. Returns false when running in a
 * non-browser environment (e.g. SSR) or on a browser that doesn't
 * implement the API at all.
 */
export function supportsMediaRecorder(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

/**
 * `getUserMedia` support probe (for mic / camera capture).
 */
export function supportsUserMedia(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * `getDisplayMedia` support probe (for screen capture). Browsers may
 * implement `mediaDevices` without `getDisplayMedia` (Firefox on Android
 * being the long-standing example), so this is its own probe.
 */
export function supportsDisplayMedia(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

/**
 * Build a default filename for a recording. `basename` is a hint
 * (e.g. user-typed name); when omitted, a sortable timestamp is used so
 * concurrent recordings don't collide.
 */
export function buildFilename(kind: CaptureKind, extension: string, basename?: string): string {
  const safe = basename
    ? basename
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, '-')
    : '';
  if (safe) return `${safe}${extension}`;
  const now = new Date();
  const stamp =
    now.getFullYear().toString().padStart(4, '0') +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') +
    '-' +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');
  const prefix = kind === 'audio' ? 'narration' : 'recording';
  return `${prefix}-${stamp}${extension}`;
}
