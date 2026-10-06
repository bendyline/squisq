/**
 * Diagrams as pictures for document exports.
 *
 * DOCX, EPUB and PDF have no Mermaid or Squisq renderer, so a diagram would
 * export as its source text. `rasterizeDiagrams` finds every diagram in a
 * MarkdownDocument, asks a host-supplied renderer for a picture of it, and
 * returns the document with each pictured diagram swapped for an image plus
 * the picture bytes, ready for the exporters' `images` option. The renderer
 * is supplied by the host because drawing needs a browser (Mermaid lays out
 * text with the DOM); this module is environment-neutral.
 *
 * Diagrams are recognized the way the player recognizes them:
 * - ```mermaid fences;
 * - ASCII-art ```diagram, ```tree, and ```timeline fences (also unlabeled or
 *   `text` fences whose content the detectors accept);
 * - heading blocks with a container template — `{[drawing]}`, `{[layout]}`,
 *   `{[diagram]}` — together with every child heading they own.
 *
 * `docToPptx` keeps drawings, timelines and ASCII diagrams as native shapes;
 * for it, use the returned `mermaid` map as its `diagramImages` option.
 */

import type {
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownDocument,
  MarkdownHeading,
  MarkdownImage,
  MarkdownNode,
  MarkdownParagraph,
} from '@bendyline/squisq/markdown';
import { extractPlainText, stringifyMarkdown } from '@bendyline/squisq/markdown';
import {
  detectAsciiDiagram,
  detectAsciiTimeline,
  detectTree,
  isContainerTemplate,
  isEligibleAsciiFenceLang,
  isEligibleAsciiTimelineFenceLang,
  isEligibleTreeFenceLang,
  isExplicitDiagramLang,
  isExplicitTimelineLang,
  isExplicitTreeLang,
  resolveTemplateName,
} from '@bendyline/squisq/doc';

/** What kind of diagram a picture is wanted for. */
export type ExportDiagramKind = 'mermaid' | 'diagram' | 'timeline' | 'tree' | 'container';

export interface ExportDiagram {
  readonly kind: ExportDiagramKind;
  /**
   * The diagram's own markdown: its fence, or for a container its heading
   * and every child heading and body it owns.
   */
  readonly markdown: string;
  /** The fence content for fence kinds; '' for containers. */
  readonly source: string;
  /** The container's template (`drawing`, `layout`, `diagram`); '' for fences. */
  readonly template: string;
  /** A text alternative for the picture. */
  readonly alt: string;
}

/** A PNG picture of a diagram, with the size it should display at. */
export interface DiagramPicture {
  readonly data: ArrayBuffer | Uint8Array;
  /** Display size in CSS pixels (96 per inch); the PNG may be denser. */
  readonly width: number;
  readonly height: number;
}

/** Draws one diagram; resolves to null to leave that diagram as source. */
export type DiagramRasterizer = (diagram: ExportDiagram) => Promise<DiagramPicture | null>;

export interface RasterizeDiagramsOptions {
  signal?: AbortSignal;
  /** Limit the kinds pictured. Default: all of them. */
  kinds?: readonly ExportDiagramKind[];
  /** Prefix for the image URLs written into the document. Default: `diagram`. */
  urlPrefix?: string;
  /** Receives a note for each diagram the renderer could not draw. */
  onWarning?: (message: string) => void;
}

export interface RasterizedDiagrams {
  /** The document with each pictured diagram replaced by an image of it. */
  readonly markdownDoc: MarkdownDocument;
  /**
   * Picture bytes keyed by the image URL written into `markdownDoc`, in the
   * shape the DOCX and PDF exporters take; EPUB takes `data` alone.
   */
  readonly images: Map<
    string,
    { data: Uint8Array; contentType: 'image/png'; width: number; height: number }
  >;
  /** Pictures of Mermaid diagrams keyed by trimmed source, for `docToPptx`'s `diagramImages`. */
  readonly mermaid: Map<string, DiagramPicture>;
}

const KIND_NAMES: Readonly<Record<ExportDiagramKind, string>> = {
  mermaid: 'Diagram',
  diagram: 'Diagram',
  timeline: 'Timeline',
  tree: 'Tree',
  container: 'Diagram',
};

