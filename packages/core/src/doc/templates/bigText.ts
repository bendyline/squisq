/**
 * Big Text Template
 *
 * Thumbnail-style display card: the title in gigantic uppercase type sized
 * to fill the frame (minus a small padding margin), either over a clean
 * theme background or over a full-bleed image with a radial "contrast
 * bloom" behind the text. Deliberately shows nothing but the title.
 *
 * The bloom is tinted from `theme.colors.background` (never hard-coded
 * black), so `theme.colors.text` painted on top stays legible by
 * construction on light and dark themes alike — the same rule the managed
 * cover's scrim follows. Built for YouTube covers and social thumbnails,
 * but works as an ordinary block template too.
 *
 * `backdrop: 'frosted'` swaps the bloom for the frosted-glass plate of the
 * frosted cover (frostedPlate.ts): the photo stays clear and the title sits
 * on glass that hugs it, centred in its placement band, sized as large as
 * the glass allows within 90% of the frame width. Only with an image; the
 * plate never fades (a fading ancestor would switch its blur off).
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { BigTextInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import type { ViewportConfig } from '../../schemas/Viewport.js';
import { getThemeFont, motionEntrance, themedImageTreatment } from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { mapAmbientMotion } from './accentImage.js';
import {
  FROSTED_PAD_X_EM,
  FROSTED_PAD_Y_EM,
  FROSTED_RADIUS_EM,
  balancedDisplayLines,
  frostedPlateLayer,
  frostedTitleBoxWidth,
  frostedUnderLightText,
  opticalCentreShiftEm,
  pct,
} from './frostedPlate.js';
import { estimateDisplayTextWidth } from '../utils/textMetrics.js';

const BIG_TEXT_LINE_HEIGHT = 1.05;
/** Fraction of the frame the display text may span — the rest is padding. */
const BIG_TEXT_WIDTH_FRACTION = 0.92;
const BIG_TEXT_HEIGHT_FRACTION = 0.86;

/**
 * The band each placement fits the title into (fractions of the frame):
 * centre `y` and height. `center` is the whole padded frame; `upper` and
 * `lower` are the top and bottom halves, short of the edges.
 */
const BIG_TEXT_BANDS: Record<'center' | 'upper' | 'lower', { y: number; height: number }> = {
  center: { y: 0.5, height: BIG_TEXT_HEIGHT_FRACTION },
  upper: { y: 0.3, height: 0.44 },
  lower: { y: 0.7, height: 0.44 },
};
/**
 * Average glyph width as a fraction of font size for bold UPPERCASE display
 * type. Deliberately generous (uppercase runs wide): overestimating glyph
 * width makes the fit conservative, so real rendering wraps no more lines
 * than the estimate and the block never overflows the frame.
 */
const BIG_TEXT_CHAR_WIDTH = 0.62;
/** Readability floor for absurdly long titles. */
const BIG_TEXT_MIN_PX = 48;

/** Greedy word-wrap line count for a given per-line character budget. */
function wrappedLineCount(wordLengths: readonly number[], charsPerLine: number): number {
  let lines = 1;
  let current = 0;
  for (const length of wordLengths) {
    const withWord = current === 0 ? length : current + 1 + length;
    if (withWord <= charsPerLine) {
      current = withWord;
    } else {
      lines += 1;
      current = length;
    }
  }
  return lines;
}

/**
 * Largest font size (px, in viewport space) whose wrapped title fits the
 * frame's padded box — width-capped so the longest word stays on one line,
 * then binary-searched against the wrapped block's height.
 */
export function fitBigTextSize(
  title: string,
  viewport: ViewportConfig,
  heightFraction: number = BIG_TEXT_HEIGHT_FRACTION,
): number {
  const availWidth = viewport.width * BIG_TEXT_WIDTH_FRACTION;
  const availHeight = viewport.height * heightFraction;
  const wordLengths = title
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.length);
  if (wordLengths.length === 0) return Math.floor(availHeight / BIG_TEXT_LINE_HEIGHT);

  const longestWord = Math.max(...wordLengths);
  const widthCap = availWidth / (BIG_TEXT_CHAR_WIDTH * longestWord);
  const singleLineCap = availHeight / BIG_TEXT_LINE_HEIGHT;

  const fits = (size: number): boolean => {
    const charsPerLine = Math.max(1, Math.floor(availWidth / (size * BIG_TEXT_CHAR_WIDTH)));
    const lines = wrappedLineCount(wordLengths, charsPerLine);
    return lines * size * BIG_TEXT_LINE_HEIGHT <= availHeight;
  };

  let low = BIG_TEXT_MIN_PX;
  let high = Math.min(widthCap, singleLineCap);
  if (high <= low) return Math.max(BIG_TEXT_MIN_PX, Math.floor(high));
  if (!fits(low)) return BIG_TEXT_MIN_PX;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  // Floor, not round: the result must never exceed the caps it was fit to.
  return Math.floor(low);
}

