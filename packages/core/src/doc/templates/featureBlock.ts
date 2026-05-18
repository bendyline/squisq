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
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont } from '../utils/themeUtils.js';

type FeatureInput = LeftFeatureInput | RightFeatureInput;

/**
 * Build the layer list for either feature template. Layers are in
 * back-to-front order: background, image, then text.
 */
function buildFeatureLayers(
  input: FeatureInput,
  context: TemplateContext,
  side: 'left' | 'right',
): Layer[] {
  const { imageSrc, imageAlt, imageWidth, imageHeight, title, body } = input;
  const { theme, layout } = context;
  // Treat the image as "sized" when the host gave us an explicit width
  // or height — that's our cue that the user resized the image in the
  // editor and we should respect that as a sizing hint instead of
  // stretching the image to fill the whole half.
  const sized = (imageWidth ?? 0) > 0 || (imageHeight ?? 0) > 0;
  // In portrait the image stacks above the text rather than splitting
  // horizontally — same flag the twoColumn template uses, so the two
  // behave consistently on narrow viewports.
  const stack = layout.stackColumns;

  const titleFontSize = scaledFontSize(48, context, true);
  const bodyFontSize = scaledFontSize(24, context, false);

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
  // the side is "left" (image left, text right), and the RIGHT edge of
  // the column when the side is "right" — we use top-left / top-right
  // anchors below so text reads left-aligned in both cases without
  // having to flip the column origin manually.
  const COLUMN_INSET = 4; // % of block width — padding from card edge / divider
  const textColumnWidth = stack ? 90 : 42;
  const textX = stack
    ? `${(100 - textColumnWidth) / 2}%`
    : side === 'left'
      ? `${50 + COLUMN_INSET}%` // text column starts just past the divider
      : `${50 - COLUMN_INSET}%`; // right edge of left-half text column

  // Stack the title above the body, with the pair vertically centered
  // in the text column. The title sits 8% above center; body sits 2%
  // below — these offsets keep both lines visible at the small card
  // sizes used by the inline preview gutter without overflowing.
  const titleY = stack ? '60%' : body ? '42%' : '50%';
  const bodyY = stack ? '78%' : title ? '55%' : '50%';
  const textAnchor = side === 'right' && !stack ? 'top-right' : 'top-left';
  const textAlign: 'left' | 'right' = side === 'right' && !stack ? 'right' : 'left';

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
        alt: imageAlt ?? title ?? '',
        fit: imageFit,
      },
      position: { x: imgX, y: imgY, width: imgW, height: imgH },
    });
  }

  if (title) {
    layers.push({
      type: 'text',
      id: 'feature-title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign,
          lineHeight: 1.2,
        },
      },
      position: {
        x: textX,
        y: titleY,
        anchor: textAnchor,
        width: `${textColumnWidth}%`,
      },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  if (body) {
    layers.push({
      type: 'text',
      id: 'feature-body',
      content: {
        text: body,
        style: {
          fontSize: bodyFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
          textAlign,
          lineHeight: 1.5,
        },
      },
      position: {
        x: textX,
        y: bodyY,
        anchor: textAnchor,
        width: `${textColumnWidth}%`,
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.2 },
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
