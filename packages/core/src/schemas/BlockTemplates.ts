/**
 * Block Templates Schema
 *
 * Defines a template system for AI-generated doc blocks. Instead of
 * specifying low-level layers, positions, and animations, AI can use
 * high-level templates like "titleBlock" or "statHighlight" with simple
 * content parameters.
 *
 * Templates are expanded into full Block structures at render time,
 * ensuring consistent styling and reducing AI generation errors.
 *
 * Template Types:
 * - titleBlock: Doc intro with title + subtitle
 * - sectionHeader: Colored section divider
 * - statHighlight: Big number/stat with description
 * - quoteBlock: Large centered quote
 * - factCard: Key fact with explanation
 * - twoColumn: Side-by-side comparison
 * - dateEvent: Timeline-style date + description
 * - imageWithCaption: Image with text overlay
 */

import type { Layer, Block, Transition, MapTileStyle, MapMarker } from './Doc.js';
import type { ViewportConfig, ViewportOrientation } from './Viewport.js';
import type { LayoutHints } from './LayoutStrategy.js';
import type { Theme } from './Theme.js';
import { VIEWPORT_PRESETS, getViewportOrientation, calculateFontScale } from './Viewport.js';
import { getLayoutHints, scaledFontSize as scaleFontSize } from './LayoutStrategy.js';

/**
 * Name of a color scheme defined in the active theme's `colorSchemes` map.
 * Templates reference schemes by name (e.g. 'blue', 'green') and the theme
 * resolves them to actual colors at render time via `resolveColorScheme()`.
 */
export type ColorScheme = string;

/**
 * Default font family for doc text.
 * PT Serif provides a classic, readable appearance for documentary-style content.
 * Used as a fallback in TextLayer when no font is specified.
 */
export const DEFAULT_DOC_FONT = '"PT Serif", Georgia, "Times New Roman", serif';

/**
 * Default font family for titles.
 */
export const DEFAULT_TITLE_FONT = '"PT Serif", Georgia, "Times New Roman", serif';

// ============================================
// Accent Image System
// ============================================

/**
 * Position options for accent images on text-based blocks.
 * Accents are tasteful image additions that complement rather than overwhelm text.
 */
export type AccentPosition =
  | 'left-strip' // Vertical strip on left (25-30% width), text shifts right
  | 'right-strip' // Vertical strip on right (25-30% width), text shifts left
  | 'bottom-strip' // Horizontal strip at bottom (25-30% height), text shifts up
  | 'corner-inset'; // Small inset image in corner with vignette edge

/**
 * Accent image configuration for text-based blocks.
 * When present, the template adjusts layout to accommodate the image tastefully.
 */
export interface AccentImage {
  /** Path to image file (relative to article media dir) */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Where to position the accent image */
  position: AccentPosition;
  /** Ambient motion effect (subtle Ken Burns) */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
  /** Photo credit / artist name */
  credit?: string;
  /** License identifier (e.g., 'CC BY-SA 4.0') */
  license?: string;
}

// ============================================
// Template Input Types
// ============================================

/**
 * Base properties shared by all template blocks.
 */
interface BaseTemplateBlock {
  /** Unique block ID */
  id: string;
  /** Block duration in seconds */
  duration: number;
  /** Which audio segment this block belongs to */
  audioSegment: number;
  /** Entry transition */
  transition?: Transition;
  /** Show doc's bottom layers (default: true) */
  useBottomLayer?: boolean;
  /** Show doc's top layers (default: true) */
  useTopLayer?: boolean;
  /**
   * Start time within the audio segment when this content is spoken.
   * Used to sync the block appearance with the narration.
   * If not provided, blocks are distributed evenly across the segment.
   */
  sourceStartTime?: number;
  /**
   * Duration of the spoken content this block represents.
   * Used with sourceStartTime to precisely position the block.
   */
  sourceDuration?: number;
}

/**
 * Title block - doc intro with large title and subtitle.
 */
