/** The videos and diagrams a narrated section embeds, which dynamic slides show
 * beside its summaries. Images keep their own full-bleed slides; these are the
 * visuals rich-media layout places next to slide text (`appendRichContentLayers`).
 */
import type { Doc } from '../schemas/Doc.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import { flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import {
  extractEmbeddedVideos,
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
  /** `<section block id>#<index>`, stable while the section's visuals are unchanged. */
  ref: string;
  kind: 'video' | 'diagram';
  /** The body node exactly as authored; slides render it through rich-media layout. */
  node: MarkdownBlockNode;
  /** A diagram, or an HTML video that can resume mid-clip on a following slide. */
  continuous: boolean;
}

function mediaKind(node: MarkdownBlockNode): Omit<PresentationMediaItem, 'ref' | 'node'> | null {
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

/** Each section's visuals in source order, claimed like images: a nested
 * block's visuals belong to the nearest narrated section at or before it. */
export function collectPresentationMedia(
  doc: Doc,
  sectionIds: string[],
): Map<string, PresentationMediaItem[]> {
  const sections = new Set(sectionIds);
  const result = new Map<string, PresentationMediaItem[]>();
  let owner = sectionIds[0];
  for (const block of flattenRenderableBlocks(doc.blocks)) {
    if (sections.has(block.id)) owner = block.id;
    if (!owner) continue;
    for (const node of block.contents ?? []) {
      const kind = mediaKind(node);
      if (!kind) continue;
      const items = result.get(owner) ?? [];
      items.push({ ...kind, ref: `${owner}#${items.length}`, node });
      result.set(owner, items);
    }
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
