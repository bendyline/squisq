/**
 * ImageEditDoc — JSON document describing a layered, editable image.
 *
 * This is the persistent state of the `<ImageEditor>` component. It lives
 * inside a `<imagebasename>_files/` sidecar folder (exposed as a
 * {@link ContentContainer}) at `state.json`, alongside referenced asset
 * bytes in `assets/` and version snapshots in `.versions/`.
 *
 * Layers compose the existing core {@link Layer} types (image / text /
 * shape) so renderers can share infrastructure with the doc system.
 * Editor-specific metadata (name, visibility, lock, opacity, blendMode)
 * lives in {@link EditorLayerMeta} and is merged onto each layer. The
 * {@link Layer.animation} field is permitted but ignored by the image
 * editor — animations are a slideshow concept.
 *
 * All asset paths in layers (e.g. `ImageLayer.content.src`) are
 * relative to the sidecar root, keeping the document portable.
 */

import type { ImageLayer, ShapeLayer, TextLayer } from './Doc.js';

// ============================================
// Layer type
// ============================================

/**
 * Per-layer editor metadata. Merged into each layer so the persisted
 * shape is a single object. All fields optional; sensible defaults
 * apply when absent (visible: true, locked: false, opacity: 1).
 */
export interface EditorLayerMeta {
  /** Human-readable name shown in the layers panel. */
  name?: string;
  /** When false, the layer is hidden from rendering. Default true. */
  visible?: boolean;
  /** When true, the layer cannot be selected/edited. Default false. */
  locked?: boolean;
  /** 0..1 multiplier on the layer's alpha. Default 1. */
  opacity?: number;
  /**
   * Canvas blend mode (matches the CSS / Canvas2D vocabulary).
   * Default 'source-over' (normal compositing).
   */
  blendMode?: GlobalCompositeOperation;
}

/** A layer in an {@link ImageEditDoc}. */
export type ImageEditLayer = (ImageLayer | TextLayer | ShapeLayer) & EditorLayerMeta;

/** The layer kinds the image editor supports. */
export type ImageEditLayerKind = ImageEditLayer['type'];

// ============================================
// Document
// ============================================

/** Canvas dimensions and background. */
export interface ImageEditCanvas {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /**
   * Background fill (CSS color, or `'transparent'` for an alpha canvas).
   * Default: `'transparent'`.
   */
  background?: string;
}

/** Optional document metadata. */
export interface ImageEditMeta {
  /** Path to the original source image (sidecar-relative). Set when the doc is seeded from an existing image. */
  sourcePath?: string;
  /** ISO timestamp set on first save. */
  createdAt?: string;
  /** ISO timestamp updated on every save. */
  updatedAt?: string;
}

/**
 * The persisted image-editor document.
 *
 * Layers are composited back-to-front: `layers[0]` is the bottom of the stack
 * (typically the base raster), `layers[layers.length - 1]` is the top.
 */
export interface ImageEditDoc {
  /** Schema version. Bumped on breaking changes. */
  version: 1;
  /** Canvas configuration. */
  canvas: ImageEditCanvas;
  /** Layers, back-to-front. */
  layers: ImageEditLayer[];
  /** Optional metadata. */
  meta?: ImageEditMeta;
}
