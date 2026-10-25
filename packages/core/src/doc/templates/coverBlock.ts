/**
 * Cover Block Template
 *
 * Full-screen hero image with title overlay, shown before playback starts.
 * This is the "poster for the doc, displaying the
 * article's hero image with elegant title treatment.
 *
 * Features:
 * - Full-screen hero image with Ken Burns ambient motion
 * - Gradient overlay for text readability (default `coverStyle: 'scrim'`), or a clear
 *   photo with the title on a frosted-glass plate (`'frosted'`): the plate rests near
 *   the bottom, grows upward for longer titles, and stays inside the frame's centre
 *   square so a square crop (a social link card) still shows the whole title
 * - Large centered title with optional subtitle; a frosted cover can split them
 *   (`coverLayout: 'split'`), the title on a plate up top and the subtitle as a deck
 *   on its own plate below, for a vertical cover's name and hook
 * - No animation delays (shown at rest, not during playback)
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TemplateContext } from '../../schemas/BlockTemplates.js';
import type { StartBlockConfig } from '../../schemas/Doc.js';
import {
  getThemeFont,
  themedFontSize,
  themedImageTreatment,
  getMotionProfile,
  motionEntrance,
} from '../utils/themeUtils.js';
import { relativeLuminance, withAlpha } from '../../schemas/colorUtils.js';
import { mapAmbientMotion } from './accentImage.js';
import { estimateProseLineCount, estimateTextHeight } from './captionUtils.js';
import { estimateDisplayTextWidth } from '../utils/textMetrics.js';
import {
  FROSTED_PAD_X_EM,
  FROSTED_PAD_Y_EM,
  FROSTED_RADIUS_EM,
  balancedDisplayLines,
  frostedBlurPx,
  frostedPlateLayer,
  frostedTitleBoxWidth,
  frostedUnderLightText,
  opticalCentreShiftEm,
  pct,
  wrapDisplayLine,
} from './frostedPlate.js';

export { opticalCentreShiftEm } from './frostedPlate.js';
import type { CoverSlideTemplate } from '../coverSlideSettings.js';
import { bigText } from './bigText.js';
import { imageWithCaption } from './imageWithCaption.js';
import { sectionHeader } from './sectionHeader.js';
import { titleBlock } from './titleBlock.js';

/**
 * Input for coverBlock template - matches StartBlockConfig
 */
export interface CoverBlockInput {
  /** Path to hero image (omit for theme-driven background) */
  heroSrc?: string;
  /** Alt text for the hero image */
  heroAlt?: string;
  /** Title to display over the hero */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Ambient motion for the hero image */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
  /** Photo credit / artist name */
  heroCredit?: string;
  /** License identifier */
  heroLicense?: string;
  /** Per-block override for the theme's photographic image grade. */
  imageTreatment?: 'none' | 'mono' | 'duotone' | 'warm' | 'cool';
  /** How a hero cover keeps its title legible (see StartBlockConfig.coverStyle). */
  coverStyle?: 'scrim' | 'frosted';
  /** Where a frosted cover puts its subtitle (see StartBlockConfig.coverLayout). */
  coverLayout?: 'stacked' | 'split';
}

/** Base (pre-viewport-scale) font size for a full-size cover title. */
const COVER_TITLE_BASE_PX = 120;
/** Title length (chars) that still reads well at the full base size. */
const COVER_TITLE_COMFORTABLE_CHARS = 26;
/** Readability floor so very long titles never shrink to nothing. */
const COVER_TITLE_MIN_BASE_PX = 62;
/** Space kept below a hero cover's title block, as a percent of frame height. */
const COVER_HERO_BOTTOM_MARGIN_PCT = 6;

/**
 * Compute the base cover-title font size for a given title, shrinking long
 * titles so their wrapped block fits the frame. Returns the pre-viewport-scale
 * value expected by {@link themedFontSize}; short titles get the full base.
 */
