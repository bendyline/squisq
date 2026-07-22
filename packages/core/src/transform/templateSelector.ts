/**
 * Template Selector
 *
 * Selects which extracted elements to promote to visual template blocks
 * and handles color scheme rotation, image interleaving, and template
 * variety.
 */

import type { Block, TransitionType } from '../schemas/Doc.js';
import type {
  TemplateBlock,
  AccentImage,
  AccentPosition,
  ImageWithCaptionInput,
  SectionHeaderInput,
  QuoteBlockInput,
  FullBleedQuoteInput,
  StatHighlightInput,
} from '../schemas/BlockTemplates.js';
import type { ExtractedElement } from '../generate/contentExtractor.js';
import type { TransformStyleConfig, TransformImage } from './types.js';
import type { AnalyzedBlock } from './blockAnalyzer.js';
import { mapElementToBlock } from '../generate/templateMapper.js';
import { SeededRandom } from '../random/SeededRandom.js';
import { estimateTimeFromText } from '../timing/narrationTiming.js';

/** Accent positions to rotate through. */
const ACCENT_POSITIONS: AccentPosition[] = [
  'left-strip',
  'right-strip',
  'bottom-strip',
  'corner-inset',
];

/** Ambient motions to rotate on image blocks. */
const AMBIENT_MOTIONS: Array<'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'> = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
];

/** A selected element paired with its source block. */
interface SelectedExtraction {
  element: ExtractedElement;
  sourceBlock: Block;
  /** Index in the original analyzed blocks array. */
  sourceIndex: number;
}

/** Result of template selection. */
export interface SelectionResult {
  /** Replacement blocks: a mix of original blocks and new template blocks. */
  blocks: Array<Block | TemplateBlock>;
  /** How many blocks were transformed. */
  transformedCount: number;
  /** How many blocks were inserted (images, section headers). */
  insertedCount: number;
}

/**
 * Select extractions and build a transformed block sequence.
 *
 * @param analyzed - Analyzed blocks from blockAnalyzer.
 * @param config - The transform style configuration.
 * @param images - Available images for interleaving.
 * @param seed - Random seed for deterministic output.
 */
export function selectAndBuild(
  analyzed: AnalyzedBlock[],
  config: TransformStyleConfig,
  images: TransformImage[],
  seed: number,
): SelectionResult {
  const rng = new SeededRandom(seed);

  // 1. Collect all extractions across all blocks, filtered by config
  const candidates = collectCandidates(analyzed, config);

  // 2. Determine how many blocks to transform. `transformRatio` scales
  // with block count; an optional duration-based budget (slides per
  // minute) caps runaway promotion on long dense documents.
  const ratioCap = Math.max(1, Math.floor(analyzed.length * config.transformRatio));
  const slidesPerMinute = config.budget?.slidesPerMinute;
  const totalDurationSeconds = analyzed.reduce((sum, ab) => sum + (ab.block.duration || 0), 0);
  const budgetCap =
    slidesPerMinute && totalDurationSeconds > 0
      ? Math.max(1, Math.round((totalDurationSeconds / 60) * slidesPerMinute))
      : Infinity;
  const maxTransforms = Math.min(ratioCap, budgetCap);
  const selected = candidates.slice(0, maxTransforms);

  // 3. Build the output block sequence
  const result = buildBlockSequence(analyzed, selected, config, images, rng);

  return result;
}

/**
 * Collect candidate extractions from all analyzed blocks, sorted by
 * a combined score of confidence and type preference.
 */
function collectCandidates(
  analyzed: AnalyzedBlock[],
  config: TransformStyleConfig,
): SelectedExtraction[] {
  const candidates: SelectedExtraction[] = [];

  for (let i = 0; i < analyzed.length; i++) {
    const ab = analyzed[i];
    // Skip blocks with no meaningful text
    if (ab.bodyWordCount < 5) continue;

    for (const element of ab.extractions) {
      if (element.confidence < config.minConfidence) continue;

      candidates.push({
        element,
        sourceBlock: ab.block,
        sourceIndex: i,
      });
    }
  }

  // Sort by: preferred type rank (lower = better), then confidence (higher = better)
  const typeRank = new Map(config.preferredTypes.map((t, i) => [t, i]));
  const maxRank = config.preferredTypes.length;

  candidates.sort((a, b) => {
    const rankA = typeRank.get(a.element.type) ?? maxRank;
    const rankB = typeRank.get(b.element.type) ?? maxRank;
    if (rankA !== rankB) return rankA - rankB;
    return b.element.confidence - a.element.confidence;
  });

  // Deduplicate: if the same extracted text appears multiple times
  // (e.g., from overlapping parent/child blocks), keep only the
  // highest-ranked occurrence.
  const seenTexts = new Set<string>();
  const deduplicated: SelectedExtraction[] = [];
  for (const candidate of candidates) {
    const key = candidate.element.text.trim().toLowerCase();
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    deduplicated.push(candidate);
  }

  return deduplicated;
}

