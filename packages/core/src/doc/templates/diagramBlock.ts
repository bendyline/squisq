/**
 * Diagram block template.
 *
 * Renders a node-and-edge diagram from one of two data sources:
 * 1. Child headings (`context.children`) — the legacy authored form; each
 *    child becomes a node positioned by `x`/`y` and connected by
 *    `connectsTo` (see `diagramLayout.ts` for auto-placement rules).
 * 2. `input.nodes`/`input.edges` (usually via `templateData`) — the
 *    data-driven form derived from an ASCII-art diagram fence. Nodes may
 *    carry per-node sizes and a `container` reference; containers draw
 *    behind their children as translucent grouping cards.
 *
 * Layout coordinates are author-defined units. The template computes a
 * bounding box of all nodes and scales it to fit the block's viewport
 * with padding, so users don't have to think about absolute pixel ranges.
 */

import type {
  Block,
  Layer,
  ShapeLayer,
  TextLayer,
  PathLayer,
  MarkerStyle,
} from '../../schemas/Doc.js';
import type {
  DiagramBlockInput,
  DiagramEdgeAnchor,
  DiagramTemplateEdge,
  DiagramTemplateNode,
  TemplateContext,
} from '../../schemas/BlockTemplates.js';
import type { MarkdownCodeBlock } from '../../markdown/types.js';
import { extractPlainText } from '../../markdown/utils.js';
import { resolveSupplementalMediaLayout } from '../richMediaLayout.js';
import { extractEmbeddedVideos, extractImages } from '../templateInputs.js';
import { resolveColorScheme, getThemeFont, themedFontSize } from '../utils/themeUtils.js';
import { DIAGRAM_LABEL_LINE_HEIGHT, fitDiagramLabel } from '../utils/diagramText.js';
import { fitProse, type ProseFit } from './captionUtils.js';
import {
  anchorPoint,
  connectorPath,
  lineStyleDasharray,
  snapEndpoints,
  type ConnectorRouting,
} from '../utils/shapeGeometry.js';
import { computeDiagramLayout } from './diagramLayout.js';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;
const PADDING = 80;

// ============================================
// Canvas frame (shared with drawingBlock)
// ============================================
//
// Both fit-to-viewport canvases used to reserve a fixed 120px band for a
// single-line title and centre the shape group in the whole frame. That
// broke two ways: a long heading rendered as one unwrapped line running past
// both frame edges, and an unconsumed image / mermaid fence (which the
// materializer paints as an overlay card in the lower-right) landed on top
// of the shapes. The helpers below measure the title, pick the region of
// the frame the media card leaves free, and surface the block's own prose
// as a muted description under the canvas instead of dropping it.

/** Frame padding shared by the canvas templates. */
export const CANVAS_PADDING = PADDING;
const CANVAS_TITLE_LINE_HEIGHT = 1.15;
const CANVAS_TITLE_MAX_LINES = 2;
/** Space between the title's last line and the top of the canvas. */
const CANVAS_TITLE_GAP_PX = 36;
const CANVAS_DESCRIPTION_LINE_HEIGHT = 1.35;
const CANVAS_DESCRIPTION_MAX_LINES = 3;
/** Space between the canvas bottom and the description's first line. */
const CANVAS_DESCRIPTION_GAP_PX = 28;
/** The description never takes more than this share of the region height. */
const CANVAS_DESCRIPTION_MAX_HEIGHT_RATIO = 0.3;
/** Widest a description column gets, as a share of the viewport width. */
const CANVAS_DESCRIPTION_MAX_WIDTH_RATIO = 0.72;
/** Small canvases may grow up to this factor (everything is vector). */
export const CANVAS_MAX_SCALE = 1.8;
/** A candidate region must keep at least this share of each viewport axis. */
const CANVAS_REGION_MIN_RATIO = 0.35;