export function fitCoverTitleSize(title: string): number {
  const len = title.trim().length;
  if (len <= COVER_TITLE_COMFORTABLE_CHARS) return COVER_TITLE_BASE_PX;
  const scaled = COVER_TITLE_BASE_PX * Math.sqrt(COVER_TITLE_COMFORTABLE_CHARS / len);
  return Math.max(COVER_TITLE_MIN_BASE_PX, Math.round(scaled));
}

function isStandardLightCover(context: TemplateContext): boolean {
  const { theme } = context;
  return theme.id === 'standard' && relativeLuminance(theme.colors.background) > 0.85;
}

/** One stop of the hero scrim. `pos` is the distance from the frame's BOTTOM (0..100). */
export interface CoverScrimStop {
  /** Percent up from the bottom of the frame — matches `linear-gradient(0deg, …)`. */
  pos: number;
  /** Opacity of the theme background tint at this stop. */
  alpha: number;
}

/**
 * Opacity ramp of the hero scrim, from the frame's bottom edge upward.
 *
 * The scrim is tinted from `theme.colors.background` (never a hard-coded
 * black), so `theme.colors.text` painted on top stays legible *by
 * construction* on light and dark themes alike — the same rule
 * `imageWithCaption` and `sectionHeader` follow.
 *
 * Because the tint is the theme background rather than black, the ramp has to
 * carry the readability that a black scrim used to get for free from being
 * dark: the hero photo underneath is arbitrary, so the composite of
 * scrim-over-photo only converges on the theme background where alpha is
 * high. The title band (~59%–82% from the top; see the `y` values below) is
 * therefore held at alpha ≥ 0.79, which keeps the worst case across all 11
 * built-in themes — light theme text over a black photo, or dark theme text
 * over a white one — above WCAG AA. Above that band the ramp falls away
 * quickly so the top ~40% of the hero reads as a photograph.
 */
export const COVER_SCRIM_STOPS: readonly CoverScrimStop[] = [
  { pos: 0, alpha: 0.95 },
  { pos: 38, alpha: 0.86 },
  { pos: 58, alpha: 0.4 },
  { pos: 78, alpha: 0.1 },
  { pos: 100, alpha: 0 },
];

/**
 * Scrim opacity at a vertical position, expressed the way layer positions are
 * (`y` percent DOWN from the top of the frame). Linear interpolation between
 * {@link COVER_SCRIM_STOPS} — the same ramp the CSS gradient renders.
 */
export function coverScrimAlphaAtY(yPctFromTop: number): number {
  const pos = 100 - yPctFromTop;
  const stops = COVER_SCRIM_STOPS;
  if (pos <= stops[0].pos) return stops[0].alpha;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (pos <= next.pos) {
      const t = (pos - prev.pos) / (next.pos - prev.pos);
      return prev.alpha + (next.alpha - prev.alpha) * t;
    }
  }
  return stops[stops.length - 1].alpha;
}

/** Build the hero scrim's CSS gradient, tinted from the theme background. */
function coverScrimGradient(background: string): string {
  const stops = COVER_SCRIM_STOPS.map((s) => `${withAlpha(background, s.alpha)} ${s.pos}%`);
  return `linear-gradient(0deg, ${stops.join(', ')})`;
}

/**
 * Fit display text to a frosted plate at most `maxPlateWidth` wide: balanced lines in the
 * plate's column, the size stepping down (to `minSize`) while the text needs more than
 * `maxLines` lines or a single word overflows the column.
 */
function fitFrostedText(
  text: string,
  size: number,
  minSize: number,
  maxPlateWidth: number,
  maxLines: number,
): { fontSize: number; lines: string[]; column: number; textWidth: number } {
  const wrapAt = (s: number) => {
    const column = maxPlateWidth - 2 * FROSTED_PAD_X_EM * s;
    const lines = text.split('\n').flatMap((line) => balancedDisplayLines(line, s, column));
    const width = Math.max(...lines.map((line) => estimateDisplayTextWidth(line, s)));
    return { lines, width, column };
  };
  let fontSize = size;
  let wrapped = wrapAt(fontSize);
  while (
    (wrapped.lines.length > maxLines || wrapped.width > wrapped.column) &&
    fontSize > minSize
  ) {
    fontSize = Math.max(minSize, Math.floor(fontSize * 0.95));
    wrapped = wrapAt(fontSize);
  }
  return {
    fontSize,
    lines: wrapped.lines,
    column: wrapped.column,
    textWidth: Math.min(wrapped.width, wrapped.column),
  };
}