export interface TitleBlockInput extends BaseTemplateBlock {
  template: 'titleBlock';
  /** Main title text */
  title: string;
  /** Subtitle or tagline (supports \n for line breaks) */
  subtitle?: string;
  /** Background color (defaults to theme primary) */
  backgroundColor?: string;
}

/**
 * Section header - section title card with optional background image.
 * Displays the section title prominently, optionally over an image.
 */
export interface SectionHeaderInput extends BaseTemplateBlock {
  template: 'sectionHeader';
  /** Section title */
  title: string;
  /** Color scheme for the section (used for fallback background) */
  colorScheme?: ColorScheme;
  /** Optional background image path */
  imageSrc?: string;
  /** Alt text for background image */
  imageAlt?: string;
  /** Ambient motion for background image */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
}

/**
 * Stat highlight - big number with description and optional detail.
 */
export interface StatHighlightInput extends BaseTemplateBlock {
  template: 'statHighlight';
  /** The statistic (e.g., "89%", "2x", "7 miles") */
  stat: string;
  /** Description of what the stat means */
  description: string;
  /** Additional detail or context */
  detail?: string;
  /** Color scheme for the stat */
  colorScheme?: ColorScheme;
  /** Optional accent image to complement the text */
  accentImage?: AccentImage;
}

/**
 * Quote block - large centered quote text.
 */
export interface QuoteBlockInput extends BaseTemplateBlock {
  template: 'quoteBlock';
  /** The quote text (supports \n for line breaks) */
  quote: string;
  /** Attribution (author, source) */
  attribution?: string;
  /** Optional accent image to complement the text */
  accentImage?: AccentImage;
}

/**
 * Fact card - key fact with explanation.
 */
export interface FactCardInput extends BaseTemplateBlock {
  template: 'factCard';
  /** The main fact or statement */
  fact: string;
  /** Explanation or context */
  explanation: string;
  /** Optional source citation */
  source?: string;
  /** Optional accent image to complement the text */
  accentImage?: AccentImage;
}

/**
 * Two column - side-by-side comparison.
 */
export interface TwoColumnInput extends BaseTemplateBlock {
  template: 'twoColumn';
  /** Left column content */
  left: {
    label: string;
    sublabel?: string;
  };
  /** Right column content */
  right: {
    label: string;
    sublabel?: string;
  };
  /** Optional header above columns */
  header?: string;
  /** Color schemes for left and right */
  leftColor?: ColorScheme;
  rightColor?: ColorScheme;
}

/**
 * Date event - timeline-style date with description.
 */
export interface DateEventInput extends BaseTemplateBlock {
  template: 'dateEvent';
  /** The date (e.g., "July 14, 1974") */
  date: string;
  /** Description of what happened (supports \n) */
  description: string;
  /** Optional footer text */
  footer?: string;
  /** Mood: 'neutral', 'somber', 'celebratory' */
  mood?: 'neutral' | 'somber' | 'celebratory';
  /** Optional accent image to complement the text */
  accentImage?: AccentImage;
}

/**
 * Image with caption - background image with text overlay.
 */
export interface ImageWithCaptionInput extends BaseTemplateBlock {
  template: 'imageWithCaption';
  /** Path to image file */
  imageSrc: string;
  /** Alt text for accessibility */
  imageAlt: string;
  /** Caption text */
  caption?: string;
  /** Caption position */
  captionPosition?: 'bottom' | 'top' | 'center';
  /** Ambient motion effect: slow zoom or pan for visual interest */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
  /** When true, style caption as a title (larger, centered, prominent) */
  isTitle?: boolean;
  /** Optional subtitle shown below the title (only when isTitle is true) */
  subtitle?: string;
  /** Photo credit / artist name */
  imageCredit?: string;
  /** License identifier (e.g., 'CC BY-SA 4.0') */
  imageLicense?: string;
}

/**
 * Map block - geographic map showing article location.
 *
 * Displays a map centered on given coordinates with optional title,
 * caption, and markers. Great for establishing geographic context.
 * See docs/MAP_TILES.md for available tile styles and attribution.
 */
