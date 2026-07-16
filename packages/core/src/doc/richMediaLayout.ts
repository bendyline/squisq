/**
 * Supplemental rich-media layout for slideshow blocks.
 *
 * Templates still own their no-media composition. When an explicitly
 * selected text-first template also contains media that it did not consume,
 * this module selects a second composition with a reserved media rectangle
 * and maps the template's foreground into the companion content rectangle.
 * The exhaustive per-template policy selects by viewport orientation, media
 * aspect, and item count so placement does not depend on a template's name or
 * incidental overlap between its layers.
 */

import type { Layer, Position } from '../schemas/Doc.js';
import type { ViewportConfig, ViewportOrientation } from '../schemas/Viewport.js';
import { getViewportOrientation } from '../schemas/Viewport.js';
import { estimateTextHeight } from './templates/captionUtils.js';
import {
  getBlockMediaLayoutPolicy,
  type SupplementalMediaLayoutVariant,
  type SupplementalMediaShape,
} from './templates/mediaLayoutPolicy.js';

export interface LayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SupplementalMediaLayout {
  layers: Layer[];
  mediaRect: LayerRect;
  /** Designed slots receive a visible frame; heuristic fallbacks do not. */
  framed: boolean;
}

interface DesignedLayout {
  contentRect: LayerRect;
  mediaRect: LayerRect;
  fontScale: number;
}

function rect(
  viewport: ViewportConfig,
  x: number,
  y: number,
  width: number,
  height: number,
): LayerRect {
  return {
    x: viewport.width * x,
    y: viewport.height * y,
    width: viewport.width * width,
    height: viewport.height * height,
  };
}

function mediaShape(
  mediaCount: number,
  aspectRatios: readonly (number | undefined)[],
): SupplementalMediaShape {
  if (mediaCount > 1) return 'multiple';
  const aspect = aspectRatios[0] ?? 16 / 9;
  if (aspect < 0.8) return 'tall';
  if (aspect > 1.25) return 'wide';
  return 'square';
}

function stackedTitleLayout(
  viewport: ViewportConfig,
  orientation: ViewportOrientation,
): DesignedLayout {
  if (orientation === 'portrait') {
    return {
      contentRect: rect(viewport, 0.06, 0.04, 0.88, 0.3),
      mediaRect: rect(viewport, 0.06, 0.39, 0.88, 0.55),
      fontScale: 0.76,
    };
  }
  if (orientation === 'square') {
    return {
      contentRect: rect(viewport, 0.05, 0.04, 0.9, 0.33),
      mediaRect: rect(viewport, 0.07, 0.42, 0.86, 0.51),
      fontScale: 0.72,
    };
  }
  return {
    contentRect: rect(viewport, 0.04, 0.03, 0.92, 0.32),
    mediaRect: rect(viewport, 0.08, 0.4, 0.84, 0.52),
    fontScale: 0.72,
  };
}

function splitLayout(viewport: ViewportConfig, orientation: ViewportOrientation): DesignedLayout {
  const square = orientation === 'square';
  return {
    contentRect: rect(viewport, square ? 0.05 : 0.04, 0.05, square ? 0.42 : 0.43, 0.9),
    mediaRect: rect(viewport, square ? 0.52 : 0.53, 0.07, square ? 0.43 : 0.43, 0.86),
    fontScale: 0.72,
  };
}

function stackedTextLayout(
  viewport: ViewportConfig,
  orientation: ViewportOrientation,
  dense: boolean,
): DesignedLayout {
  if (orientation === 'portrait') {
    return {
      contentRect: rect(viewport, 0.06, 0.04, 0.88, dense ? 0.41 : 0.36),
      mediaRect: rect(viewport, 0.06, dense ? 0.5 : 0.45, 0.88, dense ? 0.44 : 0.49),
      fontScale: dense ? 0.42 : 0.44,
    };
  }
  if (orientation === 'square') {
    return {
      contentRect: rect(viewport, 0.05, 0.04, 0.9, dense ? 0.43 : 0.36),
      mediaRect: rect(viewport, 0.07, dense ? 0.52 : 0.45, 0.86, dense ? 0.41 : 0.48),
      fontScale: dense ? 0.45 : 0.46,
    };
  }
  return {
    contentRect: rect(viewport, 0.05, 0.03, 0.9, dense ? 0.46 : 0.35),
    mediaRect: rect(viewport, 0.07, dense ? 0.55 : 0.43, 0.86, dense ? 0.38 : 0.49),
    fontScale: dense ? 0.5 : 0.48,
  };
}

