/**
 * Worksheet → data islands ("mini tables").
 *
 * A sheet is not a table. It is several tables scattered across a grid, with
 * stray labels, notes and totals in the gaps. Importing the whole used range as
 * one markdown table makes `A1` the header for all of it and turns every gap
 * into blank rows and columns.
 *
 * This module finds the islands. It is pure: grid in, rectangles out — no XML,
 * no markdown, no I/O — so the interesting part is testable on a literal grid.
 *
 * The algorithm is the standard used-range island sweep:
 *
 *   1. build an occupancy mask (a merged range with a non-empty anchor occupies
 *      its whole rectangle, so a merged title is not mistaken for a lone cell);
 *   2. 8-connected flood fill → components;
 *   3. take each component's bounding rectangle;
 *   4. merge intersecting rectangles to a fixpoint;
 *   5. absorb a lone caption sitting above a table as that table's title;
 *   6. everything still only one cell big is a "stray".
 *
 * Step 3 is why step 4 is needed: rectangularizing an L-shaped or ragged island
 * claims cells the component never touched, which can swallow a neighbour. Step
 * 4 resolves that by union rather than by letting two rectangles overlap.
 *
 * Diagonal (8-way) connectivity rather than 4-way is what keeps a table with a
 * blank cell in the middle of it in one piece. A fully blank row or column
 * still separates, which is what a human reading the sheet would say too.
 */

import { isOccupied, type CellRect, type XlsxCell } from './cells.js';

/** Tuning knobs for {@link detectRegions}. */
export interface RegionOptions {
  /**
   * Cap on regions emitted per sheet. Anything past it is folded into the
   * stray bucket rather than dropped. Default 64.
   */
  maxRegionsPerSheet?: number;
  /**
   * Cap on flood-fill components before detection gives up and tells the caller
   * to fall back to the whole grid. The merge pass is quadratic in the
   * component count, so a pathological sheet must not be allowed to run away.
   * Default 2000.
   */
  maxRegionCandidates?: number;
  /**
   * Smallest region that stays a table of its own. Anything smaller becomes a
   * stray. Default 2 — i.e. single cells coalesce.
   */
  minRegionCells?: number;
  /**
   * Cap on the occupancy mask's area (rows × columns of the used range).
   * A sheet with content in `A1` and `XFD1048576` has a bounding box of 17
   * billion cells; the mask is dense, so it must refuse rather than allocate.
   * Default 4,000,000 (a 4 MB mask).
   */
  maxMaskCells?: number;
  /** Cancel at row boundaries. */
  signal?: AbortSignal;
}

/** One detected data island. */
export interface DetectedRegion {
  /** Inclusive, zero-based bounds within the sheet grid. */
  rect: CellRect;
  /** Text of a lone caption cell absorbed from directly above the region. */
  title?: string;
  /**
   * Where that caption came from. Absorbing a title into a heading would
   * otherwise lose the cell, so the reverse path needs its address to put the
   * text back.
   */
  titleCell?: { row: number; col: number };
}

/** A cell that did not belong to any region. */
export interface StrayCell {
  row: number;
  col: number;
  cell: XlsxCell;
}

/** The result of splitting one sheet. */
export interface RegionPlan {
  regions: DetectedRegion[];
  /** Left-over single cells, in reading order, for the sheet's loose bucket. */
  strays: StrayCell[];
  warnings: string[];
  /**
   * True when detection declined (too many candidates). The caller should fall
   * back to emitting the whole grid as one table.
   */
  degraded: boolean;
}

const DEFAULT_MAX_REGIONS = 64;
const DEFAULT_MAX_CANDIDATES = 2000;
const DEFAULT_MIN_REGION_CELLS = 2;
const DEFAULT_MAX_MASK_CELLS = 4_000_000;
/** Bound on rect-merge sweeps; each is O(R²) and two normally suffice. */
const MAX_MERGE_PASSES = 8;

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/** Inclusive-rectangle intersection. */
function intersects(a: CellRect, b: CellRect): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