/** Line height of a frosted cover's title (display type sits tighter than the scrim's 1.4). */
const FROSTED_LINE_HEIGHT = 1.12;
/** Lines a frosted title may take before its size steps down. */
const FROSTED_MAX_LINES = 3;
/** Widest the plate may be, as a share of the frame's centre square (its shorter side). */
const FROSTED_SQUARE_SHARE = 0.9;
/**
 * Gap below the plate, in percent of frame height. A tall frame keeps more: a feed shows
 * a vertical video's middle 3:4, and the Shorts and Reels players lay their captions and
 * buttons over its bottom fifth.
 */
const FROSTED_BOTTOM_MARGIN_PCT = { wide: 7, tall: 17 } as const;
/**
 * Gap above a split cover's title plate, in percent of frame height: the bottom margin
 * mirrored, so a feed's 3:4 crop of a 9:16 frame (Instagram's grid starts 12.5% down, the
 * Shorts shelf about 8%) leaves as much room over the title as under the deck.
 */
const FROSTED_TOP_MARGIN_PCT = FROSTED_BOTTOM_MARGIN_PCT;
/** Subtitle size (pre-viewport-scale), as on the scrim cover. */
const COVER_SUBTITLE_BASE_PX = 40;
/**
 * A split cover's deck (its subtitle set as display type): base size, pre-viewport-scale.
 * It scales as a title does, so it stays about 0.63 of the split title in every frame:
 * 80px under a 126px title on a 1080×1920 cover, which a vertical frame's title scale
 * (0.7) would otherwise shrink below the body-scaled subtitle floor.
 */
const COVER_DECK_BASE_PX = 114;
/** A split cover's title starts this much larger than a stacked one's: it has the top to itself. */
const FROSTED_SPLIT_TITLE_SCALE = 1.5;
/** Lines a deck may take before its size steps down. */
const FROSTED_DECK_MAX_LINES = 3;
/** Narrowest gap a split cover leaves between its plates, in em of the title size. */
const FROSTED_SPLIT_MIN_GAP_EM = 0.5;

/** Geometry of a frosted cover, in px of the viewport (exported for tests and tools). */
export interface FrostedCoverLayout {
  /** Title font size, px. */
  fontSize: number;
  /** The title as drawn, one entry per line. */
  lines: string[];
  /** The plate: top-left corner, size and corner radius. */
  plate: { x: number; y: number; width: number; height: number; radius: number };
  /** The title's box: as wide as its longest line, centred on the title block with room for the font's full ascent and descent. */
  title: { cx: number; cy: number; width: number; height: number };
  /** The subtitle's box: under the title inside the plate, or centred on `subtitlePlate` when split. */
  subtitle?: {
    cx: number;
    cy: number;
    width: number;
    height: number;
    fontSize: number;
    lines: string[];
    /** Split covers only: optical centring of the deck's ink (see {@link opticalCentreShiftEm}). */
    baselineShift?: number;
  };
  /** Split covers only: the subtitle's own plate near the bottom (`plate` then sits near the top). */
  subtitlePlate?: { x: number; y: number; width: number; height: number; radius: number };
  /** Optical centring of the title's ink (see {@link opticalCentreShiftEm}). */
  baselineShift: number;
  /** Backdrop blur radius, px. */
  blur: number;
}

