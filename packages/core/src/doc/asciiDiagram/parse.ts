/**
 * ASCII diagram parser: box-and-line art → semantic nodes/edges.
 *
 * Pure and deterministic; never throws. Unparseable input degrades to an
 * empty diagram (plus warnings), never an exception — callers decide what
 * to do with sparse results (the detector requires ≥2 nodes, for example).
 *
 * Pipeline: normalize → char grid → box tracing (corner walks; `+` is
 * resolved smallest-rectangle-first) → containment tree → labels/ids →
 * edge extraction (mask box perimeters + leaf interiors, then connected
 * components of line/arrow cells with label "bridges") → loose text.
 */

import {
  arrowDirection,
  asciiArrowDirection,
  isAsciiStructural,
  isBlCorner,
  isBrCorner,
  isFlatBorderChar,
  isHoriz,
  isJunction,
  isLineChar,
  isPlus,
  isSideBorderChar,
  isTlCorner,
  isTrCorner,
  isUnicodeStructural,
  isVert,
  type ArrowDirection,
} from './chars.js';
import type { AsciiDiagram, AsciiDiagramEdge, AsciiDiagramNode } from './types.js';

/** Internal stats consumed by the detector (loose-content ratio etc.). */
export interface AsciiParseStats {
  totalNonSpaceCells: number;
  looseNonSpaceCells: number;
  hasWideChars: boolean;
}

interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

interface ParsedBox extends Rect {
  /** Title embedded in the top border (`┌── Title ──┐`), if any. */
  borderTitle?: string;
  parentIdx: number;
  labelLines: string[];
  id: string;
}

const MAX_TITLE_RUN = 60;
const MAX_BRIDGE_GAP = 40;
const MAX_LOOSE_WARNINGS = 10;

/** True crossings: vertical and horizontal runs pass through independently. */
const CROSS_CHARS = new Set(['┼', '╋', '╬', '╫', '╪']);

export function parseAsciiDiagram(text: string): AsciiDiagram {
  return parseAsciiDiagramWithStats(text).diagram;
}