/** Reserved inset for extra media while a native/spatial composition stays intact. */
function overlayMediaRect(viewport: ViewportConfig, shape: SupplementalMediaShape): LayerRect {
  const orientation = getViewportOrientation(viewport);
  if (orientation === 'portrait') {
    switch (shape) {
      case 'tall':
        return rect(viewport, 0.55, 0.5, 0.38, 0.44);
      case 'square':
        return rect(viewport, 0.49, 0.58, 0.44, 0.35);
      case 'multiple':
        return rect(viewport, 0.07, 0.67, 0.86, 0.27);
      case 'wide':
        return rect(viewport, 0.07, 0.71, 0.86, 0.23);
    }
  }
  if (orientation === 'square') {
    switch (shape) {
      case 'tall':
        return rect(viewport, 0.68, 0.1, 0.27, 0.8);
      case 'square':
        return rect(viewport, 0.55, 0.52, 0.4, 0.4);
      case 'multiple':
        return rect(viewport, 0.08, 0.62, 0.84, 0.31);
      case 'wide':
        return rect(viewport, 0.08, 0.68, 0.84, 0.27);
    }
  }
  switch (shape) {
    case 'tall':
      return rect(viewport, 0.7, 0.1, 0.26, 0.8);
    case 'square':
      return rect(viewport, 0.62, 0.22, 0.34, 0.56);
    case 'multiple':
      return rect(viewport, 0.52, 0.5, 0.44, 0.42);
    case 'wide':
      return rect(viewport, 0.54, 0.58, 0.42, 0.34);
  }
}

function designedLayout(
  variant: SupplementalMediaLayoutVariant,
  viewport: ViewportConfig,
): DesignedLayout {
  const orientation = getViewportOrientation(viewport);
  switch (variant) {
    case 'title-stack':
      return stackedTitleLayout(viewport, orientation);
    case 'split':
      return splitLayout(viewport, orientation);
    case 'text-stack':
      return stackedTextLayout(viewport, orientation, false);
    case 'dense-stack':
      return stackedTextLayout(viewport, orientation, true);
  }
}

function resolvePositionValue(value: number | string | undefined, dimension: number): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  const percent = value.match(/^\s*(-?\d+(?:\.\d+)?)%\s*$/);
  if (percent) return (Number(percent[1]) / 100) * dimension;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isZero(value: number | string): boolean {
  return value === 0 || value === '0' || value === '0%';
}

function isFullViewportBackground(layer: Layer, viewport: ViewportConfig): boolean {
  if (layer.type !== 'shape' && layer.type !== 'image') return false;
  const { position } = layer;
  const fullWidth = position.width === '100%' || position.width === viewport.width;
  const fullHeight = position.height === '100%' || position.height === viewport.height;
  return isZero(position.x) && isZero(position.y) && fullWidth && fullHeight;
}

function mapPosition(
  position: Position,
  contentRect: LayerRect,
  viewport: ViewportConfig,
): Position {
  const mapped: Position = {
    ...position,
    x:
      contentRect.x +
      (resolvePositionValue(position.x, viewport.width) / viewport.width) * contentRect.width,
    y:
      contentRect.y +
      (resolvePositionValue(position.y, viewport.height) / viewport.height) * contentRect.height,
  };
  if (position.width !== undefined) {
    mapped.width =
      (resolvePositionValue(position.width, viewport.width) / viewport.width) * contentRect.width;
  }
  if (position.height !== undefined) {
    mapped.height =
      (resolvePositionValue(position.height, viewport.height) / viewport.height) *
      contentRect.height;
  }
  return mapped;
}

