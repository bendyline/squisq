/**
 * Frosted Plate
 *
 * The frosted-glass plate that display titles sit on over a clear photo: a
 * rounded rect with a neutral translucent tint whose backdrop is blurred (and,
 * under light text, eased in contrast) by the renderer's ShapeLayer
 * `backdropBlur` / `backdropContrast`. The cover's `coverStyle: 'frosted'` and
 * bigText's `backdrop: 'frosted'` share it, so a video's cover and its title
 * cards wear the same glass.
 *
 * Besides the plate itself this holds what both layouts need to hug a title
 * with even padding: the padding and radius (in em of the title size), the
 * balanced word wrap measured with `estimateDisplayTextWidth`, and the optical
 * centring that puts a title's ink, not its x-height, in the middle of the glass.
 *
 * Gotchas: a plate must not sit under an opacity animation. An ancestor with
 * opacity below 1 isolates `backdrop-filter`, so the glass would show its tint
 * unblurred until the fade ends; keep fades on the text layers.
 *
 * Related files: coverBlock.ts (frosted cover), bigText.ts (frosted title card),
 * ../utils/textMetrics.ts (display text widths), ../../schemas/Doc.ts (ShapeLayer
 * backdrop fields), packages/react/src/layers/ShapeLayer.tsx (renders the filter).
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TemplateContext } from '../../schemas/BlockTemplates.js';
import { relativeLuminance } from '../../schemas/colorUtils.js';
import { estimateDisplayTextWidth } from '../utils/textMetrics.js';

/** Plate padding around the title block, in em of the title size. */
export const FROSTED_PAD_X_EM = 0.45;
export const FROSTED_PAD_Y_EM = 0.3;
/** Plate corner radius, in em of the title size. */
export const FROSTED_RADIUS_EM = 0.3;
/** Backdrop blur radius as a share of the frame's shorter side (12px at 720p). */
const FROSTED_BLUR_SHARE = 0.0167;
/**
 * Neutral plate tints. Never the theme background: on a warm theme that tinted every
 * cover brown, the haze the frosted style exists to remove.
 */
const FROSTED_TINT_UNDER_LIGHT_TEXT = 'rgba(12, 12, 14, 0.26)';
const FROSTED_TINT_UNDER_DARK_TEXT = 'rgba(250, 250, 250, 0.5)';
/**
 * Backdrop contrast under light text. The tint alone leaves glass over snow or sky pale
 * grey (about 2:1 against white text). Easing the contrast of what shows through pulls
 * the brightest tones down and leaves mid-tones (water, rock, foliage) almost as the
 * light tint shows them; dimming everything instead (brightness) made the glass read
 * dark. A white backdrop lands near 2.4:1, with the title's drop shadow doing the rest.
 */
const FROSTED_BACKDROP_CONTRAST = 0.65;

/** Whether the theme's text is light, so the plate darkens what it frosts (and the title takes a shadow). */
export function frostedUnderLightText(context: TemplateContext): boolean {
  return relativeLuminance(context.theme.colors.text) > 0.5;
}

/** Backdrop blur radius (px) for a frame. */
export function frostedBlurPx(context: TemplateContext): number {
  const { width, height } = context.viewport;
  return Math.round(FROSTED_BLUR_SHARE * Math.min(width, height));
}

/** Round a px measure to a percentage of `total` with two decimals. */
export function pct(value: number, total: number): string {
  return `${Math.round((value / total) * 10000) / 100}%`;
}

/** The plate's shape layer at `plate` (top-left corner and size, px of the viewport). */
export function frostedPlateLayer(
  id: string,
  plate: { x: number; y: number; width: number; height: number; radius: number },
  context: TemplateContext,
): Layer {
  const { viewport } = context;
  const lightText = frostedUnderLightText(context);
  return {
    type: 'shape',
    id,
    content: {
      shape: 'rect',
      fill: lightText ? FROSTED_TINT_UNDER_LIGHT_TEXT : FROSTED_TINT_UNDER_DARK_TEXT,
      borderRadius: Math.round(plate.radius),
      backdropBlur: frostedBlurPx(context),
      ...(lightText ? { backdropContrast: FROSTED_BACKDROP_CONTRAST } : {}),
    },
    position: {
      x: pct(plate.x, viewport.width),
      y: pct(plate.y, viewport.height),
      width: pct(plate.width, viewport.width),
      height: pct(plate.height, viewport.height),
    },
  };
}

/**
 * Ink extents of display type, in em above (or, for the descents, below) the baseline:
 * the x-height, capitals and figures, lowercase ascenders (taller than the capitals),
 * an accented capital (its accent is light, so it counts for less than its full
 * height), descending letters, and a comma. Calibrated on PT Serif Bold as Chromium
 * draws it, measured from 112 rendered covers: each class centres within 0.01 em.
 */
const INK_EM = {
  xHeight: 0.45,
  capital: 0.67,
  ascent: 0.71,
  accentedCapital: 0.8,
  descent: 0.2,
  comma: 0.155,
} as const;

/**
 * `TextStyle.baselineShift` (em) that centres a title's ink on its layer's middle.
 * Vertically centred text puts the middle of the x-height on the centre line, so
 * capitals and ascenders on the first line lift the visible block, and descenders on
 * the last line lower it: "Antarctic Peninsula" needs pushing down an eighth of an em,
 * "BORA BORA" a ninth, "Paraguay" hardly at all.
 */
export function opticalCentreShiftEm(lines: readonly string[]): number {
  const first = (lines[0] ?? '').normalize('NFD');
  const last = lines[lines.length - 1] ?? '';
  const top = /[A-Z]\p{M}/u.test(first)
    ? INK_EM.accentedCapital
    : /[bdfhklt]|[a-z]\p{M}/u.test(first)
      ? INK_EM.ascent
      : /[A-Z0-9]/.test(first)
        ? INK_EM.capital
        : INK_EM.xHeight;
  const bottom = /[gjpqyQ]/.test(last) ? INK_EM.descent : /[,;]/.test(last) ? INK_EM.comma : 0;
  return Math.round(((top - bottom) / 2 - INK_EM.xHeight / 2) * 1000) / 1000;
}

/** Greedy word wrap at `maxWidth` px; a word wider than the line keeps a line of its own. */
export function wrapDisplayLine(line: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of line.trim().split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || estimateDisplayTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Wrap a line into as few lines as fit `maxWidth`, then balance them: break at the
 * narrowest width that needs no more lines, so a title reads "Humberstone and /
 * Santa Laura / Saltpeter Works" rather than leaving one word alone at the bottom.
 */
export function balancedDisplayLines(line: string, fontSize: number, maxWidth: number): string[] {
  const greedy = wrapDisplayLine(line, fontSize, maxWidth);
  if (greedy.length < 2) return greedy;
  let lo = Math.max(
    ...line
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => estimateDisplayTextWidth(word, fontSize)),
  );
  let hi = maxWidth;
  if (lo >= hi) return greedy;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (wrapDisplayLine(line, fontSize, mid).length <= greedy.length) hi = mid;
    else lo = mid;
  }
  return wrapDisplayLine(line, fontSize, hi);
}

/**
 * Width (px) for a title layer drawn as `lines`: the widest line, and never narrower
 * than the renderer's own wrap allows. The renderer re-wraps any line longer than its
 * box at half an em per character, which would break the lines laid out here.
 */
export function frostedTitleBoxWidth(
  lines: readonly string[],
  fontSize: number,
  textWidth: number,
): number {
  const longestChars = Math.max(...lines.map((line) => line.length));
  return Math.max(textWidth, longestChars * fontSize * 0.5 + 1);
}
