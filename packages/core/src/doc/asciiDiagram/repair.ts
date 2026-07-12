/**
 * ASCII diagram REPAIR — an opt-in, best-effort pass that reconstructs a
 * clean, well-formed diagram from broken box-and-line art.
 *
 * The motivating case: hand-drawn architecture art whose labels overflow
 * their boxes and shove every following column out of alignment row-to-row
 * (e.g. a rename widened the labels). Conservative detection correctly
 * declines such art (`garbled-labels`) so it renders as a faithful code
 * block — but a user can then ask to "repair" it. This is that repair.
 *
 * It is deliberately AGGRESSIVE and lossy — never on the auto-detection path
 * (a mistake there would hide real code). It is only invoked when the user
 * explicitly opts in, and the result is a fully editable diagram, so an
 * imperfect edge or two is fine (the canvas lets the user fix them).
 *
 * Pipeline:
 *  1. Aggressive box tracing (walls may cross edge routing).
 *  2. Row-band label recovery — the key trick: even when a box's columns are
 *     desynced from its borders, each label ROW is internally consistent, so
 *     its `│…│` segments map to the band's boxes by reading order.
 *  3. Best-effort edge recovery (facing-border adjacency + arrowhead
 *     direction).
 *  4. Re-render clean via `renderAsciiDiagram` — the output re-parses cleanly.
 */

import { isHoriz, isVert, isJunction, arrowDirection } from './chars.js';
import { toGrid, traceBoxes, type TracedRect } from './parse.js';
import { renderAsciiDiagram } from './render.js';
import { detectAsciiDiagram } from './detect.js';
import type { AsciiDiagram, AsciiDiagramEdge, AsciiDiagramNode } from './types.js';

export interface RepairResult {
  /** The reconstructed diagram model (grid-native coordinates). */
  diagram: AsciiDiagram;
  /** Clean, re-rendered box-and-line art — re-parses to `diagram`. */
  art: string;
}

/** Minimum boxes for a repair to be worthwhile. */
const MIN_REPAIR_BOXES = 2;
/** Max vertical gap (rows) between two boxes to infer a connecting edge. */
const MAX_EDGE_ROW_GAP = 8;
/** Max horizontal gap (cols) between two boxes to infer a connecting edge. */
const MAX_EDGE_COL_GAP = 12;
/** Blank rows inserted between stacked bands so edges route without overlap. */
const BAND_ROW_GAP = 4;
/** Blank cols inserted between boxes in a band so edges route without overlap. */
const BAND_COL_GAP = 4;

/**
 * True when a fence is a box diagram too broken for clean detection but worth
 * offering to repair: it has box corners and aggressively traces ≥2 boxes,
 * yet conservative detection declines it. Clean diagrams (already detected)
 * and non-box art both return false, so the three states partition cleanly.
 */
export function isRepairableDiagram(text: string): boolean {
  // Already a clean diagram → not a repair candidate (the canvas handles it).
  if (detectAsciiDiagram(text).isDiagram) return false;
  const grid = toGrid(text);
  const rects = traceBoxes(grid, true);
  return dedupeRects(rects).length >= MIN_REPAIR_BOXES;
}

/**
 * Reconstruct a clean diagram from broken art. Returns `null` when fewer than
 * two boxes can be recovered (nothing worth repairing).
 */
export function repairAsciiDiagram(text: string): RepairResult | null {
  const grid = toGrid(text);
  const rects = dedupeRects(traceBoxes(grid, true));
  if (rects.length < MIN_REPAIR_BOXES) return null;

  const nodes = buildNodes(grid, rects);
  const edges = recoverEdges(grid, rects, nodes);
  const style = detectGridStyle(grid);
  const diagram: AsciiDiagram = { nodes, edges, style, warnings: ['repaired'] };
  return { diagram, art: renderAsciiDiagram(diagram) };
}

