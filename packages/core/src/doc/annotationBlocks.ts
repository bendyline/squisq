/**
 * Standalone template-annotation block extraction.
 *
 * A paragraph whose entire trimmed text is exactly `{[templateName key=value …]}`
 * — where `templateName` is not a media name (media annotations are extracted
 * first, into typed clips) — becomes a *heading-less template block*. The body
 * nodes that follow it, up to the next heading or the next standalone
 * annotation, become that block's `contents`.
 *
 * This is the block analog of {@link import('./mediaAnnotations.js').extractMediaFromContents}:
 * both walk a block's body `contents` and lift standalone `{[…]}` paragraphs
 * out, sharing the {@link parseStandaloneAnnotation} parser. Runs AFTER media
 * extraction (so media names keep their meaning) and BEFORE structured-data
 * parsing (so `json data` / `yaml data` fences attach to the new blocks).
 */

import type { Block } from '../schemas/Doc.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import { coerceAnnotationValues, type CoercedBlockMeta } from '../markdown/annotationCoercion.js';
import { resolveTemplateName } from './templates/index.js';
import { isMediaAnnotationName } from './mediaAnnotations.js';
import { parseStandaloneAnnotation, type ParsedAnnotation } from './standaloneAnnotation.js';

/** Configuration for {@link extractTemplateBlocksFromContents}. */
export interface StandaloneBlockOptions {
  /** Produce a unique block id for a parsed standalone annotation. */
  makeId: (parsed: ParsedAnnotation) => string;
  /** Initial `duration` for a produced block (the timing pass overrides it). */
  defaultDuration: number;
}

/** The split produced by {@link extractTemplateBlocksFromContents}. */
export interface TemplateBlockExtraction {
  /** Contents before the first standalone template annotation (stay on the
   *  containing block). */
  leading: MarkdownBlockNode[];
  /** Heading-less blocks, each carrying the body nodes that followed its
   *  annotation up to the next annotation / end of contents. */
  blocks: Block[];
}

/**
 * Apply coerced block-meta values onto a produced block. Mirrors
 * `markdownToDoc`'s `applyBlockMeta` so a standalone `{[quote duration=8]}`
 * honors the same block-meta keys a heading `{[…]}` annotation would.
 */
function applyBlockMeta(block: Block, m: CoercedBlockMeta): void {
  if (m.x != null) block.x = m.x;
  if (m.y != null) block.y = m.y;
  if (m.startTime != null) block.startTime = m.startTime;
  if (m.duration != null) block.duration = m.duration;
  if (m.connectsTo) block.connectsTo = m.connectsTo;
  if (m.transition) block.transition = m.transition;
}

/** Build a heading-less block from a parsed standalone template annotation. */
function makeStandaloneBlock(parsed: ParsedAnnotation, options: StandaloneBlockOptions): Block {
  // `parsed.template` is guaranteed defined by the caller's guard.
  const rawTemplate = parsed.template as string;
  const params = parsed.params;
  const hasParams = Object.keys(params).length > 0;

  const block: Block = {
    id: options.makeId(parsed),
    startTime: 0,
    duration: options.defaultDuration,
    audioSegment: 0,
    template: resolveTemplateName(rawTemplate),
    standaloneAnnotation: true,
    // Keep the raw (un-resolved) name so validation can report the exact
    // requested name — symmetric with `sourceHeading.templateAnnotation`.
    sourceAnnotation: { template: rawTemplate, ...(hasParams ? { params } : {}) },
    // Only carry a display title when the author supplied one.
    ...(params.title ? { title: params.title } : {}),
  };

  if (hasParams) {
    block.templateOverrides = params;
    applyBlockMeta(block, coerceAnnotationValues(params).blockMeta);
  }

  return block;
}

/**
 * Walk `contents`, lifting standalone template-annotation paragraphs into
 * heading-less blocks. Nodes after an annotation (until the next annotation
 * or the end of `contents`) attach to that block. Media annotations are left
 * in place — they are extracted separately, before this runs. `contents` is
 * not mutated; the split is returned.
 */
export function extractTemplateBlocksFromContents(
  contents: MarkdownBlockNode[] | undefined,
  options: StandaloneBlockOptions,
): TemplateBlockExtraction {
  const leading: MarkdownBlockNode[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const node of contents ?? []) {
    const parsed = parseStandaloneAnnotation(node);
    const isTemplateAnnotation =
      parsed != null && parsed.template != null && !isMediaAnnotationName(parsed.template);

    if (isTemplateAnnotation) {
      const block = makeStandaloneBlock(parsed as ParsedAnnotation, options);
      blocks.push(block);
      current = block;
    } else if (current) {
      (current.contents ??= []).push(node);
    } else {
      leading.push(node);
    }
  }

  return { leading, blocks };
}
