/**
 * Concept templates — `cards`, `process`, `cycle` and `layers`, and the kit
 * (lockup, type ramp, motion) the later ones in `conceptShapes.ts` share.
 *
 * Three ways to show a handful of related ideas as a picture of how they
 * relate rather than as a list: side-by-side cards for parallel ideas, a
 * numbered track for an ordered process, and a ring for a cycle that comes
 * back to its start. They share one type ramp and one grid, so a deck that
 * mixes them reads as one design: the same headline lockup, the same label
 * and detail sizes, and the theme's highlight as the accent. A slide sizes
 * all of its items together, so every card or stage on it sets in one size.
 *
 * Each item is plain text, optionally `Label: detail` (or `Label — detail`):
 * the label sets bold above its detail. Every item is one build step — its
 * shapes and words share `buildStep` — so a building slide reveals the ideas
 * one at a time, and a dynamic deck times them to the narration.
 */

import type {
  Animation,
  Layer,
  PathLayer,
  Position,
  ShapeLayer,
  TextLayer,
} from '../../schemas/Doc.js';
import type {
  CardsBlockInput,
  CycleBlockInput,
  LayersBlockInput,
  ListBlockInput,
  ProcessBlockInput,
  StatHighlightInput,
  TemplateContext,
} from '../../schemas/BlockTemplates.js';
import { pickContrastingText, withAlpha } from '../../schemas/colorUtils.js';
import {
  getMotionProfile,
  getThemeFont,
  motionDelay,
  motionEntrance,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { createBackgroundLayer, estimateProseLineCount, fitProse } from './captionUtils.js';
import { countUpSpecFor } from '../utils/countUp.js';
import { listBlock } from './listBlock.js';
import {
  splitConceptItem,
  splitStatItem,
  timelineItems,
  type ConceptItem,
  type DatedItem,
  type StatItem,
} from './conceptItems.js';

type ConceptInput = CardsBlockInput | ProcessBlockInput | CycleBlockInput | LayersBlockInput;
/** Every template that draws a handful of ideas (`conceptShapes.ts` holds the later ones). */
export type ConceptTemplateName =
  | 'cards'
  | 'process'
  | 'cycle'
  | 'layers'
  | 'stats'
  | 'pyramid'
  | 'funnel'
  | 'hub'
  | 'venn'
  | 'matrix';
/** What the shared lockup draws: a headline in an accent. */
export type Headed = Pick<ConceptInput, 'title' | 'colorScheme'>;

export { splitConceptItem, type ConceptItem } from './conceptItems.js';

const MAX_ITEMS = 6;

// ---- Type ramp (1080p reference; themed per viewport and theme) ----------

const HEADLINE_BASE = 60;
const HEADLINE_MIN = 40;
export const HEADLINE_LINE_HEIGHT = 1.15;
export const LABEL_BASE = 44;
export const DETAIL_BASE = 33;
/** An item without a label sets its words between the two. */
export const PLAIN_BASE = 38;
export const LABEL_LINE_HEIGHT = 1.2;
export const DETAIL_LINE_HEIGHT = 1.4;
/** The smallest the ramp shrinks to before text clamps. */
const MIN_SCALE = 0.62;
/** How far short ideas may grow past the base sizes, and the share of the room they then fill. */
const MAX_SCALE = 1.18;
const GROW_SHARE = 0.9;

export interface Ramp {
  label: number;
  detail: number;
  plain: number;
}

export function ramp(context: TemplateContext, scale: number): Ramp {
  return {
    label: Math.round(themedFontSize(LABEL_BASE, context, false) * scale),
    detail: Math.round(themedFontSize(DETAIL_BASE, context, false) * scale),
    plain: Math.round(themedFontSize(PLAIN_BASE, context, false) * scale),
  };
}

export interface ItemMeasure {
  labelH: number;
  gap: number;
  detailH: number;
  height: number;
}

export function measureItem(item: ConceptItem, sizes: Ramp, width: number): ItemMeasure {
  const labelH = item.label
    ? estimateProseLineCount(item.label, sizes.label, width) * sizes.label * LABEL_LINE_HEIGHT
    : 0;
  const size = item.label ? sizes.detail : sizes.plain;
  const detailH = item.detail
    ? estimateProseLineCount(item.detail, size, width) * size * DETAIL_LINE_HEIGHT
    : 0;
  const gap = item.label && item.detail ? sizes.label * 0.35 : 0;
  // A word wider than its column would break mid-word ("Chlorofluoroca-rbons"):
  // no size that lets it is a fit. Bold display faces run about 0.6em a letter.
  const widest = (text: string, size: number, em: number) =>
    Math.max(0, ...text.split(/\s+/u).map((word) => word.length)) * size * em;
  const overflows =
    widest(item.label, sizes.label, 0.62) > width || widest(item.detail, size, 0.56) > width;
  return { labelH, gap, detailH, height: overflows ? Infinity : labelH + gap + detailH };
}

/**
 * The ramp's steps. A deck's slides each pick one, so across a deck the
 * labels and details set in a handful of sizes rather than a different size
 * on every slide.
 */
const SCALES = [MAX_SCALE, 1, 0.82, MIN_SCALE];

/**
 * The largest ramp step at which every item fits `width` × `height`. Short
 * ideas grow past the base size (to `MAX_SCALE`) while they fill no more than
 * `GROW_SHARE` of the height, so a slide of a few words is not mostly empty.
 */
export function fitRamp(
  items: readonly ConceptItem[],
  context: TemplateContext,
  width: (scale: number) => number,
  height: (scale: number) => number,
): { sizes: Ramp; scale: number } {
  for (const scale of SCALES) {
    const sizes = ramp(context, scale);
    const room = height(scale) * (scale > 1 ? GROW_SHARE : 1);
    if (items.every((item) => measureItem(item, sizes, width(scale)).height <= room))
      return { sizes, scale };
  }
  return { sizes: ramp(context, MIN_SCALE), scale: MIN_SCALE };
}

// ---- Shared lockup -------------------------------------------------------

export interface Frame {
  layers: Layer[];
  accent: string;
  /** Content region the template arranges its items in. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  portrait: boolean;
}

export function accentColor(input: Headed, context: TemplateContext): string {
  return input.colorScheme
    ? resolveColorScheme(context, input.colorScheme).accent
    : context.theme.colors.highlight || context.theme.colors.primary;
}

/** Background, accent rule and headline; returns the region beneath them. */
export function frame(input: Headed, context: TemplateContext): Frame {
  const { theme, viewport } = context;
  const { width: W, height: H } = viewport;
  const portrait = H > W;
  const accent = accentColor(input, context);
  const margin = Math.round(W * (portrait ? 0.08 : 0.07));
  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];
  const title = (input.title ?? '').trim();
  let top = H * 0.1;
  if (title) {
    const headlineTop = H * (portrait ? 0.08 : 0.11);
    const base = themedFontSize(HEADLINE_BASE, context, true);
    const fit = fitProse({
      text: title,
      baseFontSize: base,
      minFontSize: Math.min(base, themedFontSize(HEADLINE_MIN, context, true)),
      maxWidthPx: W - margin * 2,
      maxHeightPx: base * HEADLINE_LINE_HEIGHT * 2,
      lineHeight: HEADLINE_LINE_HEIGHT,
    });
    const ruleH = Math.max(4, Math.round(H * 0.006));
    layers.push({
      type: 'shape',
      id: 'accent-rule',
      position: {
        x: margin,
        y: headlineTop - ruleH - fit.fontSize * 0.55,
        width: W * 0.045,
        height: ruleH,
      },
      content: { shape: 'rect', fill: accent, borderRadius: ruleH / 2 },
      animation: entrance(context, 'rule', 0),
    });
    layers.push({
      ...textLayer('title', title, box(margin, headlineTop, W - margin * 2, fit.heightPx), {
        fontSize: fit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        lineHeight: HEADLINE_LINE_HEIGHT,
        shadow: shouldUseShadow(context),
        ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
      }),
      animation: entrance(context, 'text', 0.1),
    });
    top = headlineTop + fit.heightPx + H * (portrait ? 0.05 : 0.07);
  }
  return {
    layers,
    accent,
    left: margin,
    right: W - margin,
    top,
    bottom: H * (portrait ? 0.92 : 0.9),
    portrait,
  };
}

/** A top-aligned text box spanning `left`…`left + width` from `top`. */
export function box(left: number, top: number, width: number, height: number): Position {
  return { x: left + width / 2, y: top + height / 2, width, height, anchor: 'center' };
}

export function textLayer(
  id: string,
  text: string,
  position: Position,
  style: Omit<TextLayer['content']['style'], 'textAlign'> & {
    textAlign?: 'left' | 'center' | 'right';
  },
): TextLayer {
  return {
    type: 'text',
    id,
    position,
    content: {
      text,
      style: { textAlign: 'left', verticalAlign: 'top', shrinkToFit: true, ...style },
    },
  };
}

/** The label and detail of one item, stacked from `top` across `width`. */
export function itemText(
  id: string,
  item: ConceptItem,
  measure: ItemMeasure,
  sizes: Ramp,
  left: number,
  top: number,
  width: number,
  align: 'left' | 'center' | 'right',
  context: TemplateContext,
): TextLayer[] {
  const { theme } = context;
  // A little slack below each box: real faces wrap a touch earlier than the estimate.
  const slack = (size: number) => size * 0.4;
  const layers: TextLayer[] = [];
  if (item.label)
    layers.push(
      textLayer(
        `${id}-label`,
        item.label,
        box(left, top, width, measure.labelH + slack(sizes.label)),
        {
          fontSize: sizes.label,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          lineHeight: LABEL_LINE_HEIGHT,
          textAlign: align,
        },
      ),
    );
  if (item.detail) {
    const size = item.label ? sizes.detail : sizes.plain;
    layers.push(
      textLayer(
        `${id}-detail`,
        item.detail,
        box(left, top + measure.labelH + measure.gap, width, measure.detailH + slack(size)),
        {
          fontSize: size,
          fontFamily: getThemeFont(context, 'body'),
          // Details read as secondary by weight and a little transparency, not a
          // muted hue that loses contrast on dark themes.
          color: item.label ? withAlpha(theme.colors.text, 0.8) : theme.colors.text,
          lineHeight: DETAIL_LINE_HEIGHT,
          textAlign: align,
        },
      ),
    );
  }
  return layers;
}

function itemTexts(input: { items?: unknown }): string[] {
  return (Array.isArray(input.items) ? input.items : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

export function itemsOf(input: { items?: unknown }): ConceptItem[] {
  return itemTexts(input).map(splitConceptItem);
}

/**
 * A concept block with no ideas. Under a bare headline it is the headline in
 * its lockup. Over a body that holds no ideas (a table, a quotation) it draws
 * nothing, and the block is shown as content (`materializeBlockLayers`), so
 * the body is kept rather than dropped under the headline.
 */
function withoutIdeas(area: { layers: Layer[] }, context: TemplateContext): Layer[] {
  return context.block?.contents?.length ? [] : area.layers;
}

/**
 * More ideas than a drawing holds. Rather than draw six and drop the rest,
 * the block shows all of them as the list they are (numbered for a process).
 */
export function asListWhenCrowded(
  input: { items?: unknown; title?: string; colorScheme?: string; template: string },
  context: TemplateContext,
): Layer[] | undefined {
  const items = (Array.isArray(input.items) ? input.items : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (items.length <= MAX_ITEMS) return undefined;
  return listBlock(
    {
      ...(input as unknown as Omit<ListBlockInput, 'template' | 'items'>),
      template: 'list',
      items,
      ordered: input.template === 'process',
    },
    context,
  );
}

/** The items of a `stats` block: each a figure and what it measures. */
export function statItemsOf(input: { items?: unknown }): StatItem[] {
  return itemTexts(input).map(splitStatItem);
}

/**
 * The build steps a concept block's items become, named as `blockBuildSteps`
 * names them from the layers (a stage's number, then its label and detail),
 * so a caller can time the reveals before the block is drawn.
 */
export function conceptBuildStepTexts(
  template: ConceptTemplateName,
  items: readonly string[],
): string[] {
  const shown = itemsOf({ items: [...items] });
  // A key number is its figure, the word that scales it, then what it measures.
  // Without a figure among them, key numbers draw (and are named) as cards.
  const stats = template === 'stats' ? statItemsOf({ items: [...items] }) : [];
  if (stats.some((stat) => stat.figure))
    return stats.map((stat) => {
      const { number, unit } = splitFigure(stat.figure);
      return [number, unit, stat.caption].filter(Boolean).join(' ');
    });
  if (template !== 'process' && template !== 'cycle')
    return shown.map((item) => [item.label, item.detail].filter(Boolean).join(' '));
  // A process of dated stages draws as a timeline: each station is its date,
  // then its words. A cycle too short or too wordy for a ring draws as a process.
  const asProcess = template === 'process' || cycleDrawsAsProcess(shown);
  const dated = asProcess ? timelineItems(shown) : undefined;
  if (dated)
    return dated.map((item) => [item.when, item.label, item.detail].filter(Boolean).join(' '));
  // A cycle of one item draws as a process.
  return shown.map((item, index) =>
    [String(index + 1), item.label, item.detail].filter(Boolean).join(' '),
  );
}

// ---- Motion --------------------------------------------------------------

/** When the first item enters, and the seconds between items, on a block that does not build. */
export const FIRST_TURN = 0.6;
export const TURN_STAGGER = 0.45;
export const SETTLE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * How a layer enters: words rise (or, for a statement, arrive word by word),
 * cards lift, rules and bars grow, badges pop, connectors draw.
 */
export type Entrance = 'text' | 'words' | 'surface' | 'rule' | 'bar' | 'pop' | 'draw';

/** One layer of an item, with how it enters and when (seconds into the item's turn). */
export type Part = [layer: Layer, entrance: Entrance, at: number];

/**
 * A layer's entrance. Profiles that build diagrams draw connectors on, pop
 * badges and grow rules, so each idea assembles as it arrives; `calm` fades
 * everything in, as squisq's other templates do.
 */
export function entrance(context: TemplateContext, kind: Entrance, delay: number): Animation {
  const profile = getMotionProfile(context);
  if (kind === 'text' || !profile.diagramBuild)
    return motionEntrance(context, { type: 'fadeIn', duration: 0.7, delay });
  const at = motionDelay(context, delay);
  switch (kind) {
    case 'words':
      return { type: 'wordReveal', duration: 0.5, stagger: 0.07, delay: at, easing: SETTLE };
    case 'surface':
      return { type: 'fadeInUp', duration: 0.6, delay: at, easing: SETTLE };
    case 'rule':
      return { type: 'grow', origin: 'left', duration: 0.55, delay: at, easing: SETTLE };
    case 'bar':
      return { type: 'grow', origin: 'top', duration: 0.6, delay: at, easing: SETTLE };
    case 'pop':
      return {
        type: 'grow',
        origin: 'center',
        duration: 0.5,
        delay: at,
        easing:
          profile.name === 'vibrant'
            ? 'cubic-bezier(0.34, 1.56, 0.64, 1)'
            : 'cubic-bezier(0.34, 1.3, 0.64, 1)',
      };
    case 'draw':
      return { type: 'drawOn', duration: 0.5, delay: at, easing: 'ease-in-out' };
  }
}

/**
 * Tag an item's layers as one build step, each entering on its cue in the
 * item's turn. A building block times the turn from the step's reveal.
 */
export function step(parts: readonly Part[], index: number, context: TemplateContext): Layer[] {
  const turn = FIRST_TURN + index * TURN_STAGGER;
  return parts.map(([layer, kind, at]) => ({
    ...layer,
    buildStep: index,
    animation: entrance(context, kind, turn + at),
  }));
}

/** A badge's disc and number pop together. */
export function pops(layers: readonly Layer[], at: number): Part[] {
  return layers.map((layer): Part => [layer, 'pop', at]);
}

/** An item's label and detail as parts, the detail a beat after its label. */
export function words(layers: readonly TextLayer[], at: number): Part[] {
  return layers.map((layer, i): Part => [layer, 'text', at + i * 0.12]);
}

// ---- cards ---------------------------------------------------------------

const LEAD_BASE = 44;
const LEAD_MIN = 28;
const LEAD_LINE_HEIGHT = 1.4;

/** One unlabelled idea: a lead paragraph beside an accent bar, not a lone card. */
function lead(area: Frame, text: string, context: TemplateContext): Layer[] {
  const { theme, viewport } = context;
  const barW = Math.max(5, Math.round(viewport.width * 0.004));
  const indent = barW + Math.round(viewport.width * 0.018);
  const width = (area.right - area.left) * (area.portrait ? 1 : 0.8) - indent;
  // A short lead sets larger, so one sentence does not sit small in an empty frame.
  const base = themedFontSize(
    text.length <= 90 ? LEAD_BASE * 1.3 : text.length <= 160 ? LEAD_BASE * 1.15 : LEAD_BASE,
    context,
    false,
  );
  const fit = fitProse({
    text,
    baseFontSize: base,
    minFontSize: Math.min(base, themedFontSize(LEAD_MIN, context, false)),
    maxWidthPx: width,
    maxHeightPx: (area.bottom - area.top) * 0.9,
    lineHeight: LEAD_LINE_HEIGHT,
  });
  const top = area.top + Math.max(0, (area.bottom - area.top - fit.heightPx) * 0.25);
  return [
    ...area.layers,
    ...step(
      [
        [
          {
            type: 'shape',
            id: 'lead-bar',
            position: {
              x: area.left,
              y: top + fit.fontSize * 0.2,
              width: barW,
              height: fit.heightPx - fit.fontSize * 0.3,
            },
            content: { shape: 'rect', fill: area.accent, borderRadius: barW / 2 },
          },
          'bar',
          0,
        ],
        [
          textLayer(
            'lead',
            text,
            box(area.left + indent, top, width, fit.heightPx + fit.fontSize * 0.4),
            {
              fontSize: fit.fontSize,
              fontFamily: getThemeFont(context, 'body'),
              color: theme.colors.text,
              lineHeight: LEAD_LINE_HEIGHT,
              shadow: shouldUseShadow(context),
              ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
            },
          ),
          'text',
          0.15,
        ],
      ],
      0,
      context,
    ),
  ];
}

const STATEMENT_BASE = 84;
const STATEMENT_MIN = 48;

/**
 * One idea standing alone, without a headline: a display statement in the
 * headline's face, under the accent rule, its words arriving in turn.
 */
function statement(area: Frame, text: string, context: TemplateContext): Layer[] {
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const base = themedFontSize(STATEMENT_BASE, context, true);
  const fit = fitProse({
    text,
    baseFontSize: base,
    minFontSize: Math.min(base, themedFontSize(STATEMENT_MIN, context, true)),
    maxWidthPx: W * (area.portrait ? 1 : 0.86),
    maxHeightPx: H * 0.8,
    lineHeight: HEADLINE_LINE_HEIGHT,
  });
  const top = area.top + Math.max(0, (H - fit.heightPx) / 2);
  const ruleH = Math.max(5, Math.round(viewport.height * 0.007));
  return [
    ...area.layers,
    ...step(
      [
        [
          {
            type: 'shape',
            id: 'statement-rule',
            position: {
              x: area.left,
              y: top - ruleH - fit.fontSize * 0.45,
              width: W * 0.06,
              height: ruleH,
            },
            content: { shape: 'rect', fill: area.accent, borderRadius: ruleH / 2 },
          },
          'rule',
          0,
        ],
        [
          textLayer(
            'statement',
            text,
            box(area.left, top, W * (area.portrait ? 1 : 0.86), fit.heightPx + fit.fontSize * 0.3),
            {
              fontSize: fit.fontSize,
              fontFamily: getThemeFont(context, 'title'),
              fontWeight: 'bold',
              color: theme.colors.text,
              lineHeight: HEADLINE_LINE_HEIGHT,
              shadow: shouldUseShadow(context),
              ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
            },
          ),
          'words',
          0.15,
        ],
      ],
      0,
      context,
    ),
  ];
}

/**
 * Parallel ideas as a row of cards (a 2×2 or 2×3 grid when there are many or
 * they run long; one column in portrait). A single unlabelled idea sets as a
 * lead paragraph under its headline, or as a display statement without one.
 */
export function cardsBlock(input: CardsBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  const area = frame(input, context);
  const { theme, viewport } = context;
  if (!items.length) return withoutIdeas(area, context);
  if (items.length === 1 && !items[0]!.label)
    return (input.title?.trim() ? lead : statement)(area, items[0]!.detail, context);
  // `versus=true` written in a block tag arrives as text.
  const contrast = String(input.versus) === 'true';
  if (contrast && items.length === 2 && !area.portrait) return versus(area, items, context);
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  // Four ideas sit 2×2 (wider cards, larger type) unless they are only a
  // few words each; five or six sit three to a row.
  const brief = items.every((item) => item.label.length + item.detail.length <= 28);
  const columns = area.portrait
    ? 1
    : items.length <= 3
      ? items.length
      : items.length === 4
        ? brief
          ? 4
          : 2
        : 3;
  const rows = Math.ceil(items.length / columns);
  const gap = Math.round(viewport.width * 0.02);
  const cardW = (W - gap * (columns - 1)) / columns;
  const pad = Math.round(Math.min(44, Math.max(26, cardW * 0.08)));
  const ruleH = Math.max(4, Math.round(viewport.height * 0.006));
  const ruleGap = Math.round(viewport.height * 0.022);
  const chrome = pad * 2 + ruleH + ruleGap;
  const { sizes } = fitRamp(
    items,
    context,
    () => cardW - pad * 2,
    () => (H - gap * (rows - 1)) / rows - chrome,
  );
  const measures = items.map((item) => measureItem(item, sizes, cardW - pad * 2));
  const cardH = Math.min(
    (H - gap * (rows - 1)) / rows,
    Math.max(...measures.map((m) => m.height)) + chrome + sizes.detail * 0.4,
  );
  const gridH = rows * cardH + (rows - 1) * gap;
  // Near the headline, so they read as one lockup; spare room falls below.
  const gridTop = area.top + Math.max(0, (H - gridH) * 0.35);
  const layers = [...area.layers];
  items.forEach((item, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, items.length - row * columns);
    // A short last row centres under the full ones.
    const rowLeft = area.left + ((columns - inRow) * (cardW + gap)) / 2;
    const left = rowLeft + (index % columns) * (cardW + gap);
    const top = gridTop + row * (cardH + gap);
    const card: ShapeLayer = {
      type: 'shape',
      id: `card-${index}`,
      position: { x: left, y: top, width: cardW, height: cardH },
      content: {
        shape: 'rect',
        fill: withAlpha(theme.colors.text, 0.06),
        stroke: withAlpha(theme.colors.text, 0.12),
        strokeWidth: 2,
        borderRadius: Math.round(Math.min(cardW, cardH) * 0.06),
      },
    };
    const rule: ShapeLayer = {
      type: 'shape',
      id: `card-${index}-rule`,
      position: { x: left + pad, y: top + pad, width: Math.min(cardW * 0.22, 64), height: ruleH },
      content: { shape: 'rect', fill: area.accent, borderRadius: ruleH / 2 },
    };
    layers.push(
      ...step(
        [
          [card, 'surface', 0],
          [rule, 'rule', 0.2],
          ...words(
            itemText(
              `card-${index}`,
              item,
              measures[index]!,
              sizes,
              left + pad,
              top + pad + ruleH + ruleGap,
              cardW - pad * 2,
              'left',
              context,
            ),
            0.22,
          ),
        ],
        index,
        context,
      ),
    );
  });
  return layers;
}

/**
 * Two ideas set against each other: a panel each, side by side, with a "vs"
 * mark on the seam between them, so the pair reads as one contrast rather
 * than two cards.
 */
function versus(area: Frame, items: readonly ConceptItem[], context: TemplateContext): Layer[] {
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const seam = Math.round(viewport.width * 0.08);
  const panelW = (W - seam) / 2;
  const pad = Math.round(Math.min(56, Math.max(30, panelW * 0.08)));
  const ruleH = Math.max(4, Math.round(viewport.height * 0.006));
  const ruleGap = Math.round(viewport.height * 0.022);
  const chrome = pad * 2 + ruleH + ruleGap;
  const { sizes } = fitRamp(
    items,
    context,
    () => panelW - pad * 2,
    () => H * 0.8 - chrome,
  );
  const measures = items.map((item) => measureItem(item, sizes, panelW - pad * 2));
  const panelH = Math.min(
    H,
    Math.max(...measures.map((m) => m.height)) + chrome + sizes.detail * 0.4,
  );
  const top = area.top + Math.max(0, (H - panelH) * 0.35);
  const mark = Math.round(Math.min(viewport.height * 0.1, seam * 0.85));
  const markFill = area.accent;
  const layers = [...area.layers];
  items.forEach((item, index) => {
    const left = area.left + index * (panelW + seam);
    const radius = Math.round(Math.min(panelW, panelH) * 0.05);
    const parts: Part[] = [
      [
        {
          type: 'shape',
          id: `side-${index}`,
          position: { x: left, y: top, width: panelW, height: panelH },
          content: {
            shape: 'rect',
            fill: withAlpha(theme.colors.text, 0.06),
            stroke: withAlpha(theme.colors.text, 0.12),
            strokeWidth: 2,
            borderRadius: radius,
          },
        },
        'surface',
        0,
      ],
      [
        {
          type: 'shape',
          id: `side-${index}-rule`,
          position: {
            x: left + pad,
            y: top + pad,
            width: Math.min(panelW * 0.22, 64),
            height: ruleH,
          },
          content: { shape: 'rect', fill: area.accent, borderRadius: ruleH / 2 },
        },
        'rule',
        0.15,
      ],
      ...words(
        itemText(
          `side-${index}`,
          item,
          measures[index]!,
          sizes,
          left + pad,
          top + pad + ruleH + ruleGap,
          panelW - pad * 2,
          'left',
          context,
        ),
        0.2,
      ),
    ];
    layers.push(...step(parts, index, context));
  });
  // The mark is not either side's: it pops on the seam as the first side
  // lands, announcing the contrast before the second arrives.
  const cx = area.left + panelW + seam / 2;
  const cy = top + panelH / 2;
  const at = FIRST_TURN + 0.45;
  layers.push(
    {
      type: 'shape',
      id: 'versus-mark',
      position: { x: cx - mark / 2, y: cy - mark / 2, width: mark, height: mark },
      content: { shape: 'circle', fill: markFill },
      animation: entrance(context, 'pop', at),
    },
    {
      type: 'text',
      id: 'versus-mark-text',
      position: { x: cx, y: cy, width: mark, height: mark, anchor: 'center' },
      content: {
        text: 'vs',
        style: {
          fontSize: Math.round(mark * 0.38),
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          fontStyle: 'italic',
          color: pickContrastingText(markFill),
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      },
      animation: entrance(context, 'pop', at),
    },
  );
  return layers;
}

// ---- process -------------------------------------------------------------

export function badge(
  id: string,
  number: number,
  cx: number,
  cy: number,
  diameter: number,
  accent: string,
  context: TemplateContext,
): Layer[] {
  return [
    {
      type: 'shape',
      id,
      position: { x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter },
      content: { shape: 'circle', fill: accent },
    },
    {
      type: 'text',
      id: `${id}-number`,
      position: { x: cx, y: cy, width: diameter, height: diameter, anchor: 'center' },
      content: {
        text: String(number),
        style: {
          fontSize: Math.round(diameter * 0.44),
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: pickContrastingText(accent),
          textAlign: 'center',
          verticalAlign: 'middle',
          baselineShift: 0.04,
        },
      },
    },
  ];
}

/** A line joining two stages; an arrow where it is long enough to carry one. */
export function connector(
  id: string,
  d: string,
  color: string,
  width: number,
  arrow = true,
): PathLayer {
  return {
    type: 'path',
    id,
    position: { x: 0, y: 0, width: '100%', height: '100%' },
    content: {
      d,
      stroke: color,
      strokeWidth: width,
      fill: 'none',
      ...(arrow ? { endMarker: 'arrow' as const } : {}),
    },
  };
}

/**
 * An ordered process: numbered stages on a track joined by arrows. Up to four
 * short stages run across the slide; more, longer ones, or a portrait frame
 * stack down a rail. Stages that each open with a date, in order, are a
 * timeline instead (`timeline`).
 */
export function processBlock(input: ProcessBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  const area = frame(input, context);
  const { viewport } = context;
  if (!items.length) return withoutIdeas(area, context);
  const dated = timelineItems(items);
  if (dated) return timeline(area, dated, context);
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const line = withAlpha(area.accent, 0.75);
  const stroke = Math.max(3, Math.round(viewport.height * 0.004));
  const layers = [...area.layers];
  const across =
    !area.portrait &&
    items.length <= 4 &&
    items.every((item) => item.detail.length <= 110 && item.label.length <= 40);

  if (across) {
    const columnW = W / items.length;
    const diameter = Math.round(Math.min(viewport.height * 0.1, columnW * 0.3));
    const textGap = Math.round(diameter * 0.45);
    const textW = columnW - Math.round(viewport.width * 0.02);
    const { sizes } = fitRamp(
      items,
      context,
      () => textW,
      () => H - diameter - textGap,
    );
    const measures = items.map((item) => measureItem(item, sizes, textW));
    const groupH = diameter + textGap + Math.max(...measures.map((m) => m.height));
    const groupTop = area.top + Math.max(0, (H - groupH) * 0.2);
    const cy = groupTop + diameter / 2;
    items.forEach((item, index) => {
      const cx = area.left + columnW * (index + 0.5);
      const parts: Part[] = [];
      // The arrow from the previous stage draws first, then this stage's badge
      // pops at its head and the words rise beneath it.
      const arrives = index > 0 ? 0.3 : 0;
      if (index > 0) {
        const from = cx - columnW + diameter / 2 + diameter * 0.25;
        const to = cx - diameter / 2 - diameter * 0.25;
        parts.push([
          connector(`step-${index}-arrow`, `M ${from} ${cy} L ${to} ${cy}`, line, stroke),
          'draw',
          0,
        ]);
      }
      parts.push(
        ...pops(badge(`step-${index}`, index + 1, cx, cy, diameter, area.accent, context), arrives),
      );
      parts.push(
        ...words(
          itemText(
            `step-${index}`,
            item,
            measures[index]!,
            sizes,
            cx - textW / 2,
            groupTop + diameter + textGap,
            textW,
            'center',
            context,
          ),
          arrives + 0.18,
        ),
      );
      layers.push(...step(parts, index, context));
    });
    return layers;
  }

  // Down a rail: a badge per stage, its words beside it.
  const diameter = Math.round(Math.min(viewport.height * 0.07, viewport.width * 0.07));
  const textLeft = area.left + diameter + Math.round(viewport.width * 0.022);
  const textW = area.right - textLeft;
  const rowGap = Math.round(viewport.height * 0.028);
  const { sizes } = fitRamp(
    items,
    context,
    () => textW,
    () => (H - rowGap * (items.length - 1)) / items.length,
  );
  const measures = items.map((item) => measureItem(item, sizes, textW));
  const rowH = measures.map((m) => Math.max(diameter, m.height));
  const rowsH = rowH.reduce((sum, h) => sum + h, 0);
  // Spare height opens the rows up (to a limit) so the rail reads as a path.
  const gap =
    items.length > 1
      ? rowGap +
        Math.min(
          viewport.height * 0.05,
          Math.max(0, (H - rowsH - rowGap * (items.length - 1)) * 0.5) / (items.length - 1),
        )
      : 0;
  const totalH = rowsH + gap * (items.length - 1);
  let top = area.top + Math.max(0, (H - totalH) * 0.2);
  const cx = area.left + diameter / 2;
  let previous = 0;
  items.forEach((item, index) => {
    const parts: Part[] = [];
    // The words' first line sits level with the badge.
    const firstLine = item.label
      ? sizes.label * LABEL_LINE_HEIGHT
      : sizes.plain * DETAIL_LINE_HEIGHT;
    const cy = top + Math.max(firstLine, diameter) / 2;
    let arrives = 0;
    if (index > 0) {
      const from = previous + diameter / 2 + diameter * 0.12;
      const to = cy - diameter / 2 - diameter * 0.12;
      if (to > from) {
        parts.push([
          connector(
            `step-${index}-arrow`,
            `M ${cx} ${from} L ${cx} ${to}`,
            line,
            stroke,
            to - from >= diameter * 0.6,
          ),
          'draw',
          0,
        ]);
        arrives = 0.25;
      }
    }
    previous = cy;
    parts.push(
      ...pops(badge(`step-${index}`, index + 1, cx, cy, diameter, area.accent, context), arrives),
    );
    parts.push(
      ...words(
        itemText(
          `step-${index}`,
          item,
          measures[index]!,
          sizes,
          textLeft,
          top,
          textW,
          'left',
          context,
        ),
        arrives + 0.15,
      ),
    );
    layers.push(...step(parts, index, context));
    top += rowH[index]! + gap;
  });
  return layers;
}

// ---- timeline ------------------------------------------------------------

/**
 * Dated stages as stations on a track that draws forward through time: across
 * the slide with each date above its station when they fit, otherwise down
 * it with each date beside its station. The track runs on past the last
 * station, since time does.
 */
function timeline(area: Frame, items: readonly DatedItem[], context: TemplateContext): Layer[] {
  const { viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const n = items.length;
  const dot = Math.max(14, Math.round(viewport.height * 0.026));
  const whenSize = Math.round(themedFontSize(LABEL_BASE, context, true) * 1.1);
  const whenH = whenSize * LABEL_LINE_HEIGHT;
  const gap = Math.round(viewport.height * 0.03);
  const stroke = Math.max(3, Math.round(viewport.height * 0.004));
  const line = withAlpha(area.accent, 0.6);
  const layers = [...area.layers];
  const station = (index: number, cx: number, cy: number): ShapeLayer => ({
    type: 'shape',
    id: `station-${index}`,
    position: { x: cx - dot / 2, y: cy - dot / 2, width: dot, height: dot },
    content: { shape: 'circle', fill: area.accent },
  });
  const whenText = (
    index: number,
    item: DatedItem,
    left: number,
    top: number,
    width: number,
    align: 'left' | 'center' | 'right',
  ) =>
    textLayer(`station-${index}-when`, item.when, box(left, top, width, whenH + whenSize * 0.3), {
      fontSize: whenSize,
      fontFamily: getThemeFont(context, 'title'),
      fontWeight: 'bold',
      color: area.accent,
      lineHeight: LABEL_LINE_HEIGHT,
      textAlign: align,
    });
  const columnW = W / n;
  const across =
    !area.portrait &&
    n <= 5 &&
    items.every((item) => item.detail.length <= 120 && item.label.length <= 40);

  if (across) {
    const textW = columnW - Math.round(viewport.width * 0.02);
    const { sizes } = fitRamp(
      items,
      context,
      () => textW,
      () => H - whenH - dot - gap * 2,
    );
    const measures = items.map((item) => measureItem(item, sizes, textW));
    const groupH = whenH + gap + dot + gap + Math.max(...measures.map((m) => m.height));
    const groupTop = area.top + Math.max(0, (H - groupH) * 0.3);
    const trackY = groupTop + whenH + gap + dot / 2;
    let from = area.left;
    items.forEach((item, index) => {
      const cx = area.left + columnW * (index + 0.5);
      const parts: Part[] = [
        [
          connector(
            `station-${index}-track`,
            `M ${from} ${trackY} L ${cx - dot} ${trackY}`,
            line,
            stroke,
            false,
          ),
          'draw',
          0,
        ],
        [station(index, cx, trackY), 'pop', 0.3],
        [whenText(index, item, cx - textW / 2, groupTop, textW, 'center'), 'text', 0.35],
        ...words(
          itemText(
            `station-${index}`,
            item,
            measures[index]!,
            sizes,
            cx - textW / 2,
            trackY + dot / 2 + gap,
            textW,
            'center',
            context,
          ),
          0.47,
        ),
      ];
      if (index === n - 1)
        parts.push([
          connector(
            'station-tail',
            `M ${cx + dot} ${trackY} L ${area.right} ${trackY}`,
            withAlpha(area.accent, 0.3),
            stroke,
          ),
          'draw',
          0.65,
        ]);
      from = cx + dot;
      layers.push(...step(parts, index, context));
    });
    return layers;
  }

  // Down the slide: dates in a column beside the track, words beyond it.
  const whenW = Math.min(
    W * 0.28,
    Math.max(...items.map((item) => item.when.length)) * whenSize * 0.62 + whenSize * 0.2,
  );
  const trackX = area.left + whenW + gap + dot / 2;
  const textLeft = trackX + dot / 2 + gap;
  const textW = area.right - textLeft;
  const rowGap = Math.round(viewport.height * 0.028);
  const { sizes } = fitRamp(
    items,
    context,
    () => textW,
    () => (H - rowGap * (n - 1)) / n,
  );
  const measures = items.map((item) => measureItem(item, sizes, textW));
  const rowH = measures.map((m) => Math.max(whenH, m.height));
  const rowsH = rowH.reduce((sum, h) => sum + h, 0);
  const spread =
    n > 1
      ? rowGap +
        Math.min(
          viewport.height * 0.05,
          Math.max(0, (H - rowsH - rowGap * (n - 1)) * 0.5) / (n - 1),
        )
      : 0;
  let top = area.top + Math.max(0, (H - rowsH - spread * (n - 1)) * 0.2);
  let from = 0;
  items.forEach((item, index) => {
    const cy = top + whenH / 2;
    const parts: Part[] = [];
    // The track reaches each station from the one before; the first starts it.
    if (index > 0)
      parts.push([
        connector(
          `station-${index}-track`,
          `M ${trackX} ${from} L ${trackX} ${cy - dot}`,
          line,
          stroke,
          false,
        ),
        'draw',
        0,
      ]);
    parts.push(
      [station(index, trackX, cy), 'pop', index > 0 ? 0.3 : 0],
      [whenText(index, item, area.left, top, whenW, 'right'), 'text', 0.35],
      ...words(
        itemText(
          `station-${index}`,
          item,
          measures[index]!,
          sizes,
          textLeft,
          top,
          textW,
          'left',
          context,
        ),
        0.47,
      ),
    );
    from = cy + dot;
    top += rowH[index]! + spread;
    if (index === n - 1)
      parts.push([
        connector(
          'station-tail',
          `M ${trackX} ${from} L ${trackX} ${Math.min(area.bottom, from + spread + whenH)}`,
          withAlpha(area.accent, 0.3),
          stroke,
        ),
        'draw',
        0.65,
      ]);
    layers.push(...step(parts, index, context));
  });
  return layers;
}

// ---- cycle ---------------------------------------------------------------

/** The longest detail a stage on the ring can hold beside it. */
const CYCLE_STAGE_CHARACTERS = 170;

/**
 * A ring needs at least three stages to read as one, and its labels sit in
 * the corners the ring leaves. Two stages, or stages that run to a paragraph
 * each, draw as a process instead, whose rail has the room.
 */
function cycleDrawsAsProcess(items: readonly ConceptItem[]): boolean {
  return items.length < 3 || items.some((item) => item.detail.length > CYCLE_STAGE_CHARACTERS);
}

/**
 * A cycle: stages on a ring, each joined to the next by an arrow and the
 * last back to the first. Labels sit beside their stage, away from the ring.
 */
export function cycleBlock(input: CycleBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  const area = frame(input, context);
  const { viewport } = context;
  if (cycleDrawsAsProcess(items)) return processBlock({ ...input, template: 'process' }, context);
  const H = area.bottom - area.top;
  const n = items.length;
  const cx = (area.left + area.right) / 2;
  const cy = area.top + H / 2;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const vertical = (i: number) => Math.abs(Math.cos(angle(i))) < 0.35;
  // The ring is sized first, so its arrows read as a loop; the labels then
  // fit the room it leaves: above and below it for the top and bottom
  // stages (wide and short), out to the margins beside it for the rest.
  const diameter = Math.round(Math.min(viewport.height * 0.1, viewport.width * 0.075));
  const gap = Math.round(diameter * 0.3);
  /** Label geometry, and the one type scale every stage then sets in, for a ring radius. */
  const layout = (radius: number) => {
    const above = H / 2 - radius - diameter / 2 - gap;
    const besideW = (area.right - area.left) / 2 - radius - diameter / 2 - gap;
    const verticalW = Math.round(Math.min(besideW * 2, (area.right - area.left) * 0.5));
    const labelW = (i: number) => (vertical(i) ? verticalW : besideW);
    const boxH = (i: number) => (vertical(i) ? above : radius * 1.1);
    const scale = Math.min(
      ...items.map(
        (_, i) =>
          fitRamp(
            [items[i]!],
            context,
            () => labelW(i),
            () => boxH(i),
          ).scale,
      ),
    );
    return { labelW, scale };
  };
  // The largest ring whose labels keep most of their size, down to a compact one.
  const radii = [0.3, 0.27, 0.24, 0.21, 0.18].map((share) =>
    Math.round(Math.max(diameter * 1.2, Math.min(H * share, viewport.width * 0.16))),
  );
  const radius = radii.find((r) => layout(r).scale >= 0.85) ?? radii[radii.length - 1]!;
  const { labelW, scale } = layout(radius);
  const sizes = ramp(context, scale);
  const measures = items.map((item, i) => measureItem(item, sizes, labelW(i)));
  const line = withAlpha(area.accent, 0.75);
  const stroke = Math.max(3, Math.round(viewport.height * 0.004));
  const clear = (diameter / 2 + diameter * 0.22) / radius;
  const point = (a: number) => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  const layers = [...area.layers];
  items.forEach((item, index) => {
    const a = angle(index);
    const [x, y] = point(a);
    const parts: Part[] = [];
    // The arc arriving at this stage draws round the ring, then its badge pops.
    const arcInto = (from: number, to: number, id: string) => {
      const [x1, y1] = point(from + clear);
      const [x2, y2] = point(to - clear);
      return connector(id, `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`, line, stroke);
    };
    const arrives = index > 0 ? 0.35 : 0;
    if (index > 0) parts.push([arcInto(angle(index - 1), a, `stage-${index}-arrow`), 'draw', 0]);
    parts.push(
      ...pops(badge(`stage-${index}`, index + 1, x, y, diameter, area.accent, context), arrives),
    );
    const m = measures[index]!;
    const cos = Math.cos(a);
    let left: number;
    let top: number;
    let align: 'left' | 'center' | 'right';
    const width = labelW(index);
    if (cos > 0.35) {
      left = x + diameter / 2 + gap;
      top = y - Math.min(m.height / 2, diameter / 2);
      align = 'left';
    } else if (cos < -0.35) {
      left = x - diameter / 2 - gap - width;
      top = y - Math.min(m.height / 2, diameter / 2);
      align = 'right';
    } else {
      left = x - width / 2;
      top = Math.sin(a) < 0 ? y - diameter / 2 - gap - m.height : y + diameter / 2 + gap;
      align = 'center';
    }
    parts.push(
      ...words(
        itemText(`stage-${index}`, item, m, sizes, left, top, width, align, context),
        arrives + 0.18,
      ),
    );
    // With the last stage in place, the loop closes back to the first.
    if (index === n - 1)
      parts.push([arcInto(a, angle(n), 'stage-close-arrow'), 'draw', arrives + 0.5]);
    layers.push(...step(parts, index, context));
  });
  return layers;
}

// ---- layers ----------------------------------------------------------------

/**
 * Nested parts, innermost first (a core and the layers around it), as
 * concentric rings with each part called out beside the drawing. The color
 * deepens toward the core; each ring grows out from the centre as its part is
 * named, and its callout line draws to its words. A portrait frame puts the
 * rings above the callouts, each marked with its ring's color.
 */
export function layersBlock(input: LayersBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  if (items.length < 2) return cardsBlock({ ...input, template: 'cards' }, context);
  const area = frame(input, context);
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const n = items.length;
  const portrait = area.portrait;
  const R = Math.round(portrait ? Math.min(W * 0.4, H * 0.24) : Math.min(H * 0.48, W * 0.22));
  const cx = portrait ? area.left + W / 2 : area.left + R;
  const cy = portrait ? area.top + R : area.top + H / 2;
  const gap = Math.round(viewport.width * (portrait ? 0.02 : 0.05));
  const textLeft = portrait ? area.left + gap * 1.5 : cx + R + gap;
  const textW = area.right - textLeft;
  const textTop = portrait ? cy + R + viewport.height * 0.05 : area.top;
  const textH = area.bottom - textTop;
  const rowGap = Math.round(viewport.height * 0.025);
  const { sizes } = fitRamp(
    items,
    context,
    () => textW,
    () => (textH - rowGap * (n - 1)) / n,
  );
  const measures = items.map((item) => measureItem(item, sizes, textW));
  const rowsH = measures.reduce((sum, m) => sum + m.height, 0) + rowGap * (n - 1);
  // The callouts sit level with the rings, or from the top of the room below them.
  let rowTop = portrait ? textTop : Math.max(area.top, cy - rowsH / 2);
  const radius = (index: number) => (R * (index + 1)) / n;
  const tint = (index: number) => withAlpha(area.accent, 0.85 - (0.6 * index) / (n - 1));
  const stroke = Math.max(2, Math.round(viewport.height * 0.003));
  const rings: Layer[] = [];
  const callouts: Layer[] = [];
  items.forEach((item, index) => {
    const r = radius(index);
    // Rings stack outermost beneath, so each inner one sits on the ones around it.
    rings.unshift(
      ...step(
        [
          [
            {
              type: 'shape',
              id: `layer-${index}`,
              position: { x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
              content: {
                shape: 'circle',
                fill: tint(index),
                stroke: theme.colors.background,
                strokeWidth: stroke,
              },
            },
            'pop',
            0,
          ],
        ],
        index,
        context,
      ),
    );
    const m = measures[index]!;
    const firstLine = item.label
      ? sizes.label * LABEL_LINE_HEIGHT
      : sizes.plain * DETAIL_LINE_HEIGHT;
    const labelY = rowTop + firstLine / 2;
    const parts: Part[] = [];
    if (portrait) {
      const swatch = Math.round(sizes.label * 0.55);
      parts.push([
        {
          type: 'shape',
          id: `layer-${index}-swatch`,
          position: { x: area.left, y: labelY - swatch / 2, width: swatch, height: swatch },
          content: { shape: 'circle', fill: tint(index) },
        },
        'pop',
        0.2,
      ]);
    } else {
      // A callout from the middle of the ring's band to its words: the core's
      // from its upper side, the outer rings' further round, so no lines cross.
      const inner = index ? radius(index - 1) : 0;
      const middle = index ? (inner + r) / 2 : r * 0.45;
      const angle = ((-40 + (80 * index) / Math.max(1, n - 1)) * Math.PI) / 180;
      const x = cx + middle * Math.cos(angle);
      const y = cy + middle * Math.sin(angle);
      const dot = Math.max(8, Math.round(viewport.height * 0.009));
      parts.push(
        [
          connector(
            `layer-${index}-callout`,
            `M ${x} ${y} L ${cx + R + gap * 0.3} ${labelY} L ${textLeft - gap * 0.25} ${labelY}`,
            withAlpha(theme.colors.text, 0.55),
            stroke,
            false,
          ),
          'draw',
          0.25,
        ],
        [
          {
            type: 'shape',
            id: `layer-${index}-pin`,
            position: { x: x - dot / 2, y: y - dot / 2, width: dot, height: dot },
            content: { shape: 'circle', fill: theme.colors.text },
          },
          'pop',
          0.2,
        ],
      );
    }
    parts.push(
      ...words(
        itemText(`layer-${index}`, item, m, sizes, textLeft, rowTop, textW, 'left', context),
        0.4,
      ),
    );
    callouts.push(...step(parts, index, context));
    rowTop += m.height + rowGap;
  });
  return [...area.layers, ...rings, ...callouts];
}

// ---- figure ----------------------------------------------------------------

const FIGURE_BASE = 280;
const FIGURE_MIN = 120;
const FIGURE_LINE_HEIGHT = 1.0;

/** A figure's number and the word that scales it: "3.5 million" → "3.5" over "million". */
export function splitFigure(stat: string): { number: string; unit: string } {
  const match = stat.trim().match(/^(\D{0,2}[\d.,]+\s?[%×x]?)\s+(\p{L}[\p{L} -]{0,20})$/u);
  return match
    ? { number: match[1]!.trim(), unit: match[2]!.trim() }
    : { number: stat.trim(), unit: '' };
}

/**
 * A key number in the deck's lockup (`statHighlight` with a `title`): the
 * accent rule and headline above, the figure large on the left (counting up
 * where the motion profile counts), and what it means beside it: the line
 * that states it, then a supporting detail. Portrait stacks them.
 */
export function figureLockup(input: StatHighlightInput, context: TemplateContext): Layer[] {
  const area = frame({ title: input.headline, colorScheme: input.colorScheme }, context);
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const { number, unit } = splitFigure(input.stat);
  const gutter = Math.round(viewport.width * 0.05);
  const figureW = area.portrait ? W : W * 0.4;
  const textLeft = area.portrait ? area.left : area.left + figureW + gutter;
  const textW = area.right - textLeft;
  const base = themedFontSize(FIGURE_BASE, context, true);
  const figure = fitProse({
    text: number,
    baseFontSize: base,
    minFontSize: Math.min(base, themedFontSize(FIGURE_MIN, context, true)),
    maxWidthPx: figureW,
    maxHeightPx: base * FIGURE_LINE_HEIGHT * 1.05,
    lineHeight: FIGURE_LINE_HEIGHT,
  });
  const unitSize = themedFontSize(LABEL_BASE, context, true);
  const unitH = unit ? unitSize * LABEL_LINE_HEIGHT : 0;
  const figureH = figure.fontSize * 1.08 + unitH;

  // What it means: the stating line as a lead, the detail beneath it.
  const description = (input.description ?? '').trim();
  const detail = (input.detail ?? '').trim();
  const leadBase = themedFontSize(LEAD_BASE, context, false);
  const room = area.portrait ? H - figureH - viewport.height * 0.05 : H;
  const lead = fitProse({
    text: description,
    baseFontSize: leadBase,
    minFontSize: Math.min(leadBase, themedFontSize(LEAD_MIN, context, false)),
    maxWidthPx: textW,
    maxHeightPx: room * (detail ? 0.6 : 0.9),
    lineHeight: LEAD_LINE_HEIGHT,
  });
  const detailSize = themedFontSize(DETAIL_BASE, context, false);
  const detailGap = detail && description ? leadBase * 0.6 : 0;
  const detailH = detail
    ? estimateProseLineCount(detail, detailSize, textW) * detailSize * DETAIL_LINE_HEIGHT
    : 0;
  const wordsH = (description ? lead.heightPx : 0) + detailGap + detailH;

  // Both columns sit level, a little above the middle of the room beneath the headline.
  const groupH = area.portrait
    ? figureH + viewport.height * 0.05 + wordsH
    : Math.max(figureH, wordsH);
  const top = area.top + Math.max(0, (H - groupH) * 0.4);
  const figureTop = area.portrait ? top : top + Math.max(0, (wordsH - figureH) / 2);
  const wordsTop = area.portrait
    ? top + figureH + viewport.height * 0.05
    : top + Math.max(0, (figureH - wordsH) / 2);

  const motion = getMotionProfile(context);
  const count = motion.countUp ? countUpSpecFor(number) : null;
  const layers = [...area.layers];
  layers.push({
    ...textLayer('stat', number, box(area.left, figureTop, figureW, figure.fontSize * 1.08), {
      fontSize: figure.fontSize,
      fontFamily: getThemeFont(context, 'title'),
      fontWeight: 'bold',
      color: area.accent,
      lineHeight: FIGURE_LINE_HEIGHT,
      shadow: shouldUseShadow(context),
    }),
    animation: count
      ? { type: 'countUp', duration: motion.countUpDuration, delay: 0.3, count }
      : entrance(context, 'pop', 0.3),
  });
  if (unit)
    layers.push({
      ...textLayer(
        'stat-unit',
        unit,
        box(area.left, figureTop + figure.fontSize * 1.08, figureW, unitH),
        {
          fontSize: unitSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: area.accent,
          lineHeight: LABEL_LINE_HEIGHT,
        },
      ),
      animation: entrance(context, 'text', 0.45),
    });
  if (!area.portrait && (description || detail))
    layers.push({
      type: 'shape',
      id: 'stat-divider',
      position: {
        x: textLeft - gutter / 2 - 1,
        y: Math.min(figureTop, wordsTop),
        width: 2,
        height: Math.max(figureH, wordsH),
      },
      content: { shape: 'rect', fill: withAlpha(theme.colors.text, 0.18) },
      animation: entrance(context, 'bar', 0.35),
    });
  if (description)
    layers.push({
      ...textLayer(
        'description',
        description,
        box(textLeft, wordsTop, textW, lead.heightPx + lead.fontSize * 0.4),
        {
          fontSize: lead.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          lineHeight: LEAD_LINE_HEIGHT,
          ...(lead.maxLines ? { maxLines: lead.maxLines } : {}),
        },
      ),
      animation: entrance(context, 'text', 0.6),
    });
  if (detail)
    layers.push({
      ...textLayer(
        'detail',
        detail,
        box(
          textLeft,
          wordsTop + (description ? lead.heightPx : 0) + detailGap,
          textW,
          detailH + detailSize * 0.4,
        ),
        {
          fontSize: detailSize,
          fontFamily: getThemeFont(context, 'body'),
          color: withAlpha(theme.colors.text, 0.8),
          lineHeight: DETAIL_LINE_HEIGHT,
        },
      ),
      animation: entrance(context, 'text', 0.75),
    });
  return layers;
}
