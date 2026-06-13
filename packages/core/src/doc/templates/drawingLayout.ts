/**
 * Drawing layout — shared, pure derivation of shapes + connectors from a
 * drawing block's child headings. Same children always produce the same
 * shapes, so SSR previews, exports, and (eventually) the editor stay
 * visually consistent. Mirrors `diagramLayout.ts` for the richer
 * free-form shape vocabulary.
 *
 * Each child heading is one shape. Its `{[shape …]}` annotation names the
 * primitive (`child.template`) and carries geometry/style as string params
 * (`child.templateOverrides`); `child.id` makes it referenceable;
 * `child.title` is the label.
 *
 * Layout rules (parallel to the diagram):
 * 1. Shapes with both `x` and `y` keep their authored coordinates.
 * 2. Shapes missing either are auto-placed in a square-ish grid below the
 *    bounding box of the explicitly-positioned shapes.
 * 3. `line`/`arrow` shapes with `from`/`to` (or any shape's `connectsTo`)
 *    become connectors; endpoints that match no sibling id are dropped
 *    (and counted in `warnings`).
 */

import type { Block, MarkerStyle } from '../../schemas/Doc.js';
import { extractPlainText } from '../../markdown/utils.js';
import { lineStyleDasharray, type ConnectorRouting } from '../utils/shapeGeometry.js';

/**
 * The shape kinds a drawing can render. `rect`/`circle`/`line` render as a
 * native `ShapeLayer`; everything else (and `path`/`arrow`) renders as a
 * computed `PathLayer` (see `shapeGeometry.ts`). `text` is a `TextLayer`.
 */
export type DrawingShapeKind =
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'path'
  | 'text'
  | 'triangle'
  | 'right-triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'star4'
  | 'star6'
  | 'parallelogram'
  | 'trapezoid'
  | 'plus'
  | 'chevron'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'double-arrow'
  | 'callout'
  | 'cylinder'
  | 'cloud'
  | 'heart'
  | 'lightning';

/**
 * Author-facing shape annotation names accepted on a drawing's children
 * (the `{[…]}` token). Shared with validation so an unknown shape gets a
 * "did you mean" suggestion. Aliases (`rectangle`→rect, `ellipse`→circle)
 * are included.
 */
export const SHAPE_NAMES = [
  'rectangle',
  'rect',
  'square',
  'circle',
  'ellipse',
  'oval',
  'line',
  'arrow',
  'path',
  'text',
  'triangle',
  'right-triangle',
  'diamond',
  'rhombus',
  'pentagon',
  'hexagon',
  'octagon',
  'star',
  'star4',
  'star6',
  'parallelogram',
  'trapezoid',
  'plus',
  'cross',
  'chevron',
  'arrow-right',
  'arrow-left',
  'arrow-up',
  'arrow-down',
  'double-arrow',
  'callout',
  'speech',
  'cylinder',
  'cloud',
  'heart',
  'lightning',
  'bolt',
] as const;

const SHAPE_ALIASES: Readonly<Record<string, DrawingShapeKind>> = {
  rectangle: 'rect',
  rect: 'rect',
  square: 'rect',
  circle: 'circle',
  ellipse: 'circle',
  oval: 'circle',
  line: 'line',
  arrow: 'arrow',
  path: 'path',
  text: 'text',
  label: 'text',
  triangle: 'triangle',
  'right-triangle': 'right-triangle',
  righttriangle: 'right-triangle',
  diamond: 'diamond',
  rhombus: 'diamond',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  star: 'star',
  star5: 'star',
  star4: 'star4',
  star6: 'star6',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  plus: 'plus',
  cross: 'plus',
  chevron: 'chevron',
  'arrow-right': 'arrow-right',
  arrowright: 'arrow-right',
  rightarrow: 'arrow-right',
  'arrow-left': 'arrow-left',
  arrowleft: 'arrow-left',
  leftarrow: 'arrow-left',
  'arrow-up': 'arrow-up',
  arrowup: 'arrow-up',
  uparrow: 'arrow-up',
  'arrow-down': 'arrow-down',
  arrowdown: 'arrow-down',
  downarrow: 'arrow-down',
  'double-arrow': 'double-arrow',
  doublearrow: 'double-arrow',
  callout: 'callout',
  speech: 'callout',
  bubble: 'callout',
  cylinder: 'cylinder',
  can: 'cylinder',
  cloud: 'cloud',
  heart: 'heart',
  lightning: 'lightning',
  bolt: 'lightning',
};