function union(a: CellRect, b: CellRect): CellRect {
  return {
    top: Math.min(a.top, b.top),
    left: Math.min(a.left, b.left),
    bottom: Math.max(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
  };
}

function area(rect: CellRect): number {
  return (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
}

/** Cells of `grid` inside `rect`, padded to the rectangle's full width. */
export function sliceRect(grid: XlsxCell[][], rect: CellRect, empty: XlsxCell): XlsxCell[][] {
  const out: XlsxCell[][] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const row = grid[r] ?? [];
    const cells: XlsxCell[] = [];
    for (let c = rect.left; c <= rect.right; c++) cells.push(row[c] ?? empty);
    out.push(cells);
  }
  return out;
}

/**
 * Split a sheet grid into its contiguous data islands.
 *
 * `merges` are the sheet's `<mergeCells>` rectangles; they widen the occupancy
 * mask only. Nothing here re-emits them.
 */
export function detectRegions(
  grid: XlsxCell[][],
  merges: readonly CellRect[] = [],
  options: RegionOptions = {},
): RegionPlan {
  const signal = options.signal;
  const maxRegions = options.maxRegionsPerSheet ?? DEFAULT_MAX_REGIONS;
  const maxCandidates = options.maxRegionCandidates ?? DEFAULT_MAX_CANDIDATES;
  const minCells = options.minRegionCells ?? DEFAULT_MIN_REGION_CELLS;
  const maxMaskCells = options.maxMaskCells ?? DEFAULT_MAX_MASK_CELLS;
  const warnings: string[] = [];

  const rows = grid.length;
  let cols = 0;
  for (const row of grid) cols = Math.max(cols, row.length);
  if (rows === 0 || cols === 0) {
    return { regions: [], strays: [], warnings, degraded: false };
  }
  if (rows * cols > maxMaskCells) {
    warnings.push(
      `Used range spans ${rows}×${cols} cells, past the ${maxMaskCells}-cell detection limit; imported as a single grid instead.`,
    );
    return { regions: [], strays: [], warnings, degraded: true };
  }

  // ── 1. Occupancy mask ────────────────────────────────────────────
  const mask = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    throwIfAborted(signal);
    const row = grid[r]!;
    for (let c = 0; c < row.length; c++) {
      if (isOccupied(row[c]!)) mask[r * cols + c] = 1;
    }
  }
  for (const merge of merges) {
    const anchor = grid[merge.top]?.[merge.left];
    if (!anchor || !isOccupied(anchor)) continue;
    const bottom = Math.min(merge.bottom, rows - 1);
    const right = Math.min(merge.right, cols - 1);
    for (let r = Math.max(0, merge.top); r <= bottom; r++) {
      for (let c = Math.max(0, merge.left); c <= right; c++) mask[r * cols + c] = 1;
    }
  }

  // ── 2/3. 8-connected components → bounding rectangles ────────────
  const seen = new Uint8Array(rows * cols);
  let rects: CellRect[] = [];
  const stack: number[] = [];

  for (let r0 = 0; r0 < rows; r0++) {
    throwIfAborted(signal);
    for (let c0 = 0; c0 < cols; c0++) {
      const start = r0 * cols + c0;
      if (mask[start] === 0 || seen[start] === 1) continue;
      if (rects.length >= maxCandidates) {
        warnings.push(
          `Sheet has more than ${maxCandidates} data islands; imported as a single grid instead.`,
        );
        return { regions: [], strays: [], warnings, degraded: true };
      }

      // Iterative fill — a worksheet can be a million rows deep, so recursion
      // is not an option.
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let top = r0;
      let bottom = r0;
      let left = c0;
      let right = c0;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const r = (idx / cols) | 0;
        const c = idx - r * cols;
        if (r < top) top = r;
        if (r > bottom) bottom = r;
        if (c < left) left = c;
        if (c > right) right = c;

        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const nc = c + dc;
            if (nc < 0 || nc >= cols) continue;
            const nIdx = nr * cols + nc;
            if (mask[nIdx] === 0 || seen[nIdx] === 1) continue;
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }

      rects.push({ top, left, bottom, right });
    }
  }

  // ── 4. Merge intersecting rectangles to a fixpoint ───────────────
  // Sweep rather than restart: restarting the scan on every merge is O(R³),
  // and R is only bounded by `maxRegionCandidates`. Each sweep absorbs every
  // rectangle it can into an accumulator, so two passes normally suffice.
  for (let pass = 0; pass < MAX_MERGE_PASSES; pass++) {
    throwIfAborted(signal);
    const out: CellRect[] = [];
    let changed = false;
    for (const rect of rects) {
      let current = rect;
      let hit = -1;
      for (let i = 0; i < out.length; i++) {
        if (!intersects(out[i]!, current)) continue;
        current = union(out[i]!, current);
        if (hit < 0) {
          hit = i;
          out[i] = current;
        } else {
          out[hit] = current;
          out.splice(i, 1);
          i--;
        }
        changed = true;
      }
      if (hit < 0) out.push(current);
    }
    rects = out;
    if (!changed) break;
  }

  // ── 5. Reading order, then caption absorption ────────────────────
  rects.sort((a, b) => a.top - b.top || a.left - b.left);

  const titles = new Map<number, CaptionCell>();
  const absorbed = new Set<number>();
  for (let i = 0; i < rects.length; i++) {
    const body = rects[i]!;
    if (absorbed.has(i) || area(body) < minCells) continue;
    for (let j = 0; j < rects.length; j++) {
      if (j === i || absorbed.has(j) || titles.has(i)) continue;
      const cap = rects[j]!;
      if (cap.top !== cap.bottom) continue; // captions are one row
      if (cap.bottom >= body.top) continue; // must sit above
      if (body.top - cap.bottom > 2) continue; // at most one blank row between
      if (cap.left < body.left || cap.right > body.right) continue; // inside the span
      const sole = soleCell(grid, cap);
      if (sole === null) continue; // more than one filled cell: not a caption
      titles.set(i, sole);
      absorbed.add(j);
    }
  }

  // ── 6. Classify ──────────────────────────────────────────────────
  const regions: DetectedRegion[] = [];
  const strayRects: CellRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    if (absorbed.has(i)) continue;
    let rect = rects[i]!;
    if (area(rect) < minCells) {
      strayRects.push(rect);
      continue;
    }
    if (regions.length >= maxRegions) {
      strayRects.push(rect);
      continue;
    }
    let caption = titles.get(i);
    if (caption === undefined) {
      // A caption with no blank row under it is 8-connected to the table, so
      // it arrives inside the region rather than as a rectangle of its own.
      const peeled = peelCaptionRow(grid, rect);
      if (peeled) {
        caption = peeled.caption;
        rect = peeled.rect;
      }
    }
    regions.push(
      caption === undefined
        ? { rect }
        : { rect, title: caption.text, titleCell: { row: caption.row, col: caption.col } },
    );
  }

  const overflow = rects.filter((r, i) => !absorbed.has(i) && area(r) >= minCells).length;
  if (overflow > maxRegions) {
    warnings.push(
      `Sheet has ${overflow} data islands; the first ${maxRegions} became tables and the rest were folded into the loose-cells table.`,
    );
  }

  const strays: StrayCell[] = [];
  for (const rect of strayRects) {
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let c = rect.left; c <= rect.right; c++) {
        const cell = grid[r]?.[c];
        if (cell && isOccupied(cell)) strays.push({ row: r, col: c, cell });
      }
    }
  }
  strays.sort((a, b) => a.row - b.row || a.col - b.col);

  return { regions, strays, warnings, degraded: false };
}

