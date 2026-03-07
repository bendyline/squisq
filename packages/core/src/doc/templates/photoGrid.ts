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
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { cleanCaption } from './captionUtils.js';

/** Gap between images as percentage */
const GAP = 0.5;

export function photoGrid(input: PhotoGridInput, context: TemplateContext): Layer[] {
  const { images, caption: rawCaption, ambientMotion } = input;
  const caption = rawCaption ? cleanCaption(rawCaption) : rawCaption;
  const { theme, layout } = context;

  const layers: Layer[] = [
    // Black background (visible in gaps between images)
    {
      type: 'shape',
      id: 'bg',
      content: { shape: 'rect', fill: '#000000' },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Reserve bottom space for caption — more room in landscape for larger text
  const captionHeight = caption ? (layout.stackColumns ? 18 : 22) : 0;
  const gridHeight = 100 - captionHeight;

  // Generate image positions based on count; stack vertically in portrait
  const positions = getGridPositions(images.length, gridHeight, layout.stackColumns);

  const altFontSize = scaledFontSize(24, context, false);

  for (let i = 0; i < Math.min(images.length, 4); i++) {
    const img = images[i];
    const pos = positions[i];

    // Placeholder behind image (visible if image fails to load)
    layers.push({
      type: 'shape',
      id: `grid-placeholder-${i}`,
      content: { shape: 'rect', fill: theme.background },
      position: { x: `${pos.x}%`, y: `${pos.y}%`, width: `${pos.w}%`, height: `${pos.h}%` },
    });

    // Alt-text label on placeholder
    if (img.alt) {
      layers.push({
        type: 'text',
        id: `grid-alt-${i}`,
        content: {
          text: img.alt,
          style: { fontSize: altFontSize, color: theme.textMuted, textAlign: 'center' as const },
        },
        position: { x: `${pos.x + pos.w / 2}%`, y: `${pos.y + pos.h / 2}%`, anchor: 'center' },
      });
    }

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
      },
      position: {
        x: `${pos.x}%`,
        y: `${pos.y}%`,
        width: `${pos.w}%`,
        height: `${pos.h}%`,
      },
      // Apply ambient motion to the first (largest) image only
      animation: i === 0 && ambientMotion
        ? { type: ambientMotion, duration: 15 }
        : { type: 'fadeIn', duration: 1, delay: 0.2 * i },
    });
  }

  // Caption with gradient overlay
  if (caption) {
    const captionFontSize = scaledFontSize(layout.stackColumns ? 28 : 40, context, false);

    layers.push({
      type: 'shape',
      id: 'caption-bg',
      content: {
        shape: 'rect',
        fill: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
      },
      position: { x: 0, y: `${gridHeight - 4}%`, width: '100%', height: `${captionHeight + 4}%` },
    });

    layers.push({
      type: 'text',
      id: 'caption',
      content: {
        text: caption,
        style: {
          fontSize: captionFontSize,
          color: theme.text,
          textAlign: 'center',
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: `${gridHeight + (layout.stackColumns ? captionHeight / 2 : captionHeight * 0.3)}%`,
        anchor: 'center',
        width: '90%',
      },
      animation: { type: 'fadeIn', duration: 1, delay: 0.5 },
    });
  }

  return layers;
}

interface GridPos { x: number; y: number; w: number; h: number }

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
        const thirdH = gridHeight / 3 - GAP * 2 / 3;
        return [
          { x: 0, y: 0, w: 100, h: thirdH },
          { x: 0, y: gridHeight / 3 + GAP / 3, w: 100, h: thirdH },
          { x: 0, y: gridHeight * 2 / 3 + GAP * 2 / 3, w: 100, h: thirdH },
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