/**
 * Translate a template rendered against a local viewport into a root-level
 * media rectangle. Spatial templates emit absolute SVG path coordinates, so
 * those coordinates must move with ordinary layer positions.
 */
export function placeLayersInRect(
  layers: readonly Layer[],
  sourceViewport: ViewportConfig,
  target: LayerRect,
  idPrefix: string,
): Layer[] {
  const scaleX = target.width / sourceViewport.width;
  const scaleY = target.height / sourceViewport.height;
  const fontScale = Math.min(scaleX, scaleY);
  return layers.map((layer) => {
    const position: Position = {
      ...layer.position,
      x: target.x + resolvePositionValue(layer.position.x, sourceViewport.width) * scaleX,
      y: target.y + resolvePositionValue(layer.position.y, sourceViewport.height) * scaleY,
      ...(layer.position.width !== undefined
        ? {
            width: resolvePositionValue(layer.position.width, sourceViewport.width) * scaleX,
          }
        : {}),
      ...(layer.position.height !== undefined
        ? {
            height: resolvePositionValue(layer.position.height, sourceViewport.height) * scaleY,
          }
        : {}),
    };
    const base = { ...layer, id: `${idPrefix}-${layer.id}`, position };
    if (layer.type === 'path') {
      return {
        ...base,
        type: 'path',
        content: {
          ...layer.content,
          d: transformAbsoluteSvgPath(layer.content.d, scaleX, scaleY, target.x, target.y),
          ...(layer.content.strokeWidth !== undefined
            ? { strokeWidth: layer.content.strokeWidth * fontScale }
            : {}),
        },
      };
    }
    if (layer.type === 'text' && fontScale !== 1) {
      return {
        ...base,
        type: 'text',
        content: {
          ...layer.content,
          style: {
            ...layer.content.style,
            fontSize: Math.max(10, layer.content.style.fontSize * fontScale),
          },
        },
      };
    }
    return base as Layer;
  });
}

/** Affine-transform the absolute SVG commands emitted by spatial templates. */
function transformAbsoluteSvgPath(
  d: string,
  scaleX: number,
  scaleY: number,
  translateX: number,
  translateY: number,
): string {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  if (!tokens) return d;
  let command = '';
  let parameterIndex = 0;
  return tokens
    .map((token) => {
      if (/^[a-zA-Z]$/.test(token)) {
        command = token;
        parameterIndex = 0;
        return token;
      }
      const value = Number(token);
      if (!Number.isFinite(value) || command === command.toLowerCase()) {
        parameterIndex++;
        return token;
      }
      const index = parameterIndex++;
      let transformed = value;
      switch (command) {
        case 'M':
        case 'L':
        case 'T':
        case 'C':
        case 'S':
        case 'Q':
          transformed = index % 2 === 0 ? value * scaleX + translateX : value * scaleY + translateY;
          break;
        case 'H':
          transformed = value * scaleX + translateX;
          break;
        case 'V':
          transformed = value * scaleY + translateY;
          break;
        case 'A': {
          const arcIndex = index % 7;
          if (arcIndex === 0) transformed = value * scaleX;
          else if (arcIndex === 1) transformed = value * scaleY;
          else if (arcIndex === 5) transformed = value * scaleX + translateX;
          else if (arcIndex === 6) transformed = value * scaleY + translateY;
          break;
        }
      }
      return String(Math.round(transformed * 1000) / 1000);
    })
    .join(' ');
}

function mapForegroundLayers(
  layers: readonly Layer[],
  contentRect: LayerRect,
  viewport: ViewportConfig,
  fontScale: number,
  template: string,
): Layer[] {
  const mapped = layers.map((layer) => {
    if (isFullViewportBackground(layer, viewport)) return layer;
    const position = mapPosition(layer.position, contentRect, viewport);
    if (layer.type === 'text') {
      return {
        ...layer,
        position,
        content: {
          ...layer.content,
          style: {
            ...layer.content.style,
            fontSize: Math.max(12, Math.round(layer.content.style.fontSize * fontScale)),
            ...(layer.content.style.padding !== undefined
              ? { padding: Math.round(layer.content.style.padding * fontScale) }
              : {}),
          },
        },
      };
    }
    return { ...layer, position } as Layer;
  });
  return arrangeTitleFamily(mapped, template, contentRect, viewport);
}