/**
 * Build the output block sequence, replacing source blocks with template
 * blocks where extractions were selected, and interleaving images.
 */
function buildBlockSequence(
  analyzed: AnalyzedBlock[],
  selected: SelectedExtraction[],
  config: TransformStyleConfig,
  images: TransformImage[],
  rng: SeededRandom,
): SelectionResult {
  // Map: sourceIndex → list of selected extractions for that block
  const blockExtractions = new Map<number, SelectedExtraction[]>();
  for (const sel of selected) {
    const list = blockExtractions.get(sel.sourceIndex) ?? [];
    list.push(sel);
    blockExtractions.set(sel.sourceIndex, list);
  }

  // Limit extractions per block: cap at blocksPerSection.max and ensure
  // template type variety within each block (no two same-type extractions).
  for (const [idx, list] of blockExtractions) {
    const diverse: SelectedExtraction[] = [];
    const usedTypes = new Set<string>();
    for (const sel of list) {
      if (usedTypes.has(sel.element.type)) continue;
      usedTypes.add(sel.element.type);
      diverse.push(sel);
      if (diverse.length >= config.blocksPerSection.max) break;
    }
    blockExtractions.set(idx, diverse);
  }

  const blocks: Array<Block | TemplateBlock> = [];
  let transformedCount = 0;
  let insertedCount = 0;
  let colorIndex = 0;
  let blockIdCounter = 0;
  let imageIndex = 0;
  let accentPositionIndex = 0;
  let elementsSinceImage = 0;
  let prevTemplateType = '';

  // Calculate image interleaving interval
  const totalTransformed = Array.from(blockExtractions.values()).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  const imageInterval =
    config.interleaveImages && images.length > 0 && totalTransformed > 0
      ? Math.max(2, Math.floor(totalTransformed / (images.length + 1)))
      : Infinity;

  for (let i = 0; i < analyzed.length; i++) {
    const ab = analyzed[i];
    const extractions = blockExtractions.get(i);

    if (!extractions || extractions.length === 0) {
      // Keep the original block unchanged
      blocks.push(ab.block);
      continue;
    }

    // Insert section header before a group of transformed blocks (if enabled)
    if (config.insertSectionHeaders && ab.block.title) {
      const headerBlock: SectionHeaderInput = {
        template: 'sectionHeader',
        id: `transform-header-${blockIdCounter++}`,
        duration: ab.block.duration > 0 ? Math.min(3, ab.block.duration * 0.2) : 3,
        audioSegment: ab.block.audioSegment,
        title: ab.block.title,
        colorScheme: config.colorSchemes[colorIndex % config.colorSchemes.length],
        sourceBlockId: ab.block.id,
      };
      blocks.push(headerBlock);
      insertedCount++;
    }

    // Convert each selected extraction to a template block.
    // Track the last template used globally (not just within this block)
    // to avoid consecutive same-template slides across the entire output.
    for (const sel of extractions) {
      const colorScheme = config.colorSchemes[colorIndex % config.colorSchemes.length];

      // Build accent image if we have images in the pool
      let accentImage: AccentImage | undefined;
      if (images.length > 0 && config.interleaveImages) {
        const img = images[imageIndex % images.length];
        accentImage = {
          src: img.src,
          alt: img.alt ?? '',
          position: ACCENT_POSITIONS[accentPositionIndex % ACCENT_POSITIONS.length],
          ambientMotion: rng.pick(AMBIENT_MOTIONS) ?? 'zoomIn',
          credit: img.credit,
          license: img.license,
        };
        accentPositionIndex++;
      }

      // `sourcePosition` is a CHAR OFFSET into the analyzed plain text;
      // `sourceStartTime` is doc-timeline SECONDS. Convert via spoken-word
      // proportion over the source block's timing — which, when the doc
      // carries a narration take (applyNarrationTiming ran upstream), is
      // the recorded voice: summarized slides land where the words are
      // actually spoken.
      const slideShare = ab.block.duration > 0 ? ab.block.duration / extractions.length : 6;
      const offsetInBlock =
        ab.block.duration > 0
          ? estimateTimeFromText(ab.plainText, sel.element.sourcePosition, ab.block.duration)
          : 0;
      let templateBlock = mapElementToBlock(sel.element, {
        id: `transform-${blockIdCounter++}`,
        duration: slideShare,
        audioSegment: ab.block.audioSegment,
        colorScheme,
        accentImage,
        sourceStartTime: ab.block.startTime + offsetInBlock,
        sourceDuration: slideShare,
        sourceBlockId: ab.block.id,
        sourceCharOffset: sel.element.sourcePosition,
      });

      // Style-level extraction→template remap (v2 contract). Only known
      // text-compatible pairings translate; image-backed targets consume
      // the accent image as their background. Unknown pairings keep the
      // default mapping.
      const remapTarget = config.templateMap?.[sel.element.data.type];
      if (remapTarget && remapTarget !== templateBlock.template) {
        const translated = translateTemplateBlock(templateBlock, remapTarget);
        if (translated) templateBlock = translated;
      }

      // Apply transition based on style
      if (config.transitionStyle !== 'cut') {
        const transitionType: TransitionType =
          config.transitionStyle === 'mixed'
            ? (rng.pick<TransitionType>(['fade', 'dissolve']) ?? 'fade')
            : config.transitionStyle;
        templateBlock.transition = {
          type: transitionType,
          duration: 0.5,
        };
      }

      // Avoid consecutive same-template blocks by bumping color for variety
      if (templateBlock.template === prevTemplateType) {
        colorIndex++;
      }
      prevTemplateType = templateBlock.template;

      blocks.push(templateBlock);
      transformedCount++;
      colorIndex++;
      elementsSinceImage++;

      // Interleave standalone image at intervals
      if (
        config.interleaveImages &&
        imageIndex < images.length &&
        elementsSinceImage >= imageInterval
      ) {
        const img = images[imageIndex];
        const imageBlock: ImageWithCaptionInput = {
          template: 'imageWithCaption',
          id: `transform-img-${blockIdCounter++}`,
          duration: 4,
          audioSegment: ab.block.audioSegment,
          imageSrc: img.src,
          imageAlt: img.alt ?? '',
          ambientMotion: rng.pick(AMBIENT_MOTIONS) ?? 'zoomIn',
          sourceBlockId: ab.block.id,
        };
        blocks.push(imageBlock);
        imageIndex++;
        insertedCount++;
        elementsSinceImage = 0;
      }
    }
  }

  return { blocks, transformedCount, insertedCount };
}