/** The diagram kind of a fence, or null for ordinary code. */
export function fenceDiagramKind(node: MarkdownCodeBlock): ExportDiagramKind | null {
  const lang = node.lang ?? null;
  if ((lang ?? '').trim().toLowerCase() === 'mermaid') return 'mermaid';
  // Same order the player uses (materializeBlockLayers' embedded media).
  if (isEligibleAsciiFenceLang(lang)) {
    const detection = detectAsciiDiagram(node.value, { explicit: isExplicitDiagramLang(lang) });
    if (detection.isDiagram) return 'diagram';
  }
  if (isEligibleTreeFenceLang(lang)) {
    if (detectTree(node.value, { explicit: isExplicitTreeLang(lang) }).isTree) return 'tree';
  }
  if (isEligibleAsciiTimelineFenceLang(lang)) {
    const detection = detectAsciiTimeline(node.value, { explicit: isExplicitTimelineLang(lang) });
    if (detection.isTimeline) return 'timeline';
  }
  return null;
}

/** The canonical container template a heading opens, or null. */
function containerTemplateOf(node: MarkdownNode): string | null {
  if (node.type !== 'heading') return null;
  const requested = (node as MarkdownHeading).templateAnnotation?.template;
  if (!requested || !isContainerTemplate(requested)) return null;
  return resolveTemplateName(requested);
}

/** A Mermaid diagram's `accTitle` and `accDescr`, joined, or ''. */
function mermaidAlt(source: string): string {
  const title = /^\s*accTitle\s*:\s*(.+?)\s*$/mu.exec(source)?.[1] ?? '';
  const description = /^\s*accDescr\s*:\s*(.+?)\s*$/mu.exec(source)?.[1] ?? '';
  return [title, description].filter(Boolean).join('. ');
}

function fenceMarkdown(node: MarkdownCodeBlock): string {
  return stringifyMarkdown({ type: 'document', children: [node] }).trim();
}

/** A diagram found in a document, and how to replace it. */
interface FoundDiagram {
  readonly diagram: ExportDiagram;
  /** Top-level index of the container heading, for containers. */
  readonly containerIndex?: number;
  /** Top-level index one past the container's last child, for containers. */
  readonly containerEnd?: number;
  /** The fence node, for fence kinds. */
  readonly fence?: MarkdownCodeBlock;
}

function findInDocument(doc: MarkdownDocument): FoundDiagram[] {
  const found: FoundDiagram[] = [];
  const children = doc.children;
  const walk = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'code') {
        const fence = node as MarkdownCodeBlock;
        const kind = fenceDiagramKind(fence);
        if (kind) {
          found.push({
            fence,
            diagram: {
              kind,
              markdown: fenceMarkdown(fence),
              source: fence.value,
              template: '',
              alt: (kind === 'mermaid' ? mermaidAlt(fence.value) : '') || KIND_NAMES[kind],
            },
          });
        }
        continue;
      }
      const nested = (node as { children?: unknown }).children;
      if (Array.isArray(nested) && node.type !== 'heading' && node.type !== 'paragraph') {
        walk(nested as MarkdownNode[]);
      }
    }
  };

  for (let index = 0; index < children.length; index++) {
    const node = children[index] as MarkdownNode;
    const template = containerTemplateOf(node);
    if (!template) {
      walk([node]);
      continue;
    }
    // A container owns every node up to the next heading at its depth or shallower.
    const depth = (node as MarkdownHeading).depth;
    let end = index + 1;
    while (end < children.length) {
      const next = children[end] as MarkdownNode;
      if (next.type === 'heading' && (next as MarkdownHeading).depth <= depth) break;
      end++;
    }
    const heading = extractPlainText(node).trim();
    found.push({
      containerIndex: index,
      containerEnd: end,
      diagram: {
        kind: 'container',
        markdown: stringifyMarkdown({
          type: 'document',
          children: children.slice(index, end),
        }).trim(),
        source: '',
        template,
        alt: heading || KIND_NAMES.container,
      },
    });
    index = end - 1;
  }
  return found;
}