export interface CanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasFrame {
  /** Pixel region the title + canvas + description lockup may occupy. */
  region: CanvasRegion;
  /** Measured title, when the block has one. */
  title?: ProseFit & { widthPx: number };
  /** Measured body prose, when the block has any. */
  description?: { text: string; fit: ProseFit; widthPx: number };
  /** Title height plus its gap to the canvas (0 without a title). */
  titleBlockPx: number;
  /** Gap plus description height (0 without a description). */
  descriptionBlockPx: number;
  /** Width the scaled canvas may occupy. */
  availW: number;
  /** Height the scaled canvas may occupy. */
  availH: number;
  /** Overlay card the materializer will paint for unconsumed media, if any. */
  mediaRect?: CanvasRegion;
}

export interface CanvasPlacement {
  scale: number;
  scaledW: number;
  scaledH: number;
  /** Top of the whole lockup (title, or canvas when untitled). */
  groupTop: number;
  /** Viewport-pixel origin of the scaled canvas. */
  offsetX: number;
  offsetY: number;
  /** Top of the description's first line (only meaningful with a description). */
  descriptionY: number;
}

/**
 * Media the materializer will promote to an overlay card because the canvas
 * template never consumes it: images, videos and mermaid fences in the
 * block body. Mirrors `collectRichMediaItems` (the template emits no media
 * layers of its own, so nothing is ever already consumed).
 */
function unconsumedMedia(block: Block | undefined): {
  count: number;
  aspectRatios: (number | undefined)[];
} {
  const contents = block?.contents;
  if (!contents || contents.length === 0) return { count: 0, aspectRatios: [] };
  const videos = extractEmbeddedVideos(contents);
  const videoSources = new Set(videos.map((video) => video.src));
  const seen = new Set<string>();
  const images = extractImages(contents).filter((image) => {
    if (videoSources.has(image.src) || seen.has(image.src)) return false;
    seen.add(image.src);
    return true;
  });
  const mermaid = contents.filter(
    (node): node is MarkdownCodeBlock =>
      node.type === 'code' &&
      node.lang?.trim().toLowerCase() === 'mermaid' &&
      node.value.trim().length > 0,
  );
  const aspectRatios: (number | undefined)[] = [
    ...images.map((image) =>
      image.width && image.height ? image.width / image.height : undefined,
    ),
    ...videos.map(() => 16 / 9),
    ...mermaid.map(() => 16 / 9),
  ];
  return { count: aspectRatios.length, aspectRatios };
}

