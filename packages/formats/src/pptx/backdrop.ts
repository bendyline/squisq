/**
 * Slide backdrops → PowerPoint backgrounds, slide layouts and the master.
 *
 * Templates paint their background as ordinary layers — a full-bleed `bg`
 * rect, a tint over it, a theme vignette or pattern on top of everything.
 * Exported as shapes, those land on every slide as full-slide rectangles
 * that swallow clicks meant for the content (the ones on top block it
 * outright). PowerPoint has a place for each of them instead, drawn in a
 * fixed order: the background, then the master's shapes, then the layout's,
 * then the slide's. So a slide's paint is split into
 *
 * - a **base**: the topmost opaque full-bleed paint — anything under it is
 *   invisible and dropped — which becomes a native background;
 * - **overlays**: translucent full-bleed paint above the base, which become
 *   shapes on a slide layout (or, shared by every slide, on the master),
 *   where they show on the slide but cannot be selected there;
 * - the slide's **content**, which alone stays on the slide.
 *
 * Full-bleed atmosphere drawn ABOVE the content (a theme vignette or
 * pattern) moves under it: on a slide it would sit on top of every shape and
 * intercept every click, and translucent paint reads nearly the same either
 * side of the text.
 */

import type { Block, ImageLayer, Layer, ShapeLayer, ShapePattern } from '@bendyline/squisq/schemas';
import { TEMPLATE_METADATA } from '@bendyline/squisq/doc';
import { isSvgImageSource } from '@bendyline/squisq/markdown';
import {
  blendOver,
  cssGradientToString,
  isOpaqueGradient,
  parseCssColor,
  parseCssGradient,
  type CssGradient,
  type ParsedColor,
} from './cssPaint.js';
import { resolveLayerRect } from './geometry.js';

/** Paint a layout, the master or a slide draws as its native background. */
export type BackdropBase = ShapeLayer | ImageLayer;

export interface SlideBackdrop {
  /** The opaque full-bleed paint everything sits on, or null when there is none. */
  base: BackdropBase | null;
  /** Translucent full-bleed paint above the base, bottom to top. */
  overlays: ShapeLayer[];
  /** The slide's own layers, in stacking order. */
  content: Layer[];
}

const FULL_BLEED_TOLERANCE_PX = 1;

function coversCanvas(layer: Layer): boolean {
  if (layer.position.width == null || layer.position.height == null) return false;
  const rect = resolveLayerRect(layer.position, 1920, 1080);
  return (
    rect.x <= FULL_BLEED_TOLERANCE_PX &&
    rect.y <= FULL_BLEED_TOLERANCE_PX &&
    rect.x + rect.width >= 1920 - FULL_BLEED_TOLERANCE_PX &&
    rect.y + rect.height >= 1080 - FULL_BLEED_TOLERANCE_PX
  );
}

/** A plain full-bleed rect: no stroke, no rounded corners — paint, not a shape. */
function isPaintRect(layer: Layer): layer is ShapeLayer {
  if (layer.type !== 'shape' || layer.content.shape !== 'rect') return false;
  if (layer.content.borderRadius) return false;
  if (layer.content.stroke && (layer.content.strokeWidth ?? 1) > 0) return false;
  return coversCanvas(layer);
}

/**
 * A full-bleed photo that fills the frame (`cover`/`fill`; `contain`
 * letterboxes). One with no source draws nothing in the player; it counts
 * as backdrop so it is dropped rather than exported as a slide-sized
 * "[Image]" placeholder.
 */
function isPhotoBackdrop(layer: Layer): layer is ImageLayer {
  return (
    layer.type === 'image' &&
    (!layer.content.src || layer.content.fit === 'cover' || layer.content.fit === 'fill') &&
    !(layer.content.src && isSvgImageSource(layer.content.src)) &&
    coversCanvas(layer)
  );
}

function isOpaqueColor(color: string | undefined, opacity: number | undefined): boolean {
  if (!color || color === 'none' || color === 'transparent') return false;
  return parseCssColor(color, '000000').alpha >= 100000 && (opacity ?? 1) >= 1;
}