export interface MapBlockInput extends BaseTemplateBlock {
  template: 'mapBlock';
  /** Map center coordinates */
  center: {
    lat: number;
    lng: number;
  };
  /** Zoom level (4-16, typically 8-12 for regional context) */
  zoom: number;
  /** Map tile style (default: 'terrain') */
  mapStyle?: MapTileStyle;
  /** Optional title overlay at top */
  title?: string;
  /** Optional caption at bottom */
  caption?: string;
  /** Optional markers to show on map */
  markers?: MapMarker[];
  /** Ambient motion effect: slow zoom or pan for visual interest */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
  /** Pre-rendered static image path (set by prerender-maps command) */
  staticSrc?: string;
}

/**
 * Full-bleed quote - dramatic short text filling the viewport.
 * Like a movie title card. For short, punchy sentences < 60 chars.
 */
export interface FullBleedQuoteInput extends BaseTemplateBlock {
  template: 'fullBleedQuote';
  /** Short dramatic text (< 60 chars recommended) */
  text: string;
  /** Color scheme for text tint */
  colorScheme?: ColorScheme;
}

/**
 * List block - 3-5 items stacked vertically with subtle numbering.
 * Good for enumerations like "things to see" or "key features".
 */
export interface ListBlockInput extends BaseTemplateBlock {
  template: 'listBlock';
  /** List items (3-5 recommended) */
  items: string[];
  /** Optional header above the list */
  title?: string;
  /** Color scheme for numbering accents */
  colorScheme?: ColorScheme;
  /** Optional accent image */
  accentImage?: AccentImage;
}

/**
 * Photo grid - 2-4 images in a tiled layout.
 * Used when multiple images are available for visual variety.
 */
export interface PhotoGridInput extends BaseTemplateBlock {
  template: 'photoGrid';
  /** Images to display (2-4) */
  images: { src: string; alt: string; credit?: string; license?: string }[];
  /** Optional caption below the grid */
  caption?: string;
  /** Ambient motion effect for the largest image */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
}

/**
 * Definition card - dictionary-style term with definition.
 * Large term at top, definition below, optional origin note.
 */
export interface DefinitionCardInput extends BaseTemplateBlock {
  template: 'definitionCard';
  /** The term being defined */
  term: string;
  /** The definition text */
  definition: string;
  /** Optional etymology or origin note */
  origin?: string;
  /** Color scheme for term accent */
  colorScheme?: ColorScheme;
  /** Optional accent image */
  accentImage?: AccentImage;
}

/**
 * Comparison bar - two horizontal bars showing relative numeric values.
 * Good for side-by-side numeric comparisons with visual weight.
 */
export interface ComparisonBarInput extends BaseTemplateBlock {
  template: 'comparisonBar';
  /** Left bar label */
  leftLabel: string;
  /** Left bar numeric value */
  leftValue: number;
  /** Right bar label */
  rightLabel: string;
  /** Right bar numeric value */
  rightValue: number;
  /** Unit label (e.g., "km", "people") */
  unit?: string;
  /** Color scheme */
  colorScheme?: ColorScheme;
}

/**
 * Pull quote - quote text over a full-bleed background image with dark overlay.
 * Cinematic alternative to quoteBlock when a high-quality image is available.
 */
export interface PullQuoteInput extends BaseTemplateBlock {
  template: 'pullQuote';
  /** Quote text */
  text: string;
  /** Optional attribution */
  attribution?: string;
  /** Background image (fills entire viewport) */
  backgroundImage: { src: string; alt: string; credit?: string; license?: string };
  /** Ambient motion for background image */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
}

/**
 * Video with caption - background video clip with text overlay.
 * Plays a short clip from a source video, always muted (narration is the audio track).
 * Mirrors ImageWithCaptionInput but with video-specific fields.
 */
export interface VideoWithCaptionInput extends BaseTemplateBlock {
  template: 'videoWithCaption';
  /** Path to video file */
  videoSrc: string;
  /** Path to poster frame (shown before video loads) */
  posterSrc?: string;
  /** Alt text for accessibility */
  videoAlt: string;
  /** Start time within source video (seconds) */
  clipStart: number;
  /** End time within source video (seconds) */
  clipEnd: number;
  /** Source video total duration (for validation) */
  sourceDuration?: number;
  /** Caption text overlay */
  caption?: string;
  /** Caption position */
  captionPosition?: 'bottom' | 'top' | 'center';
  /** Video credit / artist name */
  videoCredit?: string;
  /** License identifier */
  videoLicense?: string;
}