/** Body prose of the block that neither the canvas nor the media card shows. */
function canvasDescriptionText(block: Block | undefined): string {
  const contents = block?.contents;
  if (!contents) return '';
  return contents
    .filter(
      (node) => node.type === 'paragraph' || node.type === 'blockquote' || node.type === 'list',
    )
    .map((node) => extractPlainText(node).trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * The largest part of the frame the media overlay leaves free: the band
 * above it, the column beside it, or (for media pinned to the top) the band
 * below. Falls back to the whole frame when no candidate keeps a usable
 * share of both axes.
 */
function freeRegion(
  viewport: { width: number; height: number },
  media: CanvasRegion | undefined,
): CanvasRegion {
  const full: CanvasRegion = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  if (!media) return full;
  const candidates: CanvasRegion[] = [
    { x: 0, y: 0, width: viewport.width, height: media.y },
    { x: 0, y: 0, width: media.x, height: viewport.height },
    {
      x: 0,
      y: media.y + media.height,
      width: viewport.width,
      height: viewport.height - (media.y + media.height),
    },
    {
      x: media.x + media.width,
      y: 0,
      width: viewport.width - (media.x + media.width),
      height: viewport.height,
    },
  ].filter(
    (r) =>
      r.width >= viewport.width * CANVAS_REGION_MIN_RATIO &&
      r.height >= viewport.height * CANVAS_REGION_MIN_RATIO,
  );
  if (candidates.length === 0) return full;
  return candidates.reduce((best, r) => (r.width * r.height > best.width * best.height ? r : best));
}

/**
 * Measure everything that competes with the canvas for frame space: the
 * region left free by an unconsumed-media overlay, the wrapped title
 * (stepped down so a long heading stays within two lines) and the block's
 * prose description (shrunk, then line-clamped, to a short caption band).
 */
export function planCanvasFrame(
  template: 'diagram' | 'drawing',
  title: string | undefined,
  context: TemplateContext,
): CanvasFrame {
  const { viewport } = context;
  const media = unconsumedMedia(context.block);
  const mediaRect =
    media.count > 0
      ? resolveSupplementalMediaLayout([], template, viewport, media.count, media.aspectRatios)
          .mediaRect
      : undefined;
  const region = freeRegion(viewport, mediaRect);
  const innerWidth = Math.max(1, region.width - PADDING * 2);

  let titleFit: CanvasFrame['title'];
  if (title) {
    const baseFontSize = themedFontSize(40, context, true);
    const fit = fitProse({
      text: title,
      baseFontSize,
      minFontSize: Math.round(baseFontSize * 0.7),
      maxWidthPx: innerWidth,
      maxHeightPx: CANVAS_TITLE_MAX_LINES * baseFontSize * CANVAS_TITLE_LINE_HEIGHT,
      lineHeight: CANVAS_TITLE_LINE_HEIGHT,
    });
    titleFit = { ...fit, widthPx: innerWidth };
  }

  let description: CanvasFrame['description'];
  const descriptionText = canvasDescriptionText(context.block);
  if (descriptionText) {
    const baseFontSize = themedFontSize(22, context, false);
    const minFontSize = Math.min(baseFontSize, themedFontSize(16, context, false));
    const widthPx = Math.min(innerWidth, viewport.width * CANVAS_DESCRIPTION_MAX_WIDTH_RATIO);
    const fit = fitProse({
      text: descriptionText,
      baseFontSize,
      minFontSize,
      maxWidthPx: widthPx,
      maxHeightPx: Math.min(
        CANVAS_DESCRIPTION_MAX_LINES * baseFontSize * CANVAS_DESCRIPTION_LINE_HEIGHT,
        region.height * CANVAS_DESCRIPTION_MAX_HEIGHT_RATIO,
      ),
      lineHeight: CANVAS_DESCRIPTION_LINE_HEIGHT,
    });
    description = { text: descriptionText, fit, widthPx };
  }

  const titleBlockPx = titleFit ? titleFit.heightPx + CANVAS_TITLE_GAP_PX : 0;
  const descriptionBlockPx = description ? CANVAS_DESCRIPTION_GAP_PX + description.fit.heightPx : 0;
  return {
    region,
    ...(titleFit ? { title: titleFit } : {}),
    ...(description ? { description } : {}),
    titleBlockPx,
    descriptionBlockPx,
    availW: innerWidth,
    availH: Math.max(1, region.height - PADDING * 2 - titleBlockPx - descriptionBlockPx),
    ...(mediaRect ? { mediaRect } : {}),
  };
}

/**
 * Fit author-unit content of `contentW × contentH` into the frame and centre
 * the title + canvas + description lockup as one group inside the region.
 */
export function placeCanvasGroup(
  frame: CanvasFrame,
  contentW: number,
  contentH: number,
): CanvasPlacement {
  const scale = Math.min(frame.availW / contentW, frame.availH / contentH, CANVAS_MAX_SCALE);
  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  const groupH = frame.titleBlockPx + scaledH + frame.descriptionBlockPx;
  const groupTop = frame.region.y + Math.max(PADDING / 2, (frame.region.height - groupH) / 2);
  const offsetX = frame.region.x + PADDING + (frame.availW - scaledW) / 2;
  const offsetY = groupTop + frame.titleBlockPx;
  return {
    scale,
    scaledW,
    scaledH,
    groupTop,
    offsetX,
    offsetY,
    descriptionY: offsetY + scaledH + CANVAS_DESCRIPTION_GAP_PX,
  };
}

/** Title layer for a canvas: top-left anchored, wrapped and clamped to two lines. */
export function canvasTitleLayer(
  id: string,
  text: string,
  frame: CanvasFrame,
  placement: CanvasPlacement,
  context: TemplateContext,
): TextLayer | undefined {
  const fit = frame.title;
  if (!fit) return undefined;
  return {
    type: 'text',
    id,
    content: {
      text,
      style: {
        fontSize: fit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: context.theme.colors.text,
        textAlign: 'center',
        lineHeight: CANVAS_TITLE_LINE_HEIGHT,
        maxLines: fit.maxLines ?? CANVAS_TITLE_MAX_LINES,
        shrinkToFit: true,
      },
    },
    position: {
      x: frame.region.x + PADDING,
      y: placement.groupTop,
      width: fit.widthPx,
      anchor: 'top-left',
    },
  };
}

/** Muted description under the canvas, centred in the region. */
export function canvasDescriptionLayer(
  id: string,
  frame: CanvasFrame,
  placement: CanvasPlacement,
  context: TemplateContext,
): TextLayer | undefined {
  const description = frame.description;
  if (!description) return undefined;
  const { fit, widthPx } = description;
  return {
    type: 'text',
    id,
    content: {
      text: description.text,
      style: {
        fontSize: fit.fontSize,
        fontFamily: getThemeFont(context, 'body'),
        color: context.theme.colors.textMuted,
        textAlign: 'center',
        lineHeight: CANVAS_DESCRIPTION_LINE_HEIGHT,
        maxLines: fit.maxLines ?? Math.max(CANVAS_DESCRIPTION_MAX_LINES, fit.lines),
      },
    },
    position: {
      x: frame.region.x + (frame.region.width - widthPx) / 2,
      y: placement.descriptionY,
      width: widthPx,
      anchor: 'top-left',
    },
  };
}

interface ResolvedDiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Containment depth (0 = top level); containers draw depth-ascending. */
  depth: number;
  isContainer: boolean;
}

interface ResolvedDiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  directed: boolean;
  sourceAnchor?: DiagramEdgeAnchor;
  targetAnchor?: DiagramEdgeAnchor;
  routing?: ConnectorRouting;
}

