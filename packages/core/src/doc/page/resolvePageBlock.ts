/**
 * Resolve a doc block into the typed template input the page pipeline
 * (and the SVG canvas embed) should render.
 *
 * This is the block-input merge that previously lived inline in
 * `LinearDocView` — hoisted into core so the React page view, the string
 * HTML exporter, and tests share one derivation:
 *
 * - Authored blocks with a heading `{[template]}` annotation derive typed
 *   inputs from the heading/body (`deriveTemplateInputs` with placeholders),
 *   then overlay `templateData` and coerced annotation params / overrides.
 * - Auto-templated blocks (`block.autoTemplate`) already carry derived
 *   `templateData`; same overlay applies.
 * - Transform-generated blocks (no `sourceHeading`) already ARE typed
 *   template inputs; overlay `templateData` / overrides like
 *   `materializeBlockLayers` does.
 * - Everything else is prose.
 */

import type { Block } from '../../schemas/Doc.js';
import type { DocBlock, TemplateBlock } from '../../schemas/BlockTemplates.js';
import { isTemplateBlock } from '../../schemas/BlockTemplates.js';
import { extractPlainText } from '../../markdown/utils.js';
import { deriveTemplateInputs } from '../templateInputs.js';
import { coerceTemplateParams } from '../templates/inputDescriptors.js';
import { resolveTemplateName } from '../templates/templateNames.js';

/** The page pipeline's view of one block. */
export interface ResolvedPageBlock {
  /** True when the block renders as a typed section (not prose). */
  templated: boolean;
  /** Canonical template id (post-alias). Only when `templated`. */
  templateName?: string;
  /**
   * Fully merged typed template input, ready for a section extractor or
   * `materializeBlockLayers`. Only when `templated`.
   */
  templateBlock?: TemplateBlock;
}

/**
 * True when the block should render as a typed template section in Page
 * mode: heading annotation, content-aware auto template, or a template
 * block without authoring nodes (transform output, standalone annotation).
 */
export function isTemplatedPageBlock(block: Block): boolean {
  if (block.sourceHeading?.templateAnnotation?.template) return true;
  if (block.autoTemplate && block.template) return true;
  return !block.sourceHeading && isTemplateBlock(block as DocBlock);
}

/** Template id as authored (pre-alias), when the block is templated. */
function templatedName(block: Block): string | undefined {
  return block.sourceHeading?.templateAnnotation?.template ?? block.template;
}

/**
 * Merge a block into its typed template input. Mirrors the merge order
 * `materializeBlockLayers` applies at execution time:
 * derived inputs → `templateData` → coerced annotation params/overrides.
 */
export function resolvePageBlock(block: Block): ResolvedPageBlock {
  if (!isTemplatedPageBlock(block)) return { templated: false };

  const annotation = block.sourceHeading?.templateAnnotation;
  const rawName = templatedName(block) ?? 'sectionHeader';
  const templateName = resolveTemplateName(rawName);

  const rawParams: Record<string, string> = {
    ...(annotation?.params ?? {}),
    ...(block.templateOverrides ?? {}),
  };
  const coercedParams = coerceTemplateParams(rawName, rawParams).input;

  let base: Record<string, unknown>;
  if (annotation) {
    const headingText = extractPlainText(block.sourceHeading!);
    base = {
      id: block.id,
      template: rawName,
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      title: headingText,
      contents: block.contents,
      children: block.children,
      ...(deriveTemplateInputs(rawName, headingText, block.contents, {
        placeholders: true,
      }) ?? {}),
    };
  } else {
    base = {
      ...block,
      startTime: block.startTime ?? 0,
      duration: block.duration ?? 1,
      audioSegment: block.audioSegment ?? 0,
      template: rawName,
    };
  }

  const templateBlock = {
    ...base,
    ...(block.templateData ?? {}),
    ...coercedParams,
  } as unknown as TemplateBlock;

  return { templated: true, templateName, templateBlock };
}
