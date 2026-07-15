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
  HeadingTemplateAnnotation,
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownHeading,
  MarkdownParagraph,
} from '../markdown/types.js';
import { serializeAnnotation } from '../markdown/attrTokens.js';
import { flattenBlocks } from './markdownToDoc.js';
import { resolveTemplateName } from './templates/templateNames.js';
import {
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
  writeCustomTemplatesToFrontmatter,
} from './customTemplatesFrontmatter.js';
import {
  FRONTMATTER_CUSTOM_THEMES_KEY,
  writeCustomThemesToFrontmatter,
} from './customThemesFrontmatter.js';

const TRANSITION_PARAM_KEYS = ['transition', 'transitionDuration', 'transitionDirection'] as const;

/** The `markdownToDoc` default, mirrored here so the round-trip agrees by default. */
const DEFAULT_TEMPLATE = 'sectionHeader';

export interface DocToMarkdownOptions {
  /**
   * The template `markdownToDoc` assigned to un-annotated headings when this
   * doc was parsed — i.e. the `MarkdownToDocOptions.defaultTemplate` used.
   * Defaults to `'sectionHeader'`, matching that option's own default.
   *
   * Blocks carrying exactly this template are treated as IMPLICIT: no
   * `{[…]}` annotation is emitted for them, because none was authored.
   * Passing a value that disagrees with how the doc was parsed makes the
   * round-trip inject annotations onto headings that never had any.
   */
  defaultTemplate?: string;
}

/**
 * Convert a Doc with heading-driven blocks back to a MarkdownDocument.
 *
 * Walks the block tree depth-first, emitting heading nodes and contents
 * in document order. Blocks without a `sourceHeading` (preamble blocks)
 * emit only their contents.
 *
 * A block's `template` / `templateOverrides` are RECONCILED with its
 * heading's `templateAnnotation`, so programmatic edits to either round-trip.
 * Annotations that already agree are reused verbatim (including legacy
 * template spellings), keeping untouched documents byte-identical.
 *
 * @param doc - A Doc whose blocks may have `sourceHeading`, `contents`, and `children`
 * @param options - Round-trip options; see {@link DocToMarkdownOptions.defaultTemplate}
 * @returns A MarkdownDocument that can be stringified back to markdown
 */
export function docToMarkdown(doc: Doc, options: DocToMarkdownOptions = {}): MarkdownDocument {
  const defaultTemplate = resolveTemplateName(options.defaultTemplate ?? DEFAULT_TEMPLATE);
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
      const heading = ensureAnnotation(block, block.sourceHeading, defaultTemplate);
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
 * Ensure the heading's `templateAnnotation` reflects the block's CURRENT
 * template and templateOverrides. Returns a (possibly cloned) heading.
 *
 * The block — not the parsed heading — is the source of truth, so a
 * programmatic `block.template = 'statHighlight'` re-serializes as
 * `{[statHighlight]}` rather than silently re-emitting the parsed
 * annotation. The reconciled annotation is compared against the existing
 * one and the ORIGINAL object is reused when they agree, so a doc nobody
 * touched still stringifies byte-for-byte identically.
 */
function ensureAnnotation(
  block: Block,
  heading: MarkdownHeading,
  defaultTemplate: string,
): MarkdownHeading {
  const { attributes, transitionParams } = ensureTransitionMetadata(block, heading);
  const existing = heading.templateAnnotation;

  const template = resolveAnnotationTemplate(block, existing, defaultTemplate);
  const overrides =
    block.templateOverrides && Object.keys(block.templateOverrides).length > 0
      ? block.templateOverrides
      : undefined;

  let templateAnnotation: HeadingTemplateAnnotation | undefined;
  if (template !== undefined || overrides !== undefined) {
    templateAnnotation = {
      ...(template !== undefined ? { template } : {}),
      ...(overrides ? { params: overrides } : {}),
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

  // Reuse the parsed annotation when the reconciled one says the same thing;
  // the identity check below then short-circuits the whole heading clone.
  if (annotationsEqual(existing, templateAnnotation)) templateAnnotation = existing;

  if (attributes === heading.attributes && templateAnnotation === heading.templateAnnotation) {
    return heading;
  }

  return { ...heading, children: [...heading.children], attributes, templateAnnotation };
}

/**
 * The template name to serialize into `{[…]}`, or undefined for none.
 *
 * A template is only ANNOTATED when the author actually asked for it:
 *
 * - `autoTemplate` blocks carry an ephemeral, content-derived template that
 *   was never written down — emitting it would bake a guess into the source.
 * - A template equal to the `defaultTemplate` the doc was parsed with is what
 *   an un-annotated heading gets for free; annotating it would add `{[…]}` to
 *   every plain heading in the file. (Hard-coding `'sectionHeader'` here made
 *   `markdownToDoc(md, { defaultTemplate: 'title' })` do exactly that.)
 * - Otherwise the block's template wins — that is the programmatic edit.
 */
function resolveAnnotationTemplate(
  block: Block,
  existing: HeadingTemplateAnnotation | undefined,
  defaultTemplate: string,
): string | undefined {
  if (!block.template || block.autoTemplate === true) return existing?.template;

  const template = resolveTemplateName(block.template);
  // The annotation already says what the block says: keep the author's
  // spelling verbatim — including legacy aliases like `titleBlock`, and
  // including a default written out explicitly — so a round-trip never
  // rewrites bytes just to canonicalize or tidy a name.
  if (existing?.template && resolveTemplateName(existing.template) === template) {
    return existing.template;
  }
  // Reached only when the block's template DISAGREES with the annotation (or
  // there is none). Landing on the default means no annotation is needed.
  if (template === defaultTemplate) return undefined;
  return block.template;
}

function annotationsEqual(
  a: HeadingTemplateAnnotation | undefined,
  b: HeadingTemplateAnnotation | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.template === b.template && paramsEqual(a.params, b.params);
}

function paramsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
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
