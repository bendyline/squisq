/**
 * Doc → Markdown Conversion
 *
 * Converts a Doc with a heading-driven Block hierarchy back into a
 * MarkdownDocument. This is the reverse of markdownToDoc() and enables
 * round-tripping: edit a Doc's block tree, then serialize back to markdown.
 *
 * **Algorithm:**
 * Walk the block tree depth-first. For each block:
 * 1. If it has a `sourceHeading`, emit that heading node
 * 2. Emit all nodes in `contents`
 * 3. Recurse into `children`
 *
 * @example
 * ```ts
 * import { markdownToDoc, docToMarkdown } from '@bendyline/squisq/doc';
 * import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
 *
 * const md = '# Hello\n\nWorld\n';
 * const doc = markdownToDoc(parseMarkdown(md));
 * const roundTripped = stringifyMarkdown(docToMarkdown(doc));
 * ```
 */

import type { Doc, Block } from '../schemas/Doc.js';
import type { MediaClip } from '../schemas/Media.js';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownHeading,
  MarkdownParagraph,
} from '../markdown/types.js';
import { serializeAnnotation } from '../markdown/attrTokens.js';
import { flattenBlocks } from './markdownToDoc.js';
import {
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
  writeCustomTemplatesToFrontmatter,
} from './customTemplatesFrontmatter.js';
import {
  FRONTMATTER_CUSTOM_THEMES_KEY,
  writeCustomThemesToFrontmatter,
} from './customThemesFrontmatter.js';

const TRANSITION_PARAM_KEYS = ['transition', 'transitionDuration', 'transitionDirection'] as const;

/**
 * Convert a Doc with heading-driven blocks back to a MarkdownDocument.
 *
 * Walks the block tree depth-first, emitting heading nodes and contents
 * in document order. Blocks without a `sourceHeading` (preamble blocks)
 * emit only their contents.
 *
 * If a block has a `template` or `templateOverrides` that aren't already
 * reflected in the heading's `templateAnnotation`, the annotation is
 * injected so the round-trip preserves template assignments.
 *
 * @param doc - A Doc whose blocks may have `sourceHeading`, `contents`, and `children`
 * @returns A MarkdownDocument that can be stringified back to markdown
 */
export function docToMarkdown(doc: Doc): MarkdownDocument {
  const children: MarkdownBlockNode[] = [];

  // Media clips were LIFTED out of block contents at parse time
  // (`extractMediaFromContents`); re-insert their authoring annotations so
  // the round-trip doesn't silently drop narration/clip references.
  // Doc-anchored clips whose home block still exists ride back into that
  // block's body; homeless ones (programmatic clips, or a preamble block
  // that was dropped once emptied) emit at the document top — the
  // canonical authored position.
  const blockIds = new Set(flattenBlocks(doc.blocks).map((b) => b.id));
  const docMediaByBlock = new Map<string, MediaClip[]>();
  const homelessDocMedia: MediaClip[] = [];
  for (const clip of doc.documentMedia ?? []) {
    if (clip.origin && blockIds.has(clip.origin.blockId)) {
      const list = docMediaByBlock.get(clip.origin.blockId) ?? [];
      list.push(clip);
      docMediaByBlock.set(clip.origin.blockId, list);
    } else {
      homelessDocMedia.push(clip);
    }
  }
  for (const clip of homelessDocMedia) {
    children.push(synthesizeMediaParagraph(clip));
  }

  function emitBlock(block: Block): void {
    // Emit the heading node if present
    if (block.sourceHeading) {
      const heading = ensureAnnotation(block, block.sourceHeading);
      children.push(heading);
    } else if (block.standaloneAnnotation) {
      // Heading-less standalone block: re-emit its `{[…]}` annotation as a
      // paragraph before its contents. The serializer's quoting is paired
      // with the tokenizer, and stringifyMarkdown un-escapes `{[…]}` spans,
      // so the annotation round-trips.
      children.push(synthesizeAnnotationParagraph(block));
    }

    // Emit body content, with this block's media annotations re-inserted
    // at their original positions. `origin.index` refers to the ORIGINAL
    // contents array (which included every annotation), so ascending
    // insertion into the stripped contents reproduces the source order.
    const clips = [...(block.media ?? []), ...(docMediaByBlock.get(block.id) ?? [])];
    if (clips.length > 0) {
      const contents = [...(block.contents ?? [])];
      const anchored = clips
        .filter((clip) => clip.origin)
        .sort((a, b) => a.origin!.index - b.origin!.index);
      for (const clip of anchored) {
        contents.splice(
          Math.min(clip.origin!.index, contents.length),
          0,
          synthesizeMediaParagraph(clip),
        );
      }
      // Origin-less block clips (programmatic) sit right under the heading.
      for (const clip of clips.filter((c) => !c.origin).reverse()) {
        contents.unshift(synthesizeMediaParagraph(clip));
      }
      children.push(...contents);
    } else if (block.contents) {
      children.push(...block.contents);
    }

    // Recurse into children (sub-headings)
    if (block.children) {
      for (const child of block.children) {
        emitBlock(child);
      }
    }
  }

  for (const block of doc.blocks) {
    emitBlock(block);
  }

  // Merge `Doc.customTemplates` into the outgoing frontmatter so the
  // markdown remains the source-of-truth: edits made via the editor's
  // TemplateDesigner round-trip through `docToMarkdown` →
  // `stringifyMarkdown` and are visible to anyone reading the file.
  const customPayload = writeCustomTemplatesToFrontmatter(doc.customTemplates);
  let frontmatter = doc.frontmatter;
  if (customPayload) {
    frontmatter = { ...(frontmatter ?? {}), [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: customPayload };
  } else if (frontmatter && FRONTMATTER_CUSTOM_TEMPLATES_KEY in frontmatter) {
    // The doc has no custom templates anymore — drop the stale
    // frontmatter key so the markdown reflects the current state.
    const { [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: _drop, ...rest } = frontmatter;
    void _drop;
    frontmatter = rest;
  }

  // Mirror the same round-trip for `Doc.customThemes` (the theme analog).
  const customThemesPayload = writeCustomThemesToFrontmatter(doc.customThemes);
  if (customThemesPayload) {
    frontmatter = { ...(frontmatter ?? {}), [FRONTMATTER_CUSTOM_THEMES_KEY]: customThemesPayload };
  } else if (frontmatter && FRONTMATTER_CUSTOM_THEMES_KEY in frontmatter) {
    const { [FRONTMATTER_CUSTOM_THEMES_KEY]: _dropTheme, ...rest } = frontmatter;
    void _dropTheme;
    frontmatter = rest;
  }

  return {
    type: 'document',
    children,
    ...(frontmatter && Object.keys(frontmatter).length > 0 ? { frontmatter } : {}),
  };
}

/**
 * Build the synthesized annotation paragraph for a heading-less standalone
 * block: `{[templateName key=value …]}` from its `sourceAnnotation.template`
 * and current `templateOverrides` (edits round-trip through the latter).
 */
function synthesizeAnnotationParagraph(block: Block): MarkdownParagraph {
  const text = serializeAnnotation(block.sourceAnnotation?.template, block.templateOverrides);
  return { type: 'paragraph', children: [{ type: 'text', value: text }] };
}

/**
 * Re-synthesize the authoring paragraph for a media clip. The extraction
 * kept the exact source text (`origin.raw`) — emit it verbatim so quoting,
 * param order, and `mm:ss` time forms stay byte-stable. Programmatic clips
 * (no raw) serialize canonically: src, anchor, then timing params.
 */
function synthesizeMediaParagraph(clip: MediaClip): MarkdownParagraph {
  if (clip.origin?.raw) {
    return { type: 'paragraph', children: [{ type: 'text', value: clip.origin.raw }] };
  }
  const params: Record<string, string> = { src: clip.src };
  if (clip.anchor === 'document') params.anchor = 'document';
  if (clip.startAt) params.startAt = String(clip.startAt);
  if (clip.clipStart != null) params.clipStart = String(clip.clipStart);
  if (clip.clipEnd != null) params.clipEnd = String(clip.clipEnd);
  if (clip.spillover) params.spillover = 'true';
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: serializeAnnotation(clip.kind, params) }],
  };
}

