/**
 * Concept templates — `stats`, `pyramid`, `funnel`, `hub`, `venn` and `matrix`.
 *
 * More ways to draw how a handful of ideas relate, beside the four in
 * `conceptBlocks.ts`: key numbers set side by side, a hierarchy stacked as a
 * pyramid, stages that narrow as a funnel, ideas around the one thing they
 * share, two sets and their overlap, and four ideas placed on two axes.
 *
 * They are built from the same kit as `cards`, `process`, `cycle` and
 * `layers` — the headline lockup, the type ramp, the entrances — so a deck
 * that mixes all ten reads as one design. Each item is still plain text,
 * `Label: detail`, and still one build step.
 *
 * A template that cannot draw its picture from what it was given (a matrix
 * without four ideas, a Venn diagram without two sets, key numbers without a
 * figure) draws the same ideas as cards rather than a broken diagram.
 *
 * Related: `conceptBlocks.ts` (the kit), `conceptItems.ts` (how items are
 * read), `recommend/listShape.ts` (which template a list suggests).
 */

import type { Layer, PathLayer, ShapeLayer } from '../../schemas/Doc.js';
import type {
  FunnelBlockInput,
  HubBlockInput,
  MatrixBlockInput,
  PyramidBlockInput,
  StatsBlockInput,
  TemplateContext,
  VennBlockInput,
} from '../../schemas/BlockTemplates.js';
import { hexHueDegrees, isHex, pickContrastingText, withAlpha } from '../../schemas/colorUtils.js';
import {
  getMotionProfile,
  getThemeFont,
  motionDelay,
  shouldUseShadow,
  themedFontSize,
} from '../utils/themeUtils.js';
import { countUpSpecFor } from '../utils/countUp.js';
import { estimateProseLineCount, fitProse } from './captionUtils.js';
import {
  DETAIL_BASE,
  DETAIL_LINE_HEIGHT,
  FIRST_TURN,
  LABEL_BASE,
  LABEL_LINE_HEIGHT,
  TURN_STAGGER,
  asListWhenCrowded,
  box,
  cardsBlock,
  connector,
  entrance,
  fitRamp,
  frame,
  itemText,
  itemsOf,
  measureItem,
  ramp,
  splitFigure,
  statItemsOf,
  step,
  textLayer,
  words,
  type ConceptItem,
  type Frame,
  type Part,
} from './conceptBlocks.js';
import { vennOverlapIndex } from './conceptItems.js';
import { conceptDrawsAs } from './conceptSpecs.js';

/** A filled outline drawn in slide coordinates (a tier, the overlap of two circles). */
function region(
  id: string,
  d: string,
  fill: string,
  stroke: string,
  strokeWidth: number,
): PathLayer {
  return {
    type: 'path',
    id,
    position: { x: 0, y: 0, width: '100%', height: '100%' },
    content: { d, fill, stroke, strokeWidth },
  };
}

