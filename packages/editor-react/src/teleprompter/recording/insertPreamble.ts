/**
 * Pure markdown edit: insert (or replace) the narration reference at the
 * start of the document.
 *
 * The narration take is referenced by a preamble media annotation —
 * `{[audio src=audio/narration-….webm anchor=document]}` — the canonical
 * authored form `markdownToDoc` lifts into `doc.documentMedia`. A prior
 * teleprompter take's line is replaced, so retakes swap the reference
 * instead of stacking narrations. The optional camera companion rides on
 * the next line as an inline `<video>` (deliberately NOT doc-anchored:
 * document-anchored video renders full-bleed behind every block and is
 * excluded from export audio — not a talking head).
 *
 * ## Matching a prior take by ROLE, not by path
 *
 * These patterns deliberately do not encode a `audio/narration-` /
 * `video/narration-cam-` path prefix. `narrationSave` treats the path
 * RETURNED by `MediaProvider.addMedia` as authoritative because providers
 * may rename or relocate the file, so a path-shaped matcher misses the
 * very annotation it wrote and the next retake stacks a second one — two
 * document-anchored audio tracks playing at once.
 *
 * Instead we match the annotation's ROLE, scoped to POSITION:
 *
 * - Narration: a `{[audio … anchor=document …]}` line. Document-anchored
 *   audio is a single-occupancy slot (it becomes `doc.documentMedia` and
 *   is what `applyNarrationTiming` / `resolveAudioMapping` treat as *the*
 *   narration), so replacing whatever occupies it is exactly right —
 *   two of them is never a valid document.
 * - Camera: a `<video …></video>` line sitting immediately after that
 *   narration line (blank lines allowed between). Adjacency to the
 *   preamble is the role marker here — an inline `<video>` carries no
 *   anchor of its own, and this is the exact shape `cameraVideoLine`
 *   emits as part of the same insert.
 *
 * Both matchers are confined to the PREAMBLE REGION — the blank-padded run
 * at the insertion point (top of file, or just after the frontmatter fence).
 * Role alone is not enough: matching document-wide would let a retake
 * silently replace a background-music annotation the user wrote further
 * down, or consume whichever `<video>` of theirs happened to follow it.
 * Content outside the region we wrote is never touched.
 */

/** Any media annotation for the `audio` kind, whatever its attributes. */
const AUDIO_ANNOTATION_LINE = /^\{\[audio\s[^\]]*\]\}\s*$/;
/** `anchor=document`, tolerating quoted forms and any attribute order. */
const DOCUMENT_ANCHOR = /\banchor=(?:"document"|'document'|document)(?:\s|\]|$)/;
/** An inline `<video src="…"></video>` line, whatever path it points at. */
const CAMERA_LINE = /^<video\s[^>]*src="[^"]*"[^>]*><\/video>\s*$/;

/**
 * Whether `line` is the document-anchored narration annotation — the slot
 * a retake replaces. Path-agnostic on purpose (see module docs).
 */
function isNarrationLine(line: string): boolean {
  return AUDIO_ANNOTATION_LINE.test(line) && DOCUMENT_ANCHOR.test(line);
}

function quoteSrc(path: string): string {
  return /[\s"']/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

export function narrationAnnotationLine(audioPath: string): string {
  return `{[audio src=${quoteSrc(audioPath)} anchor=document]}`;
}

export function cameraVideoLine(cameraPath: string): string {
  return `<video src="${cameraPath}" controls width="240"></video>`;
}

/**
 * Insert the narration preamble after the frontmatter (or at the top),
 * replacing any previous teleprompter take's lines.
 */
export function insertNarrationPreamble(
  source: string,
  audioPath: string,
  cameraPath: string | null,
): string {
  const lines = source.split('\n');

  // Locate the insertion point: after a closing frontmatter fence.
  let insertAt = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        insertAt = i + 1;
        break;
      }
    }
  }

  // Remove a previous take's annotation (+ adjacent camera line) — but only
  // within the PREAMBLE REGION we own: the blank-padded run sitting at the
  // insertion point. Scanning the whole document would let a retake swallow
  // content the user wrote themselves — a document-anchored background-music
  // annotation further down, or whichever `<video>` happened to follow it.
  let scan = insertAt;
  while (scan < lines.length && lines[scan].trim() === '') scan++;
  if (scan < lines.length && isNarrationLine(lines[scan])) {
    let removeEnd = scan + 1;
    while (removeEnd < lines.length && lines[removeEnd].trim() === '') removeEnd++;
    if (removeEnd < lines.length && CAMERA_LINE.test(lines[removeEnd])) removeEnd++;
    // Also consume one trailing blank so we don't accumulate gaps.
    if (removeEnd < lines.length && lines[removeEnd].trim() === '') removeEnd++;
    // Splice from `insertAt` so the leading blanks go too and the re-inserted
    // preamble lands with normalized spacing (keeps retakes byte-idempotent).
    lines.splice(insertAt, removeEnd - insertAt);
  }

  const inserted: string[] = [narrationAnnotationLine(audioPath)];
  if (cameraPath) {
    inserted.push('', cameraVideoLine(cameraPath));
  }

  // Blank-line separation on both sides (unless at the very top with
  // content immediately following, where only the trailing blank matters).
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  if (before.length > 0 && before[before.length - 1].trim() !== '') before.push('');
  if (after.length > 0 && after[0].trim() !== '') inserted.push('');

  return [...before, ...inserted, ...after].join('\n');
}
