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
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { BigTextInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import type { ViewportConfig } from '../../schemas/Viewport.js';
import { getThemeFont, themedEntrance, themedImageTreatment } from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { mapAmbientMotion } from './accentImage.js';

const BIG_TEXT_LINE_HEIGHT = 1.05;
/** Fraction of the frame the display text may span — the rest is padding. */
const BIG_TEXT_WIDTH_FRACTION = 0.92;
const BIG_TEXT_HEIGHT_FRACTION = 0.86;
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
export function fitBigTextSize(title: string, viewport: ViewportConfig): number {
  const availWidth = viewport.width * BIG_TEXT_WIDTH_FRACTION;
  const availHeight = viewport.height * BIG_TEXT_HEIGHT_FRACTION;
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

/** Radial contrast bloom centered behind the title, tinted from `background`. */
function bigTextBloom(background: string): string {
  return (
    `radial-gradient(ellipse at 50% 50%, ${withAlpha(background, 0.92)} 0%, ` +
    `${withAlpha(background, 0.78)} 38%, ${withAlpha(background, 0.32)} 66%, ` +
    `${withAlpha(background, 0)} 88%)`
  );
}

export function bigText(input: BigTextInput, context: TemplateContext): Layer[] {
  const { title = '', imageSrc, imageAlt, ambientMotion } = input;
  const { theme, viewport } = context;

  const treatment = themedImageTreatment(context, input.imageTreatment);
  const displayTitle = title.toUpperCase();
  const titleFontSize = fitBigTextSize(displayTitle, viewport);

  const layers: Layer[] = [];

  if (imageSrc) {
    // Full-bleed image with the contrast bloom concentrated behind the text,
    // so the photo stays a photo at the edges while the center guarantees
    // theme-text contrast.
    layers.push(
      {
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
      },
      {
        type: 'shape',
        id: 'bigtext-bloom',
        content: {
          shape: 'rect',
          fill: bigTextBloom(theme.colors.background),
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
    );
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
          fill: `radial-gradient(ellipse at 50% 50%, ${withAlpha(theme.colors.primary, 0.38)} 0%, ${withAlpha(theme.colors.primary, 0.14)} 48%, ${withAlpha(theme.colors.primary, 0)} 78%)`,
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
    );
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
      y: '50%',
      anchor: 'center',
      width: `${BIG_TEXT_WIDTH_FRACTION * 100}%`,
      height: `${BIG_TEXT_HEIGHT_FRACTION * 100}%`,
    },
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1 }),
  });

  return layers;
}