function disc(id: string, cx: number, cy: number, r: number, fill: string): ShapeLayer {
  return {
    type: 'shape',
    id,
    position: { x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
    content: { shape: 'circle', fill },
  };
}

/**
 * The largest size, at or under `size`, at which no word of `text` is wider
 * than `width`: a label inside a shape shrinks before it breaks mid-word.
 * Bold display faces run about 0.64em a letter.
 */
function unbrokenSize(text: string, size: number, width: number, floor: number): number {
  const longest = Math.max(1, ...text.split(/\s+/u).map((word) => word.length));
  return Math.max(Math.min(size, floor), Math.min(size, Math.floor(width / (longest * 0.64))));
}

/** A soft card behind one idea, with the accent rule that opens it. */
function panel(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  ruleH: number,
  accent: string,
  context: TemplateContext,
): Part[] {
  const { theme } = context;
  return [
    [
      {
        type: 'shape',
        id,
        position: { x: left, y: top, width, height },
        content: {
          shape: 'rect',
          fill: withAlpha(theme.colors.text, 0.06),
          stroke: withAlpha(theme.colors.text, 0.12),
          strokeWidth: 2,
          borderRadius: Math.round(Math.min(width, height) * 0.06),
        },
      },
      'surface',
      0,
    ],
    [
      {
        type: 'shape',
        id: `${id}-rule`,
        position: { x: left + pad, y: top + pad, width: Math.min(width * 0.22, 64), height: ruleH },
        content: { shape: 'rect', fill: accent, borderRadius: ruleH / 2 },
      },
      'rule',
      0.2,
    ],
  ];
}

// ---- stats ---------------------------------------------------------------

const FIGURE_LINE_HEIGHT = 1.05;

/**
 * Key numbers side by side: each figure large in the accent (counting up
 * where the theme's motion counts), the word that scales it beneath
 * ("million"), then what it measures. Up to four sit in a row, five or six
 * three to a row; a portrait frame stacks them.
 */
export function statsBlock(input: StatsBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const stats = statItemsOf(input);
  // Without a figure there is nothing to count: the ideas read as cards.
  if (conceptDrawsAs('stats', input.items) === 'cards')
    return cardsBlock({ ...input, template: 'cards' }, context);
  const area = frame(input, context);
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const n = stats.length;
  const columns = area.portrait ? (n <= 3 ? 1 : 2) : n <= 4 ? n : 3;
  const rows = Math.ceil(n / columns);
  const gutter = Math.round(viewport.width * (area.portrait ? 0.07 : 0.045));
  const rowGap = Math.round(viewport.height * 0.055);
  const cellW = (W - gutter * (columns - 1)) / columns;
  const cellH = (H - rowGap * (rows - 1)) / rows;
  const figures = stats.map((stat) => splitFigure(stat.figure));

  // One size for every figure on the slide: the largest the longest of them fits.
  const base = themedFontSize(
    rows > 1 && !area.portrait ? 124 : columns >= 4 ? 132 : columns === 3 ? 156 : 176,
    context,
    true,
  );
  const floor = Math.min(base, themedFontSize(64, context, true));
  const figureSize = Math.min(
    ...figures.map(({ number }) =>
      number
        ? fitProse({
            text: number,
            baseFontSize: base,
            minFontSize: floor,
            maxWidthPx: cellW * 0.98,
            maxHeightPx: base * FIGURE_LINE_HEIGHT,
            lineHeight: FIGURE_LINE_HEIGHT,
          }).fontSize
        : base,
    ),
  );
  const figureH = figureSize * FIGURE_LINE_HEIGHT;
  const unitSize = Math.round(themedFontSize(LABEL_BASE, context, true) * (figureSize / base));
  const unitH = figures.some((figure) => figure.unit) ? unitSize * LABEL_LINE_HEIGHT : 0;
  const captionGap = Math.round(figureSize * 0.16);
  const captions: ConceptItem[] = stats.map((stat) => ({ label: '', detail: stat.caption }));
  const { sizes } = fitRamp(
    captions,
    context,
    () => cellW,
    () => Math.max(0, cellH - figureH - unitH - captionGap),
  );
  const measures = captions.map((caption) => measureItem(caption, sizes, cellW));
  const captionH = Math.max(0, ...measures.map((m) => (Number.isFinite(m.height) ? m.height : 0)));
  const groupH = Math.min(cellH, figureH + unitH + captionGap + captionH);
  const gridH = rows * groupH + (rows - 1) * rowGap;
  const gridTop = area.top + Math.max(0, (H - gridH) * 0.38);
  const motion = getMotionProfile(context);
  const ruleW = Math.max(2, Math.round(viewport.width * 0.0012));
  const layers = [...area.layers];

  stats.forEach((stat, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const inRow = Math.min(columns, n - row * columns);
    const rowLeft = area.left + ((columns - inRow) * (cellW + gutter)) / 2;
    const left = rowLeft + column * (cellW + gutter);
    const top = gridTop + row * (groupH + rowGap);
    const turn = FIRST_TURN + index * TURN_STAGGER;
    const { number, unit } = figures[index]!;
    const parts: Part[] = [];
    // A hairline separates each figure from the one before it in its row.
    if (column > 0)
      parts.push([
        {
          type: 'shape',
          id: `stat-${index}-divider`,
          position: { x: left - gutter / 2 - ruleW / 2, y: top, width: ruleW, height: groupH },
          content: { shape: 'rect', fill: withAlpha(theme.colors.text, 0.18) },
        },
        'bar',
        0,
      ]);
    const built = step(parts, index, context);
    if (number) {
      const count = motion.countUp ? countUpSpecFor(number) : null;
      built.push({
        ...textLayer(`stat-${index}`, number, box(left, top, cellW, figureH), {
          fontSize: figureSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: area.accent,
          lineHeight: FIGURE_LINE_HEIGHT,
          shadow: shouldUseShadow(context),
        }),
        buildStep: index,
        animation: count
          ? {
              type: 'countUp',
              duration: motion.countUpDuration,
              delay: motionDelay(context, turn + 0.1),
              count,
            }
          : entrance(context, 'pop', turn + 0.1),
      });
    }
    const rest: Part[] = [];
    if (unit)
      rest.push([
        textLayer(`stat-${index}-unit`, unit, box(left, top + figureH, cellW, unitH), {
          fontSize: unitSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: area.accent,
          lineHeight: LABEL_LINE_HEIGHT,
        }),
        'text',
        0.25,
      ]);
    rest.push(
      ...words(
        itemText(
          `stat-${index}`,
          captions[index]!,
          measures[index]!,
          sizes,
          left,
          top + (number ? figureH + unitH + captionGap : 0),
          cellW,
          'left',
          context,
        ),
        0.35,
      ),
    );
    layers.push(...built, ...step(rest, index, context));
  });
  return layers;
}

// ---- pyramid and funnel --------------------------------------------------

/** How far a funnel narrows from its mouth to its stem. */
const FUNNEL_STEM = 0.3;

/**
 * Tiers stacked into one shape, each called out beside it: a pyramid widens
 * from its apex (the first item) to its base, a funnel narrows from its mouth
 * (the first item) to its stem. The colour deepens toward the point, where
 * the few or the final are.
 */
function tiers(
  kind: 'pyramid' | 'funnel',
  input: PyramidBlockInput | FunnelBlockInput,
  context: TemplateContext,
): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  if (conceptDrawsAs(kind, input.items) === 'cards')
    return cardsBlock({ ...input, template: 'cards' }, context);
  const area = frame(input, context);
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const n = items.length;
  const portrait = area.portrait;
  const gap = Math.round(viewport.width * (portrait ? 0.02 : 0.045));
  const rowGap = Math.round(viewport.height * 0.02);
  const listGap = viewport.height * 0.045;
  const top = area.top;
  // Portrait stacks the shape over its callouts: the words are sized for a
  // shape of about a third of the room, and the shape then grows into
  // whatever they leave.
  const listW = W - gap * 1.5;
  const listed = portrait
    ? fitRamp(
        items,
        context,
        () => listW,
        () => (H * 0.64 - listGap - rowGap * (n - 1)) / n,
      ).sizes
    : undefined;
  const listH = listed
    ? items.reduce(
        (sum, item) => {
          const height = measureItem(item, listed, listW).height;
          return sum + (Number.isFinite(height) ? height : 0);
        },
        rowGap * (n - 1),
      )
    : 0;
  const shapeH = Math.round(
    portrait ? Math.max(H * 0.36, Math.min(H * 0.5, H - listH - listGap)) : H,
  );
  const shapeW = Math.round(
    portrait ? Math.min(W * 0.78, shapeH * 1.5) : Math.min(W * 0.4, H * 1.1),
  );
  const shapeLeft = portrait ? area.left + (W - shapeW) / 2 : area.left;
  const cx = shapeLeft + shapeW / 2;
  const slit = Math.max(3, Math.round(viewport.height * 0.007));
  const tierH = shapeH / n;
  /** Half the shape's width at a height `y` down from its top. */
  const half = (y: number) =>
    kind === 'pyramid'
      ? (shapeW / 2) * (y / shapeH)
      : (shapeW / 2) * (1 - (1 - FUNNEL_STEM) * (y / shapeH));
  const tint = (index: number) => {
    const depth = n > 1 ? index / (n - 1) : 0;
    return withAlpha(area.accent, kind === 'pyramid' ? 0.92 - 0.6 * depth : 0.32 + 0.6 * depth);
  };
  const textLeft = portrait ? area.left + gap * 1.5 : shapeLeft + shapeW + gap;
  const textW = area.right - textLeft;
  const textTop = portrait ? top + shapeH + listGap : top;
  const sizes =
    listed ??
    fitRamp(
      items,
      context,
      () => textW,
      () => tierH - rowGap,
    ).sizes;
  const measures = items.map((item) => measureItem(item, sizes, textW));
  const stroke = Math.max(2, Math.round(viewport.height * 0.003));
  const shapes: Layer[] = [];
  const callouts: Layer[] = [];
  let rowTop = textTop;
  items.forEach((item, index) => {
    const y0 = index * tierH;
    const y1 = y0 + tierH - (index < n - 1 ? slit : 0);
    const [a, b] = [half(y0), half(y1)];
    shapes.push(
      ...step(
        [
          [
            region(
              `tier-${index}`,
              `M ${cx - a} ${top + y0} L ${cx + a} ${top + y0} L ${cx + b} ${top + y1} L ${cx - b} ${top + y1} Z`,
              tint(index),
              'none',
              0,
            ),
            'surface',
            0,
          ],
        ],
        index,
        context,
      ),
    );
    const m = measures[index]!;
    const height = Number.isFinite(m.height) ? m.height : tierH;
    const middle = top + (y0 + y1) / 2;
    const parts: Part[] = [];
    let blockTop: number;
    if (portrait) {
      const firstLine = item.label
        ? sizes.label * LABEL_LINE_HEIGHT
        : sizes.plain * DETAIL_LINE_HEIGHT;
      const swatch = Math.round(sizes.label * 0.55);
      parts.push([
        {
          type: 'shape',
          id: `tier-${index}-swatch`,
          position: {
            x: area.left,
            y: rowTop + firstLine / 2 - swatch / 2,
            width: swatch,
            height: swatch,
          },
          content: { shape: 'rect', fill: tint(index), borderRadius: Math.round(swatch * 0.2) },
        },
        'pop',
        0.2,
      ]);
      blockTop = rowTop;
      rowTop += height + rowGap;
    } else {
      // A leader from the tier's edge to its words, which sit level with it.
      const edge = cx + half((y0 + y1) / 2);
      const dot = Math.max(8, Math.round(viewport.height * 0.009));
      parts.push(
        [
          connector(
            `tier-${index}-callout`,
            `M ${edge + dot} ${middle} L ${textLeft - gap * 0.25} ${middle}`,
            withAlpha(theme.colors.text, 0.45),
            stroke,
            false,
          ),
          'draw',
          0.2,
        ],
        [
          disc(`tier-${index}-pin`, edge + dot / 2, middle, dot / 2, theme.colors.text),
          'pop',
          0.15,
        ],
      );
      blockTop = Math.max(area.top, middle - height / 2);
    }
    parts.push(
      ...words(
        itemText(`tier-${index}`, item, m, sizes, textLeft, blockTop, textW, 'left', context),
        0.35,
      ),
    );
    callouts.push(...step(parts, index, context));
  });
  return [...area.layers, ...shapes, ...callouts];
}

