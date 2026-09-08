/**
 * Stop in-memory capture at 900 MiB, leaving room beneath a 1 GiB
 * storage limits for the encoder's final flush. MediaRecorder timeslices are
 * advisory: delayed chunks can exceed the threshold and must never be cut
 * off, because later chunks may be required to play the complete recording.
 */
export const DEFAULT_MAX_RECORDING_BYTES = 900 * 1024 * 1024;

export function resolveMaxRecordingBytes(value?: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_RECORDING_BYTES;
}

export function formatRecordingBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
