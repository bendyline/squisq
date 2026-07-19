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
import type { HtmlElement, HtmlNode, MarkdownBlockNode } from '../markdown/types.js';
import type { MediaClip, VideoPlacement } from '../schemas/Media.js';
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

function videoPlacement(params: Record<string, string>): VideoPlacement | undefined {
  const explicit = params.placement ?? params.presentation;
  if (explicit === 'content') return 'content';
  if (explicit === 'pip' || explicit === 'picture-in-picture') return 'picture-in-picture';
  if (explicit === 'overlay' || explicit === 'full-frame') return 'overlay';
  if (params.pip === '' || params.pip === 'true') return 'picture-in-picture';
  if (params.overlay === '' || params.overlay === 'true') return 'overlay';
  return undefined;
}

function lockToBlock(raw: string | undefined): boolean {
  return raw !== 'false' && raw !== '0';
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

  const placement = kind === 'video' ? videoPlacement(params) : undefined;
  // A standalone media annotation is inherently scheduled rather than block
  // content. Treat `content` as no override instead of emitting an impossible
  // scheduled-content state.
  if (placement && placement !== 'content') clip.placement = placement;

  if (kind === 'video' && placement && placement !== 'content' && params.lockToBlock != null) {
    const locked = lockToBlock(params.lockToBlock);
    clip.lockToBlock = locked;
    clip.anchor = locked ? 'block' : 'document';
    if (locked) clip.startAt = 0;
  }

  const clipStart = time(params.clipStart);
  const clipEnd = time(params.clipEnd);
  if (clipStart != null) clip.clipStart = clipStart;
  if (clipEnd != null) clip.clipEnd = clipEnd;
  if (clip.lockToBlock === true) delete clip.clipEnd;
  // `spillover` or `spillover=true` → true; absent/`false` → omitted.
  if (params.spillover === 'true' || params.spillover === '') clip.spillover = true;

  return clip;
}

function firstVideoElement(children: HtmlNode[]): HtmlElement | null {
  const visit = (nodes: HtmlNode[]): HtmlElement | null => {
    for (const child of nodes) {
      if (child.type !== 'htmlElement') continue;
      if (child.tagName === 'video') return child;
      const nested = visit(child.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(children);
}

function standaloneHtmlVideo(
  node: MarkdownBlockNode,
): { element: HtmlElement; raw: string } | null {
  if (node.type === 'htmlBlock') {
    // The WYSIWYG video atom serializes as a standalone tag. Avoid promoting
    // a video nested inside a larger raw-HTML component, because removing that
    // whole markdown node would also remove its surrounding authored content.
    if (!/^\s*<video\b/i.test(node.rawHtml)) return null;
    const element = firstVideoElement(node.htmlChildren);
    return element ? { element, raw: node.rawHtml.trim() } : null;
  }

  // CommonMark parses `<video>` as inline HTML inside a paragraph. Accept it
  // only when the entire paragraph is the video tag.
  if (node.type !== 'paragraph' || !node.children.every((child) => child.type === 'htmlInline')) {
    return null;
  }
  const raw = node.children
    .map((child) => (child.type === 'htmlInline' ? child.rawHtml : ''))
    .join('');
  if (!/^\s*<video\b[\s\S]*<\/video>\s*$/i.test(raw)) return null;
  for (const child of node.children) {
    if (child.type !== 'htmlInline') continue;
    const element = firstVideoElement(child.htmlChildren);
    if (element) return { element, raw: raw.trim() };
  }
  return null;
}

/**
 * Promote a standalone HTML video with an explicit non-content placement to
 * the same typed schedule used by `{[video ...]}` annotations. Plain videos
 * remain untouched in the block body and continue through rich-media layout.
 */
function htmlVideoClip(node: MarkdownBlockNode, id: string): MediaClip | null {
  const authored = standaloneHtmlVideo(node);
  if (!authored) return null;
  const { element } = authored;
  const placement = videoPlacement({
    placement: element.attributes['data-squisq-video-placement'] ?? '',
  });
  if (!placement || placement === 'content') return null;
  const src = element.attributes.src;
  if (!src) return null;
  const locked = lockToBlock(element.attributes['data-squisq-video-lock-to-block']);
  const clip: MediaClip = {
    id,
    src,
    kind: 'video',
    placement,
    lockToBlock: locked,
    startAt: locked ? 0 : (time(element.attributes['data-squisq-video-start-at']) ?? 0),
    anchor: locked ? 'block' : 'document',
  };
  const clipStart = time(element.attributes['data-squisq-video-clip-start']);
  const clipEnd = time(element.attributes['data-squisq-video-clip-end']);
  if (clipStart != null) clip.clipStart = clipStart;
  // Locked videos deliberately fill/cap to the owning block. Preserve an
  // authored independent out-point in raw HTML, but only apply it while the
  // video is unlocked.
  if (!locked && clipEnd != null) clip.clipEnd = clipEnd;
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
 * When `blockId` is given, each clip records its round-trip `origin` —
 * the owning block, its position in the ORIGINAL contents array, and
 * the annotation paragraph's exact text — so `docToMarkdown` can
 * re-insert it byte-stably.
 */
export function extractMediaFromContents(
  contents: MarkdownBlockNode[] | undefined,
  makeId: (src: string, index: number) => string,
  blockId?: string,
): MediaExtraction {
  const media: MediaClip[] = [];
  const documentMedia: MediaClip[] = [];
  const remaining: MarkdownBlockNode[] = [];
  let index = 0;
  let originalIndex = 0;

  for (const node of contents ?? []) {
    const parsed = parseStandaloneAnnotation(node);
    const clip = parsed ? toMediaClip(parsed, '') : htmlVideoClip(node, '');
    if (clip) {
      clip.id = makeId(clip.src, index++);
      const line = node.position?.start.line;
      if (line != null) clip.sourceLine = line;
      if (blockId !== undefined) {
        // parseStandaloneAnnotation only matches a paragraph with exactly
        // one text child, so this read is safe when `parsed` is non-null.
        const authoredHtml = standaloneHtmlVideo(node);
        const rawText =
          node.type === 'paragraph' && node.children?.[0]?.type === 'text'
            ? node.children[0].value.trim()
            : authoredHtml?.raw;
        clip.origin = {
          blockId,
          index: originalIndex,
          ...(rawText !== undefined ? { raw: rawText } : {}),
          ...(authoredHtml ? { format: 'html' as const } : {}),
        };
      }
      (clip.anchor === 'document' ? documentMedia : media).push(clip);
    } else {
      remaining.push(node);
    }
    originalIndex++;
  }

  return { media, documentMedia, remaining };
}
