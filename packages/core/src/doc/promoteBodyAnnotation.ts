/**
 * Body-annotation promotion detector.
 *
 * LLM-authored markdown often puts a block-type tag (`{[title …]}`, `{[list]}`,
 * `{[statHighlight …]}`) INSIDE a block's body — on its own line, or glued to
 * the end of a body paragraph — instead of appending it to the heading where
 * Squisq expects it (`# Heading {[title …]}`). This module recognizes that
 * misplaced tag so the block can be treated as that template.
 *
 * Promotion is deliberately conservative — "single trailing tag" only:
 *
 * - the tag must be the block's TRAILING content (whole-paragraph as the last
 *   node, or a trailing token on the last paragraph), and
 * - it must be the ONLY body annotation (an earlier standalone `{[…]}` paragraph
 *   means the section uses the multi-block heading-less feature — left alone).
 *
 * The detector is pure: it returns the parsed annotation, provenance for a
 * byte-faithful round-trip (`docToMarkdown` re-emits the tag in the body until
 * the block is edited — mirroring the media-annotation round-trip), and the body
 * `contents` with the tag stripped for rendering. It does NOT decide media vs.
 * template names or template validity — the caller (`markdownToDoc`) does.
 */

import type { MarkdownBlockNode } from '../markdown/types.js';
import type { PromotedBodyAnnotation } from '../schemas/Doc.js';
import { matchTrailingTemplateAnnotation } from '../markdown/attrTokens.js';
import { parseAnnotationInner, parseStandaloneAnnotation } from './standaloneAnnotation.js';

export type { PromotedBodyAnnotation };

/** A successful detection: the annotation + the body with the tag removed. */
export interface PromotableDetection {
  data: PromotedBodyAnnotation;
  strippedContents: MarkdownBlockNode[];
}

/** The last inline child of a paragraph, when it is a text node. */
function lastTextChildValue(node: MarkdownBlockNode): string | null {
  if (node.type !== 'paragraph') return null;
  const children = node.children;
  if (children.length === 0) return null;
  const last = children[children.length - 1];
  return last.type === 'text' ? last.value : null;
}

/**
 * True when a node carries a template annotation in either shape — used to
 * enforce "exactly one" by rejecting promotion when an earlier node is itself an
 * annotation (those belong to the existing heading-less-block path).
 */
function isBodyAnnotationNode(node: MarkdownBlockNode): boolean {
  if (parseStandaloneAnnotation(node)?.template) return true;
  const value = lastTextChildValue(node);
  if (value == null) return false;
  const match = matchTrailingTemplateAnnotation(value);
  return !!match && match.index > 0 && !!parseAnnotationInner(match.inner).template;
}

/** Body `contents` with the trailing token trimmed off the paragraph at `index`. */
function stripTrailingToken(
  contents: MarkdownBlockNode[],
  index: number,
  cut: number,
): MarkdownBlockNode[] {
  const out = [...contents];
  const para = out[index];
  if (para.type !== 'paragraph') return out; // caller guarantees a paragraph
  const children = [...para.children];
  const last = children[children.length - 1];
  if (last.type !== 'text') return out; // caller guarantees a trailing text node
  const kept = last.value.slice(0, cut);
  if (kept.length === 0 && children.length === 1) {
    out.splice(index, 1); // nothing but the tag survived — drop the paragraph
  } else {
    children[children.length - 1] = { ...last, value: kept };
    out[index] = { ...para, children };
  }
  return out;
}

/**
 * Detect a promotable single trailing body annotation. Returns null unless the
 * block's LAST content node is a `{[template …]}` tag (whole-paragraph or
 * trailing token) AND no earlier node is itself an annotation.
 */
export function detectPromotableBodyAnnotation(
  contents: MarkdownBlockNode[] | undefined,
): PromotableDetection | null {
  if (!contents || contents.length === 0) return null;
  const lastIndex = contents.length - 1;
  const last = contents[lastIndex];

  let data: PromotedBodyAnnotation | null = null;
  let strippedContents: MarkdownBlockNode[] | null = null;

  // Whole-paragraph form: the last node is exactly `{[…]}`.
  const whole = parseStandaloneAnnotation(last);
  if (whole?.template && last.type === 'paragraph') {
    const first = last.children[0];
    data = {
      template: whole.template,
      params: whole.params,
      origin: {
        kind: 'paragraph',
        index: lastIndex,
        raw: first && first.type === 'text' ? first.value.trim() : '',
      },
    };
    strippedContents = contents.slice(0, lastIndex);
  } else {
    // Trailing-token form: the last paragraph ends with `… {[…]}`.
    const value = lastTextChildValue(last);
    const match = value != null ? matchTrailingTemplateAnnotation(value) : null;
    if (value != null && match && match.index > 0) {
      const parsed = parseAnnotationInner(match.inner);
      if (parsed.template) {
        data = {
          template: parsed.template,
          params: parsed.params,
          origin: { kind: 'trailing', index: lastIndex, suffix: value.slice(match.index) },
        };
        strippedContents = stripTrailingToken(contents, lastIndex, match.index);
      }
    }
  }

  if (!data || !strippedContents) return null;

  // "Single tag": bail if any earlier node is also an annotation — those are the
  // existing multi-block heading-less sections and must stay untouched.
  for (let i = 0; i < lastIndex; i++) {
    if (isBodyAnnotationNode(contents[i])) return null;
  }

  return { data, strippedContents };
}