/** Recompose title-family lockups after their foreground has a smaller region. */
function arrangeTitleFamily(
  layers: Layer[],
  template: string,
  contentRect: LayerRect,
  viewport: ViewportConfig,
): Layer[] {
  const centerX = contentRect.x + contentRect.width / 2;
  const centerY = contentRect.y + contentRect.height / 2;

  if (template === 'sectionHeader') {
    return layers.map((layer) => {
      if (layer.id === 'title') {
        return {
          ...layer,
          position: {
            ...layer.position,
            x: centerX,
            y: centerY,
            width: contentRect.width * 0.9,
            anchor: 'center',
          },
        } as Layer;
      }
      if (layer.id === 'line-top' || layer.id === 'line-bottom') {
        const direction = layer.id === 'line-top' ? -1 : 1;
        return {
          ...layer,
          position: {
            ...layer.position,
            x: centerX,
            y: centerY + direction * contentRect.height * 0.28,
            width: Math.min(contentRect.width * 0.22, viewport.width * 0.2),
            height: 2,
            anchor: 'center',
          },
        } as Layer;
      }
      return layer;
    });
  }
  if (template !== 'title') return layers;

  const title = layers.find((layer) => layer.type === 'text' && layer.id === 'title');
  const subtitle = layers.find((layer) => layer.type === 'text' && layer.id === 'subtitle');
  if (!title || title.type !== 'text') return layers;
  const subtitleText = subtitle?.type === 'text' ? subtitle : undefined;
  const maxWidth = contentRect.width * 0.9;
  const decorationGap = Math.max(12, Math.min(viewport.width, viewport.height) * 0.018);
  const textGap = subtitleText ? decorationGap : 0;
  const availableHeight = contentRect.height * 0.78;
  let titleFontSize = title.content.style.fontSize;
  let subtitleFontSize = subtitleText?.content.style.fontSize ?? 0;

  const measure = () => {
    const titleHeight = estimateTextHeight(
      title.content.text,
      titleFontSize,
      maxWidth,
      title.content.style.lineHeight ?? 1.15,
    );
    const subtitleHeight = subtitleText
      ? estimateTextHeight(
          subtitleText.content.text,
          subtitleFontSize,
          maxWidth,
          subtitleText.content.style.lineHeight ?? 1.5,
        )
      : 0;
    return { titleHeight, subtitleHeight, total: titleHeight + textGap + subtitleHeight };
  };
  let measured = measure();
  if (measured.total > availableHeight) {
    const fit = Math.max(0.5, availableHeight / measured.total);
    titleFontSize = Math.max(18, Math.round(titleFontSize * fit));
    subtitleFontSize = Math.max(14, Math.round(subtitleFontSize * fit));
    measured = measure();
  }

  const top = contentRect.y + (contentRect.height - measured.total) / 2;
  const titleY = top + measured.titleHeight / 2;
  const subtitleY = top + measured.titleHeight + textGap + measured.subtitleHeight / 2;
  return layers.map((layer) => {
    if (layer.id === 'title' && layer.type === 'text') {
      return {
        ...layer,
        position: { ...layer.position, x: centerX, y: titleY, width: maxWidth, anchor: 'center' },
        content: {
          ...layer.content,
          style: { ...layer.content.style, fontSize: titleFontSize },
        },
      };
    }
    if (layer.id === 'subtitle' && layer.type === 'text') {
      return {
        ...layer,
        position: {
          ...layer.position,
          x: centerX,
          y: subtitleY,
          width: maxWidth,
          anchor: 'center',
        },
        content: {
          ...layer.content,
          style: { ...layer.content.style, fontSize: subtitleFontSize },
        },
      };
    }
    if (layer.id === 'accent-line') {
      return {
        ...layer,
        position: {
          ...layer.position,
          x: centerX,
          y: Math.max(contentRect.y + 2, top - decorationGap * 0.75),
          width: Math.min(contentRect.width * 0.18, viewport.width * 0.12),
          height: 3,
          anchor: 'center',
        },
      } as Layer;
    }
    return layer;
  });
}