/** Whether a backdrop layer hides everything beneath it. */
function isOpaquePaint(layer: ShapeLayer | ImageLayer): boolean {
  if (layer.type === 'image') return !!layer.content.src;
  const { fill, fillOpacity, gradient, pattern, filter } = layer.content;
  if (pattern || filter) return false;
  if (gradient) {
    return isOpaqueColor(gradient.from, fillOpacity) && isOpaqueColor(gradient.to, fillOpacity);
  }
  if (fill?.includes('gradient(')) {
    const parsed = parseCssGradient(fill);
    return !!parsed && isOpaqueGradient(parsed) && (fillOpacity ?? 1) >= 1;
  }
  return isOpaqueColor(fill, fillOpacity);
}

/** Film grain is an SVG turbulence filter; DrawingML has nothing to draw it with. */
function isDrawable(layer: ShapeLayer): boolean {
  return layer.content.filter?.type !== 'noise';
}

type Paint =
  | { kind: 'solid'; color: ParsedColor }
  | { kind: 'gradient'; gradient: CssGradient }
  | { kind: 'pattern'; pattern: ShapePattern };

const CLEAR: ParsedColor = { hex: '000000', alpha: 0 };

/** A paint rect's paint, with its fill opacity folded into alpha; null when unreadable. */
function layerPaint(layer: ShapeLayer): Paint | null {
  const { fill, fillOpacity, gradient, pattern } = layer.content;
  const factor = Math.max(0, Math.min(1, fillOpacity ?? 1));
  const fade = (color: ParsedColor): ParsedColor => ({
    hex: color.hex,
    alpha: Math.round(color.alpha * factor),
  });
  if (pattern) return { kind: 'pattern', pattern };
  if (gradient) {
    // `LinearGradient` measures 0 as top→bottom and 90 as left→right: CSS 180 − angle.
    return {
      kind: 'gradient',
      gradient: {
        kind: 'linear',
        angle: 180 - (gradient.angle ?? 0),
        stops: [
          { position: 0, color: fade(parseCssColor(gradient.from, '000000')) },
          { position: 1, color: fade(parseCssColor(gradient.to, '000000')) },
        ],
      },
    };
  }
  if (!fill || fill === 'none' || fill === 'transparent') return { kind: 'solid', color: CLEAR };
  if (fill.includes('gradient(')) {
    const parsed = parseCssGradient(fill);
    if (!parsed) return null;
    const stops = parsed.stops.map((stop) => ({ ...stop, color: fade(stop.color) }));
    return { kind: 'gradient', gradient: { ...parsed, stops } };
  }
  return { kind: 'solid', color: fade(parseCssColor(fill, '000000')) };
}

/**
 * Flatten a base and the translucent paint over it into ONE opaque paint —
 * a native background with no shapes over it — when at most one layer in
 * the stack varies across the frame (a gradient tint, a vignette, a
 * pattern). The varying layer keeps its geometry; every stop (or a
 * pattern's ink and ground) is the whole stack composited at that point.
 * CSS blends gradients in premultiplied alpha, so compositing at the stops
 * and interpolating the opaque results draws the same picture. Two
 * gradients of different geometry cannot share stops, so they stay apart.
 */
export function compositeBackdrop(
  base: ShapeLayer,
  overlays: readonly ShapeLayer[],
): ShapeLayer | null {
  const paints = [base, ...overlays].map(layerPaint);
  if (paints.some((paint) => paint === null)) return null;
  const stack = paints as Paint[];
  const varying = stack.filter((paint) => paint.kind !== 'solid');
  if (varying.length > 1 || stack[0]!.kind === 'pattern') return null;

  const uniform = (paint: Paint): ParsedColor => (paint.kind === 'solid' ? paint.color : CLEAR);
  const fold = (sample: (paint: Paint) => ParsedColor): string =>
    stack.reduce((under, paint) => blendOver(under, sample(paint)), '000000');
  const only = varying[0];

  let content: ShapeLayer['content'];
  if (!only) {
    content = { shape: 'rect', fill: `#${fold(uniform)}` };
  } else if (only.kind === 'gradient') {
    const stops = only.gradient.stops.map((stop) => ({
      position: stop.position,
      color: {
        hex: fold((paint) => (paint === only ? stop.color : uniform(paint))),
        alpha: 100000,
      },
    }));
    content = { shape: 'rect', fill: cssGradientToString({ ...only.gradient, stops }) };
  } else {
    const ink = parseCssColor(only.pattern.color, 'FFFFFF');
    ink.alpha = Math.round(ink.alpha * Math.max(0, Math.min(1, only.pattern.opacity ?? 1)));
    content = {
      shape: 'rect',
      // The ground under the motif, and the motif's ink over that ground.
      fill: `#${fold(uniform)}`,
      pattern: {
        ...only.pattern,
        color: `#${fold((paint) => (paint === only ? ink : uniform(paint)))}`,
        opacity: 1,
      },
    };
  }
  return { ...base, content };
}

