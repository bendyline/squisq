/**
 * Persistent Layers Expansion
 *
 * Expands persistent layer templates (solid backgrounds, gradients, overlays)
 * into raw Layer arrays. These layers are injected into each block based on
 * per-block flags (useBottomLayer, useTopLayer).
 *
 * This is shared code used by both site and efb-app doc renderers.
 *
 * Related Files:
 * - schemas/BlockTemplates.ts - PersistentLayerConfig types
 */

import type { Layer } from '../../schemas/Doc.js';
import type {
  PersistentLayer,
  PersistentLayerTemplate,
  PersistentLayerConfig,
  SolidBackgroundConfig,
  GradientBackgroundConfig,
  ImageBackgroundConfig,
  PatternBackgroundConfig,
  TitleCaptionConfig,
  CornerBrandingConfig,
  ProgressIndicatorConfig,
  DocStylePreset,
} from '../../schemas/BlockTemplates.js';
import { isPersistentLayerTemplate } from '../../schemas/BlockTemplates.js';

// ============================================
// Gradient Presets
// ============================================

const GRADIENT_PRESETS: Record<string, string> = {
  'dark-vignette': 'radial-gradient(ellipse at center, rgba(26,32,44,0.8) 0%, rgba(0,0,0,0.95) 100%)',
  'radial-dark': 'radial-gradient(ellipse at center, #1a202c 0%, #000000 100%)',
  'warm-sunset': 'linear-gradient(135deg, rgba(124,58,48,0.9) 0%, rgba(26,32,44,0.95) 100%)',
  'cool-blue': 'linear-gradient(135deg, rgba(26,54,93,0.9) 0%, rgba(26,32,44,0.95) 100%)',
  'earth-tones': 'linear-gradient(135deg, rgba(68,51,34,0.9) 0%, rgba(26,32,44,0.95) 100%)',
};

// ============================================
// Background Layer Expansion
// ============================================

/**
 * Expand a solid background config to a Layer.
 */