/** Every diagram in `doc`, in document order. */
export function findDiagrams(doc: MarkdownDocument): ExportDiagram[] {
  return findInDocument(doc).map((entry) => entry.diagram);
}

function imageParagraph(url: string, alt: string): MarkdownParagraph {
  const image: MarkdownImage = { type: 'image', url, alt, title: null };
  return { type: 'paragraph', children: [image] };
}

/** Replace fence nodes by identity, copying only the arrays on the way. */
function replaceFences<T extends MarkdownNode>(
  nodes: readonly T[],
  replacements: ReadonlyMap<MarkdownCodeBlock, MarkdownParagraph>,
): T[] {
  let changed = false;
  const next = nodes.map((node) => {
    const replacement = replacements.get(node as unknown as MarkdownCodeBlock);
    if (replacement) {
      changed = true;
      return replacement as unknown as T;
    }
    const nested = (node as { children?: unknown }).children;
    if (Array.isArray(nested)) {
      const replaced = replaceFences(nested as MarkdownNode[], replacements);
      if (replaced !== nested) {
        changed = true;
        return { ...node, children: replaced } as T;
      }
    }
    return node;
  });
  return changed ? next : (nodes as T[]);
}

/**
 * Picture every diagram in `doc` with `render`, one at a time, and return
 * the document with each pictured diagram replaced by an image of it. A
 * diagram the renderer declines or fails on stays as it was.
 */
export async function rasterizeDiagrams(
  doc: MarkdownDocument,
  render: DiagramRasterizer,
  options: RasterizeDiagramsOptions = {},
): Promise<RasterizedDiagrams> {
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const prefix = options.urlPrefix ?? 'diagram';
  const images: RasterizedDiagrams['images'] = new Map();
  const mermaid = new Map<string, DiagramPicture>();
  const fenceReplacements = new Map<MarkdownCodeBlock, MarkdownParagraph>();
  const containerReplacements: { start: number; end: number; nodes: MarkdownBlockNode[] }[] = [];

  for (const entry of findInDocument(doc)) {
    options.signal?.throwIfAborted();
    if (kinds && !kinds.has(entry.diagram.kind)) continue;
    let picture: DiagramPicture | null = null;
    try {
      picture = await render(entry.diagram);
    } catch (error) {
      options.onWarning?.(
        `A ${KIND_NAMES[entry.diagram.kind].toLowerCase()} could not be drawn and was kept as text: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!picture || picture.width <= 0 || picture.height <= 0) continue;
    const data = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
    const url = `${prefix}-${String(images.size + 1)}.png`;
    images.set(url, {
      data,
      contentType: 'image/png',
      width: picture.width,
      height: picture.height,
    });
    if (entry.diagram.kind === 'mermaid') mermaid.set(entry.diagram.source.trim(), picture);
    const paragraph = imageParagraph(url, entry.diagram.alt);
    if (entry.fence) {
      fenceReplacements.set(entry.fence, paragraph);
    } else if (entry.containerIndex !== undefined && entry.containerEnd !== undefined) {
      // Keep the heading (without its template) for the document's outline;
      // the picture takes the place of the shapes or layers under it.
      const heading = doc.children[entry.containerIndex] as MarkdownHeading;
      const { templateAnnotation: _template, ...plainHeading } = heading;
      containerReplacements.push({
        start: entry.containerIndex,
        end: entry.containerEnd,
        nodes: [plainHeading as MarkdownHeading, paragraph],
      });
    }
  }

  let children = doc.children;
  if (containerReplacements.length > 0) {
    const rebuilt: MarkdownBlockNode[] = [];
    let cursor = 0;
    for (const replacement of containerReplacements) {
      rebuilt.push(...children.slice(cursor, replacement.start), ...replacement.nodes);
      cursor = replacement.end;
    }
    rebuilt.push(...children.slice(cursor));
    children = rebuilt;
  }
  if (fenceReplacements.size > 0) children = replaceFences(children, fenceReplacements);

  return {
    markdownDoc: children === doc.children ? doc : { ...doc, children },
    images,
    mermaid,
  };
}