/** Split one slide's layer stack into its base paint, overlays and content. */
export function splitSlideBackdrop(layers: readonly Layer[]): SlideBackdrop {
  let start = 0;
  while (
    start < layers.length &&
    (isPaintRect(layers[start]!) || isPhotoBackdrop(layers[start]!))
  ) {
    start++;
  }
  // Translucent atmosphere painted over everything (a vignette, a pattern).
  let end = layers.length;
  while (end > start) {
    const layer = layers[end - 1]!;
    if (!isPaintRect(layer) || isOpaquePaint(layer)) break;
    end--;
  }

  const under = layers.slice(0, start) as BackdropBase[];
  let baseIndex = -1;
  for (let index = under.length - 1; index >= 0; index--) {
    if (isOpaquePaint(under[index]!)) {
      baseIndex = index;
      break;
    }
  }
  const overlays = [...under.slice(baseIndex + 1), ...layers.slice(end)].filter(
    (layer): layer is ShapeLayer => layer.type === 'shape' && isDrawable(layer),
  );
  return {
    base: baseIndex >= 0 ? under[baseIndex]! : null,
    overlays,
    content: layers.slice(start, end),
  };
}

/**
 * Fold as much of the paint over a base into it as composites cleanly —
 * the longest run of overlays from the bottom — and leave the rest as
 * overlays, still above it in their own order.
 */
function compositeAsFarAsPossible(
  base: BackdropBase | null,
  overlays: ShapeLayer[],
): { base: BackdropBase | null; overlays: ShapeLayer[] } {
  if (base?.type !== 'shape') return { base, overlays };
  for (let count = overlays.length; count > 0; count--) {
    const flat = compositeBackdrop(base, overlays.slice(0, count));
    if (flat) return { base: flat, overlays: overlays.slice(count) };
  }
  return { base, overlays };
}

/** What a layer paints, ignoring its id — two slides' identical paint compares equal. */
export function paintSignature(layer: Layer): string {
  const { id: _id, animation: _animation, ...rest } = layer as Layer & { animation?: unknown };
  return JSON.stringify(rest);
}

export interface DeckLayout {
  /** The layout's name, as PowerPoint's Layout menu shows it. */
  name: string;
  /** The layout's own background paint, or null to inherit the master's. */
  base: ShapeLayer | null;
  /** Overlay paint drawn as layout shapes, bottom to top. */
  overlays: ShapeLayer[];
}

export interface SlidePlan {
  /** Index into {@link DeckBackdropPlan.layouts}. */
  layout: number;
  /** Paint drawn as this slide's own background, or null to inherit its layout's. */
  base: BackdropBase | null;
  content: Layer[];
}

export interface DeckBackdropPlan {
  master: { base: ShapeLayer | null; overlays: ShapeLayer[] };
  layouts: DeckLayout[];
  slides: SlidePlan[];
}

/** A flat colour — the simplest paint, and the one a tie should go to. */
function isSolidPaint(layer: ShapeLayer): boolean {
  const { fill, gradient, pattern } = layer.content;
  return !gradient && !pattern && !fill?.includes('gradient(');
}

/**
 * The most frequent paint. A tie goes to a solid colour over a gradient or
 * pattern: the plain colour is the better default for everything to inherit,
 * and the fancier paint then sits on its own layout.
 */
function mostCommonPaint(items: readonly ShapeLayer[]): ShapeLayer | null {
  const counts = new Map<string, { item: ShapeLayer; count: number }>();
  for (const item of items) {
    const entry = counts.get(paintSignature(item));
    if (entry) entry.count++;
    else counts.set(paintSignature(item), { item, count: 1 });
  }
  let best: { item: ShapeLayer; count: number } | null = null;
  for (const entry of counts.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && isSolidPaint(entry.item) && !isSolidPaint(best.item))
    ) {
      best = entry;
    }
  }
  return best?.item ?? null;
}