/**
 * Lay out a frosted cover. The title takes at most {@link FROSTED_MAX_LINES} balanced
 * lines in a column as wide as the plate allows (stepping its size down to the cover
 * minimum when it needs more); the plate wraps it with even padding, its bottom edge
 * a fixed margin above the frame's, so a longer title grows the plate upward. Every
 * part of it stays inside the centre square of a wide frame.
 *
 * `'split'` moves the title's plate to a fixed margin below the frame's top, starting the
 * title {@link FROSTED_SPLIT_TITLE_SCALE} times larger, and gives the subtitle a plate of
 * its own where the stacked plate rests, its text set as a display deck (the title's face
 * at about two-thirds the title's size, up to {@link FROSTED_DECK_MAX_LINES} balanced
 * lines before it steps down).
 */
export function frostedCoverLayout(
  title: string,
  subtitle: string | undefined,
  context: TemplateContext,
  coverLayout: 'stacked' | 'split' = 'stacked',
): FrostedCoverLayout {
  const { width: frameW, height: frameH } = context.viewport;
  const shortSide = Math.min(frameW, frameH);
  const maxPlateWidth = FROSTED_SQUARE_SHARE * shortSide;
  const minSize = themedFontSize(COVER_TITLE_MIN_BASE_PX, context, true);

  const tall = frameH > frameW;
  const marginPct = tall ? FROSTED_BOTTOM_MARGIN_PCT.tall : FROSTED_BOTTOM_MARGIN_PCT.wide;
  const plateBottom = frameH * (1 - marginPct / 100);
  const cx = frameW / 2;
  /** The title fitted from `scale` × its cover size, with its plate padding and box. */
  const fitTitle = (scale: number) => {
    const fit = fitFrostedText(
      title,
      Math.round(scale * themedFontSize(fitCoverTitleSize(title), context, true)),
      minSize,
      maxPlateWidth,
      FROSTED_MAX_LINES,
    );
    const textHeight = fit.lines.length * fit.fontSize * FROSTED_LINE_HEIGHT;
    const padX = FROSTED_PAD_X_EM * fit.fontSize;
    const padY = FROSTED_PAD_Y_EM * fit.fontSize;
    return {
      ...fit,
      textHeight,
      padX,
      padY,
      radius: FROSTED_RADIUS_EM * fit.fontSize,
      // The box spans the plate's padding too: shrink-to-fit measures the font's whole
      // ascent and descent (about 1.3 em), which overflows a box of 1.12 em lines and
      // would scale every title down by up to 14%.
      box: (plateY: number) => ({
        cx,
        cy: plateY + padY + textHeight / 2,
        width: frostedTitleBoxWidth(fit.lines, fit.fontSize, fit.textWidth),
        height: textHeight + 2 * padY,
      }),
    };
  };

  if (coverLayout === 'split' && subtitle?.trim()) {
    const { fontSize, lines, textWidth, textHeight, padX, padY, radius, box } =
      fitTitle(FROSTED_SPLIT_TITLE_SCALE);
    const deckMin = themedFontSize(COVER_SUBTITLE_BASE_PX, context, false);
    const deck = fitFrostedText(
      subtitle.trim(),
      Math.max(deckMin, themedFontSize(COVER_DECK_BASE_PX, context, true)),
      deckMin,
      maxPlateWidth,
      FROSTED_DECK_MAX_LINES,
    );
    const deckPadX = FROSTED_PAD_X_EM * deck.fontSize;
    const deckHeight =
      deck.lines.length * deck.fontSize * FROSTED_LINE_HEIGHT +
      2 * FROSTED_PAD_Y_EM * deck.fontSize;
    const deckWidth = deck.textWidth + 2 * deckPadX;
    const topPct = tall ? FROSTED_TOP_MARGIN_PCT.tall : FROSTED_TOP_MARGIN_PCT.wide;
    const titlePlate = {
      x: cx - (textWidth + 2 * padX) / 2,
      y: (frameH * topPct) / 100,
      width: textWidth + 2 * padX,
      height: textHeight + 2 * padY,
      radius,
    };
    const deckPlate = {
      x: cx - deckWidth / 2,
      y: plateBottom - deckHeight,
      width: deckWidth,
      height: deckHeight,
      // The title's corners, so the two plates read as a pair.
      radius: Math.min(radius, deckHeight / 2),
    };
    const gap = deckPlate.y - (titlePlate.y + titlePlate.height);
    if (gap >= FROSTED_SPLIT_MIN_GAP_EM * fontSize) {
      return {
        fontSize,
        lines,
        plate: titlePlate,
        title: box(titlePlate.y),
        subtitle: {
          cx,
          cy: deckPlate.y + deckHeight / 2,
          width: frostedTitleBoxWidth(deck.lines, deck.fontSize, deck.textWidth),
          height: deckHeight,
          fontSize: deck.fontSize,
          lines: deck.lines,
          baselineShift: opticalCentreShiftEm(deck.lines),
        },
        subtitlePlate: deckPlate,
        baselineShift: opticalCentreShiftEm(lines),
        blur: frostedBlurPx(context),
      };
    }
  }

  const { fontSize, lines, column, textWidth, textHeight, padX, padY, radius, box } = fitTitle(1);

  let sub:
    { lines: string[]; width: number; height: number; fontSize: number; gap: number } | undefined;
  if (subtitle?.trim()) {
    const subSize = themedFontSize(COVER_SUBTITLE_BASE_PX, context, false);
    const subLines = subtitle.split('\n').flatMap((line) => wrapDisplayLine(line, subSize, column));
    sub = {
      lines: subLines,
      width: Math.min(
        column,
        Math.max(...subLines.map((l) => estimateDisplayTextWidth(l, subSize))),
      ),
      height: subLines.length * subSize * 1.3,
      fontSize: subSize,
      gap: 0.3 * fontSize,
    };
  }

  const plateWidth = Math.max(textWidth, sub?.width ?? 0) + 2 * padX;
  const plateHeight = textHeight + (sub ? sub.gap + sub.height : 0) + 2 * padY;
  const plateY = plateBottom - plateHeight;

  return {
    fontSize,
    lines,
    plate: {
      x: cx - plateWidth / 2,
      y: plateY,
      width: plateWidth,
      height: plateHeight,
      radius,
    },
    title: box(plateY),
    ...(sub
      ? {
          subtitle: {
            cx,
            cy: plateY + padY + textHeight + sub.gap + sub.height / 2,
            width: Math.max(
              sub.width,
              Math.max(...sub.lines.map((l) => l.length)) * sub.fontSize * 0.5 + 1,
            ),
            height: sub.height,
            fontSize: sub.fontSize,
            lines: sub.lines,
          },
        }
      : {}),
    baselineShift: opticalCentreShiftEm(lines),
    blur: frostedBlurPx(context),
  };
}

