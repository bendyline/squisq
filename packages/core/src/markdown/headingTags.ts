/**
 * Edit the settings in one ATX heading line's tags.
 *
 * A heading carries its settings in a trailing `{[template key=value …]}`
 * tag, optionally after a Pandoc `{#id .class key=value}` block:
 *
 * ```markdown
 * ## Results {#results .wide} {[barChart slideLayout=cards]}
 * ```
 *
 * {@link setHeadingLineParams} sets or removes keys in the `{[…]}` tag,
 * keeping the template name and every other parameter in its order, and
 * removes the same keys from the Pandoc block — a value there would win over
 * the one written. Text, id and classes are left as they are.
 */

import {
  matchTrailingPandocAttr,
  matchTrailingTemplateAnnotation,
  quoteAttrValue,
  splitKeyValueToken,
  tokenizeAttrTokens,
} from './attrTokens.js';
import { parsePandocAttrTokens, serializePandocAttributes } from './convert.js';

const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const CLOSING_HASHES_RE = /[ \t]#+[ \t]*$/;

/**
 * The heading line with `updates` applied to its `{[…]}` tag (`null` removes
 * a key; a tag left empty is removed). Null when the line is not a
 * single-line ATX heading this can edit (a setext heading, or one closed with
 * trailing `#`s, which would hide the tag).
 */
export function setHeadingLineParams(
  line: string,
  updates: Readonly<Record<string, string | null>>,
): string | null {
  if (line.includes('\n') || !ATX_HEADING_RE.test(line)) return null;
  let rest = line.replace(/[ \t]+$/, '');
  if (CLOSING_HASHES_RE.test(rest) && !matchTrailingTemplateAnnotation(rest)) return null;

  let inner: string | null = null;
  const tag = matchTrailingTemplateAnnotation(rest);
  if (tag) {
    inner = tag.inner.trim();
    rest = rest.slice(0, tag.index).replace(/[ \t]+$/, '');
  }

  let pandoc: string | null = null;
  const attr = matchTrailingPandocAttr(rest);
  if (attr) {
    const attrs = parsePandocAttrTokens(attr.inner.trim());
    let changed = false;
    if (attrs.params) {
      for (const key of Object.keys(updates)) {
        if (key in attrs.params) {
          delete attrs.params[key];
          changed = true;
        }
      }
      if (Object.keys(attrs.params).length === 0) delete attrs.params;
    }
    if (changed) {
      const serialized = serializePandocAttributes(attrs);
      pandoc = serialized && serialized !== '{}' ? serialized : null;
    } else {
      pandoc = rest.slice(attr.index).trim();
    }
    rest = rest.slice(0, attr.index).replace(/[ \t]+$/, '');
  }

  const tokens = inner ? tokenizeAttrTokens(inner) : [];
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  const template = firstIsParam || tokens.length === 0 ? undefined : tokens[0];
  const params = new Map<string, string>();
  for (let i = template ? 1 : 0; i < tokens.length; i++) {
    const kv = splitKeyValueToken(tokens[i]);
    if (kv) params.set(kv.key, kv.value);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const parts = template ? [template] : [];
  for (const [key, value] of params) parts.push(`${key}=${quoteAttrValue(value)}`);

  const pieces = [rest];
  if (pandoc) pieces.push(pandoc);
  if (parts.length) pieces.push(`{[${parts.join(' ')}]}`);
  return pieces.join(' ');
}
