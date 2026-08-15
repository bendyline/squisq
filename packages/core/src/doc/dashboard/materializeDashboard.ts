/**
 * Dashboard projection — the third sibling of the slide projection
 * (`buildPreviewDoc` + `materializeBlockLayers`) and the page projection
 * (`materializePageSections`).
 *
 * `materializeDashboard(doc, options)` turns a markdown-derived Doc into
 * ONE canvas: a layout's cells (canvas-unit rects) each holding one block
 * rendered AT the cell's size — a synthetic per-cell viewport, so
 * templates re-compose for the cell's orientation and typography scales
 * via `calculateFontScale` (the same strategy embedded spatial media uses
 * inside `materializeBlockLayers`). Core owns every geometry decision;
 * React consumers position cells with the CSS-ready `rectPct` values, and
 * non-React consumers flatten everything into a single canvas-level
 * `Layer[]` via {@link composeDashboardLayers}.
 *
 * Candidate blocks come from `buildPreviewDoc` (with image interleaving
 * off) so template resolution and derived inputs match the slideshow
 * exactly. Blocks beyond the layout's capacity are not rendered — that is
 * reported as an `overflow` diagnostic, never a console side effect.
 */

import type { Block, Doc, Layer } from '../../schemas/Doc.js';
import type { DocBlock } from '../../schemas/BlockTemplates.js';
import { createTemplateContext } from '../../schemas/BlockTemplates.js';
import type { CustomTemplateDefinition } from '../../schemas/CustomTemplates.js';
import type { Theme } from '../../schemas/Theme.js';
import { DEFAULT_THEME } from '../../schemas/themeLibrary.js';
import type { ViewportConfig } from '../../schemas/Viewport.js';
import {
  VIEWPORT_PRESETS,
  calculateFontScale,
  getViewportOrientation,
} from '../../schemas/Viewport.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { buildPreviewDoc } from '../buildPreviewDoc.js';
import type {
  LayerMaterializationDiagnostic,
  LayerMaterializationFailureMode,
  LayerMaterializationSource,
} from '../materializeBlockLayers.js';
import { materializeBlockLayersWithRuntime } from '../materializeBlockLayers.js';
import { placeLayersInRect, type LayerRect } from '../richMediaLayout.js';
import {
  buildRegistry,
  templateRegistry,
  type RuntimeTemplateRegistry,
} from '../templates/registry.js';
import { expandPersistentLayers, resolvePersistentLayers } from '../templates/persistentLayers.js';
import { getThemeFont } from '../utils/themeUtils.js';
import type { DashboardLayoutDefinition, DashboardTitleSlotDefinition } from './DashboardLayout.js';
import { resolveLayoutCells, validateDashboardLayoutDefinition } from './DashboardLayout.js';
import {
  DASHBOARD_AUTO_LAYOUT_ID,
  chooseDashboardLayout,
  resolveDashboardLayoutDefinition,
} from './chooseDashboardLayout.js';
import { resolveDashboardSettings } from './dashboardSettings.js';
import { readDashboardLayoutsFromFrontmatter } from './dashboardLayoutsFrontmatter.js';
import {
  resolveDashboardZooms,
  type DashboardZoomLevel,
  type DashboardZoomMode,
} from './dashboardZoom.js';
import { getBlockBodyText } from '../markdownToDoc.js';
import { resolveTemplateName } from '../templates/templateNames.js';

export interface MaterializeDashboardOptions {
  /** Theme used by cell templates and the canvas backdrop. */
  theme?: Theme;
  /** Canvas viewport. Defaults to the landscape preset. */
  viewport?: ViewportConfig;
  /**
   * Layout override: an id, {@link DASHBOARD_AUTO_LAYOUT_ID}, or an inline
   * definition. Overrides the doc's `squisq-dashboard-layout` frontmatter.
   */
  layout?: string | DashboardLayoutDefinition;
  /** Custom layouts; defaults to the doc's `squisq-dashboard-layouts`. */
  customLayouts?: readonly DashboardLayoutDefinition[];
  /** Document-scoped custom templates; defaults to `doc.customTemplates`. */
  customTemplates?: readonly CustomTemplateDefinition[];
  /** Title-band override; overrides `squisq-dashboard-title` frontmatter. */
  showTitle?: boolean;
  /** Host-supplied title fallback (file name), as in `buildPreviewDoc`. */
  documentTitle?: string;
  /** Cell zoom override; overrides `squisq-dashboard-zoom` frontmatter. */
  zoom?: DashboardZoomMode;
  /** Per-cell failure policy, forwarded to `materializeBlockLayers`. */
  failureMode?: LayerMaterializationFailureMode;
}

