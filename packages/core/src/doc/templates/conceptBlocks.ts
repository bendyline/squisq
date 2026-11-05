/**
 * Concept templates — `cards`, `process` and `cycle`.
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

import type { Layer, PathLayer, Position, ShapeLayer, TextLayer } from '../../schemas/Doc.js';
import type {
  CardsBlockInput,
  CycleBlockInput,
  ProcessBlockInput,
  TemplateContext,
} from '../../schemas/BlockTemplates.js';
import { pickContrastingText, withAlpha } from '../../schemas/colorUtils.js';
import {
  getThemeFont,
  motionEntrance,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { createBackgroundLayer, estimateProseLineCount, fitProse } from './captionUtils.js';

type ConceptInput = CardsBlockInput | ProcessBlockInput | CycleBlockInput;

/** One idea: an optional bold label and the words beneath it. */
export interface ConceptItem {
  label: string;
  detail: string;
}

const MAX_ITEMS = 6;
const LABEL_WORDS = 7;

/** Split `Label: detail` or `Label — detail`; anything else is all detail. */
export function splitConceptItem(text: string): ConceptItem {
  const clean = text.replace(/\s+/gu, ' ').trim();
  const match = clean.match(/^(.{1,64}?)(?::\s|\s[—–-]\s)(.+)$/u);
  if (match && match[1]!.split(' ').length <= LABEL_WORDS && !/\d$/u.test(match[1]!))
    return { label: match[1]!.trim(), detail: match[2]!.trim() };
  return { label: '', detail: clean };
}

// ---- Type ramp (1080p reference; themed per viewport and theme) ----------

const HEADLINE_BASE = 60;
const HEADLINE_MIN = 40;
const HEADLINE_LINE_HEIGHT = 1.15;
const LABEL_BASE = 44;
const DETAIL_BASE = 33;
/** An item without a label sets its words between the two. */
const PLAIN_BASE = 38;
const LABEL_LINE_HEIGHT = 1.2;
const DETAIL_LINE_HEIGHT = 1.4;
/** The smallest the ramp shrinks to before text clamps. */
const MIN_SCALE = 0.62;
/** How far short ideas may grow past the base sizes, and the share of the room they then fill. */
const MAX_SCALE = 1.18;
const GROW_SHARE = 0.9;

interface Ramp {
  label: number;
  detail: number;
  plain: number;
}

function ramp(context: TemplateContext, scale: number): Ramp {
  return {
    label: Math.round(themedFontSize(LABEL_BASE, context, false) * scale),
    detail: Math.round(themedFontSize(DETAIL_BASE, context, false) * scale),
    plain: Math.round(themedFontSize(PLAIN_BASE, context, false) * scale),
  };
}

interface ItemMeasure {
  labelH: number;
  gap: number;
  detailH: number;
  height: number;
}

function measureItem(item: ConceptItem, sizes: Ramp, width: number): ItemMeasure {
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
function fitRamp(
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

interface Frame {
  layers: Layer[];
  accent: string;
  /** Content region the template arranges its items in. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  portrait: boolean;
}

function accentColor(input: ConceptInput, context: TemplateContext): string {
  return input.colorScheme
    ? resolveColorScheme(context, input.colorScheme).accent
    : context.theme.colors.highlight || context.theme.colors.primary;
}

/** Background, accent rule and headline; returns the region beneath them. */
function frame(input: ConceptInput, context: TemplateContext): Frame {
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
      animation: motionEntrance(context, { type: 'fadeIn', duration: 0.6 }),
    });
    layers.push(
      textLayer('title', title, box(margin, headlineTop, W - margin * 2, fit.heightPx), {
        fontSize: fit.fontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        lineHeight: HEADLINE_LINE_HEIGHT,
        shadow: shouldUseShadow(context),
        ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
      }),
    );
    layers[layers.length - 1]!.animation = motionEntrance(context, {
      type: 'fadeIn',
      duration: 0.8,
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
function box(left: number, top: number, width: number, height: number): Position {
  return { x: left + width / 2, y: top + height / 2, width, height, anchor: 'center' };
}

function textLayer(
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
function itemText(
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

function itemsOf(input: Pick<ConceptInput, 'items'>): ConceptItem[] {
  return (Array.isArray(input.items) ? input.items : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
    .map(splitConceptItem);
}

/**
 * The build steps a concept block's items become, named as `blockBuildSteps`
 * names them from the layers (a stage's number, then its label and detail),
 * so a caller can time the reveals before the block is drawn.
 */
export function conceptBuildStepTexts(
  template: 'cards' | 'process' | 'cycle',
  items: readonly string[],
): string[] {
  const shown = itemsOf({ items: [...items] });
  // A cycle of one item draws as a process.
  return shown.map((item, index) =>
    [template === 'cards' ? '' : String(index + 1), item.label, item.detail]
      .filter(Boolean)
      .join(' '),
  );
}

/** Tag an item's layers as one build step, entering after the headline. */
function step(layers: Layer[], index: number, context: TemplateContext): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    buildStep: index,
    animation: motionEntrance(context, {
      type: 'fadeIn',
      duration: 0.7,
      delay: 0.5 + index * 0.35,
    }),
  }));
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
  const base = themedFontSize(LEAD_BASE, context, false);
  const fit = fitProse({
    text,
    baseFontSize: base,
    minFontSize: Math.min(base, themedFontSize(LEAD_MIN, context, false)),
    maxWidthPx: width,
    maxHeightPx: (area.bottom - area.top) * 0.9,
    lineHeight: LEAD_LINE_HEIGHT,
  });
  const top = area.top + Math.max(0, (area.bottom - area.top - fit.heightPx) * 0.2);
  return [
    ...area.layers,
    ...step(
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
      ],
      0,
      context,
    ),
  ];
}

/**
 * Parallel ideas as a row of cards (a 2×2 or 2×3 grid when there are many or
 * they run long; one column in portrait). A single unlabelled idea sets as a
 * lead paragraph instead.
 */
export function cardsBlock(input: CardsBlockInput, context: TemplateContext): Layer[] {
  const items = itemsOf(input);
  const area = frame(input, context);
  const { theme, viewport } = context;
  if (!items.length) return area.layers;
  if (items.length === 1 && !items[0]!.label) return lead(area, items[0]!.detail, context);
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
          card,
          rule,
          ...itemText(
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
        ],
        index,
        context,
      ),
    );
  });
  return layers;
}