/** A hierarchy as a pyramid: the apex first, the base last. */
export function pyramidBlock(input: PyramidBlockInput, context: TemplateContext): Layer[] {
  return tiers('pyramid', input, context);
}

/** Stages that narrow as a funnel: the widest first, the outcome last. */
export function funnelBlock(input: FunnelBlockInput, context: TemplateContext): Layer[] {
  return tiers('funnel', input, context);
}

// ---- hub -----------------------------------------------------------------

/**
 * Ideas around the one thing they share: a hub (its `center` words inside
 * it), a spoke out to each idea, and the idea's words at the end of its
 * spoke. The ideas read down the left of the hub, then down the right; a
 * portrait frame fans them all out to the right of it.
 */
export function hubBlock(input: HubBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  if (conceptDrawsAs('hub', input.items) === 'cards')
    return cardsBlock({ ...input, template: 'cards' }, context);
  const area = frame(input, context);
  const { viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const n = items.length;
  const portrait = area.portrait;
  const center = String(input.center ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  const hubR = Math.round(
    Math.min(viewport.height, viewport.width) * (center ? (portrait ? 0.09 : 0.115) : 0.055),
  );
  const dot = Math.round(Math.min(viewport.height, viewport.width) * 0.034);
  const gap = Math.round(dot * 0.6);
  const cx = portrait ? area.left + hubR : (area.left + area.right) / 2;
  const cy = area.top + H / 2;
  const rx = portrait ? W * 0.4 : Math.min(H * 0.42, W * 0.2);
  const ry = portrait ? H * 0.42 : rx;
  // Where each idea's spoke ends: an arc on each side of the hub (one arc in portrait).
  const leftCount = portrait ? 0 : Math.ceil(n / 2);
  const spots = items.map((_, index) => {
    const onLeft = index < leftCount;
    const count = onLeft ? leftCount : n - leftCount;
    const at = onLeft ? index : index - leftCount;
    const spread = portrait ? 124 : count <= 1 ? 0 : count === 2 ? 70 : 110;
    const degrees = count <= 1 ? 0 : -spread / 2 + (spread * at) / (count - 1);
    const theta = (degrees * Math.PI) / 180;
    return {
      onLeft,
      x: cx + (onLeft ? -1 : 1) * rx * Math.cos(theta),
      y: cy + ry * Math.sin(theta),
    };
  });
  const labelW = (index: number) =>
    spots[index]!.onLeft
      ? spots[index]!.x - dot / 2 - gap - area.left
      : area.right - (spots[index]!.x + dot / 2 + gap);
  /** The room an idea has before it meets the one below it on its side. */
  const rowH = (index: number) => {
    const side = spots.filter((spot) => spot.onLeft === spots[index]!.onLeft);
    if (side.length < 2) return H * 0.8;
    return ((side[side.length - 1]!.y - side[0]!.y) / (side.length - 1)) * 0.9;
  };
  // One type scale for every idea: the smallest any of them needs.
  const scale = Math.min(
    ...items.map(
      (item, index) =>
        fitRamp(
          [item],
          context,
          () => labelW(index),
          () => rowH(index),
        ).scale,
    ),
  );
  const sizes = ramp(context, scale);
  const measures = items.map((item, index) => measureItem(item, sizes, labelW(index)));
  const line = withAlpha(area.accent, 0.6);
  const stroke = Math.max(3, Math.round(viewport.height * 0.004));
  const layers = [...area.layers];

  // The hub is the block's subject, there from the start.
  layers.push({
    ...disc('hub', cx, cy, hubR, area.accent),
    animation: entrance(context, 'pop', 0.35),
  });
  if (center) {
    const side = hubR * 1.5;
    const floor = themedFontSize(18, context, true);
    const size = unbrokenSize(center, themedFontSize(36, context, true), side, floor);
    const fit = fitProse({
      text: center,
      baseFontSize: size,
      minFontSize: Math.min(size, floor),
      maxWidthPx: side,
      maxHeightPx: side,
      lineHeight: 1.15,
    });
    layers.push({
      type: 'text',
      id: 'hub-center',
      position: { x: cx, y: cy, width: side, height: side, anchor: 'center' },
      content: {
        text: center,
        style: {
          fontSize: fit.fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: pickContrastingText(area.accent),
          textAlign: 'center',
          verticalAlign: 'middle',
          lineHeight: 1.15,
          shrinkToFit: true,
          ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
        },
      },
      animation: entrance(context, 'pop', 0.35),
    });
  }

  items.forEach((item, index) => {
    const { x, y, onLeft } = spots[index]!;
    const length = Math.hypot(x - cx, y - cy) || 1;
    const [ux, uy] = [(x - cx) / length, (y - cy) / length];
    const from = hubR + dot * 0.35;
    const to = length - dot / 2 - dot * 0.15;
    const m = measures[index]!;
    const height = Number.isFinite(m.height) ? m.height : 0;
    const width = labelW(index);
    const left = onLeft ? x - dot / 2 - gap - width : x + dot / 2 + gap;
    const top = Math.min(
      Math.max(area.top, y - height / 2),
      Math.max(area.top, area.bottom - height),
    );
    layers.push(
      ...step(
        [
          [
            connector(
              `spoke-${index}`,
              `M ${cx + from * ux} ${cy + from * uy} L ${cx + to * ux} ${cy + to * uy}`,
              line,
              stroke,
              false,
            ),
            'draw',
            0,
          ],
          [disc(`spoke-${index}-end`, x, y, dot / 2, area.accent), 'pop', 0.3],
          ...words(
            itemText(
              `spoke-${index}`,
              item,
              m,
              sizes,
              left,
              top,
              width,
              onLeft ? 'right' : 'left',
              context,
            ),
            0.45,
          ),
        ],
        index,
        context,
      ),
    );
  });
  return layers;
}

// ---- venn ----------------------------------------------------------------

/**
 * A second colour for the other set, so the overlap blends the two: the
 * first of the theme's scheme accents (then its palette) whose hue stands
 * apart from the accent. A theme of one hue falls back to its text colour,
 * which reads as a neutral beside the accent.
 */
function secondColor(accent: string, context: TemplateContext): string {
  const { colors, colorSchemes } = context.theme;
  const hue = (color: string) => (isHex(color) ? hexHueDegrees(color) : NaN);
  const apart = (color: string) => {
    const turn = Math.abs(hue(color) - hue(accent)) % 360;
    return Math.min(turn, 360 - turn);
  };
  const candidates = [
    ...Object.values(colorSchemes ?? {}).map((scheme) => scheme.accent),
    colors.secondary,
    colors.primary,
    colors.highlight,
  ];
  return candidates.find((color) => !!color && apart(color) >= 50) ?? colors.text;
}

/**
 * Two sets as overlapping circles: each set's label inside its own side, its
 * detail beside it, and what the two share (an item labelled `Both:` or
 * `Shared:`) beneath, tied to the overlap. A portrait frame lists the three
 * under the circles.
 */
export function vennBlock(input: VennBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const all = itemsOf(input);
  const sharedAt = vennOverlapIndex(all);
  const sets = all
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => index !== sharedAt);
  if (conceptDrawsAs('venn', input.items) === 'cards')
    return cardsBlock({ ...input, template: 'cards' }, context);
  const shared = sharedAt >= 0 ? all[sharedAt]! : undefined;
  const area = frame(input, context);
  const { theme, viewport } = context;
  const W = area.right - area.left;
  const H = area.bottom - area.top;
  const portrait = area.portrait;
  const colors = [area.accent, secondColor(area.accent, context)];
  const mid = (area.left + area.right) / 2;
  const stroke = Math.max(2, Math.round(viewport.height * 0.003));
  const gap = Math.round(viewport.width * 0.025);
  const layers = [...area.layers];

  // What the sets share reads as one caption under the circles.
  const captionSize = themedFontSize(DETAIL_BASE * 1.1, context, false);
  const captionW = portrait ? W : W * 0.62;
  const captionLines = shared?.detail
    ? Math.min(3, estimateProseLineCount(shared.detail, captionSize, captionW))
    : 0;
  const sharedLabelH = shared?.label && !portrait ? captionSize * 1.5 : 0;
  const band =
    shared && !portrait
      ? sharedLabelH + captionLines * captionSize * DETAIL_LINE_HEIGHT + viewport.height * 0.04
      : 0;

  const circlesH = portrait ? H * 0.34 : H - band;
  const R = Math.round(Math.min(circlesH / 2, (portrait ? W : W * 0.34) / 2));
  const distance = R * 1.12;
  const cy = area.top + circlesH / 2;
  const centres = [mid - distance / 2, mid + distance / 2];
  const lensHalf = Math.sqrt(Math.max(0, R * R - (distance / 2) ** 2));
  const sideW = portrait ? W - gap * 1.5 : mid - distance / 2 - R - gap - area.left;
  const rowGap = Math.round(viewport.height * 0.025);
  const listTop = cy + R + viewport.height * 0.045;
  const listed = portrait ? [...sets.map(({ item }) => item), ...(shared ? [shared] : [])] : [];
  const { sizes } = fitRamp(
    portrait ? listed : sets.map(({ item }) => ({ label: '', detail: item.detail })),
    context,
    () => sideW,
    () =>
      portrait
        ? (area.bottom - listTop - rowGap * (listed.length - 1)) / Math.max(1, listed.length)
        : circlesH * 0.9,
  );
  let rowTop = listTop;
  /** One row of the portrait list: a swatch in the set's colour, then its words. */
  const row = (id: string, item: ConceptItem, fill: string): Part[] => {
    const m = measureItem(item, sizes, sideW);
    const firstLine = item.label
      ? sizes.label * LABEL_LINE_HEIGHT
      : sizes.plain * DETAIL_LINE_HEIGHT;
    const swatch = Math.round(sizes.label * 0.5);
    const parts: Part[] = [
      [
        disc(`${id}-swatch`, area.left + swatch / 2, rowTop + firstLine / 2, swatch / 2, fill),
        'pop',
        0.2,
      ],
      ...words(
        itemText(id, item, m, sizes, area.left + gap * 1.5, rowTop, sideW, 'left', context),
        0.3,
      ),
    ];
    rowTop += (Number.isFinite(m.height) ? m.height : firstLine) + rowGap;
    return parts;
  };

  sets.forEach(({ item, index }, side) => {
    const cx = centres[side]!;
    const fill = colors[side]!;
    const parts: Part[] = [
      [
        {
          type: 'shape',
          id: `set-${side}`,
          position: { x: cx - R, y: cy - R, width: R * 2, height: R * 2 },
          content: {
            shape: 'circle',
            fill: withAlpha(fill, 0.3),
            stroke: withAlpha(fill, 0.9),
            strokeWidth: stroke,
          },
        },
        'pop',
        0,
      ],
    ];
    if (portrait) {
      parts.push(...row(`set-${side}`, item, withAlpha(fill, 0.75)));
    } else {
      // The label sits in the part of the circle that is this set's alone.
      const own = R * 2 - (R * 2 - distance);
      const lobeW = own * 0.74;
      const lobeX = side === 0 ? cx - R + own * 0.52 : cx + R - own * 0.52;
      if (item.label) {
        const floor = themedFontSize(20, context, true);
        const size = unbrokenSize(
          item.label,
          themedFontSize(LABEL_BASE, context, true),
          lobeW,
          floor,
        );
        const fit = fitProse({
          text: item.label,
          baseFontSize: size,
          minFontSize: Math.min(size, floor),
          maxWidthPx: lobeW,
          maxHeightPx: R * 0.9,
          lineHeight: LABEL_LINE_HEIGHT,
        });
        parts.push([
          {
            type: 'text',
            id: `set-${side}-label`,
            position: { x: lobeX, y: cy, width: lobeW, height: R * 0.9, anchor: 'center' },
            content: {
              text: item.label,
              style: {
                fontSize: fit.fontSize,
                fontFamily: getThemeFont(context, 'title'),
                fontWeight: 'bold',
                color: theme.colors.text,
                textAlign: 'center',
                verticalAlign: 'middle',
                lineHeight: LABEL_LINE_HEIGHT,
                shrinkToFit: true,
                ...(fit.maxLines ? { maxLines: fit.maxLines } : {}),
              },
            },
          },
          'text',
          0.25,
        ]);
      }
      if (item.detail) {
        const detail: ConceptItem = { label: '', detail: item.detail };
        const m = measureItem(detail, sizes, sideW);
        const height = Number.isFinite(m.height) ? m.height : 0;
        const left = side === 0 ? area.left : area.right - sideW;
        parts.push(
          ...words(
            itemText(
              `set-${side}`,
              detail,
              m,
              sizes,
              left,
              Math.max(area.top, cy - height / 2),
              sideW,
              side === 0 ? 'right' : 'left',
              context,
            ),
            0.4,
          ),
        );
      }
    }
    layers.push(...step(parts, index, context));
  });

  if (shared) {
    const lens = region(
      'overlap',
      `M ${mid} ${cy - lensHalf} A ${R} ${R} 0 0 1 ${mid} ${cy + lensHalf} A ${R} ${R} 0 0 1 ${mid} ${cy - lensHalf} Z`,
      withAlpha(theme.colors.text, 0.16),
      withAlpha(theme.colors.text, 0.5),
      stroke,
    );
    const parts: Part[] = [[lens, 'surface', 0]];
    if (portrait) {
      parts.push(...row('overlap', shared, withAlpha(theme.colors.text, 0.5)));
    } else {
      const top = cy + R + viewport.height * 0.02;
      // A leader drops from the overlap to the words that say what it holds.
      parts.push([
        connector(
          'overlap-callout',
          `M ${mid} ${cy + lensHalf * 0.35} L ${mid} ${top}`,
          withAlpha(theme.colors.text, 0.5),
          stroke,
          false,
        ),
        'draw',
        0.2,
      ]);
      if (shared.label)
        parts.push([
          textLayer(
            'overlap-label',
            shared.label,
            box(mid - captionW / 2, top + viewport.height * 0.012, captionW, sharedLabelH),
            {
              fontSize: captionSize,
              fontFamily: getThemeFont(context, 'title'),
              fontWeight: 'bold',
              color: theme.colors.text,
              lineHeight: LABEL_LINE_HEIGHT,
              textAlign: 'center',
            },
          ),
          'text',
          0.3,
        ]);
      if (shared.detail)
        parts.push([
          textLayer(
            'overlap-detail',
            shared.detail,
            box(
              mid - captionW / 2,
              top + viewport.height * 0.012 + sharedLabelH,
              captionW,
              captionLines * captionSize * DETAIL_LINE_HEIGHT + captionSize * 0.4,
            ),
            {
              fontSize: captionSize,
              fontFamily: getThemeFont(context, 'body'),
              color: theme.colors.text,
              lineHeight: DETAIL_LINE_HEIGHT,
              textAlign: 'center',
              maxLines: 3,
            },
          ),
          'text',
          0.4,
        ]);
    }
    layers.push(...step(parts, sharedAt, context));
  }
  return layers;
}

// ---- matrix --------------------------------------------------------------

/** Type steps a matrix may take above the shared ramp's largest. */
const MATRIX_SCALES = [1.5, 1.32] as const;

/**
 * Four ideas on two axes: a 2×2 of panels in reading order (top left, top
 * right, bottom left, bottom right), with an arrow up the side for `yAxis`
 * and one along the foot for `xAxis`.
 */
export function matrixBlock(input: MatrixBlockInput, context: TemplateContext): Layer[] {
  const crowded = asListWhenCrowded(input, context);
  if (crowded) return crowded;
  const items = itemsOf(input);
  if (conceptDrawsAs('matrix', input.items) === 'cards')
    return cardsBlock({ ...input, template: 'cards' }, context);
  const area: Frame = frame(input, context);
  const { theme, viewport } = context;
  const xAxis = String(input.xAxis ?? '').trim();
  const yAxis = String(input.yAxis ?? '').trim();
  const axisSize = themedFontSize(DETAIL_BASE * 1.05, context, false);
  const axisRoom = Math.round(axisSize * 1.9);
  const stroke = Math.max(3, Math.round(viewport.height * 0.004));
  const left = area.left + (yAxis ? axisRoom * 0.7 : 0);
  const top = area.top + (yAxis ? axisRoom : 0);
  const right = area.right;
  const bottom = area.bottom - (xAxis ? axisRoom * 1.15 : 0);
  const gap = Math.round(viewport.width * 0.014);
  const cellW = (right - left - gap) / 2;
  const cellH = (bottom - top - gap) / 2;
  const pad = Math.round(Math.min(40, Math.max(22, cellW * 0.07)));
  const ruleH = Math.max(4, Math.round(viewport.height * 0.006));
  const ruleGap = Math.round(viewport.height * 0.02);
  const chrome = pad * 2 + ruleH + ruleGap;
  // Four ideas have the whole stage between them, so their words may set a
  // step or two larger than a row of cards before they fill their cells.
  const roomy = MATRIX_SCALES.find((scale) =>
    items.every(
      (item) =>
        measureItem(item, ramp(context, scale), cellW - pad * 2).height <= (cellH - chrome) * 0.7,
    ),
  );
  const sizes = roomy
    ? ramp(context, roomy)
    : fitRamp(
        items,
        context,
        () => cellW - pad * 2,
        () => cellH - chrome,
      ).sizes;
  const measures = items.map((item) => measureItem(item, sizes, cellW - pad * 2));
  const layers = [...area.layers];
  const axisColor = withAlpha(theme.colors.text, 0.6);
  const axisText = (id: string, text: string, x: number, y: number, align: 'left' | 'right') =>
    textLayer(id, text, box(x, y, (right - left) * 0.6, axisSize * 1.4), {
      fontSize: axisSize,
      fontFamily: getThemeFont(context, 'title'),
      fontWeight: 'bold',
      color: axisColor,
      lineHeight: 1.2,
      textAlign: align,
    });
  // The axes say what the grid means, so they are there before the ideas arrive.
  if (yAxis) {
    const x = area.left + stroke;
    layers.push(
      {
        ...connector(
          'axis-y',
          `M ${x} ${bottom} L ${x} ${top + axisRoom * 0.1}`,
          axisColor,
          stroke,
        ),
        animation: entrance(context, 'draw', 0.3),
      },
      {
        ...axisText('axis-y-label', yAxis, area.left, area.top, 'left'),
        animation: entrance(context, 'text', 0.45),
      },
    );
  }
  if (xAxis) {
    const y = bottom + axisRoom * 0.35;
    layers.push(
      {
        ...connector('axis-x', `M ${left} ${y} L ${right - stroke} ${y}`, axisColor, stroke),
        animation: entrance(context, 'draw', 0.3),
      },
      {
        ...axisText(
          'axis-x-label',
          xAxis,
          right - (right - left) * 0.6,
          y + axisRoom * 0.2,
          'right',
        ),
        animation: entrance(context, 'text', 0.45),
      },
    );
  }
  items.forEach((item, index) => {
    const x = left + (index % 2) * (cellW + gap);
    const y = top + Math.floor(index / 2) * (cellH + gap);
    layers.push(
      ...step(
        [
          ...panel(`cell-${index}`, x, y, cellW, cellH, pad, ruleH, area.accent, context),
          ...words(
            itemText(
              `cell-${index}`,
              item,
              measures[index]!,
              sizes,
              x + pad,
              y + pad + ruleH + ruleGap,
              cellW - pad * 2,
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