/** A caption cell: its text and where it sits. */
interface CaptionCell {
  text: string;
  row: number;
  col: number;
}

/**
 * A rectangle's single filled cell, or null when it holds none or more than
 * one. A merged caption spans several mask cells but only one of them carries
 * text, which is exactly what this distinguishes.
 */
function soleCell(grid: XlsxCell[][], rect: CellRect): CaptionCell | null {
  let found: CaptionCell | null = null;
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      const cell = grid[r]?.[c];
      if (!cell || cell.text === '') continue;
      if (found !== null) return null;
      found = { text: cell.text, row: r, col: c };
    }
  }
  return found;
}

/**
 * Peel a caption row off the top of a region.
 *
 * `Q3 Revenue` on its own line directly above a table has no blank row to
 * separate it, so the flood fill joins the two and the caption arrives as a
 * ragged first row — which would otherwise become the markdown table's header.
 * A top row holding exactly one value above a row holding several is a caption,
 * not data.
 *
 * Returns null when the top row does not look like a caption, or when peeling
 * it would leave fewer than two rows behind.
 */
function peelCaptionRow(
  grid: XlsxCell[][],
  rect: CellRect,
): { caption: CaptionCell; rect: CellRect } | null {
  if (rect.bottom - rect.top < 2) return null;

  const caption = soleCell(grid, { ...rect, bottom: rect.top });
  if (caption === null) return null;

  let below = 0;
  for (let c = rect.left; c <= rect.right; c++) {
    if ((grid[rect.top + 1]?.[c]?.text ?? '') !== '') below++;
  }
  if (below < 2) return null;

  return { caption, rect: { ...rect, top: rect.top + 1 } };
}
