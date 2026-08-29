/**
 * documentNarrationInsertion — turn a recorder save into a **document
 * narration**: the recording that runs alongside the whole document rather
 * than one block's worth of it.
 *
 * Capture is identical to an ordinary "Record media" insert (same dialog,
 * same `MediaProvider` write). Only the resulting markdown differs, in two
 * ways:
 *
 * 1. **Placement in the source** — the tag lands at the top of the document's
 *    FIRST block (immediately after its heading), not at the caret. An
 *    unlocked HTML video with no authored `data-squisq-video-start-at` is
 *    document-timed from its owning block's start (`markdownToDoc`), so
 *    living in the first block is what makes it begin at t=0, when playback
 *    starts.
 * 2. **Scheduling** — video is emitted as an `overlay` clip with
 *    `data-squisq-video-lock-to-block="false"`, which `htmlVideoClip` reads
 *    as `anchor: 'document'`. The take therefore plays across every block for
 *    its full length instead of being clipped to the block that hosts the tag.
 *
 * A `'screen+camera'` take reuses {@link buildDualClipInsertion} verbatim —
 * that pair (screen overlay + camera picture-in-picture) is already unlocked
 * and document-anchored, so the only thing this module changes for it is
 * where the two tags are written.
 *
 * An audio-only take has no overlay to place: its document-spanning form is
 * the `{[audio … anchor=document]}` annotation the teleprompter's narration
 * pipeline also writes, so we emit exactly that.
 *
 * ## Replacing a previous narration
 *
 * Like `insertNarrationPreamble`, a re-record replaces the previous take
 * rather than stacking a second document-anchored track. Matching is by ROLE
 * (an unlocked scheduled `<video>`, or a document-anchored `{[audio …]}`) and
 * confined to the blank-padded run at the insertion point — the region this
 * module owns. Tags the user wrote elsewhere are never touched.
 */

import type { RecorderSaveResult } from './RecorderModal.js';
import { buildDualClipInsertion } from './dualClipInsertion.js';
import { markdownFencedCodeLineMask } from '../markdownCodeFence.js';

/** Preview width for the full-frame overlay clip, matching the dual-clip screen tag. */
const OVERLAY_WIDTH = 480;

/** Round seconds to 2 dp for a time attribute (`parseTimeSeconds` takes unsigned decimals). */
function fmtSeconds(n: number): string {
  return String(Math.round(Math.max(0, n) * 100) / 100);
}

function quoteSrc(path: string): string {
  return /[\s"']/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

/**
 * The `<video>` tag for a solo document narration: full-frame overlay,
 * unlocked from its host block, capped at the take's own length.
 *
 * Attribute order matches `serializeMediaTag` in `tiptapBridge.ts` (and
 * `dualClipInsertion`), so the same clip re-serializes byte-identically after
 * a WYSIWYG round-trip.
 */
export function documentNarrationVideoTag(src: string, duration: number): string {
  return (
    `<video src="${src}" controls width="${OVERLAY_WIDTH}"` +
    ` data-squisq-video-placement="overlay"` +
    ` data-squisq-video-lock-to-block="false"` +
    ` data-squisq-video-clip-end="${fmtSeconds(duration)}"></video>`
  );
}

/** The document-anchored annotation for an audio-only take. */
export function documentNarrationAudioTag(src: string): string {
  return `{[audio src=${quoteSrc(src)} anchor=document]}`;
}

/**
 * `TiptapVideo` node attrs equivalent to {@link documentNarrationVideoTag},
 * for inserting into the WYSIWYG surface rather than the raw source.
 */
export function documentNarrationVideoAttrs(
  src: string,
  duration: number,
): Record<string, unknown> {
  return {
    src,
    controls: true,
    width: OVERLAY_WIDTH,
    placement: 'overlay',
    lockToBlock: false,
    clipEnd: Number(fmtSeconds(duration)),
  };
}

/**
 * The markdown line(s) a save contributes, in emission order. Multiple lines
 * are written blank-separated so each is its own markdown block (which is what
 * `extractMediaFromContents` requires to lift them into clips).
 */
export function buildDocumentNarrationTags(result: RecorderSaveResult): string[] {
  const dual = buildDualClipInsertion(result);
  // Screen first: DOM order is z-order, so the camera bubble sits on top.
  if (dual) return [dual.screenTag, dual.cameraTag];
  if (result.mediaKind === 'audio') return [documentNarrationAudioTag(result.relativePath)];
  return [documentNarrationVideoTag(result.relativePath, result.duration)];
}

// ── Source placement ───────────────────────────────────────────────

/** Any media annotation for the `audio` kind, whatever its attributes. */
const AUDIO_ANNOTATION_LINE = /^\{\[audio\s[^\]]*\]\}\s*$/;
/** `anchor=document`, tolerating quoted forms and any attribute order. */
const DOCUMENT_ANCHOR = /\banchor=(?:"document"|'document'|document)(?:\s|\]|$)/;
/** A standalone `<video …></video>` line carrying an explicit scheduled placement. */
const SCHEDULED_VIDEO_LINE = /^<video\s[^>]*data-squisq-video-placement="[^"]+"[^>]*><\/video>\s*$/;
/** The unlock flag that makes a scheduled video document-anchored. */
const UNLOCKED = /\bdata-squisq-video-lock-to-block="(?:false|0)"/;

