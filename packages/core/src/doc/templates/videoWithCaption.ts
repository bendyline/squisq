/**
 * Video With Caption Template
 *
 * Full-screen background video clip with text overlay. Mirrors the structure of
 * imageWithCaption but uses a VideoLayer instead of an ImageLayer. The video
 * plays muted — narration audio is the only sound track.
 *
 * Adapts caption positioning and font sizes for different viewports.
 *
 * This is shared code used by both site and efb-app doc renderers.
 *
 * Related Files:
 * - shared/story/templates/imageWithCaption.ts — image equivalent
 * - schemas/StoryScript.ts — VideoLayer type
 * - site/src/components/story/layers/VideoLayer.tsx — rendering component
 */

import type { Layer } from '../../schemas/Doc.js';
import type { VideoWithCaptionInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { cleanCaption } from './captionUtils.js';

export function videoWithCaption(input: VideoWithCaptionInput, context: TemplateContext): Layer[] {
  const {
    videoSrc,
    posterSrc,
    videoAlt,
    clipStart,
    clipEnd,
    sourceDuration,
    caption: rawCaption,
    captionPosition = 'bottom',
    videoCredit,
    videoLicense,
  } = input;
  const caption = rawCaption ? cleanCaption(rawCaption) : rawCaption;
  const { theme, layout } = context;

  const captionFontSize = scaledFontSize(36, context, false);
  const creditFontSize = scaledFontSize(16, context, false);

  const layers: Layer[] = [
    // Background video clip
    {
      type: 'video',
      id: 'bg-video',
      content: {
        src: videoSrc,
        posterSrc,
        alt: videoAlt,
        fit: 'cover',
        clipStart,
        clipEnd,
        sourceDuration,
        credit: videoCredit,
        license: videoLicense,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  // Caption text at bottom with gradient for readability
  if (caption) {
    layers.push({
      type: 'shape',
      id: 'caption-gradient',
      content: {
        shape: 'rect',
        fill: 'linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)',
      },
      position: {
        x: 0,
        y: captionPosition === 'top' ? 0 : '65%',
        width: '100%',
        height: '35%',
      },
    });

    const captionY =
      captionPosition === 'top' ? '15%' : captionPosition === 'center' ? '50%' : '82%';

    layers.push({
      type: 'text',
      id: 'caption',
      content: {
        text: caption,
        style: {
          fontSize: captionFontSize,
          color: theme.colors.text,
          textAlign: 'center',
          shadow: true,
        },
      },
      position: {
        x: '50%',
        y: captionY,
        anchor: 'center',
        width: layout.maxTextWidth,
      },
      animation: { type: 'fadeIn', duration: 1.5, delay: 0.5 },
    });
  }

  // Small credit text in bottom-right corner
  if (videoCredit) {
    layers.push({
      type: 'text',
      id: 'credit',
      content: {
        text: videoCredit,
        style: {
          fontSize: creditFontSize,
          color: 'rgba(255, 255, 255, 0.5)',
          textAlign: 'right',
        },
      },
      position: {
        x: '96%',
        y: '96%',
        anchor: 'bottom-right',
      },
    });
  }

  return layers;
}