/**
 * Resolve a child's `{[…]}` annotation name to a shape kind, or `null`
 * when it isn't a shape. Case-insensitive.
 */
export function normalizeShapeKind(name: string | undefined): DrawingShapeKind | null {
  if (!name) return null;
  return SHAPE_ALIASES[name.toLowerCase()] ?? null;
}

/** True when `name` is an accepted shape annotation (any alias). */
export function isShapeName(name: string | undefined): boolean {
  return normalizeShapeKind(name) != null;
}

/** A positioned shape in author-defined units (top-left origin). */
export interface DrawingShape {
  id: string;
  kind: DrawingShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when position came from `x=`/`y=`; false when auto-laid out. */
  pinned: boolean;
  /** Heading text used as the shape's label ('' when none). */
  label: string;
  /** Body text under the heading, used as a sublabel (when present). */
  sublabel?: string;
  /** Text content for `text` shapes (`text=` param, else label, else body). */
  text?: string;
  /** Raw SVG path `d` for `path` shapes. */
  d?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  dasharray?: string;
}

/** A connector joining two shapes by id. */
export interface DrawingConnector {
  id: string;
  kind: 'line' | 'arrow';
  /** Source shape id (resolved to an existing shape). */
  from: string;
  /** Target shape id (resolved to an existing shape). */
  to: string;
  /** Optional midpoint label (heading text, or `connectsTo` type). */
  label?: string;
  stroke?: string;
  strokeWidth?: number;
  dasharray?: string;
  /** End-of-line markers (default: `arrow` kind → filled arrow at `to`). */
  startMarker: MarkerStyle;
  endMarker: MarkerStyle;
  /** How the line is routed between the two shapes. Default: 'straight'. */
  routing: ConnectorRouting;
}

export interface DrawingLayout {
  shapes: DrawingShape[];
  connectors: DrawingConnector[];
  warnings: string[];
}

export interface DrawingLayoutOptions {
  /** Horizontal spacing between auto-laid-out shapes. Default: 180. */
  gapX?: number;
  /** Vertical spacing between auto-laid-out shapes. Default: 140. */
  gapY?: number;
  /** Padding below the explicit bounding box before the grid starts. Default: 80. */
  gridPad?: number;
  /** Grid origin when no explicit shapes anchor it. Default: 80, 80. */
  gridOriginX?: number;
  gridOriginY?: number;
}

const DEFAULT_OPTS: Required<DrawingLayoutOptions> = {
  gapX: 180,
  gapY: 140,
  gridPad: 80,
  gridOriginX: 80,
  gridOriginY: 80,
};

/** Default size (author units) per shape kind when width/height are omitted. */
const DEFAULT_SIZE: Partial<Record<DrawingShapeKind, { w: number; h: number }>> = {
  rect: { w: 160, h: 90 },
  circle: { w: 120, h: 120 },
  line: { w: 160, h: 0 },
  arrow: { w: 160, h: 0 },
  path: { w: 160, h: 120 },
  text: { w: 200, h: 48 },
};
const FALLBACK_SIZE = { w: 120, h: 120 };

function defaultSize(kind: DrawingShapeKind): { w: number; h: number } {
  return DEFAULT_SIZE[kind] ?? FALLBACK_SIZE;
}

/**
 * Compute shapes + connectors for a drawing from its parent block's
 * children. Pure — same inputs always produce the same output.
 */