/**
 * Translate a mapped template block into a style-requested target
 * template. Only text-compatible pairings are supported; returns null
 * (keep the default) for unknown pairs or when a required input —
 * a background image for `pullQuote` — is unavailable.
 */
function translateTemplateBlock(block: TemplateBlock, target: string): TemplateBlock | null {
  const base = {
    id: block.id,
    duration: block.duration,
    audioSegment: block.audioSegment,
    sourceStartTime: block.sourceStartTime,
    sourceDuration: block.sourceDuration,
    sourceBlockId: block.sourceBlockId,
    sourceCharOffset: block.sourceCharOffset,
  };

  if (block.template === 'quote') {
    const quote = block as QuoteBlockInput;
    if (target === 'fullBleedQuote') {
      return { ...base, template: 'fullBleedQuote', text: quote.quote };
    }
    if (target === 'pullQuote') {
      // pullQuote requires a full-bleed background image — reuse the
      // accent image the selector already assigned to this block.
      const bg = quote.accentImage;
      if (!bg) return null;
      return {
        ...base,
        template: 'pullQuote',
        text: quote.quote,
        attribution: quote.attribution,
        backgroundImage: { src: bg.src, alt: bg.alt, credit: bg.credit, license: bg.license },
      };
    }
    return null;
  }

  if (block.template === 'fullBleedQuote' && target === 'quote') {
    const fbq = block as FullBleedQuoteInput;
    return { ...base, template: 'quote', quote: fbq.text };
  }

  if (block.template === 'statHighlight' && target === 'factCard') {
    const stat = block as StatHighlightInput;
    return {
      ...base,
      template: 'factCard',
      fact: stat.stat,
      explanation: stat.description,
      accentImage: stat.accentImage,
    };
  }

  return null;
}