/**
 * Video pull quote - quote text over a video clip background with dark overlay.
 * Cinematic alternative to pullQuote when a video clip is available.
 */
export interface VideoPullQuoteInput extends BaseTemplateBlock {
  template: 'videoPullQuote';
  /** Quote text */
  text: string;
  /** Optional attribution */
  attribution?: string;
  /** Background video clip */
  backgroundVideo: {
    src: string;
    posterSrc?: string;
    alt: string;
    clipStart: number;
    clipEnd: number;
    credit?: string;
    license?: string;
  };
}

/**
 * Union of all template block types.
 */
export type TemplateBlock =
  | TitleBlockInput
  | SectionHeaderInput
  | StatHighlightInput
  | QuoteBlockInput
  | FactCardInput
  | TwoColumnInput
  | DateEventInput
  | ImageWithCaptionInput
  | MapBlockInput
  | FullBleedQuoteInput
  | ListBlockInput
  | PhotoGridInput
  | DefinitionCardInput
  | ComparisonBarInput
  | PullQuoteInput
  | VideoWithCaptionInput
  | VideoPullQuoteInput;

/**
 * A block can be either a raw Block or a TemplateBlock.
 */
export type DocBlock = Block | TemplateBlock;

/**
 * Check if a block is a template block.
 */
export function isTemplateBlock(block: DocBlock): block is TemplateBlock {
  return 'template' in block && typeof block.template === 'string';
}

// ============================================
// Template Function Type
// ============================================

/**
 * Template context passed to template functions.
 * Includes viewport information for multi-aspect ratio support.
 */
export interface TemplateContext {
  /** Full theme (colors, typography, style, renderStyle, colorSchemes) */
  theme: Theme;
  /** Block index in the doc */
  blockIndex: number;
  /** Total number of blocks */
  totalBlocks: number;
  /** Target viewport configuration */
  viewport: ViewportConfig;
  /** Computed font scale factor for this viewport */
  fontScale: number;
  /** Viewport orientation (landscape, portrait, square) */
  orientation: ViewportOrientation;
  /** Layout hints for this orientation */
  layout: LayoutHints;
}

/**
 * Create a template context with viewport-derived values.
 */
export function createTemplateContext(
  theme: Theme,
  blockIndex: number,
  totalBlocks: number,
  viewport: ViewportConfig = VIEWPORT_PRESETS.landscape,
): TemplateContext {
  const orientation = getViewportOrientation(viewport);
  return {
    theme,
    blockIndex,
    totalBlocks,
    viewport,
    fontScale: calculateFontScale(viewport),
    orientation,
    layout: getLayoutHints(orientation),
  };
}

/**
 * Calculate a scaled font size for the given context.
 * Use this in templates to ensure text scales appropriately.
 *
 * @param basePx - Base font size in pixels (designed for 1920x1080)
 * @param context - Template context with viewport info
 * @param isTitle - Whether this is title text (larger scale) or body text
 */
export function scaledFontSize(
  basePx: number,
  context: TemplateContext,
  isTitle: boolean = false,
): number {
  return scaleFontSize(basePx, context.viewport, context.orientation, isTitle);
}

/**
 * Template function signature.
 * Takes template input and returns layers array.
 */
export type TemplateFunction<T extends TemplateBlock> = (
  input: T,
  context: TemplateContext,
) => Layer[];

/**
 * Registry of all template functions.
 */
export type TemplateRegistry = {
  [K in TemplateBlock['template']]: TemplateFunction<Extract<TemplateBlock, { template: K }>>;
};

// ============================================
// Persistent Layer System
// ============================================

/**
 * Configuration for persistent doc-wide layers.
 * Bottom layers render behind all block content, top layers on top.
 */