// ---- process -------------------------------------------------------------

function badge(
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
function connector(id: string, d: string, color: string, width: number, arrow = true): PathLayer {
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
 * stack down a rail.
 */
export function processBlock(input: ProcessBlockInput, context: TemplateContext): Layer[] {
  const items = itemsOf(input);
  const area = frame(input, context);
  const { viewport } = context;
  if (!items.length) return area.layers;
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
      const parts: Layer[] = [];
      if (index > 0) {
        const from = cx - columnW + diameter / 2 + diameter * 0.25;
        const to = cx - diameter / 2 - diameter * 0.25;
        parts.push(connector(`step-${index}-arrow`, `M ${from} ${cy} L ${to} ${cy}`, line, stroke));
      }
      parts.push(...badge(`step-${index}`, index + 1, cx, cy, diameter, area.accent, context));
      parts.push(
        ...itemText(
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
    const parts: Layer[] = [];
    // The words' first line sits level with the badge.
    const firstLine = item.label
      ? sizes.label * LABEL_LINE_HEIGHT
      : sizes.plain * DETAIL_LINE_HEIGHT;
    const cy = top + Math.max(firstLine, diameter) / 2;
    if (index > 0) {
      const from = previous + diameter / 2 + diameter * 0.12;
      const to = cy - diameter / 2 - diameter * 0.12;
      if (to > from)
        parts.push(
          connector(
            `step-${index}-arrow`,
            `M ${cx} ${from} L ${cx} ${to}`,
            line,
            stroke,
            to - from >= diameter * 0.6,
          ),
        );
    }
    previous = cy;
    parts.push(...badge(`step-${index}`, index + 1, cx, cy, diameter, area.accent, context));
    parts.push(
      ...itemText(
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
    );
    layers.push(...step(parts, index, context));
    top += rowH[index]! + gap;
  });
  return layers;
}

// ---- cycle ---------------------------------------------------------------

/**
 * A cycle: stages on a ring, each joined to the next by an arrow and the
 * last back to the first. Labels sit beside their stage, away from the ring.
 */
export function cycleBlock(input: CycleBlockInput, context: TemplateContext): Layer[] {
  const items = itemsOf(input);
  const area = frame(input, context);
  const { viewport } = context;
  if (items.length < 2) return processBlock({ ...input, template: 'process' }, context);
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
    const parts: Layer[] = [];
    // The arc arriving at this stage; the first stage also receives the one closing the loop.
    const arcInto = (from: number, to: number, id: string) => {
      const [x1, y1] = point(from + clear);
      const [x2, y2] = point(to - clear);
      return connector(id, `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`, line, stroke);
    };
    if (index > 0) parts.push(arcInto(angle(index - 1), a, `stage-${index}-arrow`));
    parts.push(...badge(`stage-${index}`, index + 1, x, y, diameter, area.accent, context));
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
    parts.push(...itemText(`stage-${index}`, item, m, sizes, left, top, width, align, context));
    if (index === n - 1) parts.push(arcInto(a, angle(n), 'stage-close-arrow'));
    layers.push(...step(parts, index, context));
  });
  return layers;
}
