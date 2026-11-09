/** The features a narrated section embeds (videos, diagrams, tables and
 * pictures), which dynamic slides show beside its summaries: the visuals
 * rich-media layout places next to slide text (`appendRichContentLayers`).
 * A picture usually has its own full-bleed slide; it rides beside the text
 * only when no slide shows it that way.
 */
import type { Block, Doc } from '../schemas/Doc.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import { flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import {
  extractEmbeddedVideos,
  extractImages,
  isPictureFence,
  isPictureParagraph,
} from '../doc/templateInputs.js';
import { isStandaloneHtmlVideo } from '../doc/mediaAnnotations.js';
import { findBlockVideoEmbed } from '../markdown/videoEmbed.js';
import { isExplicitDiagramLang } from '../doc/asciiDiagram/detect.js';
import { isExplicitTimelineLang } from '../doc/asciiTimeline/detect.js';
import { isExplicitTreeLang } from '../doc/treeview/detect.js';
import { parseTimeSeconds } from '../markdown/annotationCoercion.js';
import { cloneData } from '../internal/immutable.js';

export interface PresentationMediaItem {
  /** `<section block id>#<index>` for videos and diagrams, `#table-<index>` and
   * `#image-<index>` for tables and pictures; stable while the section's
   * visuals are unchanged. */
  ref: string;
  kind: 'video' | 'diagram' | 'table' | 'image';
  /** The body node exactly as authored (a picture gets a paragraph of its
   * own); slides render it through rich-media layout. */
  node: MarkdownBlockNode;
  /** A diagram, table, picture, or an HTML video that can resume mid-clip on a
   * following slide. */
  continuous: boolean;
  /** A picture's source, matched against the slides that show it full-bleed. */
  src?: string;
}

/** Each block's own pictures. Children follow their parent in the flattened
 * order, so pictures are claimed children-first; a container template keeps
 * the pictures of its nested parts. */
export function presentationBlockImages(
  doc: Doc,
): Map<string, Array<{ src: string; alt: string; width?: number; height?: number }>> {
  const own = new Map<string, ReturnType<typeof extractImages>>();
  const seen = new Set<string>();
  const claim = (block: Block): ReturnType<typeof extractImages> => [
    ...extractImages(block.contents).filter((image) => {
      if (seen.has(image.src)) return false;
      seen.add(image.src);
      return true;
    }),
    ...(block.children ?? []).flatMap(claim),
  ];
  for (const block of [...flattenRenderableBlocks(doc.blocks)].reverse())
    own.set(block.id, claim(block));
  return own;
}

function mediaKind(
  node: MarkdownBlockNode,
): Omit<PresentationMediaItem, 'ref' | 'node' | 'src'> | null {
  if (node.type === 'table') return { kind: 'table', continuous: true };
  if (node.type === 'code')
    return isPictureFence(node) ||
      isExplicitDiagramLang(node.lang) ||
      isExplicitTreeLang(node.lang) ||
      isExplicitTimelineLang(node.lang)
      ? { kind: 'diagram', continuous: true }
      : null;
  if (isStandaloneHtmlVideo(node)) return { kind: 'video', continuous: true };
  // A hosted player or a clip in image syntax restarts on every slide it is on.
  if (
    findBlockVideoEmbed(node) ||
    (isPictureParagraph(node) && extractEmbeddedVideos([node]).length > 0)
  )
    return { kind: 'video', continuous: false };
  return null;
}

/** Each section's visuals in source order (a block's pictures after its other
 * visuals), claimed like images: a nested block's visuals belong to the
 * nearest narrated section at or before it. */
export function collectPresentationMedia(
  doc: Doc,
  sectionIds: string[],
): Map<string, PresentationMediaItem[]> {
  const sections = new Set(sectionIds);
  const result = new Map<string, PresentationMediaItem[]>();
  const pictures = presentationBlockImages(doc);
  let owner = sectionIds[0];
  for (const block of flattenRenderableBlocks(doc.blocks)) {
    if (sections.has(block.id)) owner = block.id;
    if (!owner) continue;
    const items = result.get(owner) ?? [];
    const count = (kind: PresentationMediaItem['kind']) =>
      items.filter((item) => item.kind === kind).length;
    for (const node of block.contents ?? []) {
      const kind = mediaKind(node);
      if (!kind) continue;
      // Videos and diagrams keep the plain numbering saved plans refer to.
      const ref =
        kind.kind === 'table'
          ? `${owner}#table-${count('table')}`
          : `${owner}#${count('video') + count('diagram')}`;
      items.push({ ...kind, ref, node });
    }
    for (const { src, alt, width, height } of pictures.get(block.id) ?? [])
      items.push({
        kind: 'image',
        continuous: true,
        ref: `${owner}#image-${count('image')}`,
        src,
        node: {
          type: 'paragraph',
          children: [
            {
              type: 'image',
              url: src,
              alt,
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {}),
            },
          ],
        },
      });
    if (items.length) result.set(owner, items);
  }
  return result;
}

function videoElements(node: unknown, found: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return found;
  const value = node as Record<string, unknown>;
  if (value.type === 'htmlElement' && value.tagName === 'video') found.push(value);
  for (const key of ['children', 'htmlChildren'])
    if (Array.isArray(value[key])) for (const child of value[key]) videoElements(child, found);
  return found;
}

/** A copy of `item`'s node for a slide that begins `elapsed` seconds after the
 * first slide showing it: a video picks up where that slide left off, and is
 * dropped once its authored out-point has passed. */
export function presentationMediaNode(
  item: PresentationMediaItem,
  elapsed: number,
): MarkdownBlockNode | null {
  const node = cloneData(item.node);
  if (item.kind !== 'video' || elapsed <= 0) return node;
  for (const element of videoElements(node)) {
    const attributes = (element.attributes ?? {}) as Record<string, string>;
    const seconds = (name: string) =>
      attributes[name] ? parseTimeSeconds(attributes[name]) : null;
    const from =
      (seconds('data-squisq-video-clip-start') ?? 0) +
      Math.max(0, elapsed - (seconds('data-squisq-video-start-at') ?? 0));
    const until = seconds('data-squisq-video-clip-end');
    if (until !== null && from >= until) return null;
    delete attributes['data-squisq-video-start-at'];
    element.attributes = { ...attributes, 'data-squisq-video-clip-start': String(from) };
  }
  return node;
}
