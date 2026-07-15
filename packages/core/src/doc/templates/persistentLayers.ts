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
  VignetteConfig,
  AmbientGradientConfig,
  TitleCaptionConfig,
  CornerBrandingConfig,
  ProgressIndicatorConfig,
} from '../../schemas/BlockTemplates.js';
import type { Theme } from '../../schemas/Theme.js';
import { cloneData } from '../../internal/immutable.js';
import { isPersistentLayerTemplate } from '../../schemas/BlockTemplates.js';
import { oklchDarken, withAlpha } from '../../schemas/colorUtils.js';

// ============================================
// Gradient Presets
// ============================================

const GRADIENT_PRESETS: Record<string, string> = {
  'dark-vignette':
    'radial-gradient(ellipse at center, rgba(26,32,44,0.8) 0%, rgba(0,0,0,0.95) 100%)',
  'radial-dark': 'radial-gradient(ellipse at center, #1a202c 0%, #000000 100%)',
  // Warm presets deepen within their own hue — ending in the shared navy
  // made warm themes drift cold halfway down the frame.
  'warm-sunset': 'linear-gradient(135deg, rgba(124,58,48,0.9) 0%, rgba(46,20,16,0.95) 100%)',
  'cool-blue': 'linear-gradient(135deg, rgba(26,54,93,0.9) 0%, rgba(26,32,44,0.95) 100%)',
  'earth-tones': 'linear-gradient(135deg, rgba(68,51,34,0.9) 0%, rgba(30,22,15,0.95) 100%)',
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

  // Base image layer. `blur` softens the photo into an atmosphere layer
  // (the ImageLayer renderer over-scans blurred images so soft edges never
  // reveal the frame).
  const imageLayer: Layer = {
    type: 'image',
    id: 'persistent-bg-image',
    content: {
      src: config.src,
      alt: 'Background',
      fit: 'cover',
      ...(config.blur != null && config.blur > 0 ? { blur: config.blur } : {}),
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
    animation: config.ambientMotion
      ? {
          type: config.ambientMotion,
          duration: 30, // Long ambient motion
        }
      : undefined,
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
  // 'noise' is film grain: a full-bleed rect whose paint is replaced by a
  // static feTurbulence field clipped to the rect (see ShapeFilter).
  if (config.pattern === 'noise') {
    return {
      type: 'shape',
      id: 'persistent-grain',
      content: {
        shape: 'rect',
        fill: '#000000',
        filter: { type: 'noise', opacity: config.opacity ?? 0.05 },
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
  }

  // dots / grid / diagonal render as native SVG <pattern> fills.
  const opacity = config.opacity ?? 0.06;
  return {
    type: 'shape',
    id: 'persistent-bg-pattern',
    content: {
      shape: 'rect',
      pattern: {
        kind: config.pattern,
        color: config.color ?? '#ffffff',
        size: Math.round(24 * (config.scale ?? 1)),
        opacity,
      },
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  };
}

/**
 * Expand a vignette config: transparent center darkening toward the frame
 * edges. Rides the CSS-gradient rect path in the renderer.
 */
function expandVignette(config: VignetteConfig): Layer {
  const strength = Math.max(0, Math.min(1, config.strength ?? 0.3));
  const color = config.color ?? '#000000';
  const edge = withAlpha(color, strength);
  const clear = withAlpha(color, 0);
  return {
    type: 'shape',
    id: 'persistent-vignette',
    content: {
      shape: 'rect',
      fill: `radial-gradient(ellipse at center, ${clear} 55%, ${edge} 100%)`,
    },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  };
}

/**
 * Expand an ambient drifting gradient: an oversized surface gradient with
 * a very slow Ken Burns loop. Deterministic (no randomness).
 */
function expandAmbientGradient(config: AmbientGradientConfig, theme?: Theme): Layer {
  const from = config.from ?? theme?.colors.backgroundLight ?? '#1a202c';
  const to = config.to ?? (theme ? oklchDarken(theme.colors.background, 0.04) : '#0f141d');
  return {
    type: 'shape',
    id: 'persistent-ambient-gradient',
    content: {
      shape: 'rect',
      fill: `linear-gradient(150deg, ${from} 0%, ${to} 100%)`,
    },
    // Oversized so the slow pan never reveals the frame edge.
    position: { x: '-5%', y: '-5%', width: '110%', height: '110%' },
    animation: { type: 'slowZoom', panDirection: 'left', duration: config.duration ?? 40 },
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
  const thumbPad = 1.5; // padding inside pill around thumbnail (percent)

  // Pill dimensions — taller when subtitle present
  const pillHeight = hasSubtitle ? '15%' : '7%';
  // Position above player controls
  const bgYPos = isBottom ? (hasSubtitle ? '78%' : '84%') : '2%';

  // Horizontal geometry is derived from ONE pill rect so both sides stay
  // coherent. Everything else (thumbnail, text box) is placed relative to
  // `pillX`/`pillW` rather than re-deriving edges from literals: a
  // right-positioned caption used to draw the pill at 68%–96% while the text
  // was still hard-coded to the left-edge offset (4.5%), so the title floated
  // over the slide with no backing and the pill sat empty. Mirroring the pill
  // around the same `pad` also keeps the right thumbnail inside it (it used to
  // sit at 93%+6% = 99%, overhanging the pill's 98% edge).
  const pillW = config.showThumbnail ? 30 : 28;
  const pillX = isLeft ? pad : 100 - pad - pillW;
  const bgXPos = `${pillX}%`;

  // Thumbnail sizing — use different width/height to appear square in 16:9 viewport
  // In 16:9, 6% of width ≈ 10.7% of height in pixels, so use ~6%w x 10%h for visual square
  const thumbWNum = hasSubtitle ? 6 : 5;
  const thumbW = `${thumbWNum}%`;
  const thumbH = hasSubtitle ? '10%' : '5%';

  // The pill's inner box, inset by `thumbPad` on both sides.
  const innerX = pillX + thumbPad;
  const innerW = pillW - thumbPad * 2;

  // The thumbnail hugs the pill's OUTER edge (left edge on the left, right
  // edge on the right) and the text takes the remaining inner width on the
  // other side, so text always reads away from the slide's frame.
  const textX = config.showThumbnail && isLeft ? `${innerX + thumbWNum + thumbPad}%` : `${innerX}%`;
  const textWidth = config.showThumbnail
    ? `${innerW - thumbWNum - thumbPad}%` // narrower when thumbnail takes space
    : `${innerW}%`;

  // Title Y: top of text area inside pill
  const titleYPos = isBottom ? (hasSubtitle ? '80%' : '86%') : '4%';

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
      width: `${pillW}%`,
      height: pillHeight,
    },
  });

  // Thumbnail if configured
  if (config.showThumbnail && config.thumbnailSrc) {
    const thumbX = isLeft ? `${innerX}%` : `${pillX + pillW - thumbPad - thumbWNum}%`;
    // Center thumbnail vertically in pill
    const thumbY = isBottom ? (hasSubtitle ? `${78 + thumbPad}%` : '85%') : '3%';

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
export function expandPersistentLayer(layer: PersistentLayer, theme?: Theme): Layer[] {
  // If already a raw Layer, return an owned copy.
  if (!isPersistentLayerTemplate(layer)) {
    return [cloneData(layer as Layer)];
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
    case 'vignette':
      return [expandVignette(config)];
    case 'ambientGradient':
      return [expandAmbientGradient(config, theme)];
    case 'titleCaption':
      return expandTitleCaption(config);
    case 'cornerBranding':
      return [expandCornerBranding(config)];
    case 'progressIndicator':
      return [expandProgressIndicator(config)];
    default:
      console.warn('Unknown persistent layer template:', (config as Record<string, unknown>).type);
      return [];
  }
}

/**
 * Expand all persistent layers in a config to raw Layer arrays.
 */
export function expandPersistentLayers(
  layers: PersistentLayer[] | undefined,
  theme?: Theme,
): Layer[] {
  if (!layers || layers.length === 0) {
    return [];
  }

  // Use reduce+concat instead of flatMap for Coherent GT compatibility (ES2017)
  return layers.reduce<Layer[]>(
    (acc, layer) => acc.concat(expandPersistentLayer(layer, theme)),
    [],
  );
}

/**
 * Get persistent layers from a Theme. Returns the theme's baked-in
 * persistentLayers config, or an empty config when the theme has none.
 */
export function getPersistentLayersFromTheme(theme: Theme): PersistentLayerConfig {
  return theme.persistentLayers ?? {};
}

/**
 * Resolve the effective persistent-layer config for a doc: the doc's own
 * config wins **wholesale** when present; only docs with no persistent
 * layers inherit the theme's.
 *
 * Doc-wins-wholesale (rather than merging) protects pre-baked documents
 * that carry their own background/branding layers — merging a theme's
 * atmosphere on top of those would double up backgrounds and stack
 * overlays the doc author never saw.
 */
export function resolvePersistentLayers(
  doc: { persistentLayers?: PersistentLayerConfig },
  theme: Theme,
): PersistentLayerConfig | undefined {
  const docConfig = doc.persistentLayers;
  const hasDocLayers =
    !!docConfig &&
    ((docConfig.bottomLayers?.length ?? 0) > 0 || (docConfig.topLayers?.length ?? 0) > 0);
  if (hasDocLayers) return docConfig;
  const themeConfig = theme.persistentLayers;
  const hasThemeLayers =
    !!themeConfig &&
    ((themeConfig.bottomLayers?.length ?? 0) > 0 || (themeConfig.topLayers?.length ?? 0) > 0);
  return hasThemeLayers ? themeConfig : docConfig;
}

/**
 * Compose a block's layers between pre-expanded persistent bottom/top
 * layers, honoring the per-block `useBottomLayer` / `useTopLayer` opt-outs.
 * Shared persistent-layer primitive used by `materializeBlockLayers`.
 */
export function wrapWithPersistentLayers(
  layers: Layer[],
  block: { useBottomLayer?: boolean; useTopLayer?: boolean },
  bottomLayers: Layer[],
  topLayers: Layer[],
): Layer[] {
  if (bottomLayers.length === 0 && topLayers.length === 0) return layers;
  const useBottom = block.useBottomLayer !== false;
  const useTop = block.useTopLayer !== false;
  // Each expanded block owns its persistent layers. This prevents a renderer
  // (or a later timing/style pass) from mutating the caller's config or a
  // sibling block through a shared layer reference.
  return [
    ...(useBottom ? bottomLayers.map((layer) => cloneData(layer)) : []),
    ...layers,
    ...(useTop ? topLayers.map((layer) => cloneData(layer)) : []),
  ];
}