function expandSolidBackground(config: SolidBackgroundConfig): Layer {
  return {
    type: 'shape',
    id: 'persistent-bg-solid',
    content: {
      shape: 'rect',
      fill: config.color,
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  };
}

/**
 * Expand a gradient background config to a Layer.
 */
function expandGradientBackground(config: GradientBackgroundConfig): Layer {
  const gradient = config.gradient ?? GRADIENT_PRESETS[config.preset ?? 'dark-vignette'];

  return {
    type: 'shape',
    id: 'persistent-bg-gradient',
    content: {
      shape: 'rect',
      fill: gradient,
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  };
}

/**
 * Expand an image background config to Layers.
 * Returns multiple layers: base image + dark overlay for readability.
 */
function expandImageBackground(config: ImageBackgroundConfig): Layer[] {
  const layers: Layer[] = [];
  const opacity = config.opacity ?? 0.4;

  // Base image layer
  const imageLayer: Layer = {
    type: 'image',
    id: 'persistent-bg-image',
    content: {
      src: config.src,
      alt: 'Background',
      fit: 'cover',
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
    animation: config.ambientMotion ? {
      type: config.ambientMotion,
      duration: 30, // Long ambient motion
    } : undefined,
  };

  layers.push(imageLayer);

  // Add dark overlay for text readability
  layers.push({
    type: 'shape',
    id: 'persistent-bg-overlay',
    content: {
      shape: 'rect',
      fill: `rgba(0,0,0,${0.5 + (1 - opacity) * 0.3})`,
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  });

  return layers;
}

/**
 * Expand a pattern background config to a Layer.
 */
function expandPatternBackground(config: PatternBackgroundConfig): Layer {
  const opacity = config.opacity ?? 0.1;
  const color = config.color ?? `rgba(255,255,255,${opacity})`;

  // Pattern as SVG data URI for rect patterns
  // For simplicity, use a solid subtle color with reduced opacity
  return {
    type: 'shape',
    id: 'persistent-bg-pattern',
    content: {
      shape: 'rect',
      fill: color,
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  };
}

// ============================================
// Overlay Layer Expansion
// ============================================

/**
 * Expand a title caption config to Layers.
 */
function expandTitleCaption(config: TitleCaptionConfig): Layer[] {
  const layers: Layer[] = [];
  const fontSize = config.fontSize ?? 18;
  const hasSubtitle = !!config.subtitle;

  // Position calculations
  const isBottom = config.position.includes('bottom');
  const isLeft = config.position.includes('left');

  // Even padding around the pill (3% from edges)
  const pad = 3; // percent

  // Pill dimensions — taller when subtitle present
  const pillHeight = hasSubtitle ? '15%' : '7%';
  // Position above player controls
  const bgYPos = isBottom
    ? (hasSubtitle ? '78%' : '84%')
    : '2%';
  const bgXPos = isLeft ? `${pad}%` : '68%';

  // Thumbnail sizing — use different width/height to appear square in 16:9 viewport
  // In 16:9, 6% of width ≈ 10.7% of height in pixels, so use ~6%w x 10%h for visual square
  const thumbW = hasSubtitle ? '6%' : '5%';
  const thumbH = hasSubtitle ? '10%' : '5%';
  const thumbPad = 1.5; // padding inside pill around thumbnail (percent)

  // Text X offset: after thumbnail + padding, or just pill padding
  const textX = config.showThumbnail && isLeft
    ? `${pad + thumbPad + 6 + thumbPad}%` // pill edge + thumb padding + thumb width + gap
    : `${pad + thumbPad}%`;
  // Text area width: pill width minus thumbnail area minus padding
  const textWidth = config.showThumbnail
    ? '19%'  // narrower when thumbnail takes space
    : '24%';

  // Title Y: top of text area inside pill
  const titleYPos = isBottom
    ? (hasSubtitle ? '80%' : '86%')
    : '4%';

  // Background pill for readability
  layers.push({
    type: 'shape',
    id: 'persistent-caption-bg',
    content: {
      shape: 'rect',
      fill: 'rgba(0,0,0,0.6)',
      borderRadius: 8,
    },
    position: {
      x: bgXPos,
      y: bgYPos,
      width: config.showThumbnail ? '30%' : '28%',
      height: pillHeight,
    },
  });

  // Thumbnail if configured
  if (config.showThumbnail && config.thumbnailSrc) {
    const thumbX = isLeft
      ? `${pad + thumbPad}%`
      : '93%';
    // Center thumbnail vertically in pill
    const thumbY = isBottom
      ? (hasSubtitle ? `${78 + thumbPad}%` : '85%')
      : '3%';

    layers.push({
      type: 'image',
      id: 'persistent-caption-thumb',
      content: {
        src: config.thumbnailSrc,
        alt: 'Article thumbnail',
        fit: 'cover',
      },
      position: {
        x: thumbX,
        y: thumbY,
        width: thumbW,
        height: thumbH,
      },
    });
  }

  // Title text — single line, cropped with ellipsis
  layers.push({
    type: 'text',
    id: 'persistent-caption-title',
    content: {
      text: config.title,
      style: {
        fontSize,
        fontWeight: 'bold',
        color: 'rgba(255,255,255,0.9)',
        textAlign: isLeft ? 'left' : 'right',
        maxLines: 1,
      },
    },
    position: {
      x: textX,
      y: titleYPos,
      width: textWidth,
    },
  });

  // Subtitle text (e.g., short URL)
  if (hasSubtitle) {
    const subtitleYPos = isBottom ? '85.5%' : '8%';

    layers.push({
      type: 'text',
      id: 'persistent-caption-subtitle',
      content: {
        text: config.subtitle!,
        style: {
          fontSize: 18,
          fontWeight: 'normal',
          color: 'rgba(255,255,255,0.55)',
          textAlign: isLeft ? 'left' : 'right',
        },
      },
      position: {
        x: textX,
        y: subtitleYPos,
        width: textWidth,
      },
    });
  }

  return layers;
}

/**
 * Expand a corner branding config to a Layer.
 */
function expandCornerBranding(config: CornerBrandingConfig): Layer {
  const isBottom = config.position.includes('bottom');
  const isLeft = config.position.includes('left');

  const xPos = isLeft ? '3%' : '90%';
  const yPos = isBottom ? '94%' : '3%';

  if (config.isImage) {
    return {
      type: 'image',
      id: 'persistent-branding',
      content: {
        src: config.content,
        alt: 'Branding',
        fit: 'contain',
      },
      position: {
        x: xPos,
        y: yPos,
        width: '8%',
        height: '4%',
      },
    };
  }

  return {
    type: 'text',
    id: 'persistent-branding',
    content: {
      text: config.content,
      style: {
        fontSize: 14,
        fontWeight: 'normal',
        color: 'rgba(255,255,255,0.6)',
      },
    },
    position: {
      x: xPos,
      y: yPos,
    },
  };
}

/**
 * Expand a progress indicator config to a Layer.
 * Note: Progress requires block context, returns placeholder bar.
 */
function expandProgressIndicator(config: ProgressIndicatorConfig): Layer {
  const color = config.color ?? 'rgba(255,255,255,0.3)';
  const y = config.position === 'top' ? '1%' : '98%';

  // Simple bar style - actual progress would need to be set per-block
  return {
    type: 'shape',
    id: 'persistent-progress',
    content: {
      shape: 'rect',
      fill: color,
      borderRadius: 2,
    },
    position: {
      x: '5%',
      y,
      width: '90%',
      height: '0.5%',
    },
  };
}

// ============================================
// Main Expansion Function
// ============================================

/**
 * Expand a single persistent layer (template or raw) to raw Layer(s).
 */
export function expandPersistentLayer(layer: PersistentLayer): Layer[] {
  // If already a raw Layer, return as-is
  if (!isPersistentLayerTemplate(layer)) {
    return [layer as Layer];
  }

  const template = layer as PersistentLayerTemplate;
  const config = template.config;

  switch (config.type) {
    case 'solidBackground':
      return [expandSolidBackground(config)];
    case 'gradientBackground':
      return [expandGradientBackground(config)];
    case 'imageBackground':
      return expandImageBackground(config);
    case 'patternBackground':
      return [expandPatternBackground(config)];
    case 'titleCaption':
      return expandTitleCaption(config);
    case 'cornerBranding':
      return [expandCornerBranding(config)];
    case 'progressIndicator':
      return [expandProgressIndicator(config)];
    default:
      console.warn('Unknown persistent layer template:', (config as any).type);
      return [];
  }
}

/**
 * Expand all persistent layers in a config to raw Layer arrays.
 */
export function expandPersistentLayers(
  layers: PersistentLayer[] | undefined
): Layer[] {
  if (!layers || layers.length === 0) {
    return [];
  }

  // Use reduce+concat instead of flatMap for Coherent GT compatibility (ES2017)
  return layers.reduce<Layer[]>((acc, layer) => acc.concat(expandPersistentLayer(layer)), []);
}

// ============================================
// Style Presets
// ============================================

/**
 * Get a PersistentLayerConfig from a style preset.
 *
 * @param preset - Style preset name
 * @param articleTitle - Article title for title caption
 * @param heroSrc - Optional hero image for cinematic style
 */
export function getDocStyleConfig(
  preset: DocStylePreset,
  articleTitle: string,
  heroSrc?: string,
  subtitle?: string
): PersistentLayerConfig {
  switch (preset) {
    case 'minimal':
      return {};

    case 'documentary':
      return {
        bottomLayers: [
          {
            template: 'gradientBackground',
            config: { type: 'gradientBackground', preset: 'dark-vignette' },
          },
        ],
        topLayers: [
          {
            template: 'titleCaption',
            config: {
              type: 'titleCaption',
              title: articleTitle,
              subtitle,
              position: 'bottom-left',
              fontSize: 24,
              showThumbnail: !!heroSrc,
              thumbnailSrc: heroSrc,
            },
          },
        ],
      };

    case 'branded':
      return {
        bottomLayers: [
          {
            template: 'gradientBackground',
            config: { type: 'gradientBackground', preset: 'cool-blue' },
          },
        ],
        topLayers: [
          {
            template: 'titleCaption',
            config: {
              type: 'titleCaption',
              title: articleTitle,
              subtitle,
              position: 'bottom-left',
              fontSize: 26,
              showThumbnail: !!heroSrc,
              thumbnailSrc: heroSrc,
            },
          },
        ],
      };

    case 'cinematic':
      return {
        bottomLayers: heroSrc
          ? [
              {
                template: 'imageBackground',
                config: {
                  type: 'imageBackground',
                  src: heroSrc,
                  blur: 12,
                  opacity: 0.3,
                  ambientMotion: 'zoomIn',
                },
              },
            ]
          : [
              {
                template: 'gradientBackground',
                config: { type: 'gradientBackground', preset: 'radial-dark' },
              },
            ],
        topLayers: [
          {
            template: 'titleCaption',
            config: {
              type: 'titleCaption',
              title: articleTitle,
              subtitle,
              position: 'bottom-right',
              fontSize: 22,
            },
          },
        ],
      };

    case 'clean':
      return {
        bottomLayers: [
          {
            template: 'solidBackground',
            config: { type: 'solidBackground', color: '#1a202c' },
          },
        ],
      };

    default:
      return {};
  }
}
