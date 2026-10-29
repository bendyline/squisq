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
 *   `{[diagram]}` — together with every child heading they own;
 * - ```svg fences (SVG islands) — but only when `kinds` asks for `svg`: DOCX
 *   and PPTX embed an island natively as vector art, so by default it is
 *   left in place. Ask for it to picture islands for PDF, or to get the
 *   `svg` map of PNG fallbacks the Office exporters place beside the vector.
 * - chart heading blocks (`{[barChart]}`, `{[pieChart]}`, …) whose first
 *   table is chartable: the picture replaces the table, as the player shows
 *   the chart alone (the table stays beneath it with `showTable`).
 *
 * `docToPptx` keeps drawings, timelines, ASCII diagrams and charts as native
 * shapes; for it, use the returned `mermaid` map as its `diagramImages` option.
 */

import type {
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownDocument,
  MarkdownHeading,
  MarkdownImage,
  MarkdownNode,
  MarkdownParagraph,
  MarkdownTable,
} from '@bendyline/squisq/markdown';
import {
  extractPlainText,
  isSvgIslandLang,
  parseSvgIsland,
  stringifyMarkdown,
} from '@bendyline/squisq/markdown';
import {
  TABLE_FED_TEMPLATES,
  buildChartData,
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
export type ExportDiagramKind =
  'mermaid' | 'diagram' | 'timeline' | 'tree' | 'container' | 'svg' | 'chart';

/** The kinds pictured when `kinds` is not given: everything but `svg`. */
const DEFAULT_KINDS: readonly ExportDiagramKind[] = [
  'mermaid',
  'diagram',
  'timeline',
  'tree',
  'container',
  'chart',
];

/** Every kind, `svg` included — for exporters with no vector picture of their own (PDF). */
export const EXPORT_DIAGRAM_KINDS: readonly ExportDiagramKind[] = [...DEFAULT_KINDS, 'svg'];

export interface ExportDiagram {
  readonly kind: ExportDiagramKind;
  /**
   * The diagram's own markdown: its fence, for a container its heading and
   * every child heading and body it owns, for a chart its heading and table.
   */
  readonly markdown: string;
  /** The fence content for fence kinds; '' for containers and charts. */
  readonly source: string;
  /** The container's or chart's template (`drawing`, `barChart`, …); '' for fences. */
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
  /** The kinds to picture. Default: all of them except `svg` (see above). */
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
  /**
   * Pictures of SVG islands keyed by trimmed source: the PNG fallbacks for
   * DOCX's `svgIslandFallbacks` and PPTX's `diagramImages`.
   */
  readonly svg: Map<string, DiagramPicture>;
}

const KIND_NAMES: Readonly<Record<ExportDiagramKind, string>> = {
  mermaid: 'Diagram',
  diagram: 'Diagram',
  timeline: 'Timeline',
  tree: 'Tree',
  container: 'Diagram',
  svg: 'Illustration',
  chart: 'Chart',
};

/** The diagram kind of a fence, or null for ordinary code. */
export function fenceDiagramKind(node: MarkdownCodeBlock): ExportDiagramKind | null {
  const lang = node.lang ?? null;
  if ((lang ?? '').trim().toLowerCase() === 'mermaid') return 'mermaid';
  // An svg fence that is not a usable island stays code, as in the player.
  if (isSvgIslandLang(lang)) return parseSvgIsland(node.value).ok ? 'svg' : null;
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

/** A fence's own text alternative, or ''. */
function fenceAlt(kind: ExportDiagramKind, source: string): string {
  if (kind === 'mermaid') return mermaidAlt(source);
  if (kind === 'svg') {
    const result = parseSvgIsland(source);
    return (result.ok && result.island.title) || '';
  }
  return '';
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
  /** For charts: top-level indexes of the heading and the table it plots. */
  readonly chart?: { headingIndex: number; tableIndex: number; keepTable: boolean };
}

/** A table's cells as text, header row first. */
function tableText(table: MarkdownTable): { headers: string[]; rows: string[][] } {
  const [header, ...body] = table.children.map((row) =>
    row.children.map((cell) => extractPlainText(cell).trim()),
  );
  return { headers: header ?? [], rows: body };
}

/** A list param (`valueColumns=Revenue,Cost`) as its entries. */
function listParam(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries && entries.length > 0 ? entries : undefined;
}

/** Chart-block params that are not about drawing the chart. */
const NON_CHART_PARAMS = new Set([
  'showTable',
  'src',
  'sheet',
  'anchor',
  'headerRow',
  'titleAnchor',
  'previewRows',
  'sort',
  'filter',
]);

function isTruthyParam(value: string | undefined): boolean {
  return value !== undefined && value !== 'false' && value !== '0';
}

/**
 * The chart a heading opens, when its section's first table is one the chart
 * engine can plot — the same test that decides whether the player draws a
 * chart or falls back to showing the block as content.
 */
function findChart(children: readonly MarkdownNode[], index: number): FoundDiagram | null {
  const heading = children[index] as MarkdownHeading;
  const requested = heading.templateAnnotation?.template;
  const template = requested ? resolveTemplateName(requested) : '';
  if (!TABLE_FED_TEMPLATES.has(template) || template === 'dataTable') return null;
  let tableIndex = -1;
  for (let at = index + 1; at < children.length; at++) {
    const node = children[at] as MarkdownNode;
    if (node.type === 'heading') break;
    if (node.type === 'table') {
      tableIndex = at;
      break;
    }
  }
  if (tableIndex < 0) return null;
  const table = children[tableIndex] as MarkdownTable;
  const params = heading.templateAnnotation?.params ?? {};
  const data = buildChartData(tableText(table), {
    labelColumn: params.labelColumn,
    valueColumns: listParam(params.valueColumns),
  });
  if (!data) return null;
  // The picture is the chart alone: the page keeps the heading as text and,
  // with `showTable`, the table itself. The table is already the data, so the
  // params that address a sidecar (`src`, `sheet`, `sort`, …) go too.
  const { showTable } = params;
  const chartParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => !NON_CHART_PARAMS.has(key)),
  );
  const chartHeading: MarkdownHeading = {
    ...heading,
    templateAnnotation: { template, params: chartParams },
  };
  const title = extractPlainText(heading).trim();
  const plotted = data.series.map((series) => series.name).join(', ');
  const what = `${template.replace(/Chart$/, '')} chart of ${plotted}${
    data.labelHeader ? ` by ${data.labelHeader}` : ''
  }`;
  return {
    chart: { headingIndex: index, tableIndex, keepTable: isTruthyParam(showTable) },
    diagram: {
      kind: 'chart',
      markdown: stringifyMarkdown({ type: 'document', children: [chartHeading, table] }).trim(),
      source: '',
      template,
      alt: title ? `${title}: ${what}` : what.charAt(0).toUpperCase() + what.slice(1),
    },
  };
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
              alt: fenceAlt(kind, fence.value) || KIND_NAMES[kind],
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
      const chart = node.type === 'heading' ? findChart(children, index) : null;
      if (chart) found.push(chart);
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

/** Every image URL a document already references. */
function imageUrls(nodes: readonly MarkdownNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.type === 'image') into.add((node as MarkdownImage).url);
    const nested = (node as { children?: unknown }).children;
    if (Array.isArray(nested)) imageUrls(nested as MarkdownNode[], into);
  }
  return into;
}

/** Every diagram in `doc`, in document order. */
export function findDiagrams(doc: MarkdownDocument): ExportDiagram[] {
  return findInDocument(doc).map((entry) => entry.diagram);
}

function withoutTemplate(heading: MarkdownHeading): MarkdownHeading {
  const { templateAnnotation: _template, ...plain } = heading;
  return plain;
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
 * A renderer that remembers what it drew, for a host that renders the same
 * document again and again — a live preview, or a file regenerated on every
 * save — so each pass redraws only the diagrams that changed. A picture is
 * keyed by the diagram itself; the least recently used beyond `limit` are
 * forgotten, and a failure is never remembered.
 */
export function cachingDiagramRasterizer(render: DiagramRasterizer, limit = 64): DiagramRasterizer {
  const drawn = new Map<string, Promise<DiagramPicture | null>>();
  return (diagram) => {
    const key = `${diagram.kind}\u0000${diagram.markdown}\u0000${diagram.source}`;
    let picture = drawn.get(key);
    if (picture) {
      drawn.delete(key);
    } else {
      picture = render(diagram);
      picture.catch(() => drawn.delete(key));
    }
    drawn.set(key, picture);
    if (drawn.size > limit) drawn.delete(drawn.keys().next().value!);
    return picture;
  };
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
  const kinds = new Set(options.kinds ?? DEFAULT_KINDS);
  const prefix = options.urlPrefix ?? 'diagram';
  // Never reuse a name the document already gives one of its own images.
  const taken = imageUrls(doc.children, new Set());
  let counter = 0;
  const nextUrl = (): string => {
    let url: string;
    do url = `${prefix}-${String(++counter)}.png`;
    while (taken.has(url));
    taken.add(url);
    return url;
  };
  const images: RasterizedDiagrams['images'] = new Map();
  const mermaid = new Map<string, DiagramPicture>();
  const svg = new Map<string, DiagramPicture>();
  const fenceReplacements = new Map<MarkdownCodeBlock, MarkdownParagraph>();
  // Top-level ranges, in document order and never overlapping.
  const blockReplacements: { start: number; end: number; nodes: MarkdownBlockNode[] }[] = [];

  for (const entry of findInDocument(doc)) {
    options.signal?.throwIfAborted();
    if (!kinds.has(entry.diagram.kind)) continue;
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
    const url = nextUrl();
    images.set(url, {
      data,
      contentType: 'image/png',
      width: picture.width,
      height: picture.height,
    });
    if (entry.diagram.kind === 'mermaid') mermaid.set(entry.diagram.source.trim(), picture);
    if (entry.diagram.kind === 'svg') svg.set(entry.diagram.source.trim(), picture);
    const paragraph = imageParagraph(url, entry.diagram.alt);
    if (entry.fence) {
      fenceReplacements.set(entry.fence, paragraph);
    } else if (entry.containerIndex !== undefined && entry.containerEnd !== undefined) {
      // Keep the heading (without its template) for the document's outline;
      // the picture takes the place of the shapes or layers under it.
      blockReplacements.push({
        start: entry.containerIndex,
        end: entry.containerEnd,
        nodes: [withoutTemplate(doc.children[entry.containerIndex] as MarkdownHeading), paragraph],
      });
    } else if (entry.chart) {
      // The heading and any prose stay; the picture takes the table's place.
      const { headingIndex, tableIndex, keepTable } = entry.chart;
      const table = doc.children[tableIndex] as MarkdownBlockNode;
      blockReplacements.push(
        {
          start: headingIndex,
          end: headingIndex + 1,
          nodes: [withoutTemplate(doc.children[headingIndex] as MarkdownHeading)],
        },
        {
          start: tableIndex,
          end: tableIndex + 1,
          nodes: keepTable ? [paragraph, table] : [paragraph],
        },
      );
    }
  }

  let children = doc.children;
  if (blockReplacements.length > 0) {
    const rebuilt: MarkdownBlockNode[] = [];
    let cursor = 0;
    for (const replacement of blockReplacements) {
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
    svg,
  };
}
