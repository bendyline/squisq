/**
 * Slideshow Generator
 *
 * Turns plain text + optional images into a complete squisq `Doc`.
 *
 * Pipeline:
 * 1. Strip markdown (if needed)
 * 2. Extract compelling content (stats, dates, quotes, …)
 * 3. Estimate narration timing
 * 4. Map extractions → template blocks
 * 5. Interleave image slides
 * 6. Return a ready-to-render `Doc`
 */

import type { Doc, Block } from '../schemas/Doc.js';
import type {
  TemplateBlock,
  ImageWithCaptionInput,
  TitleBlockInput,
  ColorScheme,
  AccentImage,
  AccentPosition,
} from '../schemas/BlockTemplates.js';
import { extractContent, stripMarkdown } from './contentExtractor.js';
import { mapElementToBlock } from './templateMapper.js';
import { estimateNarrationDuration } from '../timing/narrationTiming.js';
import { SeededRandom, hashString } from '../random/SeededRandom.js';

// ── Public types ───────────────────────────────────────────────────

/** Image metadata passed to the generator. */
export interface SlideshowImage {
  /** Image source path or URL. */
  src: string;
  /** Alt text for accessibility. */
  alt?: string;
  /** Photo credit. */
  credit?: string;
  /** License identifier. */
  license?: string;
}

/** Options for `generateSlideshow`. */
export interface SlideshowOptions {
  /** Deterministic seed (default: hash of the text). */
  seed?: number;
  /** Title slide text. Omit to skip the title slide. */
  title?: string;
  /** Subtitle for the title slide. */
  subtitle?: string;
  /** Explicit total duration in seconds. When omitted, estimated from text. */
  duration?: number;
  /** Target number of content slides (default: 5–8, auto-scaled). */
  targetSlides?: number;
  /** Color schemes to rotate (default: ['blue','green','purple','orange','red']). */
  colorSchemes?: ColorScheme[];
  /** Ambient motions to rotate on images. */
  ambientMotions?: Array<'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'>;
  /** Accent positions to rotate on text slides. */
  accentPositions?: AccentPosition[];
  /** Minimum slide duration in seconds (default: 4). */
  minSlideDuration?: number;
  /** Maximum slide duration in seconds (default: 15). */
  maxSlideDuration?: number;
  /** Theme identifier to embed in the Doc. */
  themeId?: string;
  /** Whether the input text is markdown (default: false). */
  isMarkdown?: boolean;
  /** Minimum extraction confidence (default: 0.3). */
  minConfidence?: number;
}

const DEFAULT_COLOR_SCHEMES: ColorScheme[] = ['blue', 'green', 'purple', 'orange', 'red'];
const DEFAULT_AMBIENT_MOTIONS: Array<'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'> = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
];
const DEFAULT_ACCENT_POSITIONS: AccentPosition[] = ['left-strip', 'right-strip', 'bottom-strip'];

// ── Main ───────────────────────────────────────────────────────────

/**
 * Generate a slideshow `Doc` from text and optional images.
 *
 * ```ts
 * const doc = generateSlideshow(articleText, myImages, {
 *   title: 'Mount Rainier',
 *   themeId: 'documentary',
 * });
 * // doc is a complete Doc ready for DocPlayer / LinearDocView
 * ```
 */