interface ResolvedDiagram {
  nodes: ResolvedDiagramNode[];
  edges: ResolvedDiagramEdge[];
}

function nodesFromChildren(context: TemplateContext): ResolvedDiagram {
  const layout = computeDiagramLayout(context.children ?? []);
  return {
    nodes: layout.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      x: n.x,
      y: n.y,
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
      depth: 0,
      isContainer: false,
    })),
    edges: layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.type ? { label: e.type } : {}),
      directed: true,
    })),
  };
}

/**
 * Defensive resolution of `templateData`-supplied nodes/edges: the data is
 * untyped at runtime (it can come from a hand-written `json data` fence),
 * so malformed entries are dropped rather than crashing the template.
 */
function nodesFromTemplateData(input: DiagramBlockInput): ResolvedDiagram {
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const valid = rawNodes.filter(
    (n): n is DiagramTemplateNode =>
      typeof n === 'object' &&
      n !== null &&
      typeof n.id === 'string' &&
      n.id.length > 0 &&
      typeof n.label === 'string' &&
      typeof n.x === 'number' &&
      Number.isFinite(n.x) &&
      typeof n.y === 'number' &&
      Number.isFinite(n.y),
  );
  const ids = new Set(valid.map((n) => n.id));
  const containerIds = new Set(
    valid.map((n) => n.container).filter((c): c is string => typeof c === 'string' && ids.has(c)),
  );
  const depthOf = (node: DiagramTemplateNode): number => {
    let depth = 0;
    let current: DiagramTemplateNode | undefined = node;
    const seen = new Set<string>();
    while (current?.container && ids.has(current.container) && !seen.has(current.id)) {
      seen.add(current.id);
      depth++;
      current = valid.find((n) => n.id === current?.container);
    }
    return depth;
  };
  const nodes: ResolvedDiagramNode[] = valid.map((n) => ({
    id: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
    w: typeof n.w === 'number' && Number.isFinite(n.w) && n.w > 0 ? n.w : NODE_WIDTH,
    h: typeof n.h === 'number' && Number.isFinite(n.h) && n.h > 0 ? n.h : NODE_HEIGHT,
    depth: depthOf(n),
    isContainer: containerIds.has(n.id),
  }));

  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  const edges: ResolvedDiagramEdge[] = rawEdges
    .filter(
      (e): e is DiagramTemplateEdge =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.source === 'string' &&
        typeof e.target === 'string' &&
        ids.has(e.source) &&
        ids.has(e.target),
    )
    .map((e, i) => ({
      id: e.label ? `${e.source}->${e.target}:${e.label}` : `${e.source}->${e.target}-${i}`,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
      directed: e.directed !== false,
      ...(e.sourceAnchor ? { sourceAnchor: e.sourceAnchor } : {}),
      ...(e.targetAnchor ? { targetAnchor: e.targetAnchor } : {}),
      ...(e.routing ? { routing: e.routing } : {}),
    }));
  return { nodes, edges };
}

