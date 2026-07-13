/**
 * headingTransition
 *
 * Read and write a block's transition (`transition` / `transitionDirection` /
 * `transitionDuration`) on a heading, in both editing surfaces:
 *
 * - Markdown (Monaco): operate on the raw heading line string.
 * - WYSIWYG (Tiptap): operate on the heading node's `dataBlockAttrs` string
 *   (Pandoc `{…}` inner) and `dataTemplateParams` string (the params inside
 *   the squisq-native `{[…]}` annotation).
 *
 * The editor writes transitions to the squisq-native `{[…]}` annotation by
 * default. It still reads legacy Pandoc `{transition=…}` attributes and
 * removes/migrates those keys when rewriting, so the two channels cannot drift
 * after a toolbar edit.
 *
 * All the brace-matching / tokenizing / serializing is delegated to the
 * shared core helpers so this stays in lockstep with the parser by import
 * rather than by copied regexes.
 */

import {
  matchTrailingTemplateAnnotation,
  matchTrailingPandocAttr,
  parsePandocAttrTokens,
  serializePandocAttributes,
  tokenizeAttrTokens,
  splitKeyValueToken,
  quoteAttrValue,
  type HeadingAttributes,
} from '@bendyline/squisq/markdown';

/** Raw (un-coerced) transition attribute values for one block. */
export interface TransitionFields {
  /** `transition` value. Empty string means "none" (`cut`). */
  type: string;
  /** `transitionDirection` value, or '' when unset. */
  direction: string;
  /** `transitionDuration` value (raw, e.g. `0.7` or `700ms`), or '' when unset. */
  duration: string;
}

export const EMPTY_TRANSITION: TransitionFields = { type: '', direction: '', duration: '' };

/** The three keys this module owns, in canonical emit order. */
const TRANSITION_KEYS = ['transition', 'transitionDirection', 'transitionDuration'] as const;

