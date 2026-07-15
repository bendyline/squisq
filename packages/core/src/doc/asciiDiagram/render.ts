/**
 * ASCII diagram renderer: semantic nodes/edges → box-and-line art.
 *
 * Deterministic (no clock, no randomness; every iteration order is an
 * explicit sort) and designed as a fixpoint partner for `parse.ts`:
 *
 * - `parseAsciiDiagram(renderAsciiDiagram(d))` preserves node ids, labels,
 *   containment, and the edge tuple set of `d`.
 * - After one normalization cycle the output is byte-stable:
 *   `renderAsciiDiagram(parseAsciiDiagram(renderAsciiDiagram(d))) ===
 *   renderAsciiDiagram(d)`.
 *
 * Grid positions come from the nodes; container rects are DERIVED from
 * their children each render (a container's own col/row are ignored), so
 * moving children can never orphan them outside their box.
 */

import { ASCII_VOCAB, UNICODE_VOCAB, cellWidth, toCells, type StyleVocab } from './chars.js';
import { MAX_BRIDGE_GAP } from './parse.js';
import type { AsciiDiagram, AsciiDiagramEdge, AsciiDiagramNode } from './types.js';

/**
 * Render-time label normalization — the ONLY normalization applied to
 * authored text, and applied so that `parse(render(d)) === d`:
 *
 * - Node labels: per-line trim, blank lines dropped. The parser trims each
 *   interior row and skips blank ones, so an un-normalized label would come
 *   back different and the second render would differ from the first.
 * - Edge labels: whitespace runs collapse to one space, then trim. An edge
 *   label lives on a single row; a newline/tab has no grid meaning, and the
 *   parser's side-label scan stops at a double space.
 *
 * Structural characters (`| - + │ ─ ┐ …`) are deliberately NOT stripped:
 * the parser disambiguates them from structure by continuity, so labels
 * like `stdin | out`, `read-only`, and `co-op` survive verbatim.
 */
function normalizeLabelLines(label: string): string[] {
  return label
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeEdgeLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const collapsed = label.replace(/\s+/gu, ' ').trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

/**
 * Can the re-parse bridge span this ` label ` text?
 *
 * The parser's bridge scan gives up after {@link MAX_BRIDGE_GAP} label
 * cells, at which point the run it was gluing splits in two and BOTH halves
 * are dropped as `dangling-edge` — embedding an over-long label destroys the
 * edge itself. Refusing to embed it costs the label but always keeps the
 * edge, and the un-embedded line re-renders identically, so the result stays
 * byte-stable. (The same trade the tight-gap case makes below.)
 */
function edgeLabelFitsBridge(text: readonly string[]): boolean {
  return text.length <= MAX_BRIDGE_GAP;
}

export interface RenderAsciiDiagramOptions {
  /** Character vocabulary; defaults to the diagram's own detected style. */
  style?: 'unicode' | 'ascii';
}

interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

interface PlacedNode {
  node: AsciiDiagramNode;
  rect: Rect;
  labelLines: string[];
  isContainer: boolean;
  depth: number;
}

const SIDE_MARGIN = 1; // blank cells kept between distinct sibling rects

export function renderAsciiDiagram(
  diagram: AsciiDiagram,
  options: RenderAsciiDiagramOptions = {},
): string {
  const vocab = (options.style ?? diagram.style) === 'ascii' ? ASCII_VOCAB : UNICODE_VOCAB;
  if (diagram.nodes.length === 0) return '';

  const placed = layoutNodes(diagram.nodes, diagram.edges);
  const canvas = new Canvas();

  // Boxes: outermost containers first so children draw over their interior.
  const drawOrder = [...placed.values()].sort(
    (a, b) => a.depth - b.depth || a.rect.r0 - b.rect.r0 || a.rect.c0 - b.rect.c0,
  );
  for (const p of drawOrder) drawBox(canvas, p, vocab);

  drawEdges(canvas, diagram.edges, placed, vocab);

  return canvas.emit();
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Approximate per-side edge degree from the nodes' authored grid
 * positions (same side logic as `pickSides`, run before final layout).
 * Used to widen/heighten boxes so sibling attachments always land on
 * distinct, gapped cells — adjacent attachments (`┬┬`) route into each
 * other and collapse to one component on re-parse.
 */
function computeSideDegrees(
  nodes: readonly AsciiDiagramNode[],
  edges: readonly AsciiDiagramEdge[],
): Map<string, { top: number; bottom: number; left: number; right: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const deg = new Map<string, { top: number; bottom: number; left: number; right: number }>();
  for (const n of nodes) deg.set(n.id, { top: 0, bottom: 0, left: 0, right: 0 });
  const rectOf = (n: AsciiDiagramNode): Rect => ({
    r0: n.row,
    c0: n.col,
    r1: n.row + n.hRows - 1,
    c1: n.col + n.wCols - 1,
  });
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || s === t) continue;
    const { exit, enter } = pickSides(rectOf(s), rectOf(t));
    deg.get(e.source)![exit]++;
    deg.get(e.target)![enter]++;
  }
  return deg;
}

