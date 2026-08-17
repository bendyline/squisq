/**
 * Dashboard cell style — the "how it's dressed" axis, orthogonal to the
 * layout's "where things go".
 *
 * A layout answers how many cells there are and what shape they take; a
 * style answers what a cell LOOKS like: whether the block simply fills its
 * rect (`basic`, the historical behavior), sits on a raised card, sits in a
 * flat outlined panel, or on an accent-tinted card. Every style derives its
 * colors, radius, and accents from the ACTIVE THEME (`colors`,
 * `style.borderRadius`, `colorSchemes`), so a gezellig dashboard reads as
 * gezellig and a tech-dark one reads as tech-dark — a style never carries
 * its own palette.
 *
 * Geometry is core-owned like everything else in the dashboard pipeline:
 * this module returns the card rect the block renders into plus the chrome
 * layers painted behind it (CELL-LOCAL coordinates — the same space
 * `materializeDashboard` hands renderers for the title band) and over it
 * (CARD-LOCAL, so a host clips them with the card's own corner radius).
 */

import type { Layer } from '../../schemas/Doc.js';
import type { Theme } from '../../schemas/Theme.js';
import {
  oklchDarken,
  oklchLighten,
  relativeLuminance,
  withAlpha,
} from '../../schemas/colorUtils.js';
import type { LayerRect } from '../richMediaLayout.js';

/** The closed set of dashboard cell styles. */
export const DASHBOARD_STYLE_IDS = ['basic', 'card', 'panel', 'accent'] as const;

export type DashboardStyleId = (typeof DASHBOARD_STYLE_IDS)[number];

export const DEFAULT_DASHBOARD_STYLE: DashboardStyleId = 'basic';

/** Picker-facing summary of a style (mirrors `DashboardLayoutSummary`). */
export interface DashboardStyleSummary {
  id: DashboardStyleId;
  label: string;
  description: string;
}

/** The style library, in picker order. */
export const DASHBOARD_STYLES: readonly DashboardStyleSummary[] = Object.freeze([
  {
    id: 'basic',
    label: 'Basic',
    description: 'Blocks fill their cells edge to edge.',
  },
  {
    id: 'card',
    label: 'Cards',
    description: 'Each block sits on a raised, rounded card.',
  },
  {
    id: 'panel',
    label: 'Panels',
    description: 'Flat outlined panels with an accent rule.',
  },
  {
    id: 'accent',
    label: 'Accent cards',
    description: "Cards tinted with the theme's accent colors in rotation.",
  },
]);

/** Normalize an authored style value; undefined when unrecognized. */
export function resolveDashboardStyleId(value: unknown): DashboardStyleId | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'none' || normalized === 'default' || normalized === 'flat') return 'basic';
  if (normalized === 'cards') return 'card';
  if (normalized === 'panels' || normalized === 'outline') return 'panel';
  if (normalized === 'accents' || normalized === 'accent-cards') return 'accent';
  return (DASHBOARD_STYLE_IDS as readonly string[]).includes(normalized)
    ? (normalized as DashboardStyleId)
    : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isLight(color: string): boolean {
  return relativeLuminance(color) > 0.45;
}

/**
 * The canvas fill behind the cells. Card-like styles tint it away from the
 * card surface (down on light themes, up on dark ones) so cards read as
 * raised rather than as invisible rectangles on matching paper; flat styles
 * keep the theme background exactly.
 */
export function dashboardCanvasFill(style: DashboardStyleId, theme: Theme): string {
  const background = theme.colors.background;
  if (style === 'basic' || style === 'panel') return background;
  return isLight(background) ? oklchDarken(background, 0.05) : oklchLighten(background, 0.04);
}

/**
 * The accent color for cell `index`. Styles that show an accent rotate
 * through the theme's own `colorSchemes` (insertion order — the same
 * vocabulary page mode's `accentRotation` rotates), falling back to the
 * palette's primary when a theme declares no schemes.
 */
export function dashboardCellAccent(theme: Theme, index: number): string {
  const schemes = Object.values(theme.colorSchemes ?? {});
  if (schemes.length === 0) return theme.colors.primary;
  const scheme = schemes[((index % schemes.length) + schemes.length) % schemes.length];
  return scheme.accent || scheme.text || theme.colors.primary;
}

/** Resolved per-style metrics for one cell, in canvas units. */
interface CellMetrics {
  /** Ring between the layout cell and the card, leaving room for elevation. */
  edge: number;
  /** Card corner radius. */
  radius: number;
}

