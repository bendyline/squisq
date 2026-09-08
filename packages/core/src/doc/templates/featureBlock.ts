/**
 * Feature Block Templates — `leftFeature` and `rightFeature`
 *
 * Pairs a "feature" image on one side of the block with a title + body
 * paragraph on the other. The two templates are mirror images, so the
 * actual layer-builder lives here once and the per-side template files
 * just call it with a `side` parameter.
 *
 * Used for editorial layouts like product highlights, profile cards,
 * and section intros where a single image deserves to sit next to a
 * short text block rather than behind it (which is what
 * `imageWithCaption` does).
 */

import type { Layer } from '../../schemas/Doc.js';
import type {
  LeftFeatureInput,
  RightFeatureInput,
  TemplateContext,
} from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  themedEntrance,
  themedFontSize,
  themedImageTreatment,
} from '../utils/themeUtils.js';
import { estimateProseLineCount, fitProse } from './captionUtils.js';

type FeatureInput = LeftFeatureInput | RightFeatureInput;

const TITLE_LINE_HEIGHT = 1.2;
const BODY_LINE_HEIGHT = 1.5;

/**
 * Renderer glyph model: `TextLayer.wrapText` breaks plain text at
 * `floor(width / (fontSize * 0.5))` characters, regardless of script or
 * face. That is a fair average for the Latin sans/serif faces the built-in
 * themes use, but CJK ideographs and emoji paint at roughly 1em, and a
 * monospace title face at ~0.6em, so lines the renderer considers full run
 * well past the column. The helpers below estimate the real painted width
 * of the lines the renderer will produce, so a template can hand it a
 * narrower wrap box and keep every line inside the column.
 */
const RENDERER_CHAR_EM = 0.5;
const MONO_CHAR_EM = 0.6;
const WIDE_CHAR_EM = 1.0;
// Hangul Jamo, CJK symbols/kana/ideographs, Yi, Hangul syllables, CJK
// compatibility, vertical forms, fullwidth forms — plus emoji.
const WIDE_GLYPH_RE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;
const MONO_FAMILY_RE = /mono|courier|consolas|menlo|fira code|source code/i;

function isMonoFamily(fontFamily: string): boolean {
  return MONO_FAMILY_RE.test(fontFamily);
}

/** Estimated painted width of one rendered line, in em. */
function estimateLineEm(line: string, mono: boolean): number {
  let em = 0;
  for (const char of line) {
    em += WIDE_GLYPH_RE.test(char) ? WIDE_CHAR_EM : mono ? MONO_CHAR_EM : RENDERER_CHAR_EM;
  }
  return em;
}

/**
 * Mirror of the renderer's `wrapText`, returning the lines it will paint for
 * a wrap box `boxWidthPx` wide (each `\n` segment wraps independently).
 */