export function parseAsciiDiagramWithStats(text: string): {
  diagram: AsciiDiagram;
  stats: AsciiParseStats;
} {
  const warnings: string[] = [];
  const grid = buildGrid(text, warnings);
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;

  let totalNonSpaceCells = 0;
  let hasWideChars = false;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = grid[r][c];
      if (ch !== ' ') totalNonSpaceCells++;
      if (!hasWideChars && isWideChar(ch)) hasWideChars = true;
    }
  }
  if (hasWideChars) warnings.push('wide-chars');

  const style = detectStyle(grid);

  // ---- Boxes -------------------------------------------------------------
  const rects = traceBoxes(grid);
  const boxes = buildBoxes(grid, rects, warnings);

  // ---- Mask: box perimeters, leaf interiors, container label text --------
  const mask = new Uint8Array(W * H);
  const perimeterOwners = new Map<number, number[]>(); // cell index → box indices
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    for (let c = box.c0; c <= box.c1; c++) {
      for (const r of [box.r0, box.r1]) {
        mask[r * W + c] = 1;
        const owners = perimeterOwners.get(r * W + c) ?? [];
        owners.push(b);
        perimeterOwners.set(r * W + c, owners);
      }
    }
    for (let r = box.r0 + 1; r <= box.r1 - 1; r++) {
      for (const c of [box.c0, box.c1]) {
        mask[r * W + c] = 1;
        const owners = perimeterOwners.get(r * W + c) ?? [];
        owners.push(b);
        perimeterOwners.set(r * W + c, owners);
      }
    }
  }
  const isContainer = boxes.map((_, i) => boxes.some((b) => b.parentIdx === i));
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b];
    if (!isContainer[b]) {
      // Leaf: whole interior is label space.
      for (let r = box.r0 + 1; r <= box.r1 - 1; r++) {
        for (let c = box.c0 + 1; c <= box.c1 - 1; c++) mask[r * W + c] = 1;
      }
    } else {
      // Container: only the label text cells above the topmost child.
      const minChildR0 = Math.min(
        ...boxes.filter((child) => child.parentIdx === b).map((child) => child.r0),
      );
      for (let r = box.r0 + 1; r < minChildR0; r++) {
        for (let c = box.c0 + 1; c <= box.c1 - 1; c++) {
          const ch = grid[r][c];
          if (ch !== ' ' && !isLineChar(ch) && arrowDirection(ch) === null) mask[r * W + c] = 1;
        }
      }
    }
  }

  // ---- Edges ---------------------------------------------------------------
  const { edges, edgeCells } = extractEdges(grid, mask, perimeterOwners, boxes, warnings);

  // ---- Loose text ---------------------------------------------------------
  let looseNonSpaceCells = 0;
  const looseRuns: string[] = [];
  for (let r = 0; r < H; r++) {
    let run = '';
    const flush = () => {
      if (run.trim().length > 0) looseRuns.push(`@${r}: ${truncate(run.trim(), 30)}`);
      run = '';
    };
    const isLooseCell = (c: number): boolean => {
      if (c < 0 || c >= W) return false;
      const idx = r * W + c;
      return grid[r][c] !== ' ' && !mask[idx] && !edgeCells.has(idx);
    };
    for (let c = 0; c < W; c++) {
      if (isLooseCell(c)) {
        run += grid[r][c];
        looseNonSpaceCells++;
      } else if (run !== '' && grid[r][c] === ' ' && isLooseCell(c + 1)) {
        run += ' '; // single interior space keeps phrases together
      } else {
        flush();
      }
    }
    flush();
  }
  for (const runText of looseRuns.slice(0, MAX_LOOSE_WARNINGS)) {
    warnings.push(`loose-text ${runText}`);
  }
  if (looseRuns.length > MAX_LOOSE_WARNINGS) {
    warnings.push(`loose-text (+${looseRuns.length - MAX_LOOSE_WARNINGS} more)`);
  }

  // ---- Assemble -----------------------------------------------------------
  const nodes: AsciiDiagramNode[] = boxes.map((box) => ({
    id: box.id,
    label: box.labelLines.join('\n'),
    col: box.c0,
    row: box.r0,
    wCols: box.c1 - box.c0 + 1,
    hRows: box.r1 - box.r0 + 1,
    ...(box.parentIdx >= 0 ? { containerId: boxes[box.parentIdx].id } : {}),
  }));

  return {
    diagram: { nodes, edges, style, warnings },
    stats: { totalNonSpaceCells, looseNonSpaceCells, hasWideChars },
  };
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function buildGrid(text: string, warnings: string[]): string[][] {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  let hadTab = false;
  const rows: string[][] = rawLines.map((line) => {
    const cells: string[] = [];
    for (const ch of line) {
      if (ch === '\t') {
        hadTab = true;
        do {
          cells.push(' ');
        } while (cells.length % 4 !== 0);
      } else {
        cells.push(ch);
      }
    }
    return cells;
  });
  if (hadTab) warnings.push('tabs-expanded');
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  for (const row of rows) {
    while (row.length < width) row.push(' ');
  }
  return rows;
}

function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0x1f300 && c <= 0x1faff)
  );
}

function detectStyle(grid: string[][]): 'unicode' | 'ascii' {
  let unicode = 0;
  let ascii = 0;
  for (const row of grid) {
    for (const ch of row) {
      if (isUnicodeStructural(ch)) unicode++;
      else if (isAsciiStructural(ch)) ascii++;
    }
  }
  return ascii > unicode ? 'ascii' : 'unicode';
}

// ---------------------------------------------------------------------------
// Box tracing
// ---------------------------------------------------------------------------

interface TracedRect extends Rect {
  borderTitle?: string;
}

function traceBoxes(grid: string[][]): TracedRect[] {
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;
  const found: TracedRect[] = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!isTlCandidate(grid, r, c)) continue;
      const rect = traceBoxFrom(grid, r, c);
      if (rect) found.push(rect);
    }
  }
  return found;
}

function isTlCandidate(grid: string[][], r: number, c: number): boolean {
  const ch = grid[r][c];
  if (isTlCorner(ch)) return true;
  // `+` (ASCII) and junction chars (Unicode `├ ┬ ┼` on shared borders /
  // sectioned cards) can open a box when a border continues right + down.
  if (!isPlus(ch) && !isJunction(ch)) return false;
  const right = grid[r][c + 1] ?? ' ';
  const below = grid[r + 1]?.[c] ?? ' ';
  const rightOk = isFlatBorderChar(right) || isTrCorner(right);
  const belowOk = isSideBorderChar(below) || isBlCorner(below);
  return rightOk && belowOk;
}