/**
 * Whether `line` is a tag this module owns — i.e. one a previous document
 * narration wrote. Deliberately path-agnostic: `MediaProvider.addMedia` may
 * rename or relocate the file, so a path-shaped matcher would miss the very
 * tag it wrote and let the next take stack a second document track.
 */
function isDocumentNarrationLine(line: string): boolean {
  if (AUDIO_ANNOTATION_LINE.test(line)) return DOCUMENT_ANCHOR.test(line);
  return SCHEDULED_VIDEO_LINE.test(line) && UNLOCKED.test(line);
}

/**
 * Line index (0-based) where the first block's body begins: just after the
 * document's first heading, skipping frontmatter and fenced code.
 *
 * With no heading at all the whole document is one heading-less preamble
 * block, so its body starts right after the frontmatter.
 */
export function firstBlockBodyLine(lines: string[]): number {
  let start = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        start = i + 1;
        break;
      }
    }
  }
  const fenced = markdownFencedCodeLineMask(lines.join('\n'));
  for (let i = start; i < lines.length; i++) {
    if (fenced[i]) continue;
    if (/^#{1,6}\s/.test(lines[i])) return i + 1;
  }
  return start;
}

/**
 * Write `tags` at the top of the document's first block, replacing whatever
 * previous document narration occupies that slot.
 *
 * Pure string → string; the caller composes it into a single
 * `setMarkdownSource` write (the single-write rule).
 */
export function insertDocumentNarration(source: string, tags: string[]): string {
  if (tags.length === 0) return source;
  const lines = source.split('\n');
  const insertAt = firstBlockBodyLine(lines);

  // Consume the run of narration lines already sitting at the insertion point
  // (blank lines between them allowed), plus the blank that trails it, so a
  // retake is byte-idempotent instead of accumulating gaps.
  let scan = insertAt;
  let removeEnd = insertAt;
  for (;;) {
    while (scan < lines.length && lines[scan].trim() === '') scan++;
    if (scan >= lines.length || !isDocumentNarrationLine(lines[scan])) break;
    scan++;
    removeEnd = scan;
  }
  if (removeEnd > insertAt) {
    // Splice from `insertAt` so leading blanks go too and the re-inserted run
    // lands with normalized spacing.
    while (removeEnd < lines.length && lines[removeEnd].trim() === '') removeEnd++;
    lines.splice(insertAt, removeEnd - insertAt);
  }

  const inserted: string[] = [];
  for (const tag of tags) {
    if (inserted.length > 0) inserted.push('');
    inserted.push(tag);
  }

  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  // Blank-line separation on both sides, so the tags are their own markdown
  // blocks rather than being folded into the heading or the prose below.
  if (before.length > 0 && before[before.length - 1].trim() !== '') before.push('');
  if (after.length > 0 && after[0].trim() !== '') inserted.push('');

  return [...before, ...inserted, ...after].join('\n');
}