function layoutNodes(
  nodes: readonly AsciiDiagramNode[],
  edges: readonly AsciiDiagramEdge[],
): Map<string, PlacedNode> {
  const byId = new Map<string, AsciiDiagramNode>();
  for (const node of nodes) byId.set(node.id, node);
  const sideDeg = computeSideDegrees(nodes, edges);

  const childIds = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of nodes) {
    if (node.containerId && byId.has(node.containerId) && node.containerId !== node.id) {
      const list = childIds.get(node.containerId) ?? [];
      list.push(node.id);
      childIds.set(node.containerId, list);
    } else {
      roots.push(node.id);
    }
  }

  const placed = new Map<string, PlacedNode>();

  const translateSubtree = (id: string, dRows: number, dCols: number): void => {
    const p = placed.get(id);
    if (p) p.rect = shiftRect(p.rect, dRows, dCols);
    for (const childId of childIds.get(id) ?? []) translateSubtree(childId, dRows, dCols);
  };

  // Place a set of sibling units (each may be a whole subtree) without overlap.
  const placeSiblings = (ids: string[], layoutUnit: (id: string) => Rect): Rect[] => {
    const order = [...ids].sort((a, b) => {
      const na = byId.get(a) as AsciiDiagramNode;
      const nb = byId.get(b) as AsciiDiagramNode;
      return na.row - nb.row || na.col - nb.col || na.id.localeCompare(nb.id);
    });
    const placedRects: Rect[] = [];
    for (const id of order) {
      let rect = layoutUnit(id);
      // Greedy deterministic collision resolution: shift along the axis
      // needing the smaller displacement (ties → down).
      let guard = 0;
      for (;;) {
        const hit = placedRects.find((p) => overlapsWithMargin(rect, p, SIDE_MARGIN));
        if (!hit || guard++ > 64) break;
        const dxRight = hit.c1 + SIDE_MARGIN + 1 - rect.c0;
        const dyDown = hit.r1 + SIDE_MARGIN + 1 - rect.r0;
        if (dxRight < dyDown) {
          translateSubtree(id, 0, dxRight);
          rect = shiftRect(rect, 0, dxRight);
        } else {
          translateSubtree(id, dyDown, 0);
          rect = shiftRect(rect, dyDown, 0);
        }
      }
      placedRects.push(rect);
    }
    return placedRects;
  };

  // Recursively size + place a subtree; returns its bounding rect.
  const layoutSubtree = (id: string, depth: number): Rect => {
    const node = byId.get(id) as AsciiDiagramNode;
    const labelLines = normalizeLabelLines(node.label);
    const children = childIds.get(id) ?? [];

    if (children.length === 0) {
      const innerW = labelLines.reduce((w, l) => Math.max(w, cellWidth(l)), 0);
      // Attachment gap: a side with K edges needs ≥ 2K+1 inner cells so the
      // spread (`from + round((i+1)*inner/(K+1))`) leaves a blank column
      // between consecutive attachments and off the corners.
      const deg = sideDeg.get(id) ?? { top: 0, bottom: 0, left: 0, right: 0 };
      const horizDeg = Math.max(deg.top, deg.bottom);
      const vertDeg = Math.max(deg.left, deg.right);
      const wCols = Math.max(node.wCols, innerW + 4, 3, horizDeg > 0 ? 2 * horizDeg + 1 : 0);
      const hRows = Math.max(
        node.hRows,
        labelLines.length + 2,
        3,
        vertDeg > 0 ? 2 * vertDeg + 1 : 0,
      );
      const rect: Rect = {
        r0: node.row,
        c0: node.col,
        r1: node.row + hRows - 1,
        c1: node.col + wCols - 1,
      };
      placed.set(id, { node, rect, labelLines, isContainer: false, depth });
      return rect;
    }

    // Container: children first, then derive our rect around them.
    const childRects = placeSiblings(children, (childId) => layoutSubtree(childId, depth + 1));
    const bbox = unionRects(childRects);
    const extraRows = Math.max(0, labelLines.length - 1);
    const titleLen = cellWidth(labelLines[0] ?? '');
    const rect: Rect = {
      r0: bbox.r0 - 2 - extraRows,
      c0: bbox.c0 - 2,
      r1: bbox.r1 + 2,
      c1: bbox.c1 + 2,
    };
    // Top border must host `── Title ──` with ≥1 line char each side; the
    // remaining label lines sit inside and need ≥1 blank cell each side
    // (a truncated interior line would silently lose label text).
    const innerLinesW = labelLines.slice(1).reduce((w, l) => Math.max(w, cellWidth(l)), 0);
    const minW = Math.max(titleLen > 0 ? titleLen + 6 : 3, innerLinesW > 0 ? innerLinesW + 4 : 3);
    if (rect.c1 - rect.c0 + 1 < minW) rect.c1 = rect.c0 + minW - 1;
    // Never shrink below the parsed size (visual stability for wide containers).
    if (rect.c1 - rect.c0 + 1 < node.wCols) rect.c1 = rect.c0 + node.wCols - 1;
    placed.set(id, { node, rect, labelLines, isContainer: true, depth });
    return rect;
  };

  placeSiblings(roots, (id) => layoutSubtree(id, 0));

  // Normalize into the positive quadrant (container margins can push past 0).
  let minR = Infinity;
  let minC = Infinity;
  for (const p of placed.values()) {
    minR = Math.min(minR, p.rect.r0);
    minC = Math.min(minC, p.rect.c0);
  }
  const dR = minR < 0 ? -minR : 0;
  const dC = minC < 0 ? -minC : 0;
  if (dR > 0 || dC > 0) {
    for (const p of placed.values()) p.rect = shiftRect(p.rect, dR, dC);
  }
  return placed;
}

