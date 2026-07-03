/**
 * headingTransition
 *
 * Read and write a block's transition (`transition` / `transitionDirection` /
 * `transitionDuration`) on a heading, in both editing surfaces:
 *
 * - Markdown (Monaco): operate on the raw heading line string.
 * - WYSIWYG (Tiptap): operate on the heading node's `dataBlockAttrs` string
 *   (the inner of the Pandoc `{…}` block, no braces — matching how
 *   `tiptapBridge` stores and re-emits it).
 *
 * Transitions are stored in the Pandoc `{#id .class key=value}` attribute
 * block, NOT the `{[template …]}` annotation. That mirrors the canonical
 * serializer (`core/doc/docToMarkdown.ts` → `ensureTransitionAttributes`,
 * which always emits the `{…}` form) and `diagram/diagramCommands.ts`, so a
 * value set here round-trips through a Doc render without being duplicated
 * or moved. Reads still look at the `{[…]}` params too, so a hand-typed
 * `{[title transition=fade]}` shows up in the picker.
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
 * `{…}` block (canonical) and the `{[…]}` template params (hand-typed),
 * with the Pandoc block taking precedence. Returns the empty transition for
 * non-heading lines.
 */
export function readHeadingLineTransition(line: string): TransitionFields {
  const split = splitHeadingLine(line);
  if (!split) return { ...EMPTY_TRANSITION };
  const fromTemplate = split.templateText
    ? paramsFromTokenString(stripTemplateBraces(split.templateText), true)
    : {};
  const fromPandoc = split.pandocInner
    ? (parsePandocAttrTokens(split.pandocInner).params ?? {})
    : {};
  return fieldsFromParams({ ...fromTemplate, ...fromPandoc });
}

/**
 * Return `line` with its transition rewritten from `next`, writing into the
 * Pandoc `{…}` block and leaving the `{[…]}` template annotation untouched.
 * Non-heading lines are returned unchanged.
 */
export function setHeadingLineTransition(line: string, next: TransitionFields): string {
  const split = splitHeadingLine(line);
  if (!split) return line;
  const attrs: HeadingAttributes = split.pandocInner
    ? parsePandocAttrTokens(split.pandocInner)
    : {};
  attrs.params = applyFieldsToParams(attrs.params ?? {}, next);
  const pandoc = pandocBlockOrNull(attrs);

  let out = split.prefix + split.text;
  if (pandoc) out += ` ${pandoc}`;
  if (split.templateText) out += ` ${split.templateText}`;
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
 * Read the transition fields from a heading node's `dataBlockAttrs` (Pandoc
 * inner) plus `dataTemplateParams` (the `{[…]}` params). Pandoc wins.
 */
export function readBlockAttrsTransition(
  blockAttrsInner: string | null | undefined,
  templateParams: string | null | undefined,
): TransitionFields {
  const fromTemplate = templateParams ? paramsFromTokenString(templateParams, false) : {};
  const fromPandoc = blockAttrsInner ? (parsePandocAttrTokens(blockAttrsInner).params ?? {}) : {};
  return fieldsFromParams({ ...fromTemplate, ...fromPandoc });
}

/**
 * Rewrite the transition in a heading node's `dataBlockAttrs` inner string.
 * Returns the new inner (no braces), or null when the block carries no
 * attributes at all — matching how `tiptapBridge` stores `dataBlockAttrs`
 * (absent attribute → null, not `{}`).
 */
export function setBlockAttrsTransition(
  blockAttrsInner: string | null | undefined,
  next: TransitionFields,
): string | null {
  const attrs: HeadingAttributes = blockAttrsInner ? parsePandocAttrTokens(blockAttrsInner) : {};
  attrs.params = applyFieldsToParams(attrs.params ?? {}, next);
  const pandoc = pandocBlockOrNull(attrs);
  return pandoc ? pandoc.slice(1, -1) : null;
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
