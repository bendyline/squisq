/**
 * Which media clip a media-edit request refers to, and its companions.
 *
 * A clip is addressed by its authoring line (the `{[audio …]}` annotation or
 * the standalone `<audio>` / `<video>` tag) because that is where the recipe
 * is written. Requests that only know a `src` (a WYSIWYG node view, a
 * right-click on an annotation paragraph) resolve to the first clip with that
 * source.
 */

import type { Block, Doc, MediaClip, MediaEdits } from '@bendyline/squisq/schemas';
import { collectDocMediaClips } from '@bendyline/squisq/mediaEdit';
import { splitKeyValueToken, tokenizeAttrTokens } from '@bendyline/squisq/markdown';
import { collectEmbeddedMedia } from '../embeddedMedia';
import type { MediaEditTarget } from '../EditorContext';

export interface EditableMedia {
  src: string;
  kind: 'audio' | 'video';
  /** 1-based authoring line — where the recipe is written. */
  sourceLine: number;
  edits?: MediaEdits;
  clipStart?: number;
  clipEnd?: number;
  startAt?: number;
  /** A MediaClip view of this media, for render keys and status lookups. */
  clip: MediaClip;
}

function flatten(blocks: readonly Block[], out: Block[] = []): Block[] {
  for (const block of blocks) {
    out.push(block);
    if (block.children?.length) flatten(block.children, out);
  }
  return out;
}

/** Every media reference in the doc that has an authoring line, in source order. */
export function listEditableMedia(doc: Doc): EditableMedia[] {
  const items: EditableMedia[] = [];
  for (const clip of collectDocMediaClips(doc)) {
    if (clip.sourceLine == null) continue;
    items.push({
      src: clip.src,
      kind: clip.kind,
      sourceLine: clip.sourceLine,
      ...(clip.edits ? { edits: clip.edits } : {}),
      ...(clip.clipStart != null ? { clipStart: clip.clipStart } : {}),
      ...(clip.clipEnd != null ? { clipEnd: clip.clipEnd } : {}),
      startAt: clip.startAt,
      clip,
    });
  }
  for (const block of flatten(doc.blocks)) {
    collectEmbeddedMedia(block).forEach((media, index) => {
      // A markdown link to a media file has nowhere to carry a recipe.
      if (media.sourceLine == null || media.form !== 'html') return;
      const clip: MediaClip = {
        id: `embedded:${block.id}:${index}`,
        src: media.src,
        kind: media.kind,
        startAt: media.startAt ?? 0,
        anchor: 'block',
        sourceLine: media.sourceLine,
        ...(media.clipStart != null ? { clipStart: media.clipStart } : {}),
        ...(media.clipEnd != null ? { clipEnd: media.clipEnd } : {}),
        ...(media.edits ? { edits: media.edits } : {}),
      };
      items.push({
        src: media.src,
        kind: media.kind,
        sourceLine: media.sourceLine,
        ...(media.edits ? { edits: media.edits } : {}),
        ...(media.clipStart != null ? { clipStart: media.clipStart } : {}),
        ...(media.clipEnd != null ? { clipEnd: media.clipEnd } : {}),
        ...(media.startAt != null ? { startAt: media.startAt } : {}),
        clip,
      });
    });
  }
  // One entry per authoring line (a placed <video> is both scheduled and embedded).
  const seen = new Set<number>();
  return items
    .sort((a, b) => a.sourceLine - b.sourceLine)
    .filter((item) => (seen.has(item.sourceLine) ? false : (seen.add(item.sourceLine), true)));
}

/** Resolve a request to a clip: by authoring line when known, else the first clip with that src. */
export function findEditableMedia(doc: Doc, target: MediaEditTarget): EditableMedia | null {
  const items = listEditableMedia(doc);
  if (target.sourceLine != null) {
    const byLine = items.find((item) => item.sourceLine === target.sourceLine);
    if (byLine) return byLine;
  }
  return items.find((item) => item.src === target.src) ?? null;
}

/** Other clips sharing this clip's `group` (e.g. the camera bubble of a screen recording). */
export function groupCompanions(doc: Doc, item: EditableMedia): EditableMedia[] {
  const group = item.edits?.group;
  if (!group) return [];
  return listEditableMedia(doc).filter(
    (other) => other.sourceLine !== item.sourceLine && other.edits?.group === group,
  );
}

/**
 * The media an annotation paragraph refers to, from its visible text
 * (`{[audio src=take.webm anchor=document]}`), or null for any other text.
 */
export function mediaTargetFromAnnotationText(text: string): MediaEditTarget | null {
  const match = text.trim().match(/^\{\[(audio|video|media)\b([\s\S]*)\]\}$/);
  if (!match) return null;
  let src: string | undefined;
  for (const token of tokenizeAttrTokens(match[2].trim())) {
    const kv = splitKeyValueToken(token);
    if (kv?.key === 'src') src = kv.value;
  }
  if (!src) return null;
  return { src, kind: match[1] === 'video' ? 'video' : 'audio' };
}

/**
 * The media target under a right-clicked element in the rendered editor: a
 * media node view (`data-squisq-media-src`) or an annotation paragraph.
 */
export function mediaTargetFromElement(element: Element): MediaEditTarget | null {
  const node = element.closest<HTMLElement>('[data-squisq-media-src]');
  if (node) {
    const src = node.dataset.squisqMediaSrc;
    const kind = node.dataset.squisqMediaKind === 'video' ? 'video' : 'audio';
    return src ? { src, kind } : null;
  }
  const paragraph = element.closest('p');
  return paragraph ? mediaTargetFromAnnotationText(paragraph.textContent ?? '') : null;
}

/**
 * Body-embedded media with a recipe, as clips for the render manager — the
 * document model does not schedule these itself.
 */
export function embeddedMediaClips(doc: Doc): MediaClip[] {
  const scheduled = new Set(collectDocMediaClips(doc).map((clip) => clip.sourceLine));
  return listEditableMedia(doc)
    .filter((item) => item.edits && !scheduled.has(item.sourceLine))
    .map((item) => item.clip);
}