export function computeDrawingLayout(
  children: readonly Block[],
  options: DrawingLayoutOptions = {},
): DrawingLayout {
  const opts = { ...DEFAULT_OPTS, ...options };
  const warnings: string[] = [];

  // First pass: turn each child into a shape descriptor (or a pending
  // connector). Track which shapes still need an auto-grid slot.
  interface Entry {
    shape: DrawingShape;
    hasX: boolean;
    hasY: boolean;
  }
  const entries: Entry[] = [];
  const unpositioned: number[] = [];

  // Connectors are resolved after all shape ids are known.
  interface PendingConnector {
    id: string;
    kind: 'line' | 'arrow';
    from: string;
    to: string;
    label?: string;
    stroke?: string;
    strokeWidth?: number;
    dasharray?: string;
    startMarker: MarkerStyle;
    endMarker: MarkerStyle;
    routing: ConnectorRouting;
    source: string; // child id, for warning messages
  }
  const pendingConnectors: PendingConnector[] = [];

  for (const child of children) {
    const kind = normalizeShapeKind(child.template);
    const params = child.templateOverrides ?? {};
    const label = child.title ?? '';
    const body = bodyText(child);

    if (!kind) {
      warnings.push(
        `Child "${child.id}" is not a shape (annotation "${child.template ?? '—'}") and was skipped`,
      );
      continue;
    }

    // line/arrow with from/to (or any shape's connectsTo) → connector.
    const from = strParam(params, 'from');
    const to = strParam(params, 'to');
    if ((kind === 'line' || kind === 'arrow') && (from || to)) {
      pendingConnectors.push({
        id: child.id,
        kind,
        from: from ?? '',
        to: to ?? '',
        ...(label ? { label } : {}),
        ...connectorSemantics(params, kind),
        source: child.id,
      });
      continue;
    }

    // Diagram-compatible: a shape's `connectsTo` also emits arrow connectors.
    for (const conn of child.connectsTo ?? []) {
      pendingConnectors.push({
        id: `${child.id}->${conn.target}${conn.type ? `:${conn.type}` : ''}`,
        kind: 'arrow',
        from: child.id,
        to: conn.target,
        ...(conn.type ? { label: conn.type } : {}),
        ...connectorSemantics(params, 'arrow'),
        source: child.id,
      });
    }

    const size = defaultSize(kind);
    const x = numParam(params, 'x');
    const y = numParam(params, 'y');
    const shape: DrawingShape = {
      id: child.id,
      kind,
      x: x ?? 0,
      y: y ?? 0,
      width: numParam(params, 'width') ?? numParam(params, 'w') ?? size.w,
      height: numParam(params, 'height') ?? numParam(params, 'h') ?? size.h,
      pinned: x != null && y != null,
      label,
      ...(body ? { sublabel: body } : {}),
      ...styleParams(params),
    };
    if (kind === 'path') {
      const d = strParam(params, 'd');
      if (d) shape.d = d;
    }
    if (kind === 'text') {
      shape.text = strParam(params, 'text') ?? label ?? body ?? '';
    }
    if (numParam(params, 'borderRadius') != null) {
      shape.borderRadius = numParam(params, 'borderRadius');
    }

    entries.push({ shape, hasX: x != null, hasY: y != null });
    if (x == null || y == null) unpositioned.push(entries.length - 1);
  }

  // Second pass: auto-place shapes missing a coordinate in a grid below
  // the pinned bounding box (mirrors diagramLayout).
  if (unpositioned.length > 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(unpositioned.length)));
    let baseX = opts.gridOriginX;
    let baseY = opts.gridOriginY;
    const pinned = entries.filter((e) => e.shape.pinned);
    if (pinned.length > 0) {
      baseX = Math.min(...pinned.map((e) => e.shape.x));
      baseY = Math.max(...pinned.map((e) => e.shape.y + e.shape.height)) + opts.gridPad;
    }
    unpositioned.forEach((entryIdx, k) => {
      const col = k % cols;
      const row = Math.floor(k / cols);
      entries[entryIdx].shape.x = baseX + col * opts.gapX;
      entries[entryIdx].shape.y = baseY + row * opts.gapY;
    });
  }

  const shapes = entries.map((e) => e.shape);
  const shapeIds = new Set(shapes.map((s) => s.id));

  // Third pass: resolve connectors against known shape ids, dropping ghosts.
  const connectors: DrawingConnector[] = [];
  const seen = new Set<string>();
  for (const c of pendingConnectors) {
    if (!shapeIds.has(c.from) || !shapeIds.has(c.to)) {
      const missing = !shapeIds.has(c.from) ? c.from : c.to;
      warnings.push(
        `Connector "${c.source}" dropped: ${missing ? `no shape with id "${missing}"` : 'missing from/to'}`,
      );
      continue;
    }
    const key = `${c.kind}:${c.from}->${c.to}:${c.label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { source: _source, ...rest } = c;
    connectors.push(rest);
  }

  return { shapes, connectors, warnings };
}

// ============================================
// Param coercion
// ============================================

/** Read a raw string param (trims a trailing comma — `x=21, y=25` is tolerated). */
function strParam(params: Record<string, string>, key: string): string | undefined {
  const raw = params[key];
  if (raw == null) return undefined;
  const v = raw.replace(/,\s*$/, '').trim();
  return v.length > 0 ? v : undefined;
}

/** Coerce a numeric param, tolerating a trailing comma. Returns undefined on failure. */
function numParam(params: Record<string, string>, key: string): number | undefined {
  const v = strParam(params, key);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Stroke style pass-throughs shared by shapes and connectors. */
function connectorStyle(params: Record<string, string>): {
  stroke?: string;
  strokeWidth?: number;
  dasharray?: string;
} {
  const out: { stroke?: string; strokeWidth?: number; dasharray?: string } = {};
  const stroke = strParam(params, 'stroke');
  const strokeWidth = numParam(params, 'strokeWidth');
  const dasharray = strParam(params, 'dasharray');
  if (stroke) out.stroke = stroke;
  if (strokeWidth != null) out.strokeWidth = strokeWidth;
  if (dasharray) out.dasharray = dasharray;
  return out;
}

/** Style pass-throughs for a fillable shape — connector stroke set plus `fill`. */
function styleParams(params: Record<string, string>): {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dasharray?: string;
} {
  const fill = strParam(params, 'fill');
  return { ...connectorStyle(params), ...(fill ? { fill } : {}) };
}

const MARKER_ALIASES: Readonly<Record<string, MarkerStyle>> = {
  none: 'none',
  arrow: 'arrow',
  triangle: 'arrow',
  filled: 'arrow',
  open: 'open',
  v: 'open',
  diamond: 'diamond',
  circle: 'circle',
  dot: 'circle',
  square: 'square',
  box: 'square',
};

const ROUTING_ALIASES: Readonly<Record<string, ConnectorRouting>> = {
  straight: 'straight',
  direct: 'straight',
  orthogonal: 'orthogonal',
  elbow: 'orthogonal',
  step: 'orthogonal',
  curved: 'curved',
  curve: 'curved',
  bezier: 'curved',
};

function parseMarker(raw: string | undefined): MarkerStyle | undefined {
  return raw ? MARKER_ALIASES[raw.toLowerCase()] : undefined;
}

function parseRouting(raw: string | undefined): ConnectorRouting | undefined {
  return raw ? ROUTING_ALIASES[raw.toLowerCase()] : undefined;
}

/**
 * Connector-only semantics: stroke style + end markers + line style + routing.
 * The default end marker is a filled `arrow` for `arrow` connectors, `none`
 * for plain `line`s; `endStyle`/`startStyle` override. `lineStyle` fills in a
 * dasharray when no explicit `dasharray` is given.
 */
function connectorSemantics(
  params: Record<string, string>,
  kind: 'line' | 'arrow',
): {
  stroke?: string;
  strokeWidth?: number;
  dasharray?: string;
  startMarker: MarkerStyle;
  endMarker: MarkerStyle;
  routing: ConnectorRouting;
} {
  const out = connectorStyle(params);
  const dasharray = out.dasharray ?? lineStyleDasharray(strParam(params, 'lineStyle'));
  return {
    ...out,
    ...(dasharray ? { dasharray } : {}),
    startMarker: parseMarker(strParam(params, 'startStyle')) ?? 'none',
    endMarker: parseMarker(strParam(params, 'endStyle')) ?? (kind === 'arrow' ? 'arrow' : 'none'),
    routing: parseRouting(strParam(params, 'routing')) ?? 'straight',
  };
}

/** Plain text of a block's body content (sublabel source). */
function bodyText(block: Block): string {
  if (!block.contents || block.contents.length === 0) return '';
  return block.contents
    .map((node) => extractPlainText(node))
    .join(' ')
    .trim();
}