function cellMetrics(style: DashboardStyleId, theme: Theme, rect: LayerRect): CellMetrics {
  const minAxis = Math.max(1, Math.min(rect.width, rect.height));
  const themeRadius = theme.style?.borderRadius ?? 14;
  if (style === 'panel') {
    return {
      edge: clamp(minAxis * 0.014, 3, 12),
      radius: clamp(themeRadius * 0.45, 0, minAxis * 0.05),
    };
  }
  return {
    // Card styles reserve a wider ring: the elevation is painted inside the
    // layout cell (a cell renders as its own clipped SVG), so the shadow
    // needs room to fall without being cut flat at the cell boundary.
    edge: clamp(minAxis * 0.03, 6, 26),
    radius: clamp(themeRadius, 6, minAxis * 0.1),
  };
}

/**
 * A CSS `border-radius` string in PERCENTAGES of the box it applies to.
 * Percent radii scale with the rendered canvas at every size (the whole
 * dashboard is aspect-locked), and the separate horizontal/vertical
 * percentages keep the corner circular on a non-square box.
 */
function radiusPct(radius: number, box: LayerRect): string | undefined {
  if (radius <= 0) return undefined;
  const x = Math.round((radius / Math.max(1, box.width)) * 100000) / 1000;
  const y = Math.round((radius / Math.max(1, box.height)) * 100000) / 1000;
  return `${x}% / ${y}%`;
}

/** The chrome + geometry a style contributes to one cell. */
export interface DashboardCellChrome {
  /** Card rect in canvas units (the block fills exactly this box). */
  cardRect: LayerRect;
  /** Box the block renders into — identical to {@link cardRect}. */
  contentRect: LayerRect;
  /** Chrome layers painted BEHIND the block, in cell-local coordinates. */
  layers: Layer[];
  /**
   * Chrome layers painted ON TOP of the block, in card-local coordinates
   * (origin at the card rect, so a host can clip them with the card's own
   * radius). Borders and accents live here: a template that paints its own
   * opaque surface would otherwise bury them.
   */
  overlayLayers: Layer[];
  /** Card corner radius in canvas units. */
  radius: number;
  /** CSS `border-radius` for the CONTENT box, percentage-based. */
  contentRadiusPct?: string;
}

/**
 * Build one cell's chrome. Returns null for `basic`, which paints nothing
 * and leaves the block filling the layout's rect exactly as before.
 *
 * The block fills the CARD, rather than sitting in a padded well inside it:
 * templates already carry their own internal padding, and many paint an
 * opaque surface or gradient of their own. Letting that surface BE the card
 * face is what keeps a card from reading as a box inside a box; the chrome
 * contributes the elevation behind it and the border/accent over it.
 *
 * Elevation is drawn as stacked translucent rects rather than an SVG blur
 * filter: it stays vector-pure, rasterizes identically in the player and in
 * headless capture, and costs three shapes.
 */