function overlapsWithMargin(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.r0 - margin <= b.r1 && b.r0 - margin <= a.r1 && a.c0 - margin <= b.c1 && b.c0 - margin <= a.c1
  );
}

function shiftRect(rect: Rect, dRows: number, dCols: number): Rect {
  return { r0: rect.r0 + dRows, c0: rect.c0 + dCols, r1: rect.r1 + dRows, c1: rect.c1 + dCols };
}

function unionRects(rects: Rect[]): Rect {
  return rects.reduce((acc, r) => ({
    r0: Math.min(acc.r0, r.r0),
    c0: Math.min(acc.c0, r.c0),
    r1: Math.max(acc.r1, r.r1),
    c1: Math.max(acc.c1, r.c1),
  }));
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

type CellKind = 'empty' | 'border' | 'label' | 'line-h' | 'line-v' | 'turn' | 'arrow' | 'junction';

class Canvas {
  private rows: string[][] = [];
  private kinds: CellKind[][] = [];

  private ensure(r: number, c: number): void {
    while (this.rows.length <= r) {
      this.rows.push([]);
      this.kinds.push([]);
    }
    const row = this.rows[r];
    const kindRow = this.kinds[r];
    while (row.length <= c) {
      row.push(' ');
      kindRow.push('empty');
    }
  }

  kindAt(r: number, c: number): CellKind {
    return this.kinds[r]?.[c] ?? 'empty';
  }

  /** Unconditional write (boxes, labels, junction upgrades). */
  set(r: number, c: number, ch: string, kind: CellKind): void {
    if (r < 0 || c < 0) return;
    this.ensure(r, c);
    this.rows[r][c] = ch;
    this.kinds[r][c] = kind;
  }

  /** Edge-aware write: respects borders, upgrades crossings, lets arrows win. */
  drawEdgeCell(r: number, c: number, ch: string, kind: CellKind, vocab: StyleVocab): void {
    if (r < 0 || c < 0) return;
    this.ensure(r, c);
    const existing = this.kinds[r][c];
    if (existing === 'border' || existing === 'label' || existing === 'junction') return;
    if (kind === 'arrow') {
      this.rows[r][c] = ch;
      this.kinds[r][c] = kind;
      return;
    }
    if (existing === 'arrow') return;
    if (
      (existing === 'line-h' && kind === 'line-v') ||
      (existing === 'line-v' && kind === 'line-h')
    ) {
      this.rows[r][c] = vocab.cross;
      this.kinds[r][c] = 'turn';
      return;
    }
    if (existing === 'empty') {
      this.rows[r][c] = ch;
      this.kinds[r][c] = kind;
    }
  }

  emit(): string {
    const lines = this.rows.map((row) => row.join('').replace(/\s+$/u, ''));
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

function drawBox(canvas: Canvas, p: PlacedNode, vocab: StyleVocab): void {
  const { rect, labelLines, isContainer } = p;
  const innerW = rect.c1 - rect.c0 - 1;

  // Top border (containers embed their first label line as a title).
  canvas.set(rect.r0, rect.c0, vocab.tl, 'border');
  canvas.set(rect.r0, rect.c1, vocab.tr, 'border');
  const title = isContainer && labelLines.length > 0 ? toCells(` ${labelLines[0]} `) : null;
  if (title && title.length <= innerW - 2) {
    const left = Math.floor((innerW - title.length) / 2);
    for (let i = 0; i < innerW; i++) {
      const inTitle = i >= left && i < left + title.length;
      const ch = inTitle ? title[i - left] : vocab.h;
      canvas.set(rect.r0, rect.c0 + 1 + i, ch, inTitle ? 'label' : 'border');
    }
  } else {
    for (let c = rect.c0 + 1; c <= rect.c1 - 1; c++) canvas.set(rect.r0, c, vocab.h, 'border');
  }

  // Bottom border + sides.
  canvas.set(rect.r1, rect.c0, vocab.bl, 'border');
  canvas.set(rect.r1, rect.c1, vocab.br, 'border');
  for (let c = rect.c0 + 1; c <= rect.c1 - 1; c++) canvas.set(rect.r1, c, vocab.h, 'border');
  for (let r = rect.r0 + 1; r <= rect.r1 - 1; r++) {
    canvas.set(r, rect.c0, vocab.v, 'border');
    canvas.set(r, rect.c1, vocab.v, 'border');
  }

  // Interior label lines: leaves get all lines (vertically centered),
  // containers the lines after the embedded title, directly below the top.
  const interiorLines = isContainer ? labelLines.slice(1) : labelLines;
  if (interiorLines.length > 0) {
    const innerH = rect.r1 - rect.r0 - 1;
    const startRow = isContainer
      ? rect.r0 + 1
      : rect.r0 + 1 + Math.max(0, Math.floor((innerH - interiorLines.length) / 2));
    interiorLines.forEach((line, i) => {
      const cells = toCells(line);
      const pad = Math.max(0, Math.floor((innerW - cells.length) / 2));
      for (let j = 0; j < cells.length && pad + j < innerW; j++) {
        canvas.set(startRow + i, rect.c0 + 1 + pad + j, cells[j], 'label');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

type Side = 'top' | 'bottom' | 'left' | 'right';

interface RoutePlan {
  edge: AsciiDiagramEdge;
  sourceId: string;
  targetId: string;
  exitSide: Side;
  enterSide: Side;
  biDir: boolean;
}

function drawEdges(
  canvas: Canvas,
  edges: readonly AsciiDiagramEdge[],
  placed: Map<string, PlacedNode>,
  vocab: StyleVocab,
): void {
  // Merge reciprocal directed pairs into single double-arrow lines.
  const sorted = [...edges].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      (a.label ?? '').localeCompare(b.label ?? ''),
  );
  const skip = new Set<number>();
  const plans: RoutePlan[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (skip.has(i)) continue;
    const e = sorted[i];
    if (!placed.has(e.source) || !placed.has(e.target)) continue;
    let biDir = false;
    if (e.directed) {
      const j = sorted.findIndex(
        (o, k) =>
          k > i &&
          !skip.has(k) &&
          o.directed &&
          o.source === e.target &&
          o.target === e.source &&
          (o.label ?? '') === (e.label ?? ''),
      );
      if (j >= 0) {
        skip.add(j);
        biDir = true;
      }
    }
    const sides = pickSides(
      (placed.get(e.source) as PlacedNode).rect,
      (placed.get(e.target) as PlacedNode).rect,
    );
    plans.push({
      edge: e,
      sourceId: e.source,
      targetId: e.target,
      exitSide: sides.exit,
      enterSide: sides.enter,
      biDir,
    });
  }

  const attachment = assignAttachments(plans, placed);
  const sideLabelRequests: SideLabelRequest[] = [];
  plans.forEach((plan, i) =>
    routeEdge(canvas, plan, i, placed, attachment, vocab, (candidates, label) =>
      sideLabelRequests.push({ candidates, label }),
    ),
  );

  // Side labels last, so they can never break another edge's line: each
  // label lands beside the first candidate whose anchor is still a plain
  // vertical and whose neighboring cells are all free — right side
  // (`│ label`) preferred, left side (`label │`) as fallback.
  for (const req of sideLabelRequests) {
    const cells = toCells(req.label);
    let done = false;
    for (const side of ['right', 'left'] as const) {
      if (done) break;
      for (const { row, col } of req.candidates) {
        if (canvas.kindAt(row, col) !== 'line-v') continue;
        const startCol = side === 'right' ? col + 2 : col - 1 - cells.length;
        if (startCol < 0) continue;
        const gapCol = side === 'right' ? col + 1 : col - 1;
        let free = canvas.kindAt(row, gapCol) === 'empty';
        for (let i = 0; free && i < cells.length; i++) {
          if (canvas.kindAt(row, startCol + i) !== 'empty') free = false;
        }
        // Left-side runs must not merge into earlier art on their left.
        if (free && side === 'left' && startCol > 0) {
          free = canvas.kindAt(row, startCol - 1) === 'empty';
        }
        if (!free) continue;
        for (let i = 0; i < cells.length; i++) {
          canvas.set(row, startCol + i, cells[i], 'label');
        }
        done = true;
        break;
      }
    }
  }
}

interface SideLabelRequest {
  /** Candidate anchor cells in preference order (middle-out per leg). */
  candidates: Array<{ row: number; col: number }>;
  label: string;
}

function pickSides(s: Rect, t: Rect): { exit: Side; enter: Side } {
  if (t.r0 > s.r1) return { exit: 'bottom', enter: 'top' };
  if (t.r1 < s.r0) return { exit: 'top', enter: 'bottom' };
  if (t.c0 > s.c1) return { exit: 'right', enter: 'left' };
  if (t.c1 < s.c0) return { exit: 'left', enter: 'right' };
  // Overlapping / containment: connect the closest pair of parallel borders.
  const gaps: Array<{ side: Side; gap: number }> = [
    { side: 'top', gap: Math.abs(s.r0 - t.r0) },
    { side: 'bottom', gap: Math.abs(t.r1 - s.r1) },
    { side: 'left', gap: Math.abs(s.c0 - t.c0) },
    { side: 'right', gap: Math.abs(t.c1 - s.c1) },
  ];
  gaps.sort((a, b) => a.gap - b.gap);
  return { exit: gaps[0].side, enter: gaps[0].side };
}

interface AttachmentSlot {
  pos: number;
  /** 0-based order within the (node, side) group + group size — used to
   * stagger Z-route jog rows so parallel routes never touch (touching
   * turns would merge into one component on re-parse). */
  index: number;
  count: number;
}

/** Deterministic per-(node, side) attachment positions, spread across the side. */
function assignAttachments(
  plans: RoutePlan[],
  placed: Map<string, PlacedNode>,
): Map<string, AttachmentSlot> {
  interface Request {
    key: string; // `${planIndex}:exit` | `${planIndex}:enter`
    otherId: string;
  }
  const bySide = new Map<string, Request[]>();
  plans.forEach((plan, i) => {
    const exitKey = `${plan.sourceId}|${plan.exitSide}`;
    const enterKey = `${plan.targetId}|${plan.enterSide}`;
    bySide.set(exitKey, [
      ...(bySide.get(exitKey) ?? []),
      { key: `${i}:exit`, otherId: plan.targetId },
    ]);
    bySide.set(enterKey, [
      ...(bySide.get(enterKey) ?? []),
      { key: `${i}:enter`, otherId: plan.sourceId },
    ]);
  });
  const result = new Map<string, AttachmentSlot>();
  for (const [sideKey, list] of [...bySide.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [nodeId, side] = sideKey.split('|') as [string, Side];
    const node = placed.get(nodeId) as PlacedNode;
    list.sort((a, b) => {
      const ra = (placed.get(a.otherId) as PlacedNode).rect;
      const rb = (placed.get(b.otherId) as PlacedNode).rect;
      return ra.r0 - rb.r0 || ra.c0 - rb.c0 || a.otherId.localeCompare(b.otherId);
    });
    const horizontal = side === 'top' || side === 'bottom';
    const from = horizontal ? node.rect.c0 + 1 : node.rect.r0 + 1;
    const to = horizontal ? node.rect.c1 - 1 : node.rect.r1 - 1;
    const inner = Math.max(1, to - from + 1);
    const k = list.length;
    if (k === 1) {
      // Single attachment lands on the side's center cell.
      result.set(list[0].key, { pos: from + Math.floor((inner - 1) / 2), index: 0, count: 1 });
    } else {
      // Stride-2 centered placement guarantees a blank cell between
      // consecutive attachments (min box sizing reserves the room), so
      // sibling routes never share adjacent columns and collapse on
      // re-parse. Span = 2k-1; clamp into the side if a tiny box can't fit.
      const span = 2 * k - 1;
      const start = from + Math.max(0, Math.floor((inner - span) / 2));
      list.forEach((req, i) => {
        result.set(req.key, { pos: Math.min(to, start + 2 * i), index: i, count: k });
      });
    }
  }
  return result;
}

function routeEdge(
  canvas: Canvas,
  plan: RoutePlan,
  planIdx: number,
  placed: Map<string, PlacedNode>,
  attachment: Map<string, AttachmentSlot>,
  vocab: StyleVocab,
  deferSideLabel: (candidates: Array<{ row: number; col: number }>, label: string) => void,
): void {
  const s = (placed.get(plan.sourceId) as PlacedNode).rect;
  const t = (placed.get(plan.targetId) as PlacedNode).rect;
  const exitSlot = attachment.get(`${planIdx}:exit`) as AttachmentSlot;
  const enterSlot = attachment.get(`${planIdx}:enter`) as AttachmentSlot;
  const exitPos = exitSlot.pos;
  const enterPos = enterSlot.pos;
  // Deterministic jog stagger: routes sharing a side (either end — fan-outs
  // AND fan-ins) each get a distinct mid-line so their turns/segments can
  // never touch or overlap on the same row/column.
  const basis = enterSlot.count > exitSlot.count ? enterSlot : exitSlot;
  const stagger = basis.index - Math.floor((basis.count - 1) / 2);

  const junction = (r: number, c: number, side: Side): void => {
    const ch =
      side === 'top'
        ? vocab.stemUp
        : side === 'bottom'
          ? vocab.stemDown
          : side === 'left'
            ? vocab.stemLeft
            : vocab.stemRight;
    canvas.set(r, c, ch, 'junction');
  };

  const args: EdgeDrawArgs = {
    canvas,
    directed: plan.edge.directed,
    biDir: plan.biDir,
    label: normalizeEdgeLabel(plan.edge.label),
    vocab,
    junction,
    stagger,
    deferSideLabel,
  };

  if (plan.exitSide === 'bottom' && plan.enterSide === 'top') {
    drawVertical(args, s, t, exitPos, enterPos, 1);
  } else if (plan.exitSide === 'top' && plan.enterSide === 'bottom') {
    drawVertical(args, s, t, exitPos, enterPos, -1);
  } else if (plan.exitSide === 'right' && plan.enterSide === 'left') {
    drawHorizontal(args, s, t, exitPos, enterPos, 1);
  } else if (plan.exitSide === 'left' && plan.enterSide === 'right') {
    drawHorizontal(args, s, t, exitPos, enterPos, -1);
  } else {
    drawNested(args, s, t, plan.exitSide);
  }
}

interface EdgeDrawArgs {
  canvas: Canvas;
  directed: boolean;
  biDir: boolean;
  label: string | undefined;
  vocab: StyleVocab;
  junction: (r: number, c: number, side: Side) => void;
  /** Jog offset for Z-routes so sibling routes never share a mid-line. */
  stagger: number;
  /** Queue a `│ label` placement for the deferred final pass. */
  deferSideLabel: (candidates: Array<{ row: number; col: number }>, label: string) => void;
}

/** Order candidate rows middle-out so labels prefer a run's midpoint. */
function middleOut(from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const rows: number[] = [];
  for (let r = lo; r <= hi; r++) rows.push(r);
  const mid = Math.floor((lo + hi) / 2);
  return rows.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function drawVertical(
  args: EdgeDrawArgs,
  s: Rect,
  t: Rect,
  exitCol: number,
  enterCol: number,
  dir: 1 | -1,
): void {
  const { canvas, directed, biDir, label, vocab, junction, stagger } = args;
  // dir 1: exit bottom of s, enter top of t (t below); dir -1 mirrored.
  const exitRow = dir === 1 ? s.r1 : s.r0;
  const enterRow = dir === 1 ? t.r0 : t.r1;
  const firstFree = exitRow + dir;
  const lastFree = enterRow - dir;
  const gap = (lastFree - firstFree) * dir + 1;

  const drawV = (col: number, rA: number, rB: number): void => {
    const lo = Math.min(rA, rB);
    const hi = Math.max(rA, rB);
    for (let r = lo; r <= hi; r++) canvas.drawEdgeCell(r, col, vocab.v, 'line-v', vocab);
  };

  const straightOk =
    exitCol >= t.c0 + 1 && exitCol <= t.c1 - 1 && exitCol >= s.c0 + 1 && exitCol <= s.c1 - 1;

  if (straightOk || gap < 2) {
    // Straight (or no room to jog): one column, clamped onto both borders.
    const sCol = clamp(exitCol, s.c0 + 1, s.c1 - 1);
    const tCol = clamp(exitCol, t.c0 + 1, t.c1 - 1);
    junction(exitRow, sCol, dir === 1 ? 'bottom' : 'top');
    junction(enterRow, tCol, dir === 1 ? 'top' : 'bottom');
    if (sCol === tCol && gap >= 1) {
      drawV(sCol, firstFree, lastFree);
      if (directed) {
        canvas.drawEdgeCell(
          lastFree,
          sCol,
          dir === 1 ? vocab.arrowDown : vocab.arrowUp,
          'arrow',
          vocab,
        );
      }
      if (biDir && gap >= 2) {
        canvas.drawEdgeCell(
          firstFree,
          sCol,
          dir === 1 ? vocab.arrowUp : vocab.arrowDown,
          'arrow',
          vocab,
        );
      }
      // `│ label` beside the run (deferred pass finds a free plain row).
      if (label) {
        args.deferSideLabel(
          middleOut(firstFree, lastFree).map((row) => ({ row, col: sCol })),
          label,
        );
      }
    }
    return;
  }

  // Z-route with a horizontal jog (also hosts the label when present).
  // Sibling routes stagger their jog rows so turns never touch (touching
  // turns would merge into one polyline on re-parse).
  const midRow = clamp(
    Math.floor((exitRow + enterRow) / 2) + stagger,
    Math.min(firstFree, lastFree),
    Math.max(firstFree, lastFree),
  );
  junction(exitRow, exitCol, dir === 1 ? 'bottom' : 'top');
  junction(enterRow, enterCol, dir === 1 ? 'top' : 'bottom');
  if (Math.abs(midRow - exitRow) >= 2) drawV(exitCol, firstFree, midRow - dir);
  if (Math.abs(enterRow - midRow) >= 2) drawV(enterCol, midRow + dir, lastFree);
  let labelEmbedded = false;
  if (exitCol === enterCol) {
    canvas.drawEdgeCell(midRow, exitCol, vocab.v, 'line-v', vocab);
  } else {
    const goingRight = enterCol > exitCol;
    // Turn glyph names describe the corner's two open sides.
    const exitTurn =
      dir === 1
        ? goingRight
          ? vocab.turnUpRight
          : vocab.turnUpLeft
        : goingRight
          ? vocab.turnDownRight
          : vocab.turnDownLeft;
    const enterTurn =
      dir === 1
        ? goingRight
          ? vocab.turnDownLeft
          : vocab.turnDownRight
        : goingRight
          ? vocab.turnUpLeft
          : vocab.turnUpRight;
    canvas.drawEdgeCell(midRow, exitCol, exitTurn, 'turn', vocab);
    canvas.drawEdgeCell(midRow, enterCol, enterTurn, 'turn', vocab);
    const lo = Math.min(exitCol, enterCol);
    const hi = Math.max(exitCol, enterCol);
    let segment: string[] = [];
    for (let c = lo + 1; c <= hi - 1; c++) segment.push(vocab.h);
    // `+ 4` (not `+ 2`): at least one line char must survive on each side
    // of ` label `, or the re-parse bridge can't glue the run back together.
    // (The jog's arrowheads sit on the vertical legs, outside this segment,
    // so nothing here needs reserving — unlike the straight cases below.)
    const text = label ? toCells(` ${label} `) : null;
    if (text && edgeLabelFitsBridge(text) && segment.length >= text.length + 2) {
      const left = Math.floor((segment.length - text.length) / 2);
      segment = segment.map((ch, i) => (i >= left && i < left + text.length ? text[i - left] : ch));
      labelEmbedded = true;
    }
    segment.forEach((ch, i) => {
      canvas.drawEdgeCell(midRow, lo + 1 + i, ch, ch === vocab.h ? 'line-h' : 'label', vocab);
    });
  }
  if (directed) {
    canvas.drawEdgeCell(
      lastFree,
      enterCol,
      dir === 1 ? vocab.arrowDown : vocab.arrowUp,
      'arrow',
      vocab,
    );
  }
  if (biDir) {
    canvas.drawEdgeCell(
      firstFree,
      exitCol,
      dir === 1 ? vocab.arrowUp : vocab.arrowDown,
      'arrow',
      vocab,
    );
  }
  // Label that couldn't embed in the jog: queue a `│ label` placement
  // beside a vertical leg (exit leg preferred — its cells are all plain;
  // the deferred pass skips arrowhead/cross rows automatically).
  if (label && !labelEmbedded) {
    const candidates: Array<{ row: number; col: number }> = [];
    if (exitCol === enterCol) {
      for (const row of middleOut(firstFree, lastFree)) candidates.push({ row, col: exitCol });
    } else {
      const exitLegLen = (midRow - dir - firstFree) * dir + 1;
      const enterLegLen = (lastFree - (midRow + dir)) * dir + 1;
      if (exitLegLen >= 1) {
        for (const row of middleOut(firstFree, midRow - dir)) {
          candidates.push({ row, col: exitCol });
        }
      }
      if (enterLegLen >= 1) {
        for (const row of middleOut(midRow + dir, lastFree)) {
          candidates.push({ row, col: enterCol });
        }
      }
    }
    if (candidates.length > 0) args.deferSideLabel(candidates, label);
  }
}

function drawHorizontal(
  args: EdgeDrawArgs,
  s: Rect,
  t: Rect,
  exitRow: number,
  enterRow: number,
  dir: 1 | -1,
): void {
  const { canvas, directed, biDir, label, vocab, junction } = args;
  // dir 1: exit right of s, enter left of t (t to the right); dir -1 mirrored.
  const exitCol = dir === 1 ? s.c1 : s.c0;
  const enterCol = dir === 1 ? t.c0 : t.c1;
  const firstFree = exitCol + dir;
  const lastFree = enterCol - dir;
  const gap = (lastFree - firstFree) * dir + 1;

  /**
   * Draw a horizontal run, optionally embedding ` label ` in it.
   *
   * `reserveLo`/`reserveHi` are cells at each end that an arrowhead will
   * later OVERWRITE. They must be excluded from the label's room: the
   * re-parse bridge needs a horizontal char to survive on each side of the
   * label text to glue the run back into one component, and an arrowhead
   * landing on that char splits the run into two one-attachment fragments
   * that are both dropped as `dangling-edge`. Budgeting for the arrows here
   * (rather than testing the raw gap) keeps the `+ 4` invariant true of the
   * cells that actually remain — for every gap, not just the one that
   * happened to fail.
   */
  const drawH = (
    row: number,
    cA: number,
    cB: number,
    hostLabel: boolean,
    reserveLo = 0,
    reserveHi = 0,
  ): void => {
    const lo = Math.min(cA, cB);
    const hi = Math.max(cA, cB);
    let segment: string[] = [];
    for (let c = lo; c <= hi; c++) segment.push(vocab.h);
    const text = hostLabel && label ? toCells(` ${label} `) : null;
    if (text && edgeLabelFitsBridge(text)) {
      const from = reserveLo;
      const to = segment.length - 1 - reserveHi;
      const room = to - from + 1;
      // `+ 2` on the arrow-free room = the documented `label.length + 4`
      // total: ` label ` plus ≥1 surviving line char on each side.
      if (room >= text.length + 2) {
        const left = from + Math.floor((room - text.length) / 2);
        segment = segment.map((ch, i) =>
          i >= left && i < left + text.length ? text[i - left] : ch,
        );
      }
    }
    segment.forEach((ch, i) => {
      canvas.drawEdgeCell(row, lo + i, ch, ch === vocab.h ? 'line-h' : 'label', vocab);
    });
  };

  const straightOk =
    exitRow >= t.r0 + 1 && exitRow <= t.r1 - 1 && exitRow >= s.r0 + 1 && exitRow <= s.r1 - 1;

  if (straightOk || gap < 2) {
    const sRow = clamp(exitRow, s.r0 + 1, s.r1 - 1);
    const tRow = clamp(exitRow, t.r0 + 1, t.r1 - 1);
    junction(sRow, exitCol, dir === 1 ? 'right' : 'left');
    junction(tRow, enterCol, dir === 1 ? 'left' : 'right');
    if (sRow === tRow && gap >= 1) {
      // The directed arrowhead lands on `lastFree`, the bidirectional one on
      // `firstFree`; which end of the [lo, hi] span those are flips with `dir`.
      drawH(
        sRow,
        firstFree,
        lastFree,
        true,
        (dir === 1 ? biDir : directed) ? 1 : 0,
        (dir === 1 ? directed : biDir) ? 1 : 0,
      );
      if (directed) {
        canvas.drawEdgeCell(
          sRow,
          lastFree,
          dir === 1 ? vocab.arrowRight : vocab.arrowLeft,
          'arrow',
          vocab,
        );
      }
      if (biDir && gap >= 2) {
        canvas.drawEdgeCell(
          sRow,
          firstFree,
          dir === 1 ? vocab.arrowLeft : vocab.arrowRight,
          'arrow',
          vocab,
        );
      }
    }
    return;
  }

  // Horizontal Z-route (staggered like the vertical case).
  const midCol = clamp(
    Math.floor((exitCol + enterCol) / 2) + args.stagger,
    Math.min(firstFree, lastFree),
    Math.max(firstFree, lastFree),
  );
  junction(exitRow, exitCol, dir === 1 ? 'right' : 'left');
  junction(enterRow, enterCol, dir === 1 ? 'left' : 'right');
  // Only the bidirectional arrowhead shares the label-hosting exit leg; the
  // forward one lands on the enter leg, a different row.
  if (Math.abs(midCol - exitCol) >= 2) {
    drawH(
      exitRow,
      firstFree,
      midCol - dir,
      true,
      dir === 1 && biDir ? 1 : 0,
      dir === -1 && biDir ? 1 : 0,
    );
  }
  if (Math.abs(enterCol - midCol) >= 2) drawH(enterRow, midCol + dir, lastFree, false);
  if (exitRow === enterRow) {
    canvas.drawEdgeCell(exitRow, midCol, vocab.h, 'line-h', vocab);
  } else {
    const goingDown = enterRow > exitRow;
    const exitTurn =
      dir === 1
        ? goingDown
          ? vocab.turnDownLeft
          : vocab.turnUpLeft
        : goingDown
          ? vocab.turnDownRight
          : vocab.turnUpRight;
    const enterTurn =
      dir === 1
        ? goingDown
          ? vocab.turnUpRight
          : vocab.turnDownRight
        : goingDown
          ? vocab.turnUpLeft
          : vocab.turnDownLeft;
    canvas.drawEdgeCell(exitRow, midCol, exitTurn, 'turn', vocab);
    canvas.drawEdgeCell(enterRow, midCol, enterTurn, 'turn', vocab);
    const lo = Math.min(exitRow, enterRow);
    const hi = Math.max(exitRow, enterRow);
    for (let r = lo + 1; r <= hi - 1; r++) {
      canvas.drawEdgeCell(r, midCol, vocab.v, 'line-v', vocab);
    }
  }
  if (directed) {
    canvas.drawEdgeCell(
      enterRow,
      lastFree,
      dir === 1 ? vocab.arrowRight : vocab.arrowLeft,
      'arrow',
      vocab,
    );
  }
  if (biDir) {
    canvas.drawEdgeCell(
      exitRow,
      firstFree,
      dir === 1 ? vocab.arrowLeft : vocab.arrowRight,
      'arrow',
      vocab,
    );
  }
}

/** Containment / overlap: a short straight run between the closest parallel borders. */
function drawNested(args: EdgeDrawArgs, s: Rect, t: Rect, side: Side): void {
  const { canvas, directed, vocab, junction } = args;
  if (side === 'top' || side === 'bottom') {
    const overlapLo = Math.max(s.c0 + 1, t.c0 + 1);
    const overlapHi = Math.min(s.c1 - 1, t.c1 - 1);
    if (overlapLo > overlapHi) return;
    const col = Math.floor((overlapLo + overlapHi) / 2);
    const sRow = side === 'top' ? s.r0 : s.r1;
    const tRow = side === 'top' ? t.r0 : t.r1;
    if (sRow === tRow) return;
    junction(sRow, col, side);
    junction(tRow, col, side);
    const lo = Math.min(sRow, tRow);
    const hi = Math.max(sRow, tRow);
    for (let r = lo + 1; r <= hi - 1; r++) canvas.drawEdgeCell(r, col, vocab.v, 'line-v', vocab);
    if (directed && hi - lo >= 2) {
      const arrowRow = tRow > sRow ? tRow - 1 : tRow + 1;
      canvas.drawEdgeCell(
        arrowRow,
        col,
        tRow > sRow ? vocab.arrowDown : vocab.arrowUp,
        'arrow',
        vocab,
      );
    }
  } else {
    const overlapLo = Math.max(s.r0 + 1, t.r0 + 1);
    const overlapHi = Math.min(s.r1 - 1, t.r1 - 1);
    if (overlapLo > overlapHi) return;
    const row = Math.floor((overlapLo + overlapHi) / 2);
    const sCol = side === 'left' ? s.c0 : s.c1;
    const tCol = side === 'left' ? t.c0 : t.c1;
    if (sCol === tCol) return;
    junction(row, sCol, side);
    junction(row, tCol, side);
    const lo = Math.min(sCol, tCol);
    const hi = Math.max(sCol, tCol);
    for (let c = lo + 1; c <= hi - 1; c++) canvas.drawEdgeCell(row, c, vocab.h, 'line-h', vocab);
    if (directed && hi - lo >= 2) {
      const arrowCol = tCol > sCol ? tCol - 1 : tCol + 1;
      canvas.drawEdgeCell(
        row,
        arrowCol,
        tCol > sCol ? vocab.arrowRight : vocab.arrowLeft,
        'arrow',
        vocab,
      );
    }
  }
}
