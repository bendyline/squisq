/**
 * Transform Types
 *
 * Defines the type system for doc block transforms — algorithms that take
 * an existing Doc and produce a new Doc with blocks optimized for visual
 * presentation. Transforms are read-only on the input and deterministic.
 */

import type { Doc } from '../schemas/Doc.js';
import type { ExtractionType } from '../generate/contentExtractor.js';
import type { ColorScheme } from '../schemas/BlockTemplates.js';

// ── Style identification ─────────────────────────────────────────

/** Identifier for a built-in or caller-registered transform style. */
export type TransformStyleId = string;

/** Summary info for UI dropdowns (mirrors getThemeSummaries pattern). */
export interface TransformStyleSummary {
  id: TransformStyleId;
  name: string;
  description: string;
}

// ── Style configuration ──────────────────────────────────────────

/** Declarative configuration controlling how a style transforms content. */
export interface TransformStyleConfig {
  /** Unique style identifier. */
  id: TransformStyleId;
  /** Human-readable name for UI display. */
  name: string;
  /** Short description for UI tooltips. */
  description: string;

  /**
   * Minimum confidence for extracted elements to become template blocks (0–1).
   * Higher values = fewer but higher-quality transformations.
   */
  minConfidence: number;

  /**
   * Maximum fraction of blocks that get transformed (0–1).
   * 0.2 = light touch, 0.8 = aggressive restructuring.
   */
  transformRatio: number;

  /** Which extraction types this style prefers, in priority order. */
  preferredTypes: ExtractionType[];

  /** Color schemes to rotate through on template blocks. */
  colorSchemes: ColorScheme[];

  /** Whether to insert sectionHeader blocks between groups. */
  insertSectionHeaders: boolean;

  /** Whether to interleave imageWithCaption blocks when images are available. */
  interleaveImages: boolean;

  /** Maximum template blocks promoted per source section. */
  blocksPerSection: { max: number };

  /** Transition style preference for transformed blocks. */
  transitionStyle: 'cut' | 'fade' | 'dissolve' | 'mixed';

  /**
   * Per-style extraction→template remapping. Falls back to the fixed
   * default map in `generate/templateMapper.ts` for unmapped types.
   * Only text-compatible targets are honored (see
   * `translateTemplateBlock`) — an unknown pairing keeps the default.
   */
  templateMap?: Partial<Record<ExtractionType, string>>;

  /**
   * Theme this style pairs best with. Consumers (CLI, editor preview)
   * apply it only when the doc doesn't already declare a `themeId`.
   */
  suggestedThemeId?: string;

  /** Optional opening/closing beats added around the transformed doc. */
  pacing?: {
    /** Prepend a `title` block built from the doc's title. */
    intro?: boolean;
    /** Append a closing beat (best unused quote/impact line, else a sectionHeader). */
    outro?: boolean;
  };

  /**
   * Duration-based slide budget (folded in from the since-removed
   * `generateSlideshow`): caps promoted template blocks at roughly
   * `slidesPerMinute` of doc duration (default: uncapped — only
   * `transformRatio` applies).
   */
  budget?: {
    /** Target promoted blocks per minute of content (e.g. 5). */
    slidesPerMinute?: number;
  };
}

/** Built-in id or a call-scoped declarative style definition. */
export type TransformStyleInput = TransformStyleId | TransformStyleConfig;

/** Explicit caller-owned registry for custom transform styles. */
export interface TransformStyleRegistry {
  register(style: TransformStyleConfig): void;
  unregister(id: string): boolean;
  get(id: string): TransformStyleConfig | undefined;
  list(): TransformStyleConfig[];
}

// ── Transform options ────────────────────────────────────────────

/** Image metadata for image interleaving. */
export interface TransformImage {
  /** Image source path or URL. */
  src: string;
  /** Alt text for accessibility. */
  alt?: string;
  /** Photo credit. */
  credit?: string;
  /** License identifier. */
  license?: string;
}

/** Options passed to `applyTransform()`. */
export interface TransformOptions {
  /** Deterministic seed. Default: hash of doc.articleId. */
  seed?: number;
  /** Available images for image interleaving / accent images. */
  images?: TransformImage[];
  /** Theme ID to embed in the output Doc. */
  themeId?: string;
  /** Override specific style config values. */
  overrides?: Partial<TransformStyleConfig>;
  /** Caller-owned registry used when `style` is an id. */
  registry?: TransformStyleRegistry;
}

// ── Transform result ─────────────────────────────────────────────

/** Result of applying a transform. */
export interface TransformResult {
  /** The transformed Doc. Input doc is NOT mutated. */
  doc: Doc;
  /** Statistics about what changed. */
  stats: {
    totalInputBlocks: number;
    transformedBlocks: number;
    insertedBlocks: number;
  };
}