/** Widest a frosted plate may be, as a share of the frame width. */
const BIG_TEXT_FROSTED_WIDTH_FRACTION = 0.9;
/**
 * Tallest a frosted plate may be, as a share of the frame's shorter side. Without it
 * a short name stacks into a wall of glass ("LA / PAZ" at a third of a vertical
 * frame); with it the fit prefers fewer, smaller lines.
 */
const BIG_TEXT_FROSTED_HEIGHT_SHARE = 0.45;

/** Geometry of a frosted big-text card, in px of the viewport (exported for tests and tools). */
export interface FrostedBigTextLayout {
  /** Title font size, px. */
  fontSize: number;
  /** The title as drawn, one entry per line. */
  lines: string[];
  /** The plate: top-left corner, size and corner radius. */
  plate: { x: number; y: number; width: number; height: number; radius: number };
  /** The title's box, centred on the plate with room for the font's full ascent and descent. */
  title: { cx: number; cy: number; width: number; height: number };
  /** Optical centring of the title's ink (see `opticalCentreShiftEm`). */
  baselineShift: number;
}

/**
 * Lay out a frosted big-text card: the largest size whose balanced lines, padded by
 * the plate, fit {@link BIG_TEXT_FROSTED_WIDTH_FRACTION} of the frame width and the
 * placement band's height (at most {@link BIG_TEXT_FROSTED_HEIGHT_SHARE} of the shorter
 * side). The plate is centred on the band.
 */
export function frostedBigTextLayout(
  displayTitle: string,
  viewport: ViewportConfig,
  band: { y: number; height: number } = BIG_TEXT_BANDS.center,
): FrostedBigTextLayout {
  const maxPlateWidth = viewport.width * BIG_TEXT_FROSTED_WIDTH_FRACTION;
  const maxPlateHeight = Math.min(
    viewport.height * band.height,
    Math.min(viewport.width, viewport.height) * BIG_TEXT_FROSTED_HEIGHT_SHARE,
  );
  const wrapAt = (size: number) => {
    const column = maxPlateWidth - 2 * FROSTED_PAD_X_EM * size;
    const lines = displayTitle
      .split('\n')
      .flatMap((line) => balancedDisplayLines(line, size, Math.max(1, column)));
    const width = Math.max(...lines.map((line) => estimateDisplayTextWidth(line, size)));
    return { lines, width, column };
  };
  const fits = (size: number): boolean => {
    const { lines, width, column } = wrapAt(size);
    const height = (lines.length * BIG_TEXT_LINE_HEIGHT + 2 * FROSTED_PAD_Y_EM) * size;
    return width <= column && height <= maxPlateHeight;
  };

  let low = BIG_TEXT_MIN_PX;
  let high = maxPlateHeight / (BIG_TEXT_LINE_HEIGHT + 2 * FROSTED_PAD_Y_EM);
  if (high > low && fits(low)) {
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
  }
  const fontSize = Math.floor(low);
  const { lines, width, column } = wrapAt(fontSize);
  const textWidth = Math.min(width, column);
  const textHeight = lines.length * fontSize * BIG_TEXT_LINE_HEIGHT;
  const padX = FROSTED_PAD_X_EM * fontSize;
  const padY = FROSTED_PAD_Y_EM * fontSize;
  const plateWidth = textWidth + 2 * padX;
  const plateHeight = textHeight + 2 * padY;
  const cx = viewport.width / 2;
  const cy = viewport.height * band.y;
  return {
    fontSize,
    lines,
    plate: {
      x: cx - plateWidth / 2,
      y: cy - plateHeight / 2,
      width: plateWidth,
      height: plateHeight,
      radius: FROSTED_RADIUS_EM * fontSize,
    },
    // As on the frosted cover, the box spans the padding: shrink-to-fit measures the
    // font's whole ascent and descent, more than a line of display type.
    title: {
      cx,
      cy,
      width: frostedTitleBoxWidth(lines, fontSize, textWidth),
      height: plateHeight,
    },
    baselineShift: opticalCentreShiftEm(lines),
  };
}