// ---------------------------------------------------------------------------
// Box de-duplication (aggressive tracing can emit the same rect twice, and
// nested duplicates where a container and a decomposed cell coincide).
// ---------------------------------------------------------------------------

function dedupeRects(rects: TracedRect[]): TracedRect[] {
  const seen = new Set<string>();
  const out: TracedRect[] = [];
  for (const r of rects) {
    const key = `${r.r0},${r.c0},${r.r1},${r.c1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  // Reading order (row, then col).
  return out.sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}

// ---------------------------------------------------------------------------
// Label recovery (row-band segment matching)
// ---------------------------------------------------------------------------

function buildNodes(grid: string[][], rects: TracedRect[]): AsciiDiagramNode[] {
  const W = grid[0]?.length ?? 0;
  const labels = rects.map(() => [] as string[]);
  const index = new Map(rects.map((r, i) => [r, i] as const));

  // Group boxes into horizontal bands (row ranges overlap).
  const bands: TracedRect[][] = [];
  for (const r of rects) {
    let band = bands.find((bd) => bd.some((x) => x.r0 <= r.r1 && r.r0 <= x.r1));
    if (!band) {
      band = [];
      bands.push(band);
    }
    band.push(r);
  }

  for (const band of bands) {
    band.sort((a, b) => a.c0 - b.c0);
    const minR = Math.min(...band.map((b) => b.r0 + 1));
    const maxR = Math.max(...band.map((b) => b.r1 - 1));
    for (let r = minR; r <= maxR; r++) {
      const inRow = band.filter((b) => r > b.r0 && r < b.r1);
      if (inRow.length === 0) continue;
      const rowText = grid[r].join('');
      // Split the row into `│`-delimited segments; a clean band row yields one
      // non-empty segment per box, matched by reading order.
      const segs = rowText
        .split(/[│┃║]/)
        .map(cleanLabelText)
        .filter((s) => s.length > 0);
      if (segs.length === inRow.length) {
        inRow.forEach((b, i) => {
          const idx = index.get(b);
          if (idx !== undefined && segs[i]) labels[idx].push(segs[i]);
        });
      } else {
        // Fallback: slice each box's own columns (works when its border cols
        // still line up — isolated boxes, or when the band-split is ambiguous).
        for (const b of inRow) {
          const idx = index.get(b);
          if (idx === undefined) continue;
          const t = cleanLabelText(grid[r].slice(b.c0 + 1, Math.min(b.c1, W)).join(''));
          if (t) labels[idx].push(t);
        }
      }
    }
  }

  // Normalize rows onto well-spaced band offsets. Preserving the original
  // (tight, broken) row positions makes the renderer route edges THROUGH
  // boxes; stacking bands with a routing gap gives every band-to-band edge
  // clean vertical space so the rendered art re-parses losslessly. Columns
  // keep their original relative order (the horizontal layout was fine).
  const bandRow = new Map<TracedRect[], number>();
  const orderedBands = [...bands].sort(
    (a, b) => Math.min(...a.map((x) => x.r0)) - Math.min(...b.map((x) => x.r0)),
  );
  let rowCursor = 0;
  for (const band of orderedBands) {
    bandRow.set(band, rowCursor);
    const bandHeight = Math.max(...band.map((b) => b.r1 - b.r0 + 1));
    rowCursor += bandHeight + BAND_ROW_GAP;
  }
  const rectBand = new Map<TracedRect, TracedRect[]>();
  for (const band of bands) for (const r of band) rectBand.set(r, band);

  // Normalize columns within each band by the boxes' FITTED widths. Recovered
  // labels are usually wider than the broken art's boxes, so the original
  // column spacing would make fitted boxes overlap — the renderer would then
  // shove a box into the wrong band and route edges through it. Laying each
  // band out left-to-right by fitted width + a routing gap keeps bands intact.
  const fittedW = rects.map((rect, i) =>
    Math.max(rect.c1 - rect.c0 + 1, ...labels[i].map((l) => l.length + 4), 3),
  );
  const rectIndex = new Map(rects.map((r, i) => [r, i] as const));
  const bandCol = new Map<TracedRect, number>();
  for (const band of bands) {
    const ordered = [...band].sort((a, b) => a.c0 - b.c0);
    let colCursor = Math.min(...band.map((b) => b.c0));
    for (const r of ordered) {
      bandCol.set(r, colCursor);
      colCursor += (fittedW[rectIndex.get(r) ?? 0] ?? 3) + BAND_COL_GAP;
    }
  }

  // Assign ids (slug of the first label line, deduped), then resolve
  // containment (a box strictly inside another becomes its child).
  const parentIdx = rects.map((_, i) => smallestContainer(rects, i));
  const usedIds = new Map<string, number>();
  const nodes: AsciiDiagramNode[] = rects.map((rect, i) => {
    let id = slugify(labels[i][0] ?? '');
    const n = usedIds.get(id) ?? 0;
    usedIds.set(id, n + 1);
    if (n > 0) id = `${id}-${n + 1}`;
    const band = rectBand.get(rect);
    const nested = parentIdx[i] >= 0;
    const row = band && !nested ? (bandRow.get(band) ?? rect.r0) : rect.r0;
    const col = !nested ? (bandCol.get(rect) ?? rect.c0) : rect.c0;
    return {
      id,
      label: labels[i].join('\n'),
      col,
      row,
      wCols: rect.c1 - rect.c0 + 1,
      hRows: rect.r1 - rect.r0 + 1,
    };
  });
  nodes.forEach((node, i) => {
    if (parentIdx[i] >= 0) node.containerId = nodes[parentIdx[i]].id;
  });
  return nodes;
}

/**
 * Strip UNICODE box-drawing chars and arrowheads (edge routing that bled into
 * a label). ASCII `-`/`|`/`+` are kept — they're common in real label text
 * (`molen-tooling`, `read-only`, `stdin | stdout`), and a unicode diagram
 * (the common case) never uses them as borders anyway.
 */
function cleanLabelText(seg: string): string {
  let out = '';
  for (const ch of seg) {
    const code = ch.codePointAt(0) ?? 0;
    const box = code >= 0x2500 && code <= 0x257f; // Box Drawing block
    if (box || arrowDirection(ch) !== null) out += ' ';
    else out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function smallestContainer(rects: TracedRect[], i: number): number {
  const child = rects[i];
  let best = -1;
  let bestArea = Infinity;
  for (let j = 0; j < rects.length; j++) {
    if (j === i) continue;
    const p = rects[j];
    if (p.r0 < child.r0 && p.c0 < child.c0 && p.r1 > child.r1 && p.c1 > child.c1) {
      const a = (p.r1 - p.r0) * (p.c1 - p.c0);
      if (a < bestArea) {
        bestArea = a;
        best = j;
      }
    }
  }
  return best;
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'node';
}

// ---------------------------------------------------------------------------
// Edge recovery (facing-border adjacency + arrowhead direction)
// ---------------------------------------------------------------------------

function recoverEdges(
  grid: string[][],
  rects: TracedRect[],
  nodes: AsciiDiagramNode[],
): AsciiDiagramEdge[] {
  const H = grid.length;
  const W = grid[0]?.length ?? 0;
  const at = (r: number, c: number): string =>
    r >= 0 && r < H && c >= 0 && c < W ? grid[r][c] : ' ';
  const isConnector = (ch: string): boolean =>
    isVert(ch) || isHoriz(ch) || isJunction(ch) || arrowDirection(ch) !== null;

  const colOverlap = (a: TracedRect, b: TracedRect): boolean =>
    Math.max(a.c0, b.c0) <= Math.min(a.c1, b.c1);
  const rowOverlap = (a: TracedRect, b: TracedRect): boolean =>
    Math.max(a.r0, b.r0) <= Math.min(a.r1, b.r1);

  const edges: AsciiDiagramEdge[] = [];
  const seen = new Set<string>();
  const push = (s: number, t: number, directed: boolean) => {
    if (s === t) return;
    const key = `${nodes[s].id}|${nodes[t].id}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: nodes[s].id, target: nodes[t].id, directed });
  };

  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const A = rects[i];
      const B = rects[j];

      // Vertical: A above B, columns overlap, a connector spans the gap, and
      // no third box sits directly between them in that column band.
      if (A.r1 < B.r0 && B.r0 - A.r1 <= MAX_EDGE_ROW_GAP && colOverlap(A, B)) {
        const lo = Math.max(A.c0, B.c0);
        const hi = Math.min(A.c1, B.c1);
        if (
          gapHasConnector(at, A.r1 + 1, B.r0 - 1, lo - 1, hi + 1, isConnector) &&
          !boxBetweenVert(rects, i, j, lo, hi)
        ) {
          const directed = gapHasArrow(at, A.r1 + 1, B.r0, lo - 1, hi + 1, 'down');
          push(i, j, directed);
        }
      }

      // Horizontal: A left of B, rows overlap. Require an actual arrowhead in
      // the gap — a label that overflowed its box leaks `│`/text into the gap
      // between horizontally-adjacent boxes, which a plain-connector test
      // would read as a phantom edge. A real horizontal edge carries `►`/`◄`.
      if (A.c1 < B.c0 && B.c0 - A.c1 <= MAX_EDGE_COL_GAP && rowOverlap(A, B) && i < j) {
        const lo = Math.max(A.r0, B.r0);
        const hi = Math.min(A.r1, B.r1);
        const rightArrow = gapHasArrow(at, lo - 1, hi + 1, A.c1 + 1, B.c0, 'right');
        const leftArrow = gapHasArrow(at, lo - 1, hi + 1, A.c1 + 1, B.c0, 'left');
        if ((rightArrow || leftArrow) && !boxBetweenHoriz(rects, i, j, lo, hi)) {
          if (leftArrow && !rightArrow) push(j, i, true);
          else push(i, j, true);
        }
      }
    }
  }
  return edges;
}

