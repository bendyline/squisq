/**
 * Pure markdown edit: insert (or replace) the narration reference at the
 * start of the document.
 *
 * The narration take is referenced by a preamble media annotation —
 * `{[audio src=audio/narration-….webm anchor=document]}` — the canonical
 * authored form `markdownToDoc` lifts into `doc.documentMedia`. A prior
 * teleprompter take's line (matched by the `audio/narration-` prefix +
 * `anchor=document`) is replaced, so retakes swap the reference instead
 * of stacking narrations. The optional camera companion rides on the
 * next line as an inline `<video>` (deliberately NOT doc-anchored:
 * document-anchored video renders full-bleed behind every block and is
 * excluded from export audio — not a talking head).
 */

const NARRATION_LINE =
  /^\{\[audio\s[^\]]*src="?audio\/narration-[^\]]*anchor=document[^\]]*\]\}\s*$/;
const CAMERA_LINE = /^<video\s[^>]*src="video\/narration-cam-[^"]*"[^>]*><\/video>\s*$/;

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

  // Remove a previous take's annotation (+ adjacent camera line).
  for (let i = 0; i < lines.length; i++) {
    if (!NARRATION_LINE.test(lines[i])) continue;
    let removeEnd = i + 1;
    while (removeEnd < lines.length && lines[removeEnd].trim() === '') removeEnd++;
    if (removeEnd < lines.length && CAMERA_LINE.test(lines[removeEnd])) removeEnd++;
    // Also consume one trailing blank so we don't accumulate gaps.
    if (removeEnd < lines.length && lines[removeEnd].trim() === '') removeEnd++;
    lines.splice(i, removeEnd - i);
    if (insertAt > i) insertAt = Math.max(0, insertAt - (removeEnd - i));
    break;
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