function positionRect(
  position: Position,
  viewport: ViewportConfig,
  fallbackWidth: number,
  fallbackHeight: number,
): LayerRect {
  const width = position.width
    ? resolvePositionValue(position.width, viewport.width)
    : fallbackWidth;
  const height = position.height
    ? resolvePositionValue(position.height, viewport.height)
    : fallbackHeight;
  let x = resolvePositionValue(position.x, viewport.width);
  let y = resolvePositionValue(position.y, viewport.height);
  const anchor = position.anchor ?? 'top-left';
  if (anchor === 'center') {
    x -= width / 2;
    y -= height / 2;
  } else {
    if (anchor.endsWith('right')) x -= width;
    if (anchor.startsWith('bottom')) y -= height;
  }
  return { x, y, width, height };
}

function overlapArea(a: LayerRect, b: LayerRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

/** Compatibility fallback for authored and document-scoped custom templates. */
function leastObstructedMediaRect(layers: readonly Layer[], viewport: ViewportConfig): LayerRect {
  const occupied = layers
    .filter((layer) => layer.type !== 'shape' && layer.type !== 'path' && layer.type !== 'mermaid')
    .map((layer) =>
      positionRect(
        layer.position,
        viewport,
        layer.type === 'text' ? viewport.width * 0.45 : viewport.width * 0.5,
        layer.type === 'text' ? viewport.height * 0.2 : viewport.height * 0.55,
      ),
    );
  if (occupied.length === 0) return rect(viewport, 0.06, 0.08, 0.88, 0.84);

  const candidates = [
    rect(viewport, 0.52, 0.12, 0.44, 0.76),
    rect(viewport, 0.04, 0.12, 0.44, 0.76),
    rect(viewport, 0.15, 0.53, 0.7, 0.41),
  ];
  return candidates.reduce((best, candidate) => {
    const score = occupied.reduce((sum, item) => sum + overlapArea(candidate, item), 0);
    const bestScore = occupied.reduce((sum, item) => sum + overlapArea(best, item), 0);
    return score < bestScore ? candidate : best;
  });
}

/**
 * Resolve the media-present variant for a block. No-media blocks never call
 * this function and therefore retain their template's original layer graph.
 */
export function resolveSupplementalMediaLayout(
  layers: Layer[],
  template: string | undefined,
  viewport: ViewportConfig,
  mediaCount: number,
  aspectRatios: readonly (number | undefined)[],
): SupplementalMediaLayout {
  const policy = getBlockMediaLayoutPolicy(template);
  const shape = mediaShape(mediaCount, aspectRatios);
  const alreadyOwnsMedia = layers.some(
    (layer) =>
      layer.type === 'image' ||
      layer.type === 'video' ||
      layer.type === 'map' ||
      layer.type === 'mermaid',
  );
  const retainNativeLayout =
    policy?.unconsumedMedia === 'retain-native-layout' ||
    (policy?.unconsumedMedia === 'reserve-when-no-native-media' && alreadyOwnsMedia);
  if (policy?.additionalMediaLayout === 'overlay-inset' && retainNativeLayout) {
    return {
      layers,
      mediaRect: overlayMediaRect(viewport, shape),
      framed: true,
    };
  }
  const canReserve =
    policy?.unconsumedMedia === 'reserved-slot' ||
    (policy?.unconsumedMedia === 'reserve-when-no-native-media' && !alreadyOwnsMedia);
  if (!policy || !canReserve || !policy.variants) {
    return {
      layers,
      mediaRect: leastObstructedMediaRect(layers, viewport),
      framed: false,
    };
  }

  const orientation = getViewportOrientation(viewport);
  const layout = designedLayout(policy.variants[orientation][shape], viewport);
  return {
    layers: mapForegroundLayers(
      layers,
      layout.contentRect,
      viewport,
      layout.fontScale,
      template ?? '',
    ),
    mediaRect: layout.mediaRect,
    framed: true,
  };
}