/**
 * Attempt to confirm a full rectangle starting at a top-left corner.
 * Smallest-rectangle-first: the first (nearest) TR/bottom-row combination
 * that closes wins, so `+` lattices decompose into cells and stacked
 * shared-border boxes parse as siblings.
 */
function traceBoxFrom(grid: string[][], r0: number, c0: number): TracedRect | null {
  const H = grid.length;
  const W = grid[0]?.length ?? 0;

  // -- Top border walk: collect TR candidates; allow one embedded title run.
  const trCandidates: number[] = [];
  let titleRun: { from: number; to: number } | null = null;
  let c = c0 + 1;
  while (c < W) {
    const ch = grid[r0][c];
    if (isTrCorner(ch)) {
      trCandidates.push(c);
      break; // a Unicode TR corner definitively ends the border
    }
    if (isPlus(ch) || isJunction(ch)) {
      trCandidates.push(c); // ambiguous: candidate AND possible continuation
      c++;
      continue;
    }
    if (isFlatBorderChar(ch)) {
      c++;
      continue;
    }
    // Possible embedded title (`┌── Title ──┐`): a single non-border run
    // bounded by border chars on both sides.
    if (titleRun) break;
    let end = c;
    let sawText = false;
    while (end < W && end - c <= MAX_TITLE_RUN) {
      const tch = grid[r0][end];
      if (isFlatBorderChar(tch) || isTrCorner(tch)) break;
      if (tch !== ' ') sawText = true;
      end++;
    }
    if (end >= W || end - c > MAX_TITLE_RUN || !sawText || end === c) break;
    titleRun = { from: c, to: end - 1 };
    c = end;
  }
  if (trCandidates.length === 0) return null;

  // -- Left wall (same for every TR candidate).
  const leftCandidates: number[] = [];
  for (let r = r0 + 1; r < H; r++) {
    const ch = grid[r][c0];
    if (isBlCorner(ch)) {
      leftCandidates.push(r);
      break;
    }
    if (isPlus(ch) || isJunction(ch)) {
      leftCandidates.push(r);
      continue;
    }
    if (isSideBorderChar(ch)) continue;
    break;
  }
  if (leftCandidates.length === 0) return null;
  const leftSet = new Set(leftCandidates);

  for (const c1 of trCandidates) {
    if (c1 < c0 + 2) continue; // minimum width 3

    // -- Right wall for this candidate.
    const rightCandidates: number[] = [];
    for (let r = r0 + 1; r < H; r++) {
      const ch = grid[r][c1];
      if (isBrCorner(ch)) {
        rightCandidates.push(r);
        break;
      }
      if (isPlus(ch) || isJunction(ch)) {
        rightCandidates.push(r);
        continue;
      }
      if (isSideBorderChar(ch)) continue;
      break;
    }

    for (const r1 of rightCandidates) {
      if (r1 < r0 + 2) continue; // minimum height 3
      if (!leftSet.has(r1)) continue;
      // -- Bottom border must be solid.
      let ok = true;
      for (let bc = c0 + 1; bc <= c1 - 1; bc++) {
        if (!isFlatBorderChar(grid[r1][bc])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const title =
        titleRun && titleRun.to < c1
          ? grid[r0]
              .slice(titleRun.from, titleRun.to + 1)
              .join('')
              .trim()
          : undefined;
      return { r0, c0, r1, c1, ...(title ? { borderTitle: title } : {}) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Containment, labels, ids
// ---------------------------------------------------------------------------

function strictlyContains(parent: Rect, child: Rect): boolean {
  return (
    parent.r0 < child.r0 && parent.c0 < child.c0 && parent.r1 > child.r1 && parent.c1 > child.c1
  );
}

/**
 * True when the boxes' INTERIORS overlap. Sharing a border line (stacked
 * `+--+ / +--+` cards, lattices) is legal and must not warn.
 */
function interiorsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.r0 + 1 <= b.r1 - 1 && b.r0 + 1 <= a.r1 - 1 && a.c0 + 1 <= b.c1 - 1 && b.c0 + 1 <= a.c1 - 1
  );
}

function area(rect: Rect): number {
  return (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1);
}

function buildBoxes(grid: string[][], rects: TracedRect[], warnings: string[]): ParsedBox[] {
  // Reading order: row, then col.
  const sorted = [...rects].sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);

  // Parents: smallest strictly-containing box; ties → first in reading order.
  const parentIdx = sorted.map((child, i) => {
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < sorted.length; j++) {
      if (j === i) continue;
      if (!strictlyContains(sorted[j], child)) continue;
      const a = area(sorted[j]);
      if (a < bestArea) {
        bestArea = a;
        best = j;
      }
    }
    return best;
  });

  // Overlap (interiors intersect, neither contains) → keep both + warning.
  let warnedOverlap = false;
  for (let i = 0; i < sorted.length && !warnedOverlap; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (
        interiorsOverlap(sorted[i], sorted[j]) &&
        !strictlyContains(sorted[i], sorted[j]) &&
        !strictlyContains(sorted[j], sorted[i])
      ) {
        warnings.push('overlapping-boxes');
        warnedOverlap = true;
        break;
      }
    }
  }

  const hasChildren = sorted.map((_, i) => parentIdx.includes(i));

  const usedIds = new Map<string, number>();
  const boxes: ParsedBox[] = sorted.map((rect, i) => {
    const labelLines: string[] = [];
    if (rect.borderTitle) labelLines.push(rect.borderTitle);
    if (!hasChildren[i]) {
      for (let r = rect.r0 + 1; r <= rect.r1 - 1; r++) {
        const rowText = grid[r].slice(rect.c0 + 1, rect.c1).join('');
        if (isDividerRow(rowText)) continue;
        const trimmed = rowText.trim();
        if (trimmed.length > 0) labelLines.push(trimmed);
      }
    } else {
      const minChildR0 = Math.min(
        ...sorted.filter((_, j) => parentIdx[j] === i).map((child) => child.r0),
      );
      for (let r = rect.r0 + 1; r < minChildR0; r++) {
        const rowText = grid[r]
          .slice(rect.c0 + 1, rect.c1)
          .map((ch) => (isLineChar(ch) || arrowDirection(ch) !== null ? ' ' : ch))
          .join('')
          .trim();
        if (rowText.length > 0) labelLines.push(rowText);
      }
    }
    const base = slugify(labelLines[0] ?? '');
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    return { ...rect, parentIdx: parentIdx[i], labelLines, id };
  });
  return boxes;
}

/** A leaf interior row that is purely a horizontal divider (`├────┤` style). */
function isDividerRow(rowText: string): boolean {
  let sawLine = false;
  for (const ch of rowText) {
    if (ch === ' ') continue;
    if (isHoriz(ch) || isJunction(ch) || isPlus(ch)) {
      sawLine = true;
      continue;
    }
    return false;
  }
  return sawLine;
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'node';
}

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

interface EdgeCellInfo {
  arrow: ArrowDirection | null;
  bridgeLabel?: string;
}

function extractEdges(
  grid: string[][],
  mask: Uint8Array,
  perimeterOwners: Map<number, number[]>,
  boxes: ParsedBox[],
  warnings: string[],
): { edges: AsciiDiagramEdge[]; edgeCells: Set<number> } {
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;

  // -- Eligible cells: line/arrow chars outside the mask.
  const cells = new Map<number, EdgeCellInfo>();
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const idx = r * W + c;
      if (mask[idx]) continue;
      const ch = grid[r][c];
      const uni = arrowDirection(ch);
      if (uni) {
        cells.set(idx, { arrow: uni });
        continue;
      }
      const asc = asciiArrowDirection(ch);
      if (asc && asciiArrowGate(grid, r, c, asc)) {
        cells.set(idx, { arrow: asc });
        continue;
      }
      if (isLineChar(ch)) cells.set(idx, { arrow: null });
    }
  }

  // -- Bridges: `──label──` glue (label + interior spaces become cells).
  for (let r = 0; r < H; r++) {
    let c = 0;
    while (c < W) {
      const idx = r * W + c;
      if (!cells.has(idx) || !isHoriz(grid[r][c])) {
        c++;
        continue;
      }
      // End of this horizontal run.
      let runEnd = c;
      while (runEnd + 1 < W && cells.has(r * W + runEnd + 1) && isHoriz(grid[r][runEnd + 1])) {
        runEnd++;
      }
      // Candidate gap after the run.
      let g = runEnd + 1;
      let sawText = false;
      let failed = false;
      while (g < W && g - runEnd - 1 <= MAX_BRIDGE_GAP) {
        const gch = grid[r][g];
        const gidx = r * W + g;
        if (mask[gidx] || isVert(gch)) {
          failed = true;
          break;
        }
        if (isHoriz(gch)) break;
        if (isLineChar(gch) || arrowDirection(gch) !== null) {
          failed = true;
          break;
        }
        const asc = asciiArrowDirection(gch);
        if (asc && asciiArrowGate(grid, r, g, asc)) {
          failed = true;
          break;
        }
        if (gch !== ' ') sawText = true;
        g++;
      }
      if (
        !failed &&
        g < W &&
        g > runEnd + 1 &&
        sawText &&
        isHoriz(grid[r][g]) &&
        !mask[r * W + g]
      ) {
        const label = grid[r]
          .slice(runEnd + 1, g)
          .join('')
          .trim();
        for (let bc = runEnd + 1; bc < g; bc++) {
          cells.set(r * W + bc, { arrow: null, bridgeLabel: label });
        }
        c = g;
      } else {
        c = runEnd + 1;
      }
    }
  }

  // -- Connected components (4-connectivity), with cross cells (`┼`)
  // acting as PASS-THROUGH: at a cross, the vertical and horizontal runs
  // connect independently, so two edges crossing each other stay two
  // edges instead of merging into one four-armed blob. (ASCII `+` cannot
  // be disambiguated from a turn, so it stays fully connective.)
  const isCrossCell = (idx: number): boolean => CROSS_CHARS.has(grid[Math.floor(idx / W)][idx % W]);
  // State key = idx * 2 + channel (0 = horizontal, 1 = vertical); non-cross
  // cells always live on channel 0.
  const stateKey = (idx: number, channel: 0 | 1): number => idx * 2 + channel;
  const visited = new Set<number>();
  const components: number[][] = [];
  const seeds: Array<[number, 0 | 1]> = [];
  for (const idx of cells.keys()) {
    seeds.push([idx, 0]);
    if (isCrossCell(idx)) seeds.push([idx, 1]);
  }
  for (const [seedIdx, seedChannel] of seeds) {
    if (visited.has(stateKey(seedIdx, seedChannel))) continue;
    const componentCells = new Set<number>();
    const queue: Array<[number, 0 | 1]> = [[seedIdx, seedChannel]];
    visited.add(stateKey(seedIdx, seedChannel));
    while (queue.length > 0) {
      const [idx, channel] = queue.pop() as [number, 0 | 1];
      componentCells.add(idx);
      const r = Math.floor(idx / W);
      const c = idx % W;
      const neighbors: Array<[number, number]> =
        isCrossCell(idx) && channel === 1
          ? [
              [r - 1, c],
              [r + 1, c],
            ]
          : isCrossCell(idx)
            ? [
                [r, c - 1],
                [r, c + 1],
              ]
            : [
                [r - 1, c],
                [r + 1, c],
                [r, c - 1],
                [r, c + 1],
              ];
      for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        const nidx = nr * W + nc;
        if (!cells.has(nidx)) continue;
        const nChannel: 0 | 1 = isCrossCell(nidx) ? (nr !== r ? 1 : 0) : 0;
        const key = stateKey(nidx, nChannel);
        if (!visited.has(key)) {
          visited.add(key);
          queue.push([nidx, nChannel]);
        }
      }
    }
    components.push([...componentCells].sort((a, b) => a - b));
  }
  components.sort((a, b) => a[0] - b[0]);

  // -- Component → edges.
  const edges: AsciiDiagramEdge[] = [];
  const seen = new Set<string>();
  let mergedParallel = false;
  const looseComponents = new Set<number>();
  const sideLabelCells = new Set<number>();

  for (const component of components) {
    const inComponent = new Set(component);
    // Endpoints: ≤1 neighbor within the component, plus every arrow cell.
    const endpoints: number[] = [];
    for (const idx of component) {
      const r = Math.floor(idx / W);
      const c = idx % W;
      let neighbors = 0;
      for (const [nr, nc] of [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ]) {
        if (inComponent.has(nr * W + nc)) neighbors++;
      }
      const info = cells.get(idx) as EdgeCellInfo;
      if (neighbors <= 1 || info.arrow !== null) endpoints.push(idx);
    }

    // Attachments: endpoint adjacent (Chebyshev ≤ 1) to a box perimeter.
    interface Attachment {
      boxIdx: number;
      isArrowEnd: boolean;
    }
    const attachmentsByBox = new Map<number, Attachment>();
    let dangling = false;
    for (const idx of endpoints) {
      const r = Math.floor(idx / W);
      const c = idx % W;
      const info = cells.get(idx) as EdgeCellInfo;
      const boxIdx = snapEndpoint(r, c, info.arrow, perimeterOwners, boxes, W, H);
      if (boxIdx === null) {
        dangling = true;
        continue;
      }
      const existing = attachmentsByBox.get(boxIdx);
      if (existing) {
        existing.isArrowEnd = existing.isArrowEnd || info.arrow !== null;
      } else {
        attachmentsByBox.set(boxIdx, { boxIdx, isArrowEnd: info.arrow !== null });
      }
    }
    const nearestOwner = (r: number, c: number): number | null => {
      const owners = perimeterOwners.get(r * W + c) ?? [];
      if (owners.length === 0) return null;
      return [...owners].sort(
        (a, b) => boxes[a].r0 - boxes[b].r0 || boxes[a].c0 - boxes[b].c0 || a - b,
      )[0];
    };

    // Junction cells touching a perimeter are attachments too — the
    // `┌──┴──┐` bus-split shape connects to the box it branched from even
    // though the junction cell has 2+ neighbors and no arrowhead.
    for (const idx of component) {
      const r = Math.floor(idx / W);
      const c = idx % W;
      const ch = grid[r][c];
      if (!isJunction(ch) && !isPlus(ch)) continue;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const boxIdx = nearestOwner(r + dr, c + dc);
        if (boxIdx !== null && !attachmentsByBox.has(boxIdx)) {
          attachmentsByBox.set(boxIdx, { boxIdx, isArrowEnd: false });
        }
      }
    }

    // Arrow cells attach to the box on the side OPPOSITE the arrowhead:
    // a tight vertical stack (`└─┬─┘` / `▼` / `┌───┐`, boxes one row apart)
    // is a single arrow cell whose only endpoint snaps to the pointed box —
    // without this the source box is missed and the edge drops. Very common
    // in AI output.
    for (const idx of component) {
      const r = Math.floor(idx / W);
      const c = idx % W;
      const info = cells.get(idx) as EdgeCellInfo;
      if (info.arrow === null) continue;
      const [dr, dc] =
        info.arrow === 'down'
          ? [-1, 0]
          : info.arrow === 'up'
            ? [1, 0]
            : info.arrow === 'right'
              ? [0, -1]
              : [0, 1];
      const boxIdx = nearestOwner(r + dr, c + dc);
      if (boxIdx !== null && !attachmentsByBox.has(boxIdx)) {
        attachmentsByBox.set(boxIdx, { boxIdx, isArrowEnd: false });
      }
    }

    const attachments = [...attachmentsByBox.values()].sort(
      (a, b) => boxes[a.boxIdx].r0 - boxes[b.boxIdx].r0 || boxes[a.boxIdx].c0 - boxes[b.boxIdx].c0,
    );

    if (attachments.length === 0) {
      for (const idx of component) looseComponents.add(idx);
      warnings.push('dangling-edge');
      continue;
    }
    if (attachments.length === 1) {
      warnings.push('dangling-edge');
      continue;
    }
    if (dangling) warnings.push('dangling-edge');

    // Label: first bridge in the component, else a side label — a text run
    // sitting one space to the right of one of the component's vertical
    // cells (`│ born`), the way labels attach to vertical drops.
    const bridgeLabels: string[] = [];
    for (const idx of component) {
      const info = cells.get(idx) as EdgeCellInfo;
      if (info.bridgeLabel && !bridgeLabels.includes(info.bridgeLabel)) {
        bridgeLabels.push(info.bridgeLabel);
      }
    }
    // A label run stops at a box border, an arrow, or a structural line —
    // but an ASCII hyphen (`-`) inside a word (`on-fail`, `read-only`) is
    // label text, not a line, so it's allowed. The leading-space gate keeps
    // real lines (which abut the `│` directly) from being read as labels.
    const isLabelStop = (ch: string): boolean =>
      (isLineChar(ch) && ch !== '-') || arrowDirection(ch) !== null;
    const hasAlnum = (s: string): boolean => /[a-z0-9]/i.test(s);

    let label = bridgeLabels[0];
    if (!label) {
      // Try the right side (`│ born`) then the left side (`born │`) of
      // each vertical cell, topmost-first.
      outer: for (const idx of component) {
        const r = Math.floor(idx / W);
        const c = idx % W;
        if (!isVert(grid[r][c])) continue;
        if ((grid[r][c + 1] ?? '') === ' ') {
          let end = c + 2;
          let run = '';
          while (end < W) {
            const ch = grid[r][end];
            if (mask[r * W + end] || isLabelStop(ch)) break;
            if (ch === ' ' && (grid[r][end + 1] ?? ' ') === ' ') break;
            run += ch;
            end++;
          }
          const clean = run.trim().replace(/^-+|-+$/g, '');
          if (clean.length > 0 && clean.length <= MAX_BRIDGE_GAP && hasAlnum(clean)) {
            label = clean;
            for (let lc = c + 2; lc < end; lc++) sideLabelCells.add(r * W + lc);
            break outer;
          }
        }
        if ((grid[r][c - 1] ?? '') === ' ') {
          let start = c - 2;
          let run = '';
          while (start >= 0) {
            const ch = grid[r][start];
            if (mask[r * W + start] || isLabelStop(ch)) break;
            if (ch === ' ' && (grid[r][start - 1] ?? ' ') === ' ') break;
            run = ch + run;
            start--;
          }
          const clean = run.trim().replace(/^-+|-+$/g, '');
          if (clean.length > 0 && clean.length <= MAX_BRIDGE_GAP && hasAlnum(clean)) {
            label = clean;
            for (let lc = start + 1; lc <= c - 2; lc++) sideLabelCells.add(r * W + lc);
            break outer;
          }
        }
      }
    }
    if (bridgeLabels.length > 1) warnings.push('multiple-edge-labels');

    const pushEdge = (sourceIdx: number, targetIdx: number, directed: boolean) => {
      const edge: AsciiDiagramEdge = {
        source: boxes[sourceIdx].id,
        target: boxes[targetIdx].id,
        ...(label ? { label } : {}),
        directed,
      };
      const key = `${edge.source}|${edge.target}|${edge.directed}|${edge.label ?? ''}`;
      if (seen.has(key)) {
        mergedParallel = true;
        return;
      }
      seen.add(key);
      edges.push(edge);
    };

    const arrowEnds = attachments.filter((a) => a.isArrowEnd);
    const plainEnds = attachments.filter((a) => !a.isArrowEnd);

    if (attachments.length === 2) {
      const [a, b] = attachments;
      if (arrowEnds.length === 2) {
        pushEdge(a.boxIdx, b.boxIdx, true);
        pushEdge(b.boxIdx, a.boxIdx, true);
      } else if (arrowEnds.length === 1) {
        const target = arrowEnds[0];
        const source = a === target ? b : a;
        pushEdge(source.boxIdx, target.boxIdx, true);
      } else {
        pushEdge(a.boxIdx, b.boxIdx, false);
      }
    } else if (plainEnds.length === 1 && arrowEnds.length >= 1) {
      for (const target of arrowEnds) pushEdge(plainEnds[0].boxIdx, target.boxIdx, true); // fan-out
    } else if (arrowEnds.length === 1 && plainEnds.length >= 1) {
      for (const source of plainEnds) pushEdge(source.boxIdx, arrowEnds[0].boxIdx, true); // fan-in
    } else if (arrowEnds.length === 0) {
      warnings.push('ambiguous-bus');
      for (let i = 1; i < attachments.length; i++) {
        pushEdge(attachments[0].boxIdx, attachments[i].boxIdx, false);
      }
    } else {
      warnings.push('ambiguous-bus');
      for (const target of arrowEnds) {
        if (plainEnds.length > 0) pushEdge(plainEnds[0].boxIdx, target.boxIdx, true);
      }
    }
  }

  if (mergedParallel) warnings.push('parallel-edges-merged');

  edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      (a.label ?? '').localeCompare(b.label ?? ''),
  );

  // Edge cells for loose-text accounting: everything in a component that
  // produced (or tried to produce) an edge, minus fully-detached art,
  // plus consumed side-label runs.
  const edgeCells = new Set<number>();
  for (const component of components) {
    for (const idx of component) {
      if (!looseComponents.has(idx)) edgeCells.add(idx);
    }
  }
  for (const idx of sideLabelCells) edgeCells.add(idx);
  return { edges, edgeCells };
}