export function generateSlideshow(
  text: string,
  images: SlideshowImage[] = [],
  options: SlideshowOptions = {},
): Doc {
  const {
    seed,
    title,
    subtitle,
    duration: explicitDuration,
    targetSlides,
    colorSchemes = DEFAULT_COLOR_SCHEMES,
    ambientMotions = DEFAULT_AMBIENT_MOTIONS,
    accentPositions = DEFAULT_ACCENT_POSITIONS,
    minSlideDuration = 4,
    maxSlideDuration = 15,
    themeId,
    isMarkdown = false,
    minConfidence = 0.3,
  } = options;

  const plainText = isMarkdown ? stripMarkdown(text) : text;
  const rng = new SeededRandom(seed ?? hashString(plainText));

  // 1. Estimate total duration
  const totalDuration = explicitDuration ?? estimateNarrationDuration(plainText);

  // 2. Extract compelling content
  const extraction = extractContent(plainText, { minConfidence });
  const allElements = extraction.elements;

  // 3. Decide slide budget
  const slideBudget = targetSlides ?? computeSlideBudget(totalDuration, allElements.length);

  // Allocate slots between content and images
  const imageSlotCount = images.length > 0 ? Math.max(1, Math.round(slideBudget * 0.4)) : 0;
  const contentSlotCount = slideBudget - imageSlotCount - (title ? 1 : 0);

  // Select top elements by confidence, then restore source order
  const sorted = [...allElements].sort((a, b) => b.confidence - a.confidence);
  const selected = sorted.slice(0, Math.max(1, contentSlotCount));
  selected.sort((a, b) => a.sourcePosition - b.sourcePosition);

  // 4. Build slides
  const blocks: (Block | TemplateBlock)[] = [];
  let slideIndex = 0;
  let colorIdx = 0;
  let accentIdx = 0;

  // Determine per-slide duration
  const totalSlideCount =
    (title ? 1 : 0) + selected.length + Math.min(imageSlotCount, images.length);
  const perSlide =
    totalSlideCount > 0
      ? Math.min(maxSlideDuration, Math.max(minSlideDuration, totalDuration / totalSlideCount))
      : minSlideDuration;

  // Title slide
  if (title) {
    const titleBlock: TitleBlockInput = {
      id: `slide-${slideIndex++}`,
      template: 'titleBlock',
      title,
      subtitle,
      duration: Math.min(perSlide, 6),
      audioSegment: 0,
    };
    blocks.push(titleBlock);
  }

  // Prepare image pool for standalone + accent images
  const standaloneImages = images.slice(0, Math.min(imageSlotCount, images.length));
  const accentPool =
    images.length > standaloneImages.length ? images.slice(standaloneImages.length) : [...images]; // reuse if not enough

  // Interleave pattern: insert an image slide every N content slides
  const imageInterval =
    standaloneImages.length > 0
      ? Math.max(1, Math.floor(selected.length / (standaloneImages.length + 1)))
      : Infinity;
  let imgIdx = 0;
  let sinceImage = 0;

  for (let i = 0; i < selected.length; i++) {
    // Maybe insert a standalone image slide before this content slide
    if (sinceImage >= imageInterval && imgIdx < standaloneImages.length) {
      blocks.push(
        createImageSlide(standaloneImages[imgIdx], slideIndex++, perSlide, rng, ambientMotions),
      );
      imgIdx++;
      sinceImage = 0;
    }

    const element = selected[i];

    // Optional accent image
    let accentImage: AccentImage | undefined;
    if (accentPool.length > 0) {
      const img = accentPool[i % accentPool.length];
      accentImage = {
        src: img.src,
        alt: img.alt ?? '',
        position: accentPositions[accentIdx % accentPositions.length],
        ambientMotion: rng.pickRequired(ambientMotions),
        credit: img.credit,
        license: img.license,
      };
      accentIdx++;
    }

    const block = mapElementToBlock(element, {
      id: `slide-${slideIndex++}`,
      duration: perSlide,
      audioSegment: 0,
      colorScheme: colorSchemes[colorIdx % colorSchemes.length],
      accentImage,
    });
    blocks.push(block);
    colorIdx++;
    sinceImage++;
  }

  // Append any remaining standalone images
  while (imgIdx < standaloneImages.length) {
    blocks.push(
      createImageSlide(standaloneImages[imgIdx], slideIndex++, perSlide, rng, ambientMotions),
    );
    imgIdx++;
  }

  // 5. Assemble Doc
  const doc: Doc = {
    articleId: title ?? 'slideshow',
    duration: totalDuration,
    blocks: blocks as Block[], // TemplateBlock satisfies the union at runtime
    audio: {
      segments: [{ src: '', name: 'main', duration: totalDuration, startTime: 0 }],
    },
    themeId,
  };

  return doc;
}

// ── Helpers ────────────────────────────────────────────────────────

function computeSlideBudget(duration: number, elementCount: number): number {
  // Aim for ~5 slides per minute of content, clamped 3–12
  const byDuration = Math.round((duration / 60) * 5);
  // But don't exceed available elements + a few image slots
  const budget = Math.min(byDuration, elementCount + 4);
  return Math.max(3, Math.min(12, budget));
}

function createImageSlide(
  img: SlideshowImage,
  index: number,
  duration: number,
  rng: SeededRandom,
  motions: Array<'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'>,
): ImageWithCaptionInput {
  return {
    id: `slide-${index}`,
    template: 'imageWithCaption',
    imageSrc: img.src,
    imageAlt: img.alt ?? '',
    caption: img.alt,
    duration,
    audioSegment: 0,
    ambientMotion: rng.pickRequired(motions),
    imageCredit: img.credit,
    imageLicense: img.license,
  };
}
