/**
 * Video Pull Quote Template
 *
 * Quote text over a video clip background with dark overlay.
 * Cinematic alternative to pullQuote when a video clip is available.
 * Combines the visual dynamism of live video with the text focus of quoteBlock.
 *
 * The video plays muted — narration audio is the only sound track.
 *
 * Without a background video the lockup renders on the theme surface
 * instead of the template producing a blank block. The text lockup itself
 * (fitted quote + attribution as one measured, centred stack) is shared
 * with `pullQuote`.
 *
 * This is shared code used by both site and efb-app doc renderers.
 *
 * Related Files:
 * - shared/story/templates/pullQuote.ts — image-based equivalent
 * - schemas/StoryScript.ts — VideoLayer type
 * - site/src/components/story/layers/VideoLayer.tsx — rendering component
 */

import type { Layer } from '../../schemas/Doc.js';
import type { VideoPullQuoteInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { themedSurfaceGradient } from '../utils/themeUtils.js';
import { createBackgroundLayer } from './captionUtils.js';
import { pullQuoteLockup, pullQuoteOverlayLayer } from './pullQuote.js';

export function videoPullQuote(input: VideoPullQuoteInput, context: TemplateContext): Layer[] {
  const { text, attribution, backgroundVideo } = input;

  const layers: Layer[] = [];

  if (backgroundVideo?.src) {
    layers.push(
      // Full-bleed background video clip
      {
        type: 'video',
        id: 'bg-video',
        content: {
          src: backgroundVideo.src,
          posterSrc: backgroundVideo.posterSrc,
          alt: backgroundVideo.alt,
          fit: 'cover',
          // Markdown-derived clips carry no bounds: start at 0 and run for the block.
          clipStart: backgroundVideo.clipStart ?? 0,
          clipEnd: backgroundVideo.clipEnd ?? (backgroundVideo.clipStart ?? 0) + input.duration,
          credit: backgroundVideo.credit,
          license: backgroundVideo.license,
        },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
      // Dark overlay for text readability
      pullQuoteOverlayLayer(),
    );
  } else {
    // No clip: render the quote on the theme surface rather than nothing.
    layers.push(createBackgroundLayer('bg', themedSurfaceGradient(context, 160)));
  }

  layers.push(
    ...pullQuoteLockup({ text, attribution, overMedia: Boolean(backgroundVideo?.src) }, context),
  );

  return layers;
}
