/**
 * Dashboard layout model.
 *
 * A dashboard renders a document's blocks onto ONE canvas: a layout places
 * N cells (as %-rects) over the canvas's content area, and each cell hosts
 * one rendered block. Where `materializeBlockLayers` is the slide
 * projection and `materializePageSections` is the page projection,
 * `materializeDashboard` (in this directory) is the dashboard projection —
 * this module holds the layout *definition* shape shared by built-in and
 * user-authored layouts, plus the geometry helpers that resolve a
 * definition against a concrete viewport.
 *
 * Positions are `%`-strings relative to the layout's CONTENT rect (the
 * canvas minus the optional title band), mirroring the custom-template
 * convention: one definition renders at any aspect ratio unchanged.
 */

import type { ViewportOrientation } from '../../schemas/Viewport.js';
import type { LayerRect } from '../richMediaLayout.js';
import { normalizeDashboardZoom, type DashboardZoomLevel } from './dashboardZoom.js';

/**
 * One cell of a dashboard layout. `x`/`y`/`width`/`height` are `%`-strings
 * relative to the content rect. `block` is an optional 1-based explicit
 * block assignment ("render block N here"); cells without one fill in
 * document order.
 */
export interface DashboardCellDefinition {
  x: string;
  y: string;
  width: string;
  height: string;
  /** 1-based candidate-block index this cell explicitly renders. */
  block?: number;
  /**
   * Type-scale multiplier for the block rendered here: 1, 1.5, or 2
   * (percent spellings 100/150/200 are accepted and normalized). Pins the
   * cell's zoom and exempts it from the automatic density pick.
   */
  zoom?: number;
}

/** Where and how tall the optional document-title band renders. */
export interface DashboardTitleSlotDefinition {
  /** Which canvas edge hosts the band. Default 'top'. */
  placement: 'top' | 'bottom';
  /** Band height as a `%`-string of the canvas height. Default '9%'. */
  height: string;
}

/**
 * A dashboard layout definition — JSON-serializable so built-ins and
 * frontmatter-authored custom layouts share one schema.
 */
export interface DashboardLayoutDefinition {
  /** Slug id used by `squisq-dashboard-layout` (lowercase, hyphens). */
  name: string;
  /** Human-facing picker label. */
  label: string;
  description?: string;
  /**
   * Per-orientation cell arrays. `landscape` is required and defines the
   * layout's capacity. Fallbacks when a variant is absent:
   * square → landscape cells (%-stretch), portrait → transposed landscape.
   * Variants that are present must match landscape's cell count.
   */
  cells: {
    landscape: DashboardCellDefinition[];
    portrait?: DashboardCellDefinition[];
    square?: DashboardCellDefinition[];
  };
  /** Overrides the default title band when the doc shows a title. */
  titleSlot?: DashboardTitleSlotDefinition;
  /** False excludes the layout from auto-pick (picker-only). Default true. */
  auto?: boolean;
}

export interface DashboardLayoutValidationError {
  path: string;
  message: string;
}

export interface DashboardLayoutValidationResult {
  valid: boolean;
  errors: DashboardLayoutValidationError[];
  /** The normalized definition when `valid` is true. */
  layout?: DashboardLayoutDefinition;
}

/** A resolved cell: canvas-unit rect plus the optional explicit pins. */
export interface ResolvedDashboardCell {
  rect: LayerRect;
  block?: number;
  /** Author-pinned zoom level from the cell definition. */
  zoom?: DashboardZoomLevel;
}

const MAX_CELLS = 32;
const MAX_BLOCK_ASSIGNMENT = 64;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Parse a percent value: accepts `'33.4%'`, `'33.4'`, or a bare number
 * (hand-authored JSON friendliness). Returns undefined when unparseable.
 */
