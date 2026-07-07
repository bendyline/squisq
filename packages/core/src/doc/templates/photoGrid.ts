/**
 * Photo Grid Template
 *
 * Displays 2-4 images in a tiled layout for visual variety.
 * Layout adapts based on image count and viewport orientation:
 *
 * Landscape:
 * - 2 images: side-by-side 50/50
 * - 3 images: one large left (60%) + two stacked right
 * - 4 images: 2x2 grid
 *
 * Portrait (9:16): images stack horizontally (top/bottom) instead of
 * side-by-side, giving each image full width on narrow screens.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { PhotoGridInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { getThemeFont, themedFontSize, themedImageTreatment } from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { cleanCaption } from './captionUtils.js';

/** Gap between images as percentage */
const GAP = 1.2;

export function photoGrid(input: PhotoGridInput, context: TemplateContext): Layer[] {
  const { images, caption: rawCaption, ambientMotion } = input;

  // Guard: images array is required
  if (!images || images.length === 0) return [];

  const caption = rawCaption ? cleanCaption(rawCaption) : rawCaption;
  const { theme, layout } = context;

  const treatment = themedImageTreatment(context, input.imageTreatment);

  const layers: Layer[] = [
    // Theme surface background (visible in gaps between images)
    {
      type: 'shape',
      id: 'bg',
      content: { shape: 'rect', fill: theme.colors.background },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  const gridHeight = 100;

  // Generate image positions based on count; stack vertically in portrait
  const positions = getGridPositions(images.length, gridHeight, layout.stackColumns);

  for (let i = 0; i < Math.min(images.length, 4); i++) {
    const img = images[i];
    const pos = positions[i];

    // Placeholder behind image (visible if image fails to load)
    layers.push({
      type: 'shape',
      id: `grid-placeholder-${i}`,
      content: { shape: 'rect', fill: theme.colors.background },
      position: { x: `${pos.x}%`, y: `${pos.y}%`, width: `${pos.w}%`, height: `${pos.h}%` },
    });

    // Image layer (covers placeholder when loaded)
    layers.push({
      type: 'image',
      id: `grid-img-${i}`,
      content: {
        src: img.src,
        alt: img.alt,
        fit: 'cover',
        credit: img.credit,
        license: img.license,
        ...(treatment ? { treatment } : {}),
      },
      position: {
        x: `${pos.x}%`,
        y: `${pos.y}%`,
        width: `${pos.w}%`,
        height: `${pos.h}%`,
      },
      // Apply ambient motion to the first (largest) image only
      animation:
        i === 0 && ambientMotion
          ? { type: ambientMotion, duration: 15 }
          : { type: 'fadeIn', duration: 1, delay: 0.2 * i },
    });
  }

  // Caption in a compact translucent chip above player controls. Long
  // archival/Wikimedia descriptions are intentionally clamped.
  if (caption) {
    const captionFontSize = themedFontSize(layout.stackColumns ? 24 : 26, context, false);
    const captionY = layout.stackColumns ? '78%' : '74%';
    const captionBgY = layout.stackColumns ? '72%' : '68%';
    const captionHeight = layout.stackColumns ? '13%' : '16%';
    const bg = theme.colors.background;

    layers.push({
      type: 'shape',
      id: 'caption-bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(90deg, ${withAlpha(bg, 0)}, ${withAlpha(bg, 0.78)} 16%, ${withAlpha(bg, 0.78)} 84%, ${withAlpha(bg, 0)})`,
      },
      position: { x: 0, y: captionBgY, width: '100%', height: captionHeight },
    });

    layers.push({
      type: 'text',
      id: 'caption',
      content: {
        text: caption,
        style: {
          fontSize: captionFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.text,
          textAlign: 'center',
          shadow: true,
          lineHeight: 1.18,
          maxLines: layout.stackColumns ? 2 : 1,
        },
      },
      position: {
        x: '50%',
        y: captionY,
        anchor: 'center',
        width: '78%',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 0.5 },
    });
  }

  return layers;
}

interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

function getGridPositions(count: number, gridHeight: number, stacked: boolean): GridPos[] {
  const halfW = 50 - GAP / 2;
  const halfH = gridHeight / 2 - GAP / 2;

  switch (count) {
    case 2:
      if (stacked) {
        // Portrait: stack top/bottom
        return [
          { x: 0, y: 0, w: 100, h: halfH },
          { x: 0, y: gridHeight / 2 + GAP / 2, w: 100, h: halfH },
        ];
      }
      return [
        { x: 0, y: 0, w: halfW, h: gridHeight },
        { x: 50 + GAP / 2, y: 0, w: halfW, h: gridHeight },
      ];
    case 3: {
      if (stacked) {
        // Portrait: stack all three vertically
        const thirdH = gridHeight / 3 - (GAP * 2) / 3;
        return [
          { x: 0, y: 0, w: 100, h: thirdH },
          { x: 0, y: gridHeight / 3 + GAP / 3, w: 100, h: thirdH },
          { x: 0, y: (gridHeight * 2) / 3 + (GAP * 2) / 3, w: 100, h: thirdH },
        ];
      }
      const leftW = 60 - GAP / 2;
      const rightW = 40 - GAP / 2;
      return [
        { x: 0, y: 0, w: leftW, h: gridHeight },
        { x: 60 + GAP / 2, y: 0, w: rightW, h: halfH },
        { x: 60 + GAP / 2, y: gridHeight / 2 + GAP / 2, w: rightW, h: halfH },
      ];
    }
    case 4:
    default:
      // 2x2 grid works well in both orientations
      return [
        { x: 0, y: 0, w: halfW, h: halfH },
        { x: 50 + GAP / 2, y: 0, w: halfW, h: halfH },
        { x: 0, y: gridHeight / 2 + GAP / 2, w: halfW, h: halfH },
        { x: 50 + GAP / 2, y: gridHeight / 2 + GAP / 2, w: halfW, h: halfH },
      ];
  }
}