/**
 * Ensure the heading's `templateAnnotation` reflects the block's
 * template and templateOverrides. Returns a (possibly cloned) heading.
 */
function ensureAnnotation(block: Block, heading: MarkdownHeading): MarkdownHeading {
  const { attributes, transitionParams } = ensureTransitionMetadata(block, heading);

  // If the block has a non-default template or overrides, inject an annotation
  const hasExplicitTemplate =
    block.template && block.template !== 'sectionHeader' && block.autoTemplate !== true;
  const hasOverrides = block.templateOverrides && Object.keys(block.templateOverrides).length > 0;

  let templateAnnotation = heading.templateAnnotation;
  if (!templateAnnotation && (hasExplicitTemplate || hasOverrides || transitionParams)) {
    templateAnnotation = {
      ...(hasExplicitTemplate ? { template: block.template ?? 'sectionHeader' } : {}),
      ...(hasOverrides ? { params: block.templateOverrides } : {}),
    };
  }

  if (transitionParams) {
    templateAnnotation = {
      ...(templateAnnotation ?? {}),
      params: {
        ...(templateAnnotation?.params ?? {}),
        ...transitionParams,
      },
    };
  }

  if (attributes === heading.attributes && templateAnnotation === heading.templateAnnotation) {
    return heading;
  }

  return { ...heading, children: [...heading.children], attributes, templateAnnotation };
}

function ensureTransitionMetadata(
  block: Block,
  heading: MarkdownHeading,
): {
  attributes: MarkdownHeading['attributes'];
  transitionParams: Record<string, string> | undefined;
} {
  const transition = block.transition;
  if (!transition) {
    return { attributes: heading.attributes, transitionParams: undefined };
  }

  // The transition is written to the squisq-native `{[…]}` params for
  // author-facing markdown, and to `attributes.blockMeta` for the in-memory
  // Doc → MarkdownDocument → Doc path (which does not re-parse string params).
  const attrs = removeTransitionParams(heading.attributes) ?? {};
  const attributes = {
    ...attrs,
    blockMeta: {
      ...(attrs.blockMeta ?? {}),
      transition,
    },
  };
  return {
    attributes,
    transitionParams: {
      transition: transition.type,
      ...(transition.duration !== undefined
        ? { transitionDuration: String(transition.duration) }
        : {}),
      ...(transition.direction ? { transitionDirection: transition.direction } : {}),
    },
  };
}

function removeTransitionParams(
  attrs: MarkdownHeading['attributes'],
): MarkdownHeading['attributes'] {
  if (!attrs?.params) return attrs;
  const params = { ...attrs.params };
  for (const key of TRANSITION_PARAM_KEYS) delete params[key];
  return {
    ...attrs,
    ...(Object.keys(params).length > 0 ? { params } : { params: undefined }),
  };
}
