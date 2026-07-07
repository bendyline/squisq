/**
 * Media-annotation extraction.
 *
 * Lifts standalone body-level media annotations — `{[audio …]}` / `{[video …]}`
 * — out of a block's markdown contents into typed {@link MediaClip}s. A block
 * can hold several clips (unlike the single heading annotation). An annotation
 * flagged `anchor=document` (or `span=document`) becomes a document-spanning
 * clip instead. The annotation grammar is the shared one used for heading
 * annotations, so quoting/escaping behave identically.
 */

import { parseTimeSeconds } from '../markdown/annotationCoercion.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import type { MediaClip } from '../schemas/Media.js';
import { parseStandaloneAnnotation, type ParsedAnnotation } from './standaloneAnnotation.js';

/** Annotation template names that produce a timed media clip. */
const MEDIA_TEMPLATES = new Set(['audio', 'video', 'media']);

/**
 * Whether a standalone-annotation template name is a media name
 * (`audio`/`video`/`media`). The standalone template-block extractor uses
 * this to leave media annotations to {@link extractMediaFromContents}.
 */
export function isMediaAnnotationName(name: string | undefined): boolean {
  return name != null && MEDIA_TEMPLATES.has(name);
}

function time(raw: string | undefined): number | null {
  if (raw == null) return null;
  return parseTimeSeconds(raw);
}

/** Build a {@link MediaClip} from a parsed media annotation, or null if invalid. */
function toMediaClip(parsed: ParsedAnnotation, id: string): MediaClip | null {
  const { template, params } = parsed;
  if (!template || !MEDIA_TEMPLATES.has(template)) return null;
  const src = params.src;
  if (!src) return null;

  const kind: MediaClip['kind'] = template === 'video' ? 'video' : 'audio';
  const anchor: MediaClip['anchor'] =
    params.anchor === 'document' || params.span === 'document' ? 'document' : 'block';
  // `startAt` is canonical; `startTime` is accepted as an alias (it is the
  // heading-attribute spelling, so authors reach for it here too).
  const clip: MediaClip = {
    id,
    src,
    kind,
    startAt: time(params.startAt ?? params.startTime) ?? 0,
    anchor,
  };

  const clipStart = time(params.clipStart);
  const clipEnd = time(params.clipEnd);
  if (clipStart != null) clip.clipStart = clipStart;
  if (clipEnd != null) clip.clipEnd = clipEnd;
  // `spillover` or `spillover=true` → true; absent/`false` → omitted.
  if (params.spillover === 'true' || params.spillover === '') clip.spillover = true;

  return clip;
}

export interface MediaExtraction {
  /** Block-anchored clips (anchor='block'). */
  media: MediaClip[];
  /** Document-spanning clips (anchor='document'). */
  documentMedia: MediaClip[];
  /** Contents with the lifted media-annotation paragraphs removed. */
  remaining: MarkdownBlockNode[];
}

/**
 * Walk `contents`, lifting every standalone media annotation into a
 * {@link MediaClip}. `makeId(src, index)` produces stable clip ids.
 */
export function extractMediaFromContents(
  contents: MarkdownBlockNode[] | undefined,
  makeId: (src: string, index: number) => string,
): MediaExtraction {
  const media: MediaClip[] = [];
  const documentMedia: MediaClip[] = [];
  const remaining: MarkdownBlockNode[] = [];
  let index = 0;

  for (const node of contents ?? []) {
    const parsed = parseStandaloneAnnotation(node);
    const clip = parsed ? toMediaClip(parsed, '') : null;
    if (parsed && clip) {
      clip.id = makeId(clip.src, index++);
      const line = node.position?.start.line;
      if (line != null) clip.sourceLine = line;
      (clip.anchor === 'document' ? documentMedia : media).push(clip);
    } else {
      remaining.push(node);
    }
  }

  return { media, documentMedia, remaining };
}