function layoutLabel(block: Block): string {
  if (block.template) return TEMPLATE_METADATA[block.template]?.label ?? block.template;
  return block.id === 'cover-block' ? 'Cover' : 'Slide';
}

/**
 * Decide where each slide's paint lives:
 *
 * - the **master** takes the deck's most common base, and the theme's
 *   persistent atmosphere when every slide carries it — as master shapes, so
 *   it shows over every layout's background and is edited in one place;
 * - one **layout** per template look (same template, same overlays) takes
 *   that look's base when it differs from the master's, composited with as
 *   much of the look's tint as flattens into it, and any remaining overlays;
 * - a **slide** keeps a base of its own only when it differs from its
 *   layout's — a full-bleed photo, or a colour the template varies per slide.
 */
export function planDeckBackdrops(blocks: readonly Block[]): DeckBackdropPlan {
  const raw = blocks.map((block) => splitSlideBackdrop(block.layers ?? []));

  // Theme atmosphere every slide shares belongs to the master. Matching by
  // paint rather than id keeps a per-slide opt-out on its own slides.
  let masterOverlays = (raw[0]?.overlays ?? []).filter(
    (overlay) =>
      overlay.id.startsWith('persistent-') &&
      raw.every((slide) =>
        slide.overlays.some((other) => paintSignature(other) === paintSignature(overlay)),
      ),
  );
  const masterSignatures = new Set(masterOverlays.map(paintSignature));
  const split = raw.map((slide) => ({
    ...compositeAsFarAsPossible(
      slide.base,
      slide.overlays.filter((overlay) => !masterSignatures.has(paintSignature(overlay))),
    ),
    content: slide.content,
  }));
  const slideOverlays = split.map((slide) => slide.overlays);

  const paintBases = split
    .map((slide) => slide.base)
    .filter((base): base is ShapeLayer => base?.type === 'shape');
  let masterBase = mostCommonPaint(paintBases);
  const masterBaseSignature = masterBase ? paintSignature(masterBase) : null;

  const layouts: DeckLayout[] = [];
  const layoutKeys = new Map<string, number>();
  const groups: number[][] = [];
  blocks.forEach((block, index) => {
    const key = `${layoutLabel(block)}\u0000${slideOverlays[index]!.map(paintSignature).join('\u0000')}`;
    let layout = layoutKeys.get(key);
    if (layout === undefined) {
      layout = layouts.length;
      layoutKeys.set(key, layout);
      const label = layoutLabel(block);
      const taken = layouts.filter((existing) => existing.name.replace(/ \d+$/, '') === label);
      layouts.push({
        name: taken.length ? `${label} ${taken.length + 1}` : label,
        base: null,
        overlays: slideOverlays[index]!,
      });
      groups.push([]);
    }
    groups[layout]!.push(index);
  });

  const slides: SlidePlan[] = blocks.map(() => ({ layout: 0, base: null, content: [] }));
  groups.forEach((members, layoutIndex) => {
    const layout = layouts[layoutIndex]!;
    const groupBase = mostCommonPaint(
      members
        .map((index) => split[index]!.base)
        .filter((base): base is ShapeLayer => base?.type === 'shape'),
    );
    if (groupBase && paintSignature(groupBase) !== masterBaseSignature) layout.base = groupBase;
    const inherited = layout.base ?? masterBase;
    const inheritedSignature = inherited ? paintSignature(inherited) : null;
    for (const index of members) {
      const { base, content } = split[index]!;
      slides[index] = {
        layout: layoutIndex,
        base: base && paintSignature(base) !== inheritedSignature ? base : null,
        content,
      };
    }
  });

  // When nothing overrides the master's background, its atmosphere can be
  // part of that background rather than shapes over it.
  if (
    masterBase &&
    masterOverlays.length > 0 &&
    layouts.every((layout) => !layout.base) &&
    slides.every((slide) => !slide.base)
  ) {
    const flat = compositeBackdrop(masterBase, masterOverlays);
    if (flat) {
      masterBase = flat;
      masterOverlays = [];
    }
  }

  return { master: { base: masterBase, overlays: masterOverlays }, layouts, slides };
}
