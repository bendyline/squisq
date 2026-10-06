/**
 * Apply Transform
 *
 * Main entry point for the transform module. Takes a Doc and a style,
 * analyzes block content, selects extractions to promote, and returns
 * a new Doc with blocks optimized for visual presentation.
 *
 * The input Doc is never mutated — a fresh Doc is always returned.
 */

import type { Doc } from '../schemas/Doc.js';
import type { DocBlock, TitleBlockInput, SectionHeaderInput } from '../schemas/BlockTemplates.js';
import type { TransformStyleInput, TransformOptions, TransformResult } from './types.js';
import { resolveTransformStyle } from './registry.js';
import { analyzeBlocks, analyzeFlatBlocks, extractDocImages } from './blockAnalyzer.js';
import { selectAndBuild } from './templateSelector.js';
import type { SelectionResult } from './templateSelector.js';
import { briefText, summarizeBlock } from './contentSummary.js';
import { flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { allocateTiming } from './timingAllocator.js';
import { hashString } from '../random/SeededRandom.js';

/**
 * Apply a transform style to a Doc, producing a new Doc with blocks
 * optimized for visual presentation.
 *
 * @param doc - The source Doc (not mutated).
 * @param style - Built-in/registry id or a call-scoped declarative style.
 * @param options - Optional seed, images, theme override, and explicit registry.
 * @returns TransformResult with the new Doc and stats.
 */
export function applyTransform(
  doc: Doc,
  style: TransformStyleInput,
  options?: TransformOptions,
): TransformResult {
  const baseConfig = resolveTransformStyle(style, options?.registry);
  const config = options?.overrides
    ? { ...baseConfig, ...options.overrides, id: baseConfig.id }
    : baseConfig;

  const seed = options?.seed ?? hashString(doc.articleId || 'transform');

  // Use provided images or auto-extract from the doc's markdown content
  const images = options?.images ?? extractDocImages(doc.blocks);

  // 1. Analyze blocks
  const analyzed = (config.contentMode ? analyzeFlatBlocks : analyzeBlocks)(
    config.contentMode ? flattenRenderableBlocks(doc.blocks) : doc.blocks,
    {
      minConfidence: config.minConfidence,
      types: config.preferredTypes,
    },
  );

  // If no blocks have meaningful content, return the doc unchanged
  const hasContent = analyzed.some((ab) => ab.bodyWordCount >= 5);
  if (!hasContent && !config.contentMode) {
    return {
      doc: { ...doc },
      stats: {
        totalInputBlocks: doc.blocks.length,
        transformedBlocks: 0,
        insertedBlocks: 0,
      },
    };
  }

  // 2. Select extractions and build template blocks
  const selection: SelectionResult =
    config.contentMode === 'headings-and-features'
      ? {
          blocks: analyzed
            .filter((ab) => ab.block.sourceHeading || ab.block.title)
            .map((ab) => summarizeBlock(ab.block, 'headings-and-features')),
          transformedCount: analyzed.filter((ab) => ab.block.sourceHeading || ab.block.title)
            .length,
          insertedCount: 0,
        }
      : selectAndBuild(analyzed, config, images, seed);

  // 2b. Pacing bookends: an opening title beat and/or a closing beat.
  let paced: DocBlock[] = selection.blocks;
  let pacingInserted = 0;
  const docTitle = firstTitle(doc);
  if (config.pacing?.intro && docTitle && !doc.startBlock) {
    const intro: TitleBlockInput = {
      template: 'title',
      id: 'transform-intro',
      duration: 4,
      audioSegment: 0,
      title: docTitle,
    };
    paced = [intro, ...paced];
    pacingInserted++;
  }
  if (config.pacing?.outro && docTitle) {
    const outro: SectionHeaderInput = {
      template: 'sectionHeader',
      id: 'transform-outro',
      duration: 3,
      audioSegment: 0,
      title: docTitle,
      colorScheme: config.colorSchemes[0],
    };
    paced = [...paced, outro];
    pacingInserted++;
  }

  // 3. Allocate timing across the new block sequence
  const timedBlocks = allocateTiming(paced, doc.duration);

  // 4. Assemble the output Doc. A style's suggested theme applies only
  // when neither the caller nor the doc declares one.
  const transformedDoc: Doc = {
    ...doc,
    blocks: timedBlocks,
    themeId: options?.themeId ?? doc.themeId ?? config.suggestedThemeId,
    ...(config.contentMode && doc.startBlock
      ? {
          startBlock: {
            ...doc.startBlock,
            subtitle:
              config.contentMode === 'brief' ? briefText(doc.startBlock.subtitle ?? '') : undefined,
          },
        }
      : {}),
  };

  return {
    doc: transformedDoc,
    stats: {
      totalInputBlocks: doc.blocks.length,
      transformedBlocks: selection.transformedCount,
      insertedBlocks: selection.insertedCount + pacingInserted,
    },
  };
}

/** First non-empty block title (the doc's working title). */
function firstTitle(doc: Doc): string | undefined {
  if (doc.startBlock?.title) return doc.startBlock.title;
  for (const block of doc.blocks) {
    if (block.title) return block.title;
  }
  return undefined;
}