/** CSS-ready percentages of the FULL canvas for absolute positioning. */
export interface DashboardRectPct {
  left: string;
  top: string;
  width: string;
  height: string;
}

/** One populated dashboard cell. */
export interface DashboardCell {
  /** Cell ordinal in the layout (0-based, layout order). */
  index: number;
  /** The projected slide block rendered in this cell. */
  block: Block;
  /** Index in the candidate block sequence (for keys/debugging). */
  blockIndex: number;
  /** Layers materialized against {@link DashboardCell.viewport} (un-prefixed). */
  layers: Layer[];
  /** Cell rect in canvas units. */
  rect: LayerRect;
  /** Cell rect as percentages of the full canvas. */
  rectPct: DashboardRectPct;
  /** The synthetic per-cell viewport the layers were rendered against. */
  viewport: ViewportConfig;
  /**
   * Type-scale multiplier the block rendered with (1, 1.5, or 2) — the
   * layout stays cell-composed, but themed type renders this much larger
   * so sparse blocks fill their slot. Already baked into `layers`.
   */
  zoom: DashboardZoomLevel;
  source: LayerMaterializationSource;
  diagnostic?: LayerMaterializationDiagnostic;
}

export interface DashboardDiagnostic {
  type: 'overflow' | 'unknown-layout' | 'invalid-cell-assignment' | 'empty-doc';
  message: string;
  /** Ids of blocks hidden by an `overflow`. */
  hiddenBlockIds?: string[];
  /** The unresolvable id behind an `unknown-layout`. */
  requestedLayout?: string;
}

/** The rendered document-title band. */
export interface DashboardTitle {
  text: string;
  rect: LayerRect;
  rectPct: DashboardRectPct;
  viewport: ViewportConfig;
  layers: Layer[];
}

export interface DashboardMaterialization {
  layout: DashboardLayoutDefinition;
  layoutSource: 'option' | 'frontmatter' | 'auto';
  viewport: ViewportConfig;
  cells: DashboardCell[];
  /** Null when the title band is disabled or no title resolves. */
  title: DashboardTitle | null;
  /** Canvas-level base fill + theme/doc persistent layers, applied once. */
  backdrop: { bottomLayers: Layer[]; topLayers: Layer[] };
  diagnostics: DashboardDiagnostic[];
}

const DEFAULT_TITLE_SLOT: DashboardTitleSlotDefinition = { placement: 'top', height: '9%' };
/** Gap between the title band and the content area, as a canvas-height fraction. */
const TITLE_CONTENT_GAP = 0.015;