function parsePercent(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/%$/, '');
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Format a percent number as the canonical `%`-string. */
function formatPercent(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded}%`;
}

function validateCell(
  input: unknown,
  path: string,
  errors: DashboardLayoutValidationError[],
): DashboardCellDefinition | undefined {
  if (!input || typeof input !== 'object') {
    errors.push({ path, message: 'cell must be an object' });
    return undefined;
  }
  const cell = input as Record<string, unknown>;
  const x = parsePercent(cell.x);
  const y = parsePercent(cell.y);
  const width = parsePercent(cell.width);
  const height = parsePercent(cell.height);
  if (x === undefined || x < 0 || x > 100) {
    errors.push({ path: `${path}.x`, message: 'x must be a percent between 0 and 100' });
    return undefined;
  }
  if (y === undefined || y < 0 || y > 100) {
    errors.push({ path: `${path}.y`, message: 'y must be a percent between 0 and 100' });
    return undefined;
  }
  if (width === undefined || width <= 0 || width > 100) {
    errors.push({ path: `${path}.width`, message: 'width must be a percent greater than 0' });
    return undefined;
  }
  if (height === undefined || height <= 0 || height > 100) {
    errors.push({ path: `${path}.height`, message: 'height must be a percent greater than 0' });
    return undefined;
  }
  const out: DashboardCellDefinition = {
    x: formatPercent(x),
    y: formatPercent(y),
    width: formatPercent(width),
    height: formatPercent(height),
  };
  if (cell.block !== undefined) {
    const block = typeof cell.block === 'string' ? Number(cell.block) : cell.block;
    if (
      typeof block !== 'number' ||
      !Number.isInteger(block) ||
      block < 1 ||
      block > MAX_BLOCK_ASSIGNMENT
    ) {
      errors.push({
        path: `${path}.block`,
        message: `block must be an integer between 1 and ${MAX_BLOCK_ASSIGNMENT}`,
      });
      return undefined;
    }
    out.block = block;
  }
  if (cell.zoom !== undefined) {
    const zoom = normalizeDashboardZoom(cell.zoom);
    if (zoom === undefined) {
      errors.push({
        path: `${path}.zoom`,
        message: 'zoom must be 1, 1.5, or 2 (or 100/150/200 percent)',
      });
      return undefined;
    }
    out.zoom = zoom;
  }
  return out;
}

function validateCellArray(
  input: unknown,
  path: string,
  errors: DashboardLayoutValidationError[],
): DashboardCellDefinition[] | undefined {
  if (!Array.isArray(input)) {
    errors.push({ path, message: 'must be an array of cells' });
    return undefined;
  }
  if (input.length < 1 || input.length > MAX_CELLS) {
    errors.push({ path, message: `must contain between 1 and ${MAX_CELLS} cells` });
    return undefined;
  }
  const cells: DashboardCellDefinition[] = [];
  for (let i = 0; i < input.length; i++) {
    const cell = validateCell(input[i], `${path}[${i}]`, errors);
    if (!cell) return undefined;
    cells.push(cell);
  }
  return cells;
}

function validateTitleSlot(
  input: unknown,
  errors: DashboardLayoutValidationError[],
): DashboardTitleSlotDefinition | undefined {
  if (!input || typeof input !== 'object') {
    errors.push({ path: 'titleSlot', message: 'titleSlot must be an object' });
    return undefined;
  }
  const slot = input as Record<string, unknown>;
  const placement =
    slot.placement === 'bottom' ? 'bottom' : slot.placement === 'top' ? 'top' : undefined;
  if (placement === undefined && slot.placement !== undefined) {
    errors.push({ path: 'titleSlot.placement', message: "placement must be 'top' or 'bottom'" });
    return undefined;
  }
  const height = parsePercent(slot.height);
  if (height === undefined || height <= 0 || height > 40) {
    errors.push({ path: 'titleSlot.height', message: 'height must be a percent between 0 and 40' });
    return undefined;
  }
  return { placement: placement ?? 'top', height: formatPercent(height) };
}

/**
 * Validate an untrusted layout definition (frontmatter, host input) into a
 * normalized {@link DashboardLayoutDefinition}. Never throws; malformed
 * definitions come back as `{ valid: false, errors }`.
 */
export function validateDashboardLayoutDefinition(input: unknown): DashboardLayoutValidationResult {
  const errors: DashboardLayoutValidationError[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'definition must be an object' }] };
  }
  const def = input as Record<string, unknown>;

  const name = typeof def.name === 'string' ? def.name.trim().toLowerCase() : '';
  if (!NAME_PATTERN.test(name)) {
    errors.push({
      path: 'name',
      message: 'name must be a slug (lowercase letters, digits, hyphens)',
    });
  }
  const label = typeof def.label === 'string' ? def.label.trim() : '';
  if (label.length === 0) {
    errors.push({ path: 'label', message: 'label must be a non-empty string' });
  }

  const cellsInput = def.cells as Record<string, unknown> | undefined;
  let landscape: DashboardCellDefinition[] | undefined;
  let portrait: DashboardCellDefinition[] | undefined;
  let square: DashboardCellDefinition[] | undefined;
  if (!cellsInput || typeof cellsInput !== 'object') {
    errors.push({ path: 'cells', message: 'cells must be an object with a landscape array' });
  } else {
    landscape = validateCellArray(cellsInput.landscape, 'cells.landscape', errors);
    if (cellsInput.portrait !== undefined) {
      portrait = validateCellArray(cellsInput.portrait, 'cells.portrait', errors);
    }
    if (cellsInput.square !== undefined) {
      square = validateCellArray(cellsInput.square, 'cells.square', errors);
    }
    if (landscape) {
      if (portrait && portrait.length !== landscape.length) {
        errors.push({
          path: 'cells.portrait',
          message: 'portrait must define the same number of cells as landscape',
        });
      }
      if (square && square.length !== landscape.length) {
        errors.push({
          path: 'cells.square',
          message: 'square must define the same number of cells as landscape',
        });
      }
    }
  }

  let titleSlot: DashboardTitleSlotDefinition | undefined;
  if (def.titleSlot !== undefined) {
    titleSlot = validateTitleSlot(def.titleSlot, errors);
  }

  if (errors.length > 0 || !landscape) {
    return { valid: false, errors };
  }

  const layout: DashboardLayoutDefinition = {
    name,
    label,
    cells: {
      landscape,
      ...(portrait ? { portrait } : {}),
      ...(square ? { square } : {}),
    },
  };
  if (typeof def.description === 'string' && def.description.trim()) {
    layout.description = def.description.trim();
  }
  if (titleSlot) layout.titleSlot = titleSlot;
  if (def.auto === false) layout.auto = false;
  return { valid: true, errors, layout };
}

/** Number of blocks the layout can display. */
export function layoutCapacity(def: DashboardLayoutDefinition): number {
  return def.cells.landscape.length;
}

/**
 * Swap each cell's axes (x↔y, width↔height) — the automatic portrait
 * rendition for layouts that only define landscape cells. A row of cells
 * becomes a column; grids become their transpose.
 */
export function transposeCells(
  cells: readonly DashboardCellDefinition[],
): DashboardCellDefinition[] {
  return cells.map((cell) => ({
    x: cell.y,
    y: cell.x,
    width: cell.height,
    height: cell.width,
    ...(cell.block !== undefined ? { block: cell.block } : {}),
    ...(cell.zoom !== undefined ? { zoom: cell.zoom } : {}),
  }));
}

/**
 * Pick the orientation variant (with fallbacks) and resolve its `%`-strings
 * against a concrete content rect, producing canvas-unit cell rects.
 */
export function resolveLayoutCells(
  def: DashboardLayoutDefinition,
  orientation: ViewportOrientation,
  contentRect: LayerRect,
): ResolvedDashboardCell[] {
  const cells =
    orientation === 'portrait'
      ? (def.cells.portrait ?? transposeCells(def.cells.landscape))
      : orientation === 'square'
        ? (def.cells.square ?? def.cells.landscape)
        : def.cells.landscape;
  return cells.map((cell) => {
    const x = parsePercent(cell.x) ?? 0;
    const y = parsePercent(cell.y) ?? 0;
    const width = parsePercent(cell.width) ?? 0;
    const height = parsePercent(cell.height) ?? 0;
    const resolved: ResolvedDashboardCell = {
      rect: {
        x: contentRect.x + (x / 100) * contentRect.width,
        y: contentRect.y + (y / 100) * contentRect.height,
        width: Math.max(1, (width / 100) * contentRect.width),
        height: Math.max(1, (height / 100) * contentRect.height),
      },
    };
    if (cell.block !== undefined) resolved.block = cell.block;
    const zoom = normalizeDashboardZoom(cell.zoom);
    if (zoom !== undefined) resolved.zoom = zoom;
    return resolved;
  });
}
