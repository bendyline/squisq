/**
 * Standalone-paragraph annotation parser.
 *
 * A paragraph whose entire trimmed text is exactly a `{[…]}` annotation
 * (nothing before or after) is a *standalone annotation*. Two features share
 * this shape:
 *
 * - **Media annotations** (`{[audio …]}` / `{[video …]}`) — lifted into typed
 *   {@link import('../schemas/Media.js').MediaClip}s by `mediaAnnotations.ts`.
 * - **Standalone template blocks** (`{[quote]}`, `{[statHighlight …]}`, …) —
 *   turned into heading-less {@link import('../schemas/Doc.js').Block}s by
 *   `annotationBlocks.ts`.
 *
 * Both call the single parser here so the annotation grammar (quoting,
 * escaping, first-token-is-template) stays identical to the heading form.
 */

import {
  matchTrailingTemplateAnnotation,
  tokenizeAttrTokens,
  splitKeyValueToken,
} from '../markdown/attrTokens.js';
import type { MarkdownBlockNode } from '../markdown/types.js';

/** The template name + params parsed out of a standalone `{[…]}` paragraph. */
export interface ParsedAnnotation {
  /** First bare token, when the annotation leads with one (e.g. `quote`). */
  template?: string;
  /** Remaining `key=value` tokens, unquoted/unescaped. */
  params: Record<string, string>;
}

/**
 * Parse a paragraph node that is *exactly* a `{[…]}` annotation (nothing
 * before or after). Returns the template + params, or null when the node
 * isn't a standalone annotation (not a paragraph, more than one child, a
 * non-text child such as a resolved inline icon, or trailing text).
 */
export function parseStandaloneAnnotation(node: MarkdownBlockNode): ParsedAnnotation | null {
  if (node.type !== 'paragraph') return null;
  const children = node.children ?? [];
  if (children.length !== 1 || children[0].type !== 'text') return null;
  const text = children[0].value.trim();
  const match = matchTrailingTemplateAnnotation(text);
  // index 0 means the whole (trimmed) paragraph is the annotation.
  if (!match || match.index !== 0) return null;

  const tokens = tokenizeAttrTokens(match.inner.trim());
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  const template = firstIsParam || tokens.length === 0 ? undefined : tokens[0];
  const startIdx = firstIsParam ? 0 : 1;
  const params: Record<string, string> = {};
  for (let i = startIdx; i < tokens.length; i++) {
    const kv = splitKeyValueToken(tokens[i]);
    if (kv) params[kv.key] = kv.value;
  }
  return { template, params };
}