export interface PersistentLayerConfig {
  /** Layers rendered behind all block content */
  bottomLayers?: PersistentLayer[];
  /** Layers rendered on top of all block content */
  topLayers?: PersistentLayer[];
}

/**
 * A persistent layer - either a template or raw Layer.
 */
export type PersistentLayer = PersistentLayerTemplate | Layer;

/**
 * Check if a persistent layer is a template.
 */
export function isPersistentLayerTemplate(
  layer: PersistentLayer,
): layer is PersistentLayerTemplate {
  return 'template' in layer && typeof layer.template === 'string';
}

/**
 * Template-based persistent layer for easy configuration.
 */
export interface PersistentLayerTemplate {
  template: PersistentLayerTemplateType;
  config: PersistentLayerTemplateConfig;
}

/**
 * Available persistent layer template types.
 */
export type PersistentLayerTemplateType =
  | 'solidBackground' // Solid color fill
  | 'gradientBackground' // CSS gradient or preset
  | 'imageBackground' // Blurred/faded hero image
  | 'patternBackground' // Subtle pattern (dots, grid)
  | 'titleCaption' // Article title in corner
  | 'cornerBranding' // Logo or text badge
  | 'progressIndicator'; // Bar/dots showing position

/**
 * Union of all persistent layer template configs.
 */
export type PersistentLayerTemplateConfig =
  | SolidBackgroundConfig
  | GradientBackgroundConfig
  | ImageBackgroundConfig
  | PatternBackgroundConfig
  | TitleCaptionConfig
  | CornerBrandingConfig
  | ProgressIndicatorConfig;

// ============================================
// Background Layer Configs
// ============================================

/**
 * Solid color background.
 */
export interface SolidBackgroundConfig {
  type: 'solidBackground';
  /** CSS color value */
  color: string;
}

/**
 * Gradient background (CSS gradient or preset).
 */
export interface GradientBackgroundConfig {
  type: 'gradientBackground';
  /** Custom CSS gradient string */
  gradient?: string;
  /** Preset gradient name */
  preset?: 'dark-vignette' | 'radial-dark' | 'warm-sunset' | 'cool-blue' | 'earth-tones';
}

/**
 * Image background (blurred/faded hero image).
 */
export interface ImageBackgroundConfig {
  type: 'imageBackground';
  /** Path to image file */
  src: string;
  /** Blur radius in pixels (0-20) */
  blur?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Ambient motion effect */
  ambientMotion?: 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';
}

/**
 * Pattern background (subtle repeating pattern).
 */
export interface PatternBackgroundConfig {
  type: 'patternBackground';
  /** Pattern type */
  pattern: 'dots' | 'grid' | 'diagonal' | 'noise';
  /** Pattern color */
  color?: string;
  /** Pattern opacity (0-1) */
  opacity?: number;
  /** Pattern scale multiplier */
  scale?: number;
}

// ============================================
// Overlay Layer Configs
// ============================================

/**
 * Title caption overlay (article title in corner).
 */
export interface TitleCaptionConfig {
  type: 'titleCaption';
  /** Title text */
  title: string;
  /** Subtitle text (e.g., short URL like "qual..la/slug") */
  subtitle?: string;
  /** Position on screen */
  position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Font size in pixels (default: 18) */
  fontSize?: number;
  /** Show thumbnail alongside title */
  showThumbnail?: boolean;
  /** Thumbnail image path */
  thumbnailSrc?: string;
}

/**
 * Corner branding overlay (logo or text badge).
 */
export interface CornerBrandingConfig {
  type: 'cornerBranding';
  /** Text content or image path */
  content: string;
  /** Position on screen */
  position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Whether content is an image path (vs text) */
  isImage?: boolean;
}

/**
 * Progress indicator overlay (bar or dots showing position).
 */
export interface ProgressIndicatorConfig {
  type: 'progressIndicator';
  /** Indicator style */
  style: 'bar' | 'dots' | 'fraction';
  /** Position on screen */
  position: 'bottom' | 'top';
  /** Indicator color */
  color?: string;
}