/** ASCII arrow chars count only when a matching line char sits behind them. */
function asciiArrowGate(grid: string[][], r: number, c: number, dir: ArrowDirection): boolean {
  const behind =
    dir === 'down'
      ? grid[r - 1]?.[c]
      : dir === 'up'
        ? grid[r + 1]?.[c]
        : dir === 'right'
          ? grid[r]?.[c - 1]
          : grid[r]?.[c + 1];
  if (behind === undefined) return false;
  return dir === 'down' || dir === 'up' ? isVert(behind) : isHoriz(behind);
}

/**
 * Snap an endpoint cell to a box: prefer a perimeter cell in the arrow's
 * pointing direction, else the nearest (Chebyshev ≤ 1) perimeter owner,
 * ties broken by reading order.
 */
function snapEndpoint(
  r: number,
  c: number,
  arrow: ArrowDirection | null,
  perimeterOwners: Map<number, number[]>,
  boxes: ParsedBox[],
  W: number,
  H: number,
): number | null {
  const ownersAt = (rr: number, cc: number): number[] => {
    if (rr < 0 || rr >= H || cc < 0 || cc >= W) return [];
    return perimeterOwners.get(rr * W + cc) ?? [];
  };
  if (arrow) {
    const [dr, dc] =
      arrow === 'down' ? [1, 0] : arrow === 'up' ? [-1, 0] : arrow === 'right' ? [0, 1] : [0, -1];
    // Pointed cell at distance 1, then 2 (`--> ` with a space before the box).
    for (const dist of [1, 2]) {
      const pointed = ownersAt(r + dr * dist, c + dc * dist);
      if (pointed.length > 0) {
        // The pointed-at box: the one whose border faces the arrow.
        const sorted = [...pointed].sort((a, b) => {
          const da = directionDepth(boxes[a], r + dr * dist, c + dc * dist, arrow);
          const db = directionDepth(boxes[b], r + dr * dist, c + dc * dist, arrow);
          return db - da || a - b;
        });
        return sorted[0];
      }
    }
  }
  const candidates = new Map<number, number>(); // boxIdx → priority (0 = orthogonal, 1 = diagonal, 2 = one space away)
  for (const [dr, dc, priority] of [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [-1, -1, 1],
    [-1, 1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-2, 0, 2],
    [2, 0, 2],
    [0, -2, 2],
    [0, 2, 2],
  ]) {
    for (const owner of ownersAt(r + dr, c + dc)) {
      const existing = candidates.get(owner);
      if (existing === undefined || priority < existing) candidates.set(owner, priority);
    }
  }
  if (candidates.size === 0) return null;
  const ranked = [...candidates.entries()].sort(
    (a, b) =>
      a[1] - b[1] ||
      boxes[a[0]].r0 - boxes[b[0]].r0 ||
      boxes[a[0]].c0 - boxes[b[0]].c0 ||
      a[0] - b[0],
  );
  return ranked[0][0];
}

/** How deep the cell sits toward a box's interior along the arrow direction (higher = more pointed-at). */
function directionDepth(box: Rect, r: number, c: number, arrow: ArrowDirection): number {
  switch (arrow) {
    case 'down':
      return box.r0 === r ? 1 : 0; // arrow points down at the box's TOP border
    case 'up':
      return box.r1 === r ? 1 : 0;
    case 'right':
      return box.c0 === c ? 1 : 0;
    case 'left':
      return box.c1 === c ? 1 : 0;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