function gapHasConnector(
  at: (r: number, c: number) => string,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
  isConnector: (ch: string) => boolean,
): boolean {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) if (isConnector(at(r, c))) return true;
  return false;
}

function gapHasArrow(
  at: (r: number, c: number) => string,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
  dir: 'down' | 'up' | 'left' | 'right',
): boolean {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (arrowDirection(at(r, c)) === dir) return true;
    }
  }
  return false;
}

function boxBetweenVert(
  rects: TracedRect[],
  i: number,
  j: number,
  lo: number,
  hi: number,
): boolean {
  const A = rects[i];
  const B = rects[j];
  return rects.some((k, ki) => {
    if (ki === i || ki === j) return false;
    return k.r0 > A.r1 && k.r1 < B.r0 && Math.max(k.c0, lo) <= Math.min(k.c1, hi);
  });
}

function boxBetweenHoriz(
  rects: TracedRect[],
  i: number,
  j: number,
  lo: number,
  hi: number,
): boolean {
  const A = rects[i];
  const B = rects[j];
  return rects.some((k, ki) => {
    if (ki === i || ki === j) return false;
    return k.c0 > A.c1 && k.c1 < B.c0 && Math.max(k.r0, lo) <= Math.min(k.r1, hi);
  });
}

// ---------------------------------------------------------------------------

function detectGridStyle(grid: string[][]): 'unicode' | 'ascii' {
  let unicode = 0;
  let ascii = 0;
  for (const row of grid) {
    for (const ch of row) {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x2500 && code <= 0x257f) unicode++;
      else if (ch === '+' || ch === '|' || ch === '-') ascii++;
    }
  }
  return ascii > unicode ? 'ascii' : 'unicode';
}