const HEADING_LINE_RE = /^(#{1,6}\s+)([\s\S]*)$/;

// ============================================
// params map ⇄ fields
// ============================================

function fieldsFromParams(params: Record<string, string> | undefined): TransitionFields {
  if (!params) return { ...EMPTY_TRANSITION };
  return {
    type: params.transition ?? '',
    direction: params.transitionDirection ?? '',
    duration: params.transitionDuration ?? '',
  };
}

/**
 * Return a new params map with the transition keys rewritten from `next`,
 * preserving every other key in its original order. When `type` is empty
 * (none), all three transition keys are dropped; direction/duration are only
 * written when a type is present (they're meaningless on their own).
 */
function applyFieldsToParams(
  params: Record<string, string>,
  next: TransitionFields,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if ((TRANSITION_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  if (next.type) {
    out.transition = next.type;
    if (next.direction) out.transitionDirection = next.direction;
    if (next.duration) out.transitionDuration = next.duration;
  }
  return out;
}

function removeFieldsFromAttrs(attrs: HeadingAttributes): HeadingAttributes {
  if (!attrs.params) return attrs;
  const params = applyFieldsToParams(attrs.params, EMPTY_TRANSITION);
  if (Object.keys(params).length > 0) attrs.params = params;
  else delete attrs.params;
  return attrs;
}

/** Parse a bare `key=value …` token string into a params map. */
function paramsFromTokenString(input: string, skipFirstToken: boolean): Record<string, string> {
  const tokens = tokenizeAttrTokens(input);
  const params: Record<string, string> = {};
  for (const token of skipFirstToken ? tokens.slice(1) : tokens) {
    const kv = splitKeyValueToken(token);
    if (kv) params[kv.key] = kv.value;
  }
  return params;
}

function templatePartsFromInner(inner: string | null | undefined): {
  template: string | undefined;
  params: Record<string, string>;
} {
  if (!inner) return { template: undefined, params: {} };
  const tokens = tokenizeAttrTokens(inner);
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  const template = firstIsParam || tokens.length === 0 ? undefined : tokens[0];
  const startIdx = template ? 1 : 0;
  const params: Record<string, string> = {};
  for (const token of tokens.slice(startIdx)) {
    const kv = splitKeyValueToken(token);
    if (kv) params[kv.key] = kv.value;
  }
  return { template, params };
}

function paramsToInner(params: Record<string, string>): string | null {
  const parts = Object.entries(params).map(([key, value]) => `${key}=${quoteAttrValue(value)}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function templateAnnotationOrNull(
  template: string | undefined,
  params: Record<string, string>,
): string | null {
  const parts: string[] = [];
  if (template) parts.push(template);
  const paramInner = paramsToInner(params);
  if (paramInner) parts.push(paramInner);
  return parts.length > 0 ? `{[${parts.join(' ')}]}` : null;
}

// ============================================
// Heading line (Markdown / Monaco view)
// ============================================

interface SplitHeadingLine {
  /** `## ` */
  prefix: string;
  /** Bare heading text (trailing whitespace stripped). */
  text: string;
  /** Inner of the trailing Pandoc `{…}` block, or null. */
  pandocInner: string | null;
  /** Verbatim trailing `{[…]}` template annotation (no leading space), or ''. */
  templateText: string;
}

/**
 * Split a heading line into its prefix, bare text, and trailing annotation
 * blocks. Mirrors the peel-off order in `tiptapBridge` / core's parser:
 * the `{[…]}` template annotation sits at the very end, the Pandoc `{…}`
 * block just before it. Returns null when `line` is not a heading.
 */
function splitHeadingLine(line: string): SplitHeadingLine | null {
  const m = line.match(HEADING_LINE_RE);
  if (!m) return null;
  let rest = m[2];

  let templateText = '';
  const tm = matchTrailingTemplateAnnotation(rest);
  if (tm) {
    templateText = rest.slice(tm.index).trim();
    rest = rest.slice(0, tm.index);
  }

  let pandocInner: string | null = null;
  const pm = matchTrailingPandocAttr(rest);
  if (pm) {
    pandocInner = pm.inner;
    rest = rest.slice(0, pm.index);
  }

  return { prefix: m[1], text: rest.replace(/\s+$/, ''), pandocInner, templateText };
}

/**
 * Read the transition fields off a heading line. Looks in both the Pandoc
 * `{…}` block (legacy) and the `{[…]}` template params (canonical),
 * with the Pandoc block taking precedence. Returns the empty transition for
 * non-heading lines.
 */
export function readHeadingLineTransition(line: string): TransitionFields {
  const split = splitHeadingLine(line);
  if (!split) return { ...EMPTY_TRANSITION };
  const fromTemplate = split.templateText
    ? templatePartsFromInner(stripTemplateBraces(split.templateText)).params
    : {};
  const fromPandoc = split.pandocInner
    ? (parsePandocAttrTokens(split.pandocInner).params ?? {})
    : {};
  return fieldsFromParams({ ...fromTemplate, ...fromPandoc });
}

/**
 * Return `line` with its transition rewritten from `next`, writing into the
 * squisq-native `{[…]}` annotation. Legacy Pandoc transition keys are removed
 * while preserving ids, classes, and other Pandoc params. Non-heading lines are
 * returned unchanged.
 */
export function setHeadingLineTransition(line: string, next: TransitionFields): string {
  const split = splitHeadingLine(line);
  if (!split) return line;
  const attrs: HeadingAttributes = split.pandocInner
    ? parsePandocAttrTokens(split.pandocInner)
    : {};
  removeFieldsFromAttrs(attrs);
  const pandoc = pandocBlockOrNull(attrs);

  const templateParts = templatePartsFromInner(
    split.templateText ? stripTemplateBraces(split.templateText) : null,
  );
  const templateParams = applyFieldsToParams(templateParts.params, next);
  const template = templateAnnotationOrNull(templateParts.template, templateParams);

  let out = split.prefix + split.text;
  if (pandoc) out += ` ${pandoc}`;
  if (template) out += ` ${template}`;
  return out;
}

/** Strip the outer `{[` … `]}` from a verbatim template annotation. */
function stripTemplateBraces(templateText: string): string {
  const m = templateText.match(/^\{\[([\s\S]*)\]\}[\s\]}]*$/);
  return m ? m[1] : templateText;
}

// ============================================
// data-block-attrs (WYSIWYG / Tiptap view)
// ============================================

/**
 * Read the transition fields from a heading node's `dataBlockAttrs` (legacy
 * Pandoc inner) plus `dataTemplateParams` (canonical `{[…]}` params). Pandoc
 * wins so the picker mirrors the value that `markdownToDoc` will render when
 * both channels are present.
 */
export function readBlockAttrsTransition(
  blockAttrsInner: string | null | undefined,
  templateParams: string | null | undefined,
): TransitionFields {
  const fromTemplate = templateParams ? paramsFromTokenString(templateParams, false) : {};
  const fromPandoc = blockAttrsInner ? (parsePandocAttrTokens(blockAttrsInner).params ?? {}) : {};
  return fieldsFromParams({ ...fromTemplate, ...fromPandoc });
}

export interface HeadingTransitionAttrs {
  /** Inner of the Pandoc `{…}` block, without braces. */
  blockAttrsInner: string | null;
  /** Param string inside the `{[…]}` annotation, without the template token. */
  templateParams: string | null;
}

/**
 * Rewrite a heading node's transition for Tiptap, writing the transition
 * family into `dataTemplateParams` and removing any legacy transition keys
 * from `dataBlockAttrs`.
 */
export function setHeadingAttrsTransition(
  blockAttrsInner: string | null | undefined,
  templateParams: string | null | undefined,
  next: TransitionFields,
): HeadingTransitionAttrs {
  const attrs: HeadingAttributes = blockAttrsInner ? parsePandocAttrTokens(blockAttrsInner) : {};
  removeFieldsFromAttrs(attrs);
  const pandoc = pandocBlockOrNull(attrs);

  const params = applyFieldsToParams(paramsFromTokenString(templateParams ?? '', false), next);
  return {
    blockAttrsInner: pandoc ? pandoc.slice(1, -1) : null,
    templateParams: paramsToInner(params),
  };
}

// ============================================
// shared
// ============================================

/**
 * Serialize `attrs` to a `{…}` block, or null when there's nothing to emit.
 * `serializePandocAttributes` returns the literal `{}` marker for an empty
 * attribute set; we treat that as "no block".
 */
function pandocBlockOrNull(attrs: HeadingAttributes): string | null {
  const raw = serializePandocAttributes(attrs);
  return raw == null || raw === '{}' ? null : raw;
}