export function buildDashboardCellChrome(
  style: DashboardStyleId,
  options: { theme: Theme; rect: LayerRect; index: number },
): DashboardCellChrome | null {
  const { theme, rect, index } = options;
  if (style === 'basic') return null;

  const { edge, radius } = cellMetrics(style, theme, rect);
  const cardRect: LayerRect = {
    x: rect.x + edge,
    y: rect.y + edge,
    width: Math.max(1, rect.width - edge * 2),
    height: Math.max(1, rect.height - edge * 2),
  };
  // Local (cell-relative) card box the chrome layers are drawn in.
  const local: LayerRect = {
    x: edge,
    y: edge,
    width: cardRect.width,
    height: cardRect.height,
  };
  const minAxis = Math.max(1, Math.min(rect.width, rect.height));
  const hairline = Math.max(1, Math.round(minAxis * 0.004));
  const accent = dashboardCellAccent(theme, index);
  const layers: Layer[] = [];

  if (style !== 'panel') {
    // Elevation: three progressively wider, fainter, lower rects — a blur
    // approximated in plain vector shapes so the player and headless
    // capture rasterize it identically. `spread + dy <= edge` on every
    // step keeps the whole falloff inside the cell (a cell renders as its
    // own clipped SVG, so anything outside would be cut flat).
    const steps = [
      { spread: 0.45, dy: 0.5, alpha: 0.05 },
      { spread: 0.25, dy: 0.42, alpha: 0.05 },
      { spread: 0.08, dy: 0.3, alpha: 0.06 },
    ];
    steps.forEach((step, stepIndex) => {
      const spread = edge * step.spread;
      const dy = edge * step.dy;
      layers.push({
        type: 'shape',
        id: `cell-shadow-${stepIndex}`,
        content: {
          shape: 'rect',
          fill: withAlpha(theme.colors.text, step.alpha),
          borderRadius: radius + spread,
        },
        position: {
          x: local.x - spread,
          y: local.y - spread + dy,
          width: local.width + spread * 2,
          height: local.height + spread * 2,
        },
      });
    });
  }

  // The card face. A block that paints its own surface covers this
  // entirely (by design); it is what shows through for the many templates
  // whose theme-background backdrop `stripBlockBackdropLayer` removes.
  layers.push({
    type: 'shape',
    id: 'cell-surface',
    content: {
      shape: 'rect',
      // The surface stays the theme background; the canvas is what moves
      // (see `dashboardCanvasFill`), so cards read as raised paper in both
      // light and dark themes without inventing a palette slot.
      fill: theme.colors.background,
      borderRadius: radius,
    },
    position: { x: local.x, y: local.y, width: local.width, height: local.height },
  });

  // ── Overlays: card-local, so the host can clip them with the card's own
  //    corner radius. Drawn over the block, which may be fully opaque.
  const overlayLayers: Layer[] = [];
  if (style === 'accent') {
    // A wash rather than a saturated fill: the block's own text keeps the
    // contrast it was designed for against the theme background.
    overlayLayers.push({
      type: 'shape',
      id: 'cell-accent-wash',
      content: { shape: 'rect', fill: withAlpha(accent, 0.1), borderRadius: radius },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });
  }
  if (style === 'accent' || style === 'panel') {
    // A header stripe across the top of the card. The overlay box is
    // clipped to the card radius by the host, so the bar's own square ends
    // land outside the visible corner.
    const barHeight = Math.max(2, Math.round(minAxis * 0.014));
    overlayLayers.push({
      type: 'shape',
      id: 'cell-accent-bar',
      content: { shape: 'rect', fill: accent },
      position: { x: 0, y: 0, width: '100%', height: barHeight },
    });
  }
  // The border rides on top for the same reason: an opaque template
  // surface would otherwise bury a stroke drawn on the card face. Inset by
  // half the stroke so the whole line stays inside the clip box.
  const strokeWidth = style === 'panel' ? hairline : Math.max(1, hairline * 0.6);
  overlayLayers.push({
    type: 'shape',
    id: 'cell-border',
    content: {
      shape: 'rect',
      fill: 'none',
      stroke: style === 'panel' ? withAlpha(accent, 0.45) : withAlpha(theme.colors.text, 0.14),
      strokeWidth,
      borderRadius: radius,
    },
    position: {
      x: strokeWidth / 2,
      y: strokeWidth / 2,
      width: Math.max(1, local.width - strokeWidth),
      height: Math.max(1, local.height - strokeWidth),
    },
  });

  const chrome: DashboardCellChrome = {
    cardRect,
    // The block fills the card: templates bring their own padding, and a
    // padded well inside the card reads as a box inside a box.
    contentRect: cardRect,
    layers,
    overlayLayers,
    radius,
  };
  const contentRadius = radiusPct(radius, cardRect);
  if (contentRadius) chrome.contentRadiusPct = contentRadius;
  return chrome;
}

/**
 * Whether a block's own full-bleed theme-background layer should be
 * dropped in this style. Card-like styles paint the surface themselves, so
 * an opaque backdrop from the template would hide the card's tint and
 * square off its corners. Only a fill that exactly matches the theme
 * background is ever dropped — a template's accent or gradient backdrop is
 * authored intent and stays.
 */
export function stripsBlockBackdrop(style: DashboardStyleId): boolean {
  return style !== 'basic';
}

/**
 * Remove a leading full-bleed rect whose fill is exactly the theme
 * background. Matches `createBackgroundLayer`'s output shape.
 */
export function stripBlockBackdropLayer(layers: readonly Layer[], theme: Theme): Layer[] {
  const first = layers[0];
  if (!first || first.type !== 'shape') return [...layers];
  const { content, position } = first;
  const fill = typeof content.fill === 'string' ? content.fill.trim().toLowerCase() : '';
  const fullBleed =
    content.shape === 'rect' &&
    (position.x === 0 || position.x === '0%') &&
    (position.y === 0 || position.y === '0%') &&
    position.width === '100%' &&
    position.height === '100%';
  if (!fullBleed || content.gradient || content.pattern) return [...layers];
  if (fill !== theme.colors.background.trim().toLowerCase()) return [...layers];
  return layers.slice(1);
}