function percentNumber(value: string): number {
  const parsed = Number(value.trim().replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pctOf(value: number, total: number): string {
  return `${Math.round((value / Math.max(1, total)) * 100000) / 1000}%`;
}

function rectToPct(rect: LayerRect, viewport: ViewportConfig): DashboardRectPct {
  return {
    left: pctOf(rect.x, viewport.width),
    top: pctOf(rect.y, viewport.height),
    width: pctOf(rect.width, viewport.width),
    height: pctOf(rect.height, viewport.height),
  };
}

/** Frontmatter `title:` wins; the host-supplied name is the fallback. */
function resolveDashboardTitle(doc: Doc, provided?: string): string {
  const frontmatterTitle = doc.frontmatter?.title;
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }
  return provided?.trim() ?? '';
}

/**
 * Drop a leading candidate that only restates the document title, so the
 * title renders once (in the band) instead of twice — the dashboard analog
 * of the page projection's cover-dedupe guard. A block that carries its
 * own body prose is kept: its cell shows real content.
 */
function dedupeLeadingTitleBlock(candidates: Block[], titleText: string): Block[] {
  if (candidates.length === 0 || !titleText) return candidates;
  const first = candidates[0];
  const firstTitle = typeof first.title === 'string' ? first.title.trim().toLowerCase() : '';
  if (!firstTitle || firstTitle !== titleText.trim().toLowerCase()) return candidates;
  const template = (first as { template?: string }).template;
  const titleShaped = template === 'title' || template === 'sectionHeader' || template === 'cover';
  const hasBody = Array.isArray(first.contents) && first.contents.length > 0;
  return titleShaped || !hasBody ? candidates.slice(1) : candidates;
}

function buildTitleLayers(
  titleText: string,
  bandViewport: ViewportConfig,
  slot: DashboardTitleSlotDefinition,
  theme: Theme,
  canvasViewport: ViewportConfig,
): Layer[] {
  const context = createTemplateContext(theme, 0, 1, canvasViewport);
  const canvasFontScale = calculateFontScale(canvasViewport);
  const fontSize = Math.min(44 * canvasFontScale, bandViewport.height * 0.52);
  return [
    {
      type: 'shape',
      id: 'dashboard-title-accent',
      content: { shape: 'rect', fill: theme.colors.primary },
      position: {
        x: 0,
        y: '26%',
        width: Math.max(4, Math.round(6 * canvasFontScale)),
        height: '48%',
      },
    },
    {
      type: 'text',
      id: 'dashboard-title-text',
      content: {
        text: titleText,
        style: {
          fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'left',
          verticalAlign: 'middle',
          maxLines: 1,
        },
      },
      position: { x: '1.4%', y: 0, width: '97%', height: '100%' },
    },
    {
      // Hairline separating the band from the content area.
      type: 'shape',
      id: 'dashboard-title-rule',
      content: { shape: 'rect', fill: withAlpha(theme.colors.text, 0.14) },
      position: {
        x: 0,
        y: slot.placement === 'bottom' ? 0 : bandViewport.height - 2,
        width: '100%',
        height: 2,
      },
    },
  ];
}

export function materializeDashboard(
  doc: Doc,
  options: MaterializeDashboardOptions = {},
): DashboardMaterialization {
  const theme = options.theme ?? DEFAULT_THEME;
  const viewport = options.viewport ?? VIEWPORT_PRESETS.landscape;
  const orientation = getViewportOrientation(viewport);
  const customLayouts =
    options.customLayouts ?? readDashboardLayoutsFromFrontmatter(doc.frontmatter);
  const customTemplates = options.customTemplates ?? doc.customTemplates;
  const diagnostics: DashboardDiagnostic[] = [];

  // 1. Settings + layout resolution. Unknown ids degrade to auto with a
  //    diagnostic instead of failing the render.
  const settings = resolveDashboardSettings(doc.frontmatter, {
    layout: typeof options.layout === 'string' ? options.layout : undefined,
    showTitle: options.showTitle,
    zoom: options.zoom,
  });
  let layoutDef: DashboardLayoutDefinition | undefined;
  let layoutSource: DashboardMaterialization['layoutSource'] = 'auto';
  if (options.layout && typeof options.layout === 'object') {
    const validated = validateDashboardLayoutDefinition(options.layout);
    if (validated.layout) {
      layoutDef = validated.layout;
      layoutSource = 'option';
    } else {
      diagnostics.push({
        type: 'unknown-layout',
        message: 'Inline dashboard layout definition is invalid; falling back to auto.',
        requestedLayout: (options.layout as { name?: string }).name,
      });
    }
  } else if (settings.layout !== DASHBOARD_AUTO_LAYOUT_ID) {
    const resolved = resolveDashboardLayoutDefinition(settings.layout, customLayouts);
    if (resolved) {
      layoutDef = resolved;
      layoutSource =
        typeof options.layout === 'string' && options.layout.trim() ? 'option' : 'frontmatter';
    } else {
      diagnostics.push({
        type: 'unknown-layout',
        message: `Unknown dashboard layout "${settings.layout}"; falling back to auto.`,
        requestedLayout: settings.layout,
      });
    }
  }

  // 2. Candidate blocks — THE slide projection, minus interleaved image
  //    filler (a dashboard should not spend cells on synthetic slides).
  const preview = buildPreviewDoc(doc, {
    documentTitle: options.documentTitle,
    interleaveImages: false,
  });
  let candidates = (preview.blocks ?? []) as Block[];
  if (candidates.length === 0) {
    diagnostics.push({
      type: 'empty-doc',
      message: 'The document has no renderable blocks; the dashboard has no cells.',
    });
  }

  // 3. Title band + dedupe. The band renders only when enabled AND a title
  //    actually resolves; the managed cover never renders on a dashboard.
  const titleText = settings.showTitle ? resolveDashboardTitle(doc, options.documentTitle) : '';
  const hasTitleBand = titleText.length > 0;
  if (hasTitleBand) {
    candidates = dedupeLeadingTitleBlock(candidates, titleText);
  }

  // 4. Auto-pick when no explicit layout survived resolution.
  if (!layoutDef) {
    layoutDef = chooseDashboardLayout(candidates.length, orientation, customLayouts);
    layoutSource = 'auto';
  }

  // 5. Geometry: the content rect is the canvas minus the title band.
  let contentRect: LayerRect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  let title: DashboardTitle | null = null;
  if (hasTitleBand) {
    const slot = layoutDef.titleSlot ?? DEFAULT_TITLE_SLOT;
    const bandPct = Math.min(40, Math.max(2, percentNumber(slot.height)));
    const bandHeight = (bandPct / 100) * viewport.height;
    const gap = TITLE_CONTENT_GAP * viewport.height;
    const titleRect: LayerRect =
      slot.placement === 'bottom'
        ? { x: 0, y: viewport.height - bandHeight, width: viewport.width, height: bandHeight }
        : { x: 0, y: 0, width: viewport.width, height: bandHeight };
    contentRect =
      slot.placement === 'bottom'
        ? { x: 0, y: 0, width: viewport.width, height: viewport.height - bandHeight - gap }
        : {
            x: 0,
            y: bandHeight + gap,
            width: viewport.width,
            height: viewport.height - bandHeight - gap,
          };
    const bandViewport: ViewportConfig = {
      width: Math.max(1, Math.round(titleRect.width)),
      height: Math.max(1, Math.round(titleRect.height)),
      name: 'Dashboard title',
    };
    title = {
      text: titleText,
      rect: titleRect,
      rectPct: rectToPct(titleRect, viewport),
      viewport: bandViewport,
      layers: buildTitleLayers(titleText, bandViewport, slot, theme, viewport),
    };
  }

  // 6. Cell assignment: explicit `block: N` claims first (1-based;
  //    duplicates allowed — a KPI wall may repeat a block), then the
  //    remaining cells fill with unclaimed candidates in document order.
  const resolvedCells = resolveLayoutCells(layoutDef, orientation, contentRect);
  const assignments: Array<{
    cellIndex: number;
    rect: LayerRect;
    candidateIndex: number;
    explicitZoom?: DashboardZoomLevel;
  }> = [];
  const explicitlyClaimed = new Set<number>();
  resolvedCells.forEach((cell, cellIndex) => {
    if (cell.block === undefined) return;
    const candidateIndex = cell.block - 1;
    if (candidateIndex < 0 || candidateIndex >= candidates.length) {
      diagnostics.push({
        type: 'invalid-cell-assignment',
        message: `Cell ${cellIndex + 1} of layout "${layoutDef.name}" requests block ${cell.block}, but the document has ${candidates.length} block(s); the cell is left empty.`,
      });
      return;
    }
    explicitlyClaimed.add(candidateIndex);
    assignments.push({ cellIndex, rect: cell.rect, candidateIndex, explicitZoom: cell.zoom });
  });
  const filled = new Set<number>();
  let cursor = 0;
  resolvedCells.forEach((cell, cellIndex) => {
    if (cell.block !== undefined) return;
    while (cursor < candidates.length && explicitlyClaimed.has(cursor)) cursor++;
    if (cursor >= candidates.length) return; // layout larger than the doc — fine
    filled.add(cursor);
    assignments.push({
      cellIndex,
      rect: cell.rect,
      candidateIndex: cursor,
      explicitZoom: cell.zoom,
    });
    cursor++;
  });
  const hidden: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (!explicitlyClaimed.has(i) && !filled.has(i)) hidden.push(i);
  }
  if (hidden.length > 0) {
    diagnostics.push({
      type: 'overflow',
      message: `${hidden.length} block(s) exceed the "${layoutDef.name}" layout's ${resolvedCells.length} cell(s) and are not rendered.`,
      hiddenBlockIds: hidden.map((i) => String((candidates[i] as { id?: unknown }).id ?? i)),
    });
  }

  // 7. Cell zoom: explicit pins win; auto boosts short text-led blocks;
  //    the picks are quantized so the dashboard uses at most base 1× plus
  //    ONE boost level (cells stay consistently sized, never free-fitted).
  const orderedAssignments = assignments.sort((a, b) => a.cellIndex - b.cellIndex);
  const zooms = resolveDashboardZooms(
    orderedAssignments.map(({ candidateIndex, explicitZoom }) => {
      const block = candidates[candidateIndex];
      const title = typeof block.title === 'string' ? block.title : '';
      return {
        template: resolveTemplateName((block as { template?: string }).template ?? ''),
        textLength: title.length + getBlockBodyText(block).length,
        ...(explicitZoom !== undefined ? { explicit: explicitZoom } : {}),
      };
    }),
    settings.zoom,
  );

  // 8. Per-cell materialization at the cell's own viewport. The registry is
  //    hoisted once; theme persistent layers are opted out per cell and
  //    applied once at the canvas level instead. Zoom multiplies the
  //    context's type scale — composition still targets the cell.
  const registry: RuntimeTemplateRegistry =
    customTemplates && customTemplates.length > 0
      ? buildRegistry(customTemplates)
      : (templateRegistry as unknown as RuntimeTemplateRegistry);
  const cells: DashboardCell[] = orderedAssignments.map(
    ({ cellIndex, rect, candidateIndex }, orderIndex) => {
      const block = candidates[candidateIndex];
      const zoom = zooms[orderIndex];
      const cellViewport: ViewportConfig = {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        name: `Dashboard cell ${cellIndex + 1}`,
      };
      const cellContext = createTemplateContext(
        theme,
        candidateIndex,
        candidates.length,
        cellViewport,
      );
      if (zoom !== 1) cellContext.fontScale *= zoom;
      const result = materializeBlockLayersWithRuntime(
        block as DocBlock,
        {
          theme,
          viewport: cellViewport,
          persistentLayers: false,
          blockIndex: candidateIndex,
          totalBlocks: candidates.length,
          failureMode: options.failureMode,
        },
        { registry, templateContext: cellContext },
      );
      return {
        index: cellIndex,
        block,
        blockIndex: candidateIndex,
        layers: result.layers,
        rect,
        rectPct: rectToPct(rect, viewport),
        viewport: cellViewport,
        zoom,
        source: result.source,
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      };
    },
  );

  // 9. Canvas backdrop: base fill + persistent layers (doc's win wholesale
  //    over the theme's, matching every other projection).
  const persistent = resolvePersistentLayers(doc, theme);
  const backdrop = {
    bottomLayers: [
      {
        type: 'shape',
        id: 'dashboard-backdrop',
        content: { shape: 'rect', fill: theme.colors.background },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      } as Layer,
      ...expandPersistentLayers(persistent?.bottomLayers, theme),
    ],
    topLayers: expandPersistentLayers(persistent?.topLayers, theme),
  };

  return {
    layout: layoutDef,
    layoutSource,
    viewport,
    cells,
    title,
    backdrop,
    diagnostics,
  };
}

/**
 * Flatten a materialization into one canvas-level `Layer[]` for non-React
 * consumers. Every cell/title layer is mapped into its canvas rect with a
 * unique id prefix (templates reuse ids like `title`, so the prefix is
 * what keeps the flat canvas collision-free). Paint order: backdrop
 * bottom, cells, title band, backdrop top.
 */
export function composeDashboardLayers(materialization: DashboardMaterialization): Layer[] {
  const layers: Layer[] = [...materialization.backdrop.bottomLayers];
  for (const cell of materialization.cells) {
    layers.push(...placeLayersInRect(cell.layers, cell.viewport, cell.rect, `cell-${cell.index}`));
  }
  if (materialization.title) {
    layers.push(
      ...placeLayersInRect(
        materialization.title.layers,
        materialization.title.viewport,
        materialization.title.rect,
        'dashboard-title',
      ),
    );
  }
  layers.push(...materialization.backdrop.topLayers);
  return layers;
}