/** The frosted plate, title and subtitle layers that sit over a clear hero. */
function frostedCoverLayers(input: CoverBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport } = context;
  const layout = frostedCoverLayout(input.title, input.subtitle, context, input.coverLayout);
  const lightText = frostedUnderLightText(context);
  const layers: Layer[] = [
    frostedPlateLayer('cover-plate', layout.plate, context),
    {
      type: 'text',
      id: 'cover-title',
      content: {
        text: layout.lines.join('\n'),
        style: {
          fontSize: layout.fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          verticalAlign: 'middle',
          lineHeight: FROSTED_LINE_HEIGHT,
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
      animation: getMotionProfile(context).coverWordReveal
        ? { type: 'wordReveal', duration: 0.5, delay: 0.1, stagger: 0.12 }
        : { type: 'fadeIn', duration: 0.8 },
    },
  ];
  if (layout.subtitle && layout.subtitlePlate) {
    // Split: the deck is display type on its own glass, styled as a smaller title.
    layers.push(frostedPlateLayer('cover-subtitle-plate', layout.subtitlePlate, context), {
      type: 'text',
      id: 'cover-subtitle',
      content: {
        text: layout.subtitle.lines.join('\n'),
        style: {
          fontSize: layout.subtitle.fontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          verticalAlign: 'middle',
          lineHeight: FROSTED_LINE_HEIGHT,
          baselineShift: layout.subtitle.baselineShift,
          shadow: lightText,
          shrinkToFit: true,
        },
      },
      position: {
        x: '50%',
        y: pct(layout.subtitle.cy, viewport.height),
        anchor: 'center',
        width: pct(layout.subtitle.width, viewport.width),
        height: pct(layout.subtitle.height, viewport.height),
      },
      animation: motionEntrance(context, { type: 'fadeIn', duration: 0.8, delay: 0.2 }),
    });
  } else if (layout.subtitle) {
    layers.push({
      type: 'text',
      id: 'cover-subtitle',
      content: {
        text: layout.subtitle.lines.join('\n'),
        style: {
          fontSize: layout.subtitle.fontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'normal',
          color: lightText ? withAlpha(theme.colors.text, 0.86) : theme.colors.textMuted,
          textAlign: 'center',
          verticalAlign: 'middle',
          lineHeight: 1.3,
          shrinkToFit: true,
        },
      },
      position: {
        x: '50%',
        y: pct(layout.subtitle.cy, viewport.height),
        anchor: 'center',
        width: pct(layout.subtitle.width, viewport.width),
        height: pct(layout.subtitle.height, viewport.height),
      },
      animation: motionEntrance(context, { type: 'fadeIn', duration: 0.8, delay: 0.2 }),
    });
  }
  return layers;
}

/**
 * Generate cover block layers from StartBlockConfig.
 */
export function coverBlock(input: CoverBlockInput, context: TemplateContext): Layer[] {
  const treatment = themedImageTreatment(context, input.imageTreatment);
  const { heroSrc, heroAlt, title, subtitle, ambientMotion, heroCredit, heroLicense } = input;
  const { theme, layout, viewport } = context;
  const standardLightCover = !heroSrc && isStandardLightCover(context);

  // Scale font sizes for viewport - cover titles are larger than regular title blocks.
  // The cover title wraps within maxTextWidth but does not otherwise shrink, so a long
  // title (e.g. "Seattle: The Emerald City That Rebuilt Itself on Top of Itself") wrapped
  // to three 120px lines overflows the frame and is clipped by the player controls.
  // Auto-fit the base size to title length so long titles stay within the frame. The
  // wrapped title's total height grows with fontSize² × length (line count ∝ length ×
  // fontSize / width, line height ∝ fontSize), so scaling the base by √(threshold/length)
  // keeps the wrapped block's area roughly constant past the threshold. Short titles are
  // unaffected (scale clamps at 1).
  const titleFontSize = themedFontSize(fitCoverTitleSize(title), context, true);
  const subtitleFontSize = themedFontSize(COVER_SUBTITLE_BASE_PX, context, false);

  // Where the title and subtitle land on the solid-background cover. The
  // accent rule hangs from the title's estimated bottom edge (1.4 is the text
  // layer's default line height) so it can never cut through a wrapped title
  // the way a fixed slot did; with a subtitle it stops halfway to the
  // subtitle's top edge when the two are closer than the preferred gap.
  // The height counts explicit `\n` breaks too (a title such as a short link
  // may arrive pre-broken), and the title layer is a box with `shrinkToFit`,
  // so the renderer centres the wrapped block on its anchor exactly as this
  // estimate assumes instead of hanging extra lines below it.
  const titleYPct = subtitle ? parseFloat(layout.primaryY) : 50;
  const maxWidthPx = (parseFloat(layout.maxTextWidth) / 100) * viewport.width;
  const titleH = Math.max(
    estimateTextHeight(title, titleFontSize, maxWidthPx, 1.4),
    estimateProseLineCount(title, titleFontSize, maxWidthPx) * titleFontSize * 1.4,
  );
  const px = (v: number) => (v / viewport.height) * 100;
  const subH = subtitle ? estimateTextHeight(subtitle, subtitleFontSize, maxWidthPx, 1.5) : 0;
  const titleBottomPct = titleYPct + px(titleH / 2);
  let accentYPct = titleBottomPct + px(40);

  // Over a hero the title sits low, in the scrim's opaque band: 75%, or 70%
  // above a subtitle at 82%. A title of several lines lifts its anchor just
  // enough that the centred block ends above the frame's bottom margin (or
  // the subtitle's top edge) rather than running off the frame.
  const heroTitleBasePct = subtitle ? 70 : 75;
  const heroTitleLimitPct = subtitle ? 82 - px(subH / 2) : 100 - COVER_HERO_BOTTOM_MARGIN_PCT;
  const heroTitleYPct = Math.min(heroTitleBasePct, heroTitleLimitPct - px(titleH / 2));
  if (subtitle) {
    const subtitleTopPct = parseFloat(layout.secondaryY) - px(subH / 2);
    accentYPct = Math.max(
      titleBottomPct,
      Math.min(accentYPct, (titleBottomPct + subtitleTopPct) / 2),
    );
  }

  const layers: Layer[] = [];

  if (heroSrc) {
    // Hero image path: full-screen image with gradient overlay for text readability
    const imageAnimation = mapAmbientMotion(ambientMotion);

    layers.push({
      type: 'image',
      id: 'cover-hero',
      content: {
        src: heroSrc,
        alt: heroAlt || title,
        fit: 'cover',
        credit: heroCredit,
        license: heroLicense,
        ...(treatment ? { treatment } : {}),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: imageAnimation,
    });
    // Frosted: the photo stays clear, and the title brings its own plate.
    if (input.coverStyle === 'frosted') return [...layers, ...frostedCoverLayers(input, context)];
    layers.push({
      type: 'shape',
      id: 'cover-gradient',
      content: {
        shape: 'rect',
        fill: coverScrimGradient(theme.colors.background),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    });
  } else {
    if (standardLightCover) {
      // Standard Light needs a restrained cover-poster treatment; a
      // full-strength primary radial hotspot overwhelms dark serif text
      // and makes the subtitle muddy.
      layers.push(
        {
          type: 'shape',
          id: 'cover-bg',
          content: {
            shape: 'rect',
            fill: theme.colors.background,
          },
          position: { x: 0, y: 0, width: '100%', height: '100%' },
        },
        {
          type: 'shape',
          id: 'cover-bg-tint',
          content: {
            shape: 'rect',
            fill: `radial-gradient(ellipse at 50% 40%, ${withAlpha(theme.colors.primary, 0.16)} 0%, ${withAlpha(theme.colors.primary, 0.07)} 38%, ${withAlpha(theme.colors.primary, 0)} 78%)`,
          },
          position: { x: 0, y: 0, width: '100%', height: '100%' },
        },
      );
    } else {
      // Non-Standard themes keep the existing dramatic radial cover look.
      layers.push({
        type: 'shape',
        id: 'cover-bg',
        content: {
          shape: 'rect',
          fill: `radial-gradient(ellipse at 50% 40%, ${theme.colors.primary} 0%, ${theme.colors.background} 100%)`,
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      });
    }

    // Subtle decorative accent line below the title's wrapped extent
    layers.push({
      type: 'shape',
      id: 'cover-accent',
      content: {
        shape: 'rect',
        fill: standardLightCover
          ? withAlpha(theme.colors.primary, 0.24)
          : 'rgba(255, 255, 255, 0.2)',
      },
      position: {
        x: '35%',
        y: `${accentYPct}%`,
        width: '30%',
        height: '2px',
      },
    });
  }

  // Title - positioned lower when over hero, centered when over solid background
  layers.push({
    type: 'text',
    id: 'cover-title',
    content: {
      text: title,
      style: {
        fontSize: titleFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: theme.colors.text,
        textAlign: 'center',
        shadow: !standardLightCover,
        shrinkToFit: true,
      },
    },
    position: {
      x: '50%',
      y: heroSrc ? `${Math.round(heroTitleYPct * 100) / 100}%` : `${titleYPct}%`,
      anchor: 'center',
      width: layout.maxTextWidth,
      height: `${Math.round(px(titleH) * 100) / 100}%`,
    },
    // No animation delay - shown immediately at rest. Word-by-word reveal is
    // a profile opt-in (off by default: the cover doubles as the poster).
    animation: getMotionProfile(context).coverWordReveal
      ? { type: 'wordReveal', duration: 0.5, delay: 0.1, stagger: 0.12 }
      : { type: 'fadeIn', duration: 0.8 },
  });

  // Add subtitle if provided
  if (subtitle) {
    layers.push({
      type: 'text',
      id: 'cover-subtitle',
      content: {
        text: subtitle,
        style: {
          fontSize: subtitleFontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: standardLightCover ? 'bold' : 'normal',
          color: standardLightCover ? withAlpha(theme.colors.text, 0.78) : theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: 1.5,
        },
      },
      position: {
        x: '50%',
        y: heroSrc ? '82%' : layout.secondaryY,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: motionEntrance(context, { type: 'fadeIn', duration: 0.8, delay: 0.2 }),
    });
  }

  return layers;
}

/**
 * Convert StartBlockConfig to CoverBlockInput.
 */
export function startBlockToCoverInput(config: StartBlockConfig): CoverBlockInput {
  return {
    heroSrc: config.heroSrc,
    heroAlt: config.heroAlt,
    title: config.title,
    subtitle: config.subtitle,
    ambientMotion: config.ambientMotion,
    heroCredit: config.heroCredit,
    heroLicense: config.heroLicense,
    ...(config.coverStyle ? { coverStyle: config.coverStyle } : {}),
    ...(config.coverLayout ? { coverLayout: config.coverLayout } : {}),
  };
}

/**
 * Expand a StartBlockConfig into a renderable Block.
 * This is used by the player to render the cover block at rest.
 */
export function expandCoverBlock(
  config: StartBlockConfig,
  context: TemplateContext,
  template: CoverSlideTemplate = 'cover',
): Layer[] {
  const input = startBlockToCoverInput(config);
  const base = {
    id: 'cover-block',
    duration: 0,
    audioSegment: -1,
  };

  if (template === 'title') {
    return titleBlock(
      {
        ...base,
        template: 'title',
        title: input.title,
        subtitle: input.subtitle,
      },
      context,
    );
  }

  if (template === 'sectionHeader') {
    return sectionHeader(
      {
        ...base,
        template: 'sectionHeader',
        title: input.title,
        imageSrc: input.heroSrc,
        imageAlt: input.heroAlt,
        ambientMotion: input.ambientMotion,
      },
      context,
    );
  }

  if (template === 'bigText' || template === 'bigTextImage') {
    // The image variant needs a hero; without one it degrades to the clean
    // text-only card rather than rendering an empty image layer.
    const useHero = template === 'bigTextImage' && !!input.heroSrc;
    return bigText(
      {
        ...base,
        template: 'bigText',
        title: input.title,
        ...(useHero
          ? {
              imageSrc: input.heroSrc,
              imageAlt: input.heroAlt ?? input.title,
              ambientMotion: input.ambientMotion,
            }
          : {}),
      },
      context,
    );
  }

  if (template === 'imageWithCaption') {
    // This appearance fundamentally needs an image. Documents without one
    // retain a useful title card instead of rendering an empty image layer.
    if (!input.heroSrc) {
      return titleBlock(
        {
          ...base,
          template: 'title',
          title: input.title,
          subtitle: input.subtitle,
        },
        context,
      );
    }
    return imageWithCaption(
      {
        ...base,
        template: 'imageWithCaption',
        imageSrc: input.heroSrc,
        imageAlt: input.heroAlt ?? input.title,
        caption: input.title,
        subtitle: input.subtitle,
        ambientMotion: input.ambientMotion,
        imageCredit: input.heroCredit,
        imageLicense: input.heroLicense,
        isTitle: true,
      },
      context,
    );
  }

  return coverBlock(input, context);
}
