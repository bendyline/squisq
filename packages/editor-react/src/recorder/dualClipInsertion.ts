/**
 * dualClipInsertion — turn a `'screen+camera'` save into the two scheduled
 * `<video>` clips the document needs for composed playback.
 *
 * The screen recording becomes a full-frame **overlay** clip and the camera
 * recording a **picture-in-picture** bubble, both document-anchored so they
 * play on the doc timeline together (the browser mixes their audio). The
 * measured start skew between the two files (`camera.offsetSec`) is folded into
 * the camera clip's `startAt` / `clipStart` so the presenter lines up with the
 * screen.
 *
 * Both the raw-markdown tags and the equivalent `TiptapVideo` attrs are
 * produced here. The tag attribute order matches `serializeMediaTag` in
 * `tiptapBridge.ts`, so a WYSIWYG insert re-serializes byte-for-byte identical
 * to the raw insert, and `htmlVideoClip` in core reparses either into the same
 * `MediaClip`s (`anchor='document'`, overlay + picture-in-picture).
 */

import type { RecorderSaveResult } from './RecorderModal.js';

/** The two clips to insert for a dual (screen + camera) recording. */
export interface DualClipInsertion {
  /** Raw-markdown `<video>` tag for the screen (overlay) clip. */
  screenTag: string;
  /** Raw-markdown `<video>` tag for the camera (picture-in-picture) clip. */
  cameraTag: string;
  /** `TiptapVideo` node attrs for the screen clip. */
  screenAttrs: Record<string, unknown>;
  /** `TiptapVideo` node attrs for the camera clip. */
  cameraAttrs: Record<string, unknown>;
}

/**
 * Below this many seconds a start skew is treated as zero — well under the
 * jitter of `MediaRecorder.onstart` timestamps, and it keeps the emitted
 * markup free of near-zero `startAt`/`clipStart` attributes.
 */
const SKEW_EPSILON = 0.05;

/**
 * Format seconds for a time annotation. `parseTimeSeconds` accepts only
 * unsigned decimals, so clamp to ≥ 0 and round to 2 dp.
 */
function fmtSeconds(n: number): string {
  return String(Math.round(Math.max(0, n) * 100) / 100);
}

/**
 * Build the two scheduled clips for a dual recording, or null when the result
 * is not a `'screen+camera'` save (no camera companion).
 */
export function buildDualClipInsertion(result: RecorderSaveResult): DualClipInsertion | null {
  if (result.source !== 'screen+camera' || !result.camera) return null;

  const screenClipEnd = fmtSeconds(result.duration);
  const offset = result.camera.offsetSec;

  // Positive skew: camera started AFTER the screen — delay the bubble by
  // `startAt`. Negative skew: camera started FIRST — trim its head with
  // `clipStart`. Both algebraically leave the camera length at
  // `camera.duration` (= duration − offset).
  const startAt = offset >= SKEW_EPSILON ? fmtSeconds(offset) : undefined;
  const clipStart = offset <= -SKEW_EPSILON ? fmtSeconds(-offset) : undefined;
  const cameraClipEnd = fmtSeconds(result.camera.duration);

  const screenTag =
    `<video src="${result.relativePath}" controls width="480"` +
    ` data-squisq-video-placement="overlay"` +
    ` data-squisq-video-lock-to-block="false"` +
    ` data-squisq-video-clip-end="${screenClipEnd}"></video>`;

  const cameraTag =
    `<video src="${result.camera.relativePath}" controls width="240"` +
    ` data-squisq-video-placement="picture-in-picture"` +
    ` data-squisq-video-lock-to-block="false"` +
    (startAt != null ? ` data-squisq-video-start-at="${startAt}"` : '') +
    (clipStart != null ? ` data-squisq-video-clip-start="${clipStart}"` : '') +
    ` data-squisq-video-clip-end="${cameraClipEnd}"></video>`;

  const screenAttrs: Record<string, unknown> = {
    src: result.relativePath,
    controls: true,
    width: 480,
    placement: 'overlay',
    lockToBlock: false,
    clipEnd: Number(screenClipEnd),
  };

  const cameraAttrs: Record<string, unknown> = {
    src: result.camera.relativePath,
    controls: true,
    width: 240,
    placement: 'picture-in-picture',
    lockToBlock: false,
    clipEnd: Number(cameraClipEnd),
  };
  if (startAt != null) cameraAttrs.startAt = Number(startAt);
  if (clipStart != null) cameraAttrs.clipStart = Number(clipStart);

  return { screenTag, cameraTag, screenAttrs, cameraAttrs };
}