/** Radial contrast bloom centered behind the title, tinted from `background`. */
function bigTextBloom(background: string, centerY = 0.5): string {
  return (
    `radial-gradient(ellipse at 50% ${Math.round(centerY * 100)}%, ${withAlpha(background, 0.92)} 0%, ` +
    `${withAlpha(background, 0.78)} 38%, ${withAlpha(background, 0.32)} 66%, ` +
    `${withAlpha(background, 0)} 88%)`
  );
}

export function bigText(input: BigTextInput, context: TemplateContext): Layer[] {
  const { title = '', imageSrc, imageAlt, ambientMotion } = input;
  const { theme, viewport } = context;
  const band = BIG_TEXT_BANDS[input.placement ?? 'center'] ?? BIG_TEXT_BANDS.center;

  const treatment = themedImageTreatment(context, input.imageTreatment);
  const displayTitle = title.toUpperCase();
  const frosted = input.backdrop === 'frosted' && !!imageSrc;
  const titleFontSize = fitBigTextSize(displayTitle, viewport, band.height);

  const layers: Layer[] = [];

  if (imageSrc) {
    // Full-bleed image with the contrast bloom concentrated behind the text,
    // so the photo stays a photo at the edges while the center guarantees
    // theme-text contrast.
    layers.push({
      type: 'image',
      id: 'bigtext-image',
      content: {
        src: imageSrc,
        alt: imageAlt || title,
        fit: 'cover',
        ...(treatment ? { treatment } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: mapAmbientMotion(ambientMotion, 8) ?? {
        type: 'slowZoom',
        duration: 8,
        direction: 'in',
      },
    });
    if (!frosted) {
      layers.push({
        type: 'shape',
        id: 'bigtext-bloom',
        content: {
          shape: 'rect',
          fill: bigTextBloom(theme.colors.background, band.y),
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      });
    }
  } else {
    // Clean theme surface with a soft primary bloom so the card still has
    // depth without an image.
    layers.push(
      {
        type: 'shape',
        id: 'bigtext-bg',
        content: {
          shape: 'rect',
          fill: theme.colors.background,
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
      {
        type: 'shape',
        id: 'bigtext-tint',
        content: {
          shape: 'rect',
          fill: `radial-gradient(ellipse at 50% ${Math.round(band.y * 100)}%, ${withAlpha(theme.colors.primary, 0.38)} 0%, ${withAlpha(theme.colors.primary, 0.14)} 48%, ${withAlpha(theme.colors.primary, 0)} 78%)`,
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
    );
  }

  if (frosted) {
    const layout = frostedBigTextLayout(displayTitle, viewport, band);
    const lightText = frostedUnderLightText(context);
    layers.push(frostedPlateLayer('bigtext-plate', layout.plate, context), {
      type: 'text',
      id: 'bigtext-title',
      content: {
        text: layout.lines.join('\n'),
        style: {
          fontSize: layout.fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          verticalAlign: 'middle',
          lineHeight: BIG_TEXT_LINE_HEIGHT,
          baselineShift: layout.baselineShift,
          shadow: lightText,
          shrinkToFit: true,
        },
      },
      position: {
        x: '50%',
        y: pct(layout.title.cy, viewport.height),
        anchor: 'center',
        width: pct(layout.title.width, viewport.width),
        height: pct(layout.title.height, viewport.height),
      },
      animation: motionEntrance(context, { type: 'fadeIn', duration: 1 }),
    });
    return layers;
  }

  // The title is the whole composition: gigantic, centered, spanning the
  // frame minus the padding fraction reserved by fitBigTextSize. The size
  // here is still an estimate — `shrinkToFit` has the renderer measure the
  // real glyphs and scale down to the box, so a wide display face can never
  // spill past the frame, and the wrapped block centers on the frame middle
  // instead of hanging extra lines below it.
  layers.push({
    type: 'text',
    id: 'bigtext-title',
    content: {
      text: displayTitle,
      style: {
        fontSize: titleFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        textAlign: 'center',
        lineHeight: BIG_TEXT_LINE_HEIGHT,
        shadow: !!imageSrc,
        shrinkToFit: true,
      },
    },
    position: {
      x: '50%',
      y: `${band.y * 100}%`,
      anchor: 'center',
      width: `${BIG_TEXT_WIDTH_FRACTION * 100}%`,
      height: `${band.height * 100}%`,
    },
    animation: motionEntrance(context, { type: 'fadeIn', duration: 1 }),
  });

  return layers;
}