export function diagramBlock(input: DiagramBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport, children = [] } = context;
  const colors = input.colorScheme ? resolveColorScheme(context, input.colorScheme) : undefined;

  const resolved =
    children.length > 0
      ? nodesFromChildren(context)
      : input.nodes && input.nodes.length > 0
        ? nodesFromTemplateData(input)
        : { nodes: [], edges: [] };

  if (resolved.nodes.length === 0) {
    // Empty diagram — render a single hint label so the block has visible
    // content. Wrapped within the frame so a long heading cannot run off.
    return [
      {
        type: 'text',
        id: 'diagram-empty',
        content: {
          text: input.title ?? 'Empty diagram',
          style: {
            fontSize: themedFontSize(36, context, true),
            fontFamily: getThemeFont(context, 'title'),
            color: theme.colors.textMuted,
            textAlign: 'center',
            maxLines: 3,
            shrinkToFit: true,
          },
        },
        position: {
          x: '50%',
          y: '50%',
          anchor: 'center',
          width: viewport.width - PADDING * 2,
        },
      },
    ];
  }

  // Compute the bounding box of all nodes in author coordinates.
  const minX = Math.min(...resolved.nodes.map((n) => n.x));
  const maxX = Math.max(...resolved.nodes.map((n) => n.x + n.w));
  const minY = Math.min(...resolved.nodes.map((n) => n.y));
  const maxY = Math.max(...resolved.nodes.map((n) => n.y + n.h));

  // Frame plan: the region an unconsumed-media overlay leaves free, the
  // measured (wrapped, stepped-down) title and the block's prose description.
  const frame = planCanvasFrame('diagram', input.title, context);
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  // Uniform scale so the diagram fits both dimensions. Small diagrams are
  // allowed to grow (everything here is vector) up to 1.8× so a three-node
  // flow doesn't render as a tiny cluster in an empty canvas; label fonts
  // and strokes scale with the nodes, clamped so text never balloons. The
  // title, the scaled diagram and the description are centered together as
  // one group — a top-pinned title over a center-floated diagram split the
  // block into two stranded pieces.
  const placement = placeCanvasGroup(frame, contentW, contentH);
  const { scale, offsetX, offsetY } = placement;
  const fontAdj = Math.min(Math.max(scale, 1), 1.5);
  const strokeW = Math.round(2 * fontAdj);
  const transform = (n: ResolvedDiagramNode): { x: number; y: number; w: number; h: number } => ({
    x: offsetX + (n.x - minX) * scale,
    y: offsetY + (n.y - minY) * scale,
    w: n.w * scale,
    h: n.h * scale,
  });

  const layers: Layer[] = [];

  // Optional title above the diagram.
  if (input.title) {
    const titleLayer = canvasTitleLayer('diagram-title', input.title, frame, placement, context);
    if (titleLayer) layers.push(titleLayer);
  }

  const containers = resolved.nodes
    .filter((n) => n.isContainer)
    .sort((a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x);
  const leaves = resolved.nodes.filter((n) => !n.isContainer);

  // Container cards first — translucent grouping surfaces behind everything.
  for (const node of containers) {
    const t = transform(node);
    const card: ShapeLayer = {
      type: 'shape',
      id: `node-card-${node.id}`,
      content: {
        shape: 'rect',
        fill: colors?.bg ?? theme.colors.backgroundLight,
        fillOpacity: 0.25,
        stroke: colors?.text ?? theme.colors.primary,
        strokeWidth: Math.max(1, strokeW - 1),
        borderRadius: 10,
      },
      position: { x: t.x, y: t.y, width: t.w, height: t.h },
    };
    layers.push(card);
  }

  // Position lookup by id for edge routing (containers included — edges may
  // attach to them, e.g. a through-border split from a parsed fence).
  const positions = new Map<string, { cx: number; cy: number; rx: number; ry: number }>();
  for (const node of resolved.nodes) {
    const t = transform(node);
    positions.set(node.id, { cx: t.x + t.w / 2, cy: t.y + t.h / 2, rx: t.w / 2, ry: t.h / 2 });
  }

  // Edge styling (applies to all edges; direction comes per-edge).
  const startMarker: MarkerStyle = input.startStyle ?? 'none';
  const configuredEnd: MarkerStyle = input.endStyle ?? 'arrow';
  const edgeDash = lineStyleDasharray(input.lineStyle);

  // Edges above containers, behind leaf nodes.
  for (const edge of resolved.edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    const endMarker: MarkerStyle = edge.directed ? configuredEnd : 'none';
    const snapped = snapEndpoints(a, b);
    const start = edge.sourceAnchor ? anchorPoint(a, edge.sourceAnchor) : snapped.start;
    const end = edge.targetAnchor ? anchorPoint(b, edge.targetAnchor) : snapped.end;
    const pathLayer: PathLayer = {
      type: 'path',
      id: `edge-${edge.id}`,
      content: {
        d: connectorPath(edge.routing ?? input.edgeStyle ?? 'curved', start, end),
        stroke: colors?.text ?? theme.colors.primary,
        strokeWidth: strokeW,
        fill: 'none',
        ...(edgeDash ? { dasharray: edgeDash } : {}),
        ...(startMarker !== 'none' ? { startMarker } : {}),
        ...(endMarker !== 'none' ? { endMarker } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    layers.push(pathLayer);

    if (edge.label) {
      // Edge label, floated just above the edge midpoint so the line never
      // strikes through the text.
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      const labelFontSize = themedFontSize(Math.round(18 * fontAdj), context, false);
      const labelLayer: TextLayer = {
        type: 'text',
        id: `edge-label-${edge.id}`,
        content: {
          text: edge.label,
          style: {
            fontSize: labelFontSize,
            fontFamily: getThemeFont(context, 'body'),
            color: theme.colors.textMuted,
            textAlign: 'center',
          },
        },
        position: { x: mx, y: my - labelFontSize * 0.9, anchor: 'center' },
      };
      layers.push(labelLayer);
    }
  }

  // Leaf nodes (card + label) on top of edges.
  for (const node of leaves) {
    const t = transform(node);
    const card: ShapeLayer = {
      type: 'shape',
      id: `node-card-${node.id}`,
      content: {
        shape: 'rect',
        fill: colors?.bg ?? theme.colors.backgroundLight,
        stroke: colors?.text ?? theme.colors.primary,
        strokeWidth: strokeW,
        borderRadius: input.nodeShape === 'pill' ? t.h / 2 : 10,
      },
      position: { x: t.x, y: t.y, width: t.w, height: t.h },
    };
    layers.push(card);

    const preferredFontSize = themedFontSize(Math.round(22 * fontAdj), context, false);
    const fit = fitDiagramLabel(node.label, t.w, t.h, preferredFontSize);
    const label: TextLayer = {
      type: 'text',
      id: `node-label-${node.id}`,
      content: {
        text: node.label,
        style: {
          fontSize: fit.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: colors?.text ?? theme.colors.text,
          textAlign: 'center',
          lineHeight: DIAGRAM_LABEL_LINE_HEIGHT,
        },
      },
      position: {
        x: t.x + t.w / 2,
        y: t.y + t.h / 2 + fit.firstLineOffset,
        anchor: 'center',
        width: fit.textWidth,
      },
    };
    layers.push(label);
  }

  // Container titles last — anchored near the container's top edge, above
  // any child content that could otherwise overprint them.
  for (const node of containers) {
    const t = transform(node);
    const fontSize = themedFontSize(Math.round(20 * fontAdj), context, false);
    const label: TextLayer = {
      type: 'text',
      id: `node-label-${node.id}`,
      content: {
        text: node.label.split('\n')[0] ?? '',
        style: {
          fontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
      },
      position: { x: t.x + t.w / 2, y: t.y + fontSize, anchor: 'center', width: t.w },
    };
    layers.push(label);
  }

  // Body prose the canvas itself cannot show, as a muted caption below it.
  const descriptionLayer = canvasDescriptionLayer('diagram-description', frame, placement, context);
  if (descriptionLayer) layers.push(descriptionLayer);

  return layers;
}
