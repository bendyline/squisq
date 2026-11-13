/**
 * headingTemplateLine
 *
 * Read and write a block's type — the template named by a heading's
 * squisq-native `{[templateName key=value …]}` annotation — directly on the
 * Markdown source, for surfaces that have no Tiptap heading node to update:
 * the Source view (Monaco) and the Slideshow toolbar's block-type picker.
 *
 * Changing the type keeps the heading text, its Pandoc `{#id .class}` block,
 * and the annotation's block-level params (transition, timing, …). Params
 * that belong to the previous template are dropped: they describe that
 * template's inputs and mean nothing to the next one.
 *
 * Brace matching and tokenizing are delegated to the shared core helpers so
 * this stays in lockstep with the parser by import, not by copied regexes.
 */

import {
  KNOWN_BLOCK_META_KEYS,
  matchTrailingPandocAttr,
  matchTrailingTemplateAnnotation,
  splitKeyValueToken,
  tokenizeAttrTokens,
} from '@bendyline/squisq/markdown';
import { isMarkdownFencedCodeLine } from './markdownCodeFence';

const BLOCK_META_KEYS = new Set<string>(Object.keys(KNOWN_BLOCK_META_KEYS));

/** An ATX heading line: up to three spaces, 1–6 `#`, whitespace, then text. */
const HEADING_LINE_RE = /^( {0,3}#{1,6}[ \t]+)(.*\S.*)$/;

/** The `key=value` tokens that configure the block rather than its template. */
export function keepBlockMetaParamTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => {
    const kv = splitKeyValueToken(token);
    return kv ? BLOCK_META_KEYS.has(kv.key) : false;
  });
}

/**
 * {@link keepBlockMetaParamTokens} over the param string a Tiptap heading
 * node stores in `dataTemplateParams`. Null when nothing survives.
 */
export function keepBlockMetaParamString(inner: string | null | undefined): string | null {
  if (!inner) return null;
  const params = keepBlockMetaParamTokens(tokenizeAttrTokens(inner));
  return params.length > 0 ? params.join(' ') : null;
}

interface HeadingLineParts {
  /** `## `, including any leading indent. */
  prefix: string;
  /** Heading text with both trailing annotation blocks removed. */
  text: string;
  /** The Pandoc `{…}` block as written, with its leading whitespace, or ''. */
  pandoc: string;
  /** The annotation's template name, or '' when it names none. */
  template: string;
  /** The annotation's tokens after the template name. */
  params: string[];
}

/**
 * Split a heading line into its text and trailing annotation blocks. The two
 * blocks may appear in either order, as the parser accepts (`convert.ts`
 * peels them in a bounded loop for the same reason).
 */
function splitHeadingLine(line: string): HeadingLineParts | null {
  const match = HEADING_LINE_RE.exec(line);
  if (!match) return null;
  let rest = match[2];
  let annotationInner: string | null = null;
  let pandoc = '';
  for (let pass = 0; pass < 4; pass++) {
    let matched = false;
    if (annotationInner === null) {
      const annotation = matchTrailingTemplateAnnotation(rest);
      if (annotation) {
        annotationInner = annotation.inner;
        rest = rest.slice(0, annotation.index);
        matched = true;
      }
    }
    if (!pandoc) {
      const attrs = matchTrailingPandocAttr(rest);
      if (attrs) {
        pandoc = rest.slice(attrs.index).replace(/\s+$/, '');
        rest = rest.slice(0, attrs.index);
        matched = true;
      }
    }
    if (!matched) break;
  }

  const tokens = annotationInner === null ? [] : tokenizeAttrTokens(annotationInner.trim());
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  return {
    prefix: match[1],
    text: rest.replace(/\s+$/, ''),
    pandoc,
    template: firstIsParam ? '' : (tokens[0] ?? ''),
    params: tokens.slice(firstIsParam || tokens.length === 0 ? 0 : 1),
  };
}

/**
 * The template a heading line's annotation names: `''` for a heading with no
 * template, `null` when `line` is not a heading at all.
 */
export function readHeadingLineTemplate(line: string): string | null {
  return splitHeadingLine(line)?.template ?? null;
}

/**
 * Return `line` with its block type set to `template` (`''` removes it).
 * Emits the canonical trailing order — Pandoc block, then annotation. A line
 * that is not a heading is returned unchanged.
 */
export function setHeadingLineTemplate(line: string, template: string): string {
  const parts = splitHeadingLine(line);
  if (!parts) return line;
  const annotationParts = [
    ...(template ? [template] : []),
    ...keepBlockMetaParamTokens(parts.params),
  ];
  const annotation = annotationParts.length > 0 ? ` {[${annotationParts.join(' ')}]}` : '';
  return `${parts.prefix}${parts.text}${parts.pandoc}${annotation}`;
}

/**
 * Set the block type of the heading on 1-based `lineNumber` of a whole
 * Markdown document, leaving every other character — line endings included —
 * as it was.
 *
 * Returns `null` when that line is not a heading the type can be written to
 * (out of range, inside a fenced code block, or not an ATX heading), so a
 * caller holding a stale line number refuses instead of editing prose.
 */
export function setSourceHeadingTemplate(
  source: string,
  lineNumber: number,
  template: string,
): string | null {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  // Odd entries are the line terminators, so joining restores them verbatim.
  const parts = source.split(/(\r\n|\r|\n)/);
  const index = (lineNumber - 1) * 2;
  if (index >= parts.length) return null;
  if (isMarkdownFencedCodeLine(source, lineNumber)) return null;
  if (!splitHeadingLine(parts[index])) return null;
  parts[index] = setHeadingLineTemplate(parts[index], template);
  return parts.join('');
}