function simulateRendererLines(text: string, fontSize: number, boxWidthPx: number): string[] {
  const charsPerLine = Math.floor(boxWidthPx / (fontSize * RENDERER_CHAR_EM));
  const lines: string[] = [];
  for (const segment of text.split('\n')) {
    if (!segment.trim() || charsPerLine <= 0) {
      lines.push(segment);
      continue;
    }
    let current = '';
    for (const word of segment.split(/\s+/)) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= charsPerLine) {
        current = test;
        continue;
      }
      if (current) lines.push(current);
      let remaining = word;
      while (remaining.length > charsPerLine) {
        lines.push(remaining.slice(0, charsPerLine));
        remaining = remaining.slice(charsPerLine);
      }
      current = remaining;
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Width to hand the renderer as the layer's wrap box so that every line it
 * paints stays inside `columnWidthPx`. Latin text in a proportional face
 * gets the full column; text carrying wide glyphs (CJK, emoji) or set in a
 * monospace face gets a narrower box — the renderer then breaks earlier and
 * the painted lines land on the column edge instead of past it. Floors at
 * half the column: a run of ideographs paints at exactly the column width
 * from there (1em per glyph × column/1em glyphs per line).
 */
export function fitWrapWidth(
  text: string,
  fontSize: number,
  columnWidthPx: number,
  fontFamily: string,
): number {
  const mono = isMonoFamily(fontFamily);
  if (!mono && !WIDE_GLYPH_RE.test(text)) return columnWidthPx;

  const floor = columnWidthPx * 0.5;
  const step = columnWidthPx * 0.02;
  let width = columnWidthPx;
  while (width > floor) {
    const lines = simulateRendererLines(text, fontSize, width);
    const widest = Math.max(...lines.map((line) => estimateLineEm(line, mono))) * fontSize;
    if (widest <= columnWidthPx) return width;
    width -= step;
  }
  return floor;
}

/**
 * Build the layer list for either feature template. Layers are in
 * back-to-front order: background, image, then text.
 */
function buildFeatureLayers(
  input: FeatureInput,
  context: TemplateContext,
  side: 'left' | 'right',
): Layer[] {
  const { imageSrc, imageAlt, imageWidth, imageHeight } = input;
  const title = input.title?.trim() ?? '';
  const body = input.body?.trim() ?? '';
  const { theme, layout, viewport } = context;

  const treatment = themedImageTreatment(context, input.imageTreatment);
  // Treat the image as "sized" when the host gave us an explicit width
  // or height — that's our cue that the user resized the image in the
  // editor and we should respect that as a sizing hint instead of
  // stretching the image to fill the whole half.
  const sized = (imageWidth ?? 0) > 0 || (imageHeight ?? 0) > 0;
  // In portrait the image stacks above the text rather than splitting
  // horizontally — same flag the twoColumn template uses, so the two
  // behave consistently on narrow viewports.
  const stack = layout.stackColumns;

  const titleFont = getThemeFont(context, 'title');
  const bodyFont = getThemeFont(context, 'body');
  const titleBaseSize = themedFontSize(48, context, true);
  const titleMinSize = themedFontSize(30, context, true);
  const bodyBaseSize = themedFontSize(24, context, false);
  const bodyMinSize = themedFontSize(18, context, false);

  // Image takes the full left or right half. The text column gets the
  // opposite half, with a comfortable inset so the text doesn't kiss
  // the image edge or the card border. All values are percentages of
  // the block viewport so they scale with the card size.
  //
  // When the image is "sized" we shrink it inside its half: the half
  // still claims the space (so the text column stays the same width
  // and the layout doesn't shift around when dimensions are toggled)
  // but the image itself sits centered with padding around it. The
  // sized box uses a square envelope sized to the smaller dimension of
  // its half so the image breathes regardless of viewport aspect.
  let imgX: string;
  let imgY: string;
  let imgW: string;
  let imgH: string;
  let imageFit: 'cover' | 'contain';
  if (stack) {
    imgX = '0';
    imgY = '0';
    imgW = '100%';
    imgH = '50%';
    imageFit = sized ? 'contain' : 'cover';
  } else if (sized) {
    // 90% of the half (with explicit aspect via fit='contain') so the
    // image keeps its natural proportions and never touches the card
    // edges. We don't try to honor the literal pixel value — block
    // viewports are designed in their own coordinate space — but the
    // *intent* (smaller image, padded, centered) is what comes through.
    const halfStart = side === 'left' ? 5 : 55; // %
    imgX = `${halfStart}%`;
    imgY = '5%';
    imgW = '40%';
    imgH = '90%';
    imageFit = 'contain';
  } else {
    imgX = side === 'left' ? '0' : '50%';
    imgY = '0';
    imgW = '50%';
    imgH = '100%';
    imageFit = 'cover';
  }

  // Text-column geometry. `textX` is the LEFT edge of the column when
  // the side is "left" (image left, text right); when the side is
  // "right" the column occupies the left half, inset from the card edge.
  // The mirror lives in the layout only — fully right-aligned
  // (ragged-left) running text on rightFeature was genuinely hard to read.
  const COLUMN_INSET = 4; // % of block width — padding from card edge / divider
  const textColumnWidth = stack ? 90 : 42;
  const textXPct = stack
    ? (100 - textColumnWidth) / 2
    : side === 'left'
      ? 50 + COLUMN_INSET // text column starts just past the divider
      : COLUMN_INSET + 2; // left edge of the left-half text column
  const textX = `${textXPct}%`;
  const columnWidthPx = (textColumnWidth / 100) * viewport.width;
  const textAnchor = 'top-left';
  const textAlign = 'left' as const;

  // Vertical band the text stack may occupy. Landscape keeps 8% clear at
  // the top and 10% at the bottom — the extra slack below absorbs faces
  // that wrap a line or two earlier than the renderer's 0.5em estimate.
  // In the stacked (portrait) layout the band sits under the image half.
  const bandTop = (stack ? 0.56 : 0.08) * viewport.height;
  const bandBottom = (stack ? 0.92 : 0.9) * viewport.height;
  const bandHeight = bandBottom - bandTop;

  // Title: step the size down for a long heading so it never claims more
  // than ~45% of the band, and clamp at the floor for the pathological case.
  const titleWrapWidth = title ? fitWrapWidth(title, titleBaseSize, columnWidthPx, titleFont) : 0;
  const titleFit = title
    ? fitProse({
        text: title,
        baseFontSize: titleBaseSize,
        minFontSize: titleMinSize,
        maxWidthPx: titleWrapWidth,
        maxHeightPx: bandHeight * 0.45,
        lineHeight: TITLE_LINE_HEIGHT,
      })
    : null;
  const titleLines = titleFit
    ? Math.min(
        estimateProseLineCount(title, titleFit.fontSize, titleWrapWidth),
        titleFit.maxLines ?? Number.POSITIVE_INFINITY,
      )
    : 0;
  const titleHeight = titleFit ? titleLines * titleFit.fontSize * TITLE_LINE_HEIGHT : 0;

  // Breathing room between the title's last line and the body's first.
  const gap = title && body ? Math.round(titleBaseSize * 0.6) : 0;

  // Body: whatever height the band has left under the title. Shrink to fit,
  // then clamp with an ellipsis at the readable floor.
  const bodyWrapWidth = body ? fitWrapWidth(body, bodyBaseSize, columnWidthPx, bodyFont) : 0;
  const bodyFit = body
    ? fitProse({
        text: body,
        baseFontSize: bodyBaseSize,
        minFontSize: bodyMinSize,
        maxWidthPx: bodyWrapWidth,
        maxHeightPx: Math.max(bodyMinSize * BODY_LINE_HEIGHT, bandHeight - titleHeight - gap),
        lineHeight: BODY_LINE_HEIGHT,
      })
    : null;
  const bodyHeight = bodyFit?.heightPx ?? 0;

  // Centre the measured stack on the band's midpoint (≈ where the old fixed
  // 42% / 55% slots put a one-line title + short body), never above the top.
  const stackHeight = titleHeight + gap + bodyHeight;
  const stackTop = Math.max(bandTop, bandTop + (bandHeight - stackHeight) / 2);
  const titleY = stackTop;
  const bodyY = stackTop + titleHeight + gap;
  const pctY = (px: number) => `${((px / viewport.height) * 100).toFixed(2)}%`;
  const pctW = (px: number) =>
    px >= columnWidthPx ? `${textColumnWidth}%` : `${((px / viewport.width) * 100).toFixed(2)}%`;

  // Paint our own background so the text column has a theme-paired
  // surface to sit on. The host wrapper's surface isn't always theme-
  // aware (e.g. the InlinePreviewGutter card uses a fixed light SVG
  // background), and `theme.colors.text` is only guaranteed legible
  // against `theme.colors.background` — themes like Gezellig pair
  // cream text with a dark warm-brown background, which would
  // disappear on a light wrapper. Matching the convention every other
  // text-bearing template uses (see twoColumn / listBlock).
  const layers: Layer[] = [
    {
      type: 'shape',
      id: 'feature-bg',
      content: { shape: 'rect', fill: theme.colors.background },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  if (imageSrc) {
    layers.push({
      type: 'image',
      id: 'feature-image',
      content: {
        src: imageSrc,
        alt: imageAlt ?? title,
        fit: imageFit,
        ...(treatment ? { treatment } : {}),
      },
      position: { x: imgX, y: imgY, width: imgW, height: imgH },
    });
  }

  if (title && titleFit) {
    layers.push({
      type: 'text',
      id: 'feature-title',
      content: {
        text: title,
        style: {
          fontSize: titleFit.fontSize,
          fontFamily: titleFont,
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign,
          lineHeight: TITLE_LINE_HEIGHT,
          ...(titleFit.maxLines ? { maxLines: titleFit.maxLines } : {}),
        },
      },
      position: {
        x: textX,
        y: pctY(titleY),
        anchor: textAnchor,
        width: pctW(titleWrapWidth),
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 0.8 }),
    });
  }

  if (body && bodyFit) {
    layers.push({
      type: 'text',
      id: 'feature-body',
      content: {
        text: body,
        style: {
          fontSize: bodyFit.fontSize,
          fontFamily: bodyFont,
          color: theme.colors.textMuted,
          textAlign,
          lineHeight: BODY_LINE_HEIGHT,
          ...(bodyFit.maxLines ? { maxLines: bodyFit.maxLines } : {}),
        },
      },
      position: {
        x: textX,
        y: pctY(bodyY),
        anchor: textAnchor,
        width: pctW(bodyWrapWidth),
      },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 0.8, delay: 0.2 }),
    });
  }

  return layers;
}

export function leftFeature(input: LeftFeatureInput, context: TemplateContext): Layer[] {
  return buildFeatureLayers(input, context, 'left');
}

export function rightFeature(input: RightFeatureInput, context: TemplateContext): Layer[] {
  return buildFeatureLayers(input, context, 'right');
}
