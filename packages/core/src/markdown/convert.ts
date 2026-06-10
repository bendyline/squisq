/**
 * mdast ↔ Squisq Markdown Node Conversion
 *
 * Converts between the remark/mdast AST format and the squisq
 * MarkdownDocument JSON format. This is the bridge layer that allows
 * us to use the battle-tested unified/remark ecosystem for parsing
 * and serialization while exposing our own clean, well-typed interfaces.
 *
 * The conversion is designed for perfect round-tripping:
 * toMdast(fromMdast(tree)) should produce an equivalent mdast tree.
 */

import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownListItem,
  MarkdownTableRow,
  MarkdownTableCell,
  MarkdownSourcePosition,
  HeadingTemplateAnnotation,
  HeadingAttributes,
  MarkdownHeading,
  MarkdownInlineIcon,
} from './types.js';
import { parseHtmlToNodes } from './htmlParse.js';
import { resolveIcon } from '../icons/resolve.js';
import { coerceAnnotationValues } from './annotationCoercion.js';
import {
  matchTrailingTemplateAnnotation,
  matchTrailingPandocAttr,
  tokenizeAttrTokens,
  splitKeyValueToken,
  quoteAttrValue,
} from './attrTokens.js';

// ============================================
// Generic mdast node shape
// ============================================

/**
 * Minimal interface for mdast/unist nodes.
 * Using a generic shape avoids hard dependency on @types/mdast
 * and handles extension nodes (GFM, math, directive) uniformly.
 */
interface MdastPosition {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

interface MdastNode {
  type: string;
  position?: MdastPosition;
  children?: MdastNode[];
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  url?: string;
  title?: string | null;
  alt?: string;
  identifier?: string;
  label?: string;
  referenceType?: string;
  align?: (string | null)[];
  name?: string;
  attributes?: Record<string, string>;
  data?: Record<string, unknown>;
}

// ============================================
// Position conversion
// ============================================

function convertPosition(pos?: MdastPosition): MarkdownSourcePosition | undefined {
  if (!pos) return undefined;
  return {
    start: {
      line: pos.start.line,
      column: pos.start.column,
      ...(pos.start.offset != null ? { offset: pos.start.offset } : {}),
    },
    end: {
      line: pos.end.line,
      column: pos.end.column,
      ...(pos.end.offset != null ? { offset: pos.end.offset } : {}),
    },
  };
}

function toMdastPosition(pos: MarkdownSourcePosition): MdastPosition {
  return {
    start: {
      line: pos.start.line,
      column: pos.start.column,
      ...(pos.start.offset != null ? { offset: pos.start.offset } : {}),
    },
    end: {
      line: pos.end.line,
      column: pos.end.column,
      ...(pos.end.offset != null ? { offset: pos.end.offset } : {}),
    },
  };
}

/** Conditionally include position in node. */
function posField(
  pos?: MarkdownSourcePosition,
): { position: MarkdownSourcePosition } | Record<string, never> {
  return pos ? { position: pos } : {};
}

function mdastPosField(
  pos?: MarkdownSourcePosition,
): { position: MdastPosition } | Record<string, never> {
  return pos ? { position: toMdastPosition(pos) } : {};
}

// ============================================
// mdast → Squisq (fromMdast)
// ============================================

/**
 * Extract plain text content from an mdast node tree.
 * Used for directive labels.
 */
function extractText(node: MdastNode): string {
  if (node.value != null) return node.value;
  if (node.children) {
    return node.children.map(extractText).join('');
  }
  return '';
}

// ============================================
// Template annotation helpers
// ============================================

/**
 * Extract a `{[templateName key=value …]}` annotation from a heading's
 * inline children. Mutates the children array in-place: strips the
 * annotation text from the last text node (or removes the node entirely).
 *
 * Matching is delegated to {@link matchTrailingTemplateAnnotation}: a
 * quote-aware grammar (values may contain `]` when quoted) with a legacy
 * fallback, plus tolerance for an accidental doubled trailing `]}`. A
 * non-trailing annotation like `## The {[chart]} section` doesn't match.
 *
 * @returns The parsed annotation, or null if none found.
 */
function extractTemplateAnnotation(
  children: MarkdownInlineNode[],
): HeadingTemplateAnnotation | null {
  // Walk backwards to find the last text node
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.type === 'text') {
      const match = matchTrailingTemplateAnnotation(child.value);
      if (match) {
        const inner = match.inner.trim();
        const annotation = parseAnnotationTokens(inner);

        // Strip the matched portion from the text
        const stripped = child.value.slice(0, match.index).replace(/\s+$/, '');
        if (stripped) {
          (child as { value: string }).value = stripped;
        } else {
          // Remove the now-empty text node
          children.splice(i, 1);
        }
        return annotation;
      }
      // Only check the last text node (trailing position)
      break;
    }
    // If the last child isn't a text node, there's no annotation
    break;
  }
  return null;
}

/**
 * Parse the inner content of a `{[…]}` annotation into template + params.
 *
 * Input: `"chart colorScheme=blue caption=\"Sales by region\""`
 * Output: `{ template: 'chart', params: { colorScheme: 'blue', caption: 'Sales by region' } }`
 *
 * Tokenization is shared with the Pandoc attribute parser
 * ({@link tokenizeAttrTokens}), so quoting and escaping behave
 * identically in both annotation forms.
 */
function parseAnnotationTokens(inner: string): HeadingTemplateAnnotation {
  const tokens = tokenizeAttrTokens(inner);
  const params: Record<string, string> = {};

  // If the first token contains '=', there's no template name —
  // the annotation is purely key-value (e.g., `{[audio=intro.mp3]}`).
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  const template = firstIsParam || tokens.length === 0 ? undefined : tokens[0];
  const startIdx = firstIsParam ? 0 : 1;

  for (let i = startIdx; i < tokens.length; i++) {
    const kv = splitKeyValueToken(tokens[i]);
    if (kv) {
      params[kv.key] = kv.value;
    }
  }

  const result: HeadingTemplateAnnotation = {};
  if (template) {
    result.template = template;
  }
  if (Object.keys(params).length > 0) {
    result.params = params;
  }
  return result;
}

// ============================================
// Pandoc-style heading attribute helpers
// ============================================

/**
 * Extract a trailing Pandoc-style `{…}` attribute block from a heading's
 * inline children. Matching is delegated to {@link matchTrailingPandocAttr}
 * (quote-aware — values may contain `}` when quoted — with a legacy
 * fallback; a `(?!\[)` lookahead keeps it from colliding with the
 * squisq-native `{[…]}` template annotation).
 *
 * Unlike `extractTemplateAnnotation()`, this walks backward through both
 * text nodes AND bare `textDirective` nodes. remark-directive may have
 * fragmented a `{key=val:type,…}` attribute block at colon-prefixed
 * segments like `:type` that look like text directives but are really
 * attribute-value fragments. We virtually re-stitch the trailing run as a
 * single string, match against it, and only physically modify the children
 * array if a match is found — so a heading that legitimately contains a
 * non-bare `:directive` is left alone.
 *
 * Returns the parsed `HeadingAttributes`, or null if no match.
 */
function extractPandocAttributes(children: MarkdownInlineNode[]): HeadingAttributes | null {
  // Collect the trailing run of [text | bare textDirective] children.
  const trail: { val: string; idx: number; len: number }[] = [];
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i];
    if (c.type === 'text') {
      trail.unshift({ val: c.value, idx: i, len: c.value.length });
    } else if (c.type === 'textDirective') {
      const td = c as {
        name?: string;
        children?: unknown[];
        attributes?: Record<string, string>;
      };
      const isBare =
        (!td.children || td.children.length === 0) &&
        (!td.attributes || Object.keys(td.attributes).length === 0);
      if (!isBare) break;
      const synthesized = ':' + (td.name ?? '');
      trail.unshift({ val: synthesized, idx: i, len: synthesized.length });
    } else {
      break;
    }
  }
  if (trail.length === 0) return null;

  const joined = trail.map((t) => t.val).join('');
  const match = matchTrailingPandocAttr(joined);
  if (!match) return null;

  const inner = match.inner.trim();
  const attrs = parsePandocAttrTokens(inner);

  // Strip the matched portion. `match.index` is an offset into `joined`.
  // Walk forward through `trail` until we find the child that straddles
  // the match boundary; trim that child (if text) or drop it (if directive),
  // and remove everything after it from `children`.
  const matchStart = match.index;
  let scannedLen = 0;
  for (let ti = 0; ti < trail.length; ti++) {
    const t = trail[ti];
    if (scannedLen + t.len <= matchStart) {
      scannedLen += t.len;
      continue;
    }
    const firstNode = children[t.idx];
    const keepLen = matchStart - scannedLen;
    if (firstNode.type === 'text') {
      const trimmed = firstNode.value.slice(0, keepLen).replace(/\s+$/, '');
      if (trimmed) {
        (firstNode as { value: string }).value = trimmed;
        children.splice(t.idx + 1);
      } else {
        children.splice(t.idx);
      }
    } else {
      // Match boundary fell inside a textDirective's synthesized ":name"
      // string — drop the directive and everything after.
      children.splice(t.idx);
    }
    return attrs;
  }
  // Match consumes the entire trail.
  children.splice(trail[0].idx);
  return attrs;
}

/**
 * Parse the inner content of a Pandoc-style `{…}` block. Tokens are
 * whitespace-separated, with quoted runs (single or double) treated as
 * single tokens — tokenization is shared with the `{[…]}` template
 * annotation parser via {@link tokenizeAttrTokens}.
 *
 * - `#id` → `attributes.id`
 * - `.class` → push onto `attributes.classes`
 * - `key=value` or `key="quoted value"` → `attributes.params[key] = value`
 *
 * Empty `{}` yields `{}` (preserved as an annotation marker for round-tripping).
 * Duplicate ids and keys: last wins, silent.
 */
export function parsePandocAttrTokens(inner: string): HeadingAttributes {
  const tokens = tokenizeAttrTokens(inner);
  const attrs: HeadingAttributes = {};
  const params: Record<string, string> = {};
  const classes: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('#') && !token.includes('=')) {
      attrs.id = token.slice(1);
    } else if (token.startsWith('.') && !token.includes('=')) {
      const cls = token.slice(1);
      if (cls) classes.push(cls);
    } else {
      const kv = splitKeyValueToken(token);
      if (kv) {
        params[kv.key] = kv.value;
      }
    }
  }

  if (classes.length > 0) attrs.classes = classes;
  if (Object.keys(params).length > 0) {
    attrs.params = params;
    const { blockMeta, metadata } = coerceAnnotationValues(params);
    if (Object.keys(blockMeta).length > 0) attrs.blockMeta = blockMeta;
    if (Object.keys(metadata).length > 0) attrs.metadata = metadata;
  }
  return attrs;
}

/**
 * Serialize a HeadingAttributes object back to a Pandoc `{#id .class key=value}` string.
 * Returns null when the attributes object is entirely empty (nothing to emit).
 *
 * Canonical key order: `#id`, then `.classes` (in original order), then
 * params in their original insertion order. Values are quoted via the
 * shared {@link quoteAttrValue} rule (same as `{[…]}` serialization).
 */
export function serializePandocAttributes(attrs: HeadingAttributes): string | null {
  const parts: string[] = [];
  if (attrs.id) parts.push(`#${attrs.id}`);
  if (attrs.classes) {
    for (const cls of attrs.classes) parts.push(`.${cls}`);
  }
  if (attrs.params) {
    for (const [key, value] of Object.entries(attrs.params)) {
      parts.push(`${key}=${quoteAttrValue(value)}`);
    }
  }
  // Preserve an empty `{}` annotation marker if it was authored deliberately
  // (e.g., reserved for downstream tooling). Caller decides whether to emit.
  if (parts.length === 0) return '{}';
  return `{${parts.join(' ')}}`;
}

/**
 * Serialize a HeadingTemplateAnnotation back to `{[templateName key=value …]}` text.
 * Values are quoted via the shared {@link quoteAttrValue} rule (same as
 * Pandoc attribute serialization).
 */
function serializeTemplateAnnotation(annotation: HeadingTemplateAnnotation): string {
  const parts: string[] = [];
  if (annotation.template) {
    parts.push(annotation.template);
  }
  if (annotation.params) {
    for (const [key, value] of Object.entries(annotation.params)) {
      parts.push(`${key}=${quoteAttrValue(value)}`);
    }
  }
  return `{[${parts.join(' ')}]}`;
}

/**
 * Convert an mdast Root node to a MarkdownDocument.
 *
 * @param root - The mdast root node (from remark-parse)
 * @param options - Conversion options
 * @returns A MarkdownDocument
 */
export function fromMdast(root: MdastNode, options?: { parseHtml?: boolean }): MarkdownDocument {
  const doParseHtml = options?.parseHtml !== false;
  return {
    type: 'document',
    children: convertBlockChildren(root.children ?? [], doParseHtml),
    ...posField(convertPosition(root.position)),
  };
}

function convertBlockChildren(children: MdastNode[], parseHtml: boolean): MarkdownBlockNode[] {
  const result: MarkdownBlockNode[] = [];
  for (const child of children) {
    const node = convertBlockNode(child, parseHtml);
    if (node) result.push(node);
  }
  return result;
}

function convertInlineChildren(
  children: MdastNode[],
  parseHtml: boolean,
  /** When false, skip the inline-icon split. Headings opt out so the
   *  `extractTemplateAnnotation` pass still sees the trailing
   *  `{[…]}` in raw text form; the caller runs `splitInlineIcons`
   *  itself afterward on the remaining children. */
  applyIconSplit: boolean = true,
): MarkdownInlineNode[] {
  const result: MarkdownInlineNode[] = [];
  for (const child of children) {
    const node = convertInlineNode(child, parseHtml);
    if (node) result.push(node);
  }
  const mentioned = coalesceMentions(result);
  return applyIconSplit ? splitInlineIcons(mentioned) : mentioned;
}

/**
 * Walk an inline-children list and split each text node on `{[token]}`
 * occurrences whose tokens resolve to known FontAwesome icons. Returns
 * a new array — unresolved tokens are left as literal text so authors
 * can write `{[notathing]}` verbatim if they really mean to.
 *
 * Exposed for the heading code path, which first strips the trailing
 * template annotation and then runs this on what remains.
 */
export function splitInlineIcons(nodes: MarkdownInlineNode[]): MarkdownInlineNode[] {
  // First pass: reassemble `text + textDirective + text` patterns
  // formed when a qualified token like `{[fa-solid:user]}` was split
  // by remark-directive's colon recognition. We collapse those triples
  // back into a single text node containing the original token so the
  // regex below can match.
  const recombined = recombineDirectiveTokens(nodes);

  const out: MarkdownInlineNode[] = [];
  for (const node of recombined) {
    if (node.type !== 'text') {
      out.push(node);
      continue;
    }
    out.push(...splitTextOnIcons(node.value, node.position));
  }
  return out;
}

/**
 * When the user types `{[fa-solid:user]}`, remark's directive plugin
 * sees `:user` and emits a `textDirective` node. The result is a
 * three-node sequence `text("…{[fa-solid") + textDirective("user") +
 * text("]}…")`. This helper detects that shape and stitches the three
 * back into one text node so downstream icon detection works on the
 * authored token.
 */
function recombineDirectiveTokens(nodes: MarkdownInlineNode[]): MarkdownInlineNode[] {
  const out: MarkdownInlineNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i];
    const next = nodes[i + 1];
    const after = nodes[i + 2];
    if (
      cur?.type === 'text' &&
      next?.type === 'textDirective' &&
      after?.type === 'text' &&
      /\{\[[a-zA-Z0-9_-]+$/.test(cur.value) &&
      /^\]\}/.test(after.value)
    ) {
      const directive = next as unknown as { name?: string };
      const directiveName = directive.name ?? '';
      const merged: MarkdownInlineNode = {
        type: 'text',
        value: cur.value + ':' + directiveName + after.value,
        ...(cur.position ? { position: cur.position } : {}),
      };
      out.push(merged);
      i += 2;
      continue;
    }
    out.push(cur);
  }
  return out;
}

const ICON_TOKEN_RE = /\{\[([a-zA-Z0-9_:-]+)\]\}/g;

function splitTextOnIcons(value: string, position?: MarkdownSourcePosition): MarkdownInlineNode[] {
  if (!value) return [];
  ICON_TOKEN_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const out: MarkdownInlineNode[] = [];
  while ((match = ICON_TOKEN_RE.exec(value)) !== null) {
    const token = match[1];
    const icon = resolveIcon(token);
    if (!icon) continue; // leave the literal `{[…]}` in place
    if (match.index > lastIndex) {
      out.push({
        type: 'text',
        value: value.slice(lastIndex, match.index),
        ...(position ? { position } : {}),
      });
    }
    const iconNode: MarkdownInlineIcon = {
      type: 'inlineIcon',
      token,
      family: icon.family,
      name: icon.name,
      ...(position ? { position } : {}),
    };
    out.push(iconNode);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex === 0) {
    // No matches — return the original text node unchanged.
    return [{ type: 'text', value, ...(position ? { position } : {}) }];
  }
  if (lastIndex < value.length) {
    out.push({
      type: 'text',
      value: value.slice(lastIndex),
      ...(position ? { position } : {}),
    });
  }
  return out;
}

/**
 * Post-process an inline-children list to collapse `text('@') + link(scheme:id)`
 * pairs into a single `mention` node. The wire format `@[Display](scheme:id)`
 * comes back from remark as two adjacent nodes — we merge them so consumers
 * see a single atomic mention. A plain link whose URL doesn't have `scheme:id`
 * shape, or that isn't immediately preceded by `@`, is left alone so ordinary
 * links keep working.
 */
function coalesceMentions(inlines: MarkdownInlineNode[]): MarkdownInlineNode[] {
  const out: MarkdownInlineNode[] = [];
  for (const cur of inlines) {
    const prev = out[out.length - 1];
    if (
      cur.type === 'link' &&
      typeof cur.url === 'string' &&
      prev &&
      prev.type === 'text' &&
      prev.value.endsWith('@')
    ) {
      const schemeMatch = cur.url.match(/^([a-z][a-z0-9+.-]*):(.+)$/i);
      if (schemeMatch && schemeMatch[1] && schemeMatch[2]) {
        const targetKind = schemeMatch[1];
        const targetId = schemeMatch[2];
        const displayName = extractInlineText(cur.children);
        if (prev.value === '@') {
          out.pop();
        } else {
          prev.value = prev.value.slice(0, -1);
        }
        out.push({
          type: 'mention',
          targetKind,
          targetId,
          displayName,
          ...(cur.position ? { position: cur.position } : {}),
        });
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Plain-text of an inline children list — used to pull the display name
 * out of a mention link's children. */
function extractInlineText(nodes: MarkdownInlineNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text' || n.type === 'inlineCode') out += n.value;
    else if ('children' in n && Array.isArray(n.children)) {
      out += extractInlineText(n.children as MarkdownInlineNode[]);
    }
  }
  return out;
}

function convertBlockNode(node: MdastNode, parseHtml: boolean): MarkdownBlockNode | null {
  const pos = convertPosition(node.position);

  switch (node.type) {
    case 'heading': {
      // Defer icon splitting so `extractTemplateAnnotation` sees the
      // trailing `{[name]}` as plain text and can decide whether it's
      // a template annotation. Anything that's NOT the template still
      // needs to become an icon node, so we run `splitInlineIcons` on
      // what's left after the template extraction.
      //
      // Both annotation forms ({[…]} and Pandoc {#…}) may appear at the
      // end of the heading in either order. Extract them in a loop so
      // we catch the second-from-last one too. A small bounded retry
      // (max 4) is plenty — authors don't stack more than two trailing
      // brace-blocks in practice.
      const headingChildren = convertInlineChildren(node.children ?? [], parseHtml, false);
      let annotation: HeadingTemplateAnnotation | null = null;
      let attrs: HeadingAttributes | null = null;
      for (let pass = 0; pass < 4; pass++) {
        let matched = false;
        if (!annotation) {
          const t = extractTemplateAnnotation(headingChildren);
          if (t) {
            annotation = t;
            matched = true;
          }
        }
        if (!attrs) {
          const a = extractPandocAttributes(headingChildren);
          if (a) {
            attrs = a;
            matched = true;
          }
        }
        if (!matched) break;
      }
      const finalChildren = splitInlineIcons(headingChildren);
      const result: MarkdownHeading = {
        type: 'heading',
        depth: (node.depth ?? 1) as 1 | 2 | 3 | 4 | 5 | 6,
        children: finalChildren,
        ...posField(pos),
      };
      if (annotation) {
        result.templateAnnotation = annotation;
      }
      if (attrs) {
        result.attributes = attrs;
      }
      return result;
    }

    case 'paragraph':
      return {
        type: 'paragraph',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'blockquote':
      return {
        type: 'blockquote',
        children: convertBlockChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'list':
      return {
        type: 'list',
        ordered: node.ordered ?? false,
        ...(node.start != null ? { start: node.start } : {}),
        ...(node.spread != null ? { spread: node.spread } : {}),
        children: (node.children ?? []).map((item) => convertListItem(item, parseHtml)),
        ...posField(pos),
      };

    case 'code':
      return {
        type: 'code',
        ...(node.lang != null ? { lang: node.lang } : {}),
        ...(node.meta != null ? { meta: node.meta } : {}),
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'thematicBreak':
      return {
        type: 'thematicBreak',
        ...posField(pos),
      };

    case 'table':
      return {
        type: 'table',
        ...(node.align
          ? { align: node.align.map((a) => a as 'left' | 'right' | 'center' | null) }
          : {}),
        children: (node.children ?? []).map((row, i) => convertTableRow(row, i === 0, parseHtml)),
        ...posField(pos),
      };

    case 'html':
      return {
        type: 'htmlBlock',
        rawHtml: node.value ?? '',
        htmlChildren: parseHtml ? parseHtmlToNodes(node.value ?? '') : [],
        ...posField(pos),
      };

    case 'math':
      return {
        type: 'math',
        value: node.value ?? '',
        ...(node.meta != null ? { meta: node.meta } : {}),
        ...posField(pos),
      };

    case 'definition':
      return {
        type: 'definition',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        url: node.url ?? '',
        ...(node.title != null ? { title: node.title } : {}),
        ...posField(pos),
      };

    case 'footnoteDefinition':
      return {
        type: 'footnoteDefinition',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        children: convertBlockChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'containerDirective': {
      const allChildren = node.children ?? [];
      let label: string | undefined;
      let contentChildren = allChildren;

      // Extract directive label (first paragraph with directiveLabel flag)
      if (
        allChildren.length > 0 &&
        allChildren[0].type === 'paragraph' &&
        allChildren[0].data?.directiveLabel === true
      ) {
        label = extractText(allChildren[0]);
        contentChildren = allChildren.slice(1);
      }

      return {
        type: 'containerDirective',
        name: node.name ?? '',
        ...(label ? { label } : {}),
        ...(node.attributes && Object.keys(node.attributes).length > 0
          ? { attributes: node.attributes }
          : {}),
        children: convertBlockChildren(contentChildren, parseHtml),
        ...posField(pos),
      };
    }

    case 'leafDirective':
      return {
        type: 'leafDirective',
        name: node.name ?? '',
        ...(node.attributes && Object.keys(node.attributes).length > 0
          ? { attributes: node.attributes }
          : {}),
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'yaml':
      // YAML frontmatter nodes are handled separately in parse.ts — skip silently
      return null;

    default:
      // Unknown block node — skip with a warning
      if (typeof console !== 'undefined') {
        console.warn(`[squisq/markdown] Unknown mdast block node type: "${node.type}"`);
      }
      return null;
  }
}

function convertListItem(node: MdastNode, parseHtml: boolean): MarkdownListItem {
  const pos = convertPosition(node.position);
  return {
    type: 'listItem',
    ...(node.checked != null ? { checked: node.checked } : {}),
    ...(node.spread != null ? { spread: node.spread } : {}),
    children: convertBlockChildren(node.children ?? [], parseHtml),
    ...posField(pos),
  };
}

function convertTableRow(node: MdastNode, isHeader: boolean, parseHtml: boolean): MarkdownTableRow {
  const pos = convertPosition(node.position);
  return {
    type: 'tableRow',
    children: (node.children ?? []).map((cell) => convertTableCell(cell, isHeader, parseHtml)),
    ...posField(pos),
  };
}

function convertTableCell(
  node: MdastNode,
  isHeader: boolean,
  parseHtml: boolean,
): MarkdownTableCell {
  const pos = convertPosition(node.position);
  return {
    type: 'tableCell',
    ...(isHeader ? { isHeader: true } : {}),
    children: convertInlineChildren(node.children ?? [], parseHtml),
    ...posField(pos),
  };
}

function convertInlineNode(node: MdastNode, parseHtml: boolean): MarkdownInlineNode | null {
  const pos = convertPosition(node.position);

  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'emphasis':
      return {
        type: 'emphasis',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'strong':
      return {
        type: 'strong',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'delete':
      return {
        type: 'delete',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'inlineCode':
      return {
        type: 'inlineCode',
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'link':
      return {
        type: 'link',
        url: node.url ?? '',
        ...(node.title != null ? { title: node.title } : {}),
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'image':
      return {
        type: 'image',
        url: node.url ?? '',
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...(node.title != null ? { title: node.title } : {}),
        ...posField(pos),
      };

    case 'break':
      return {
        type: 'break',
        ...posField(pos),
      };

    case 'html':
      return {
        type: 'htmlInline',
        rawHtml: node.value ?? '',
        htmlChildren: parseHtml ? parseHtmlToNodes(node.value ?? '') : [],
        ...posField(pos),
      };

    case 'inlineMath':
      return {
        type: 'inlineMath',
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'footnoteReference':
      return {
        type: 'footnoteReference',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        ...posField(pos),
      };

    case 'linkReference':
      return {
        type: 'linkReference',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: (node.referenceType ?? 'full') as 'full' | 'collapsed' | 'shortcut',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'imageReference':
      return {
        type: 'imageReference',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: (node.referenceType ?? 'full') as 'full' | 'collapsed' | 'shortcut',
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...posField(pos),
      };

    case 'textDirective':
      return {
        type: 'textDirective',
        name: node.name ?? '',
        ...(node.attributes && Object.keys(node.attributes).length > 0
          ? { attributes: node.attributes }
          : {}),
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    default:
      if (typeof console !== 'undefined') {
        console.warn(`[squisq/markdown] Unknown mdast inline node type: "${node.type}"`);
      }
      return null;
  }
}

// ============================================
// Squisq → mdast (toMdast)
// ============================================

/**
 * Convert a MarkdownDocument back to an mdast Root node.
 *
 * @param doc - A MarkdownDocument
 * @returns An mdast Root node suitable for remark-stringify
 */
export function toMdast(doc: MarkdownDocument): MdastNode {
  return {
    type: 'root',
    children: doc.children.map((n) => blockToMdast(n)),
    ...mdastPosField(doc.position),
  };
}

function blockToMdast(node: MarkdownBlockNode): MdastNode {
  switch (node.type) {
    case 'heading': {
      const mdastChildren = inlineChildrenToMdast(node.children);
      // Canonical trailing order: Pandoc attrs first, then template annotation.
      // Author-supplied order is not preserved across round-trips by design —
      // canonicalization gives stable diffs.
      const suffixes: string[] = [];
      if (node.attributes) {
        const pandoc = serializePandocAttributes(node.attributes);
        if (pandoc != null) suffixes.push(pandoc);
      }
      if (node.templateAnnotation) {
        suffixes.push(serializeTemplateAnnotation(node.templateAnnotation));
      }
      if (suffixes.length > 0) {
        const suffix = suffixes.join(' ');
        const lastChild = mdastChildren[mdastChildren.length - 1];
        if (lastChild && lastChild.type === 'text') {
          lastChild.value = (lastChild.value ?? '') + ' ' + suffix;
        } else {
          mdastChildren.push({ type: 'text', value: ' ' + suffix });
        }
      }
      return {
        type: 'heading',
        depth: node.depth,
        children: mdastChildren,
        ...mdastPosField(node.position),
      };
    }

    case 'paragraph':
      return {
        type: 'paragraph',
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'blockquote':
      return {
        type: 'blockquote',
        children: node.children.map(blockToMdast),
        ...mdastPosField(node.position),
      };

    case 'list':
      return {
        type: 'list',
        ordered: node.ordered,
        ...(node.start != null ? { start: node.start } : {}),
        ...(node.spread != null ? { spread: node.spread } : {}),
        children: node.children.map(listItemToMdast),
        ...mdastPosField(node.position),
      };

    case 'code':
      return {
        type: 'code',
        ...(node.lang != null ? { lang: node.lang } : {}),
        ...(node.meta != null ? { meta: node.meta } : {}),
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'thematicBreak':
      return {
        type: 'thematicBreak',
        ...mdastPosField(node.position),
      };

    case 'table':
      return {
        type: 'table',
        ...(node.align ? { align: node.align } : {}),
        children: node.children.map(tableRowToMdast),
        ...mdastPosField(node.position),
      };

    case 'htmlBlock':
      return {
        type: 'html',
        value: node.rawHtml,
        ...mdastPosField(node.position),
      };

    case 'math':
      return {
        type: 'math',
        value: node.value,
        ...(node.meta != null ? { meta: node.meta } : {}),
        ...mdastPosField(node.position),
      };

    case 'definition':
      return {
        type: 'definition',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        url: node.url,
        ...(node.title != null ? { title: node.title } : {}),
        ...mdastPosField(node.position),
      };

    case 'footnoteDefinition':
      return {
        type: 'footnoteDefinition',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        children: node.children.map(blockToMdast),
        ...mdastPosField(node.position),
      };

    case 'containerDirective': {
      const children: MdastNode[] = [];

      // Reinject label as first paragraph with directiveLabel flag
      if (node.label) {
        children.push({
          type: 'paragraph',
          data: { directiveLabel: true },
          children: [{ type: 'text', value: node.label }],
        });
      }

      children.push(...node.children.map(blockToMdast));

      return {
        type: 'containerDirective',
        name: node.name,
        ...(node.attributes ? { attributes: node.attributes } : {}),
        children,
        ...mdastPosField(node.position),
      };
    }

    case 'leafDirective':
      return {
        type: 'leafDirective',
        name: node.name,
        ...(node.attributes ? { attributes: node.attributes } : {}),
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'definitionList':
      // Definition lists don't map to standard mdast.
      // Convert to HTML as fallback.
      return {
        type: 'html',
        value: definitionListToHtml(node),
        ...mdastPosField(node.position),
      };

    default:
      return { type: 'html', value: '' };
  }
}

function listItemToMdast(item: MarkdownListItem): MdastNode {
  return {
    type: 'listItem',
    ...(item.checked != null ? { checked: item.checked } : {}),
    ...(item.spread != null ? { spread: item.spread } : {}),
    children: item.children.map(blockToMdast),
    ...mdastPosField(item.position),
  };
}

function tableRowToMdast(row: MarkdownTableRow): MdastNode {
  return {
    type: 'tableRow',
    children: row.children.map(tableCellToMdast),
    ...mdastPosField(row.position),
  };
}

function tableCellToMdast(cell: MarkdownTableCell): MdastNode {
  return {
    type: 'tableCell',
    children: inlineChildrenToMdast(cell.children),
    ...mdastPosField(cell.position),
  };
}

/**
 * Serialize an array of inline nodes to mdast, flat-mapping the result so
 * a single `mention` expands to two mdast nodes (`text('@')` + `link`).
 * Use in place of `.map(inlineToMdast)` wherever we walk a children array.
 */
function inlineChildrenToMdast(nodes: MarkdownInlineNode[]): MdastNode[] {
  const out: MdastNode[] = [];
  for (const n of nodes) {
    if (n.type === 'mention') {
      out.push({ type: 'text', value: '@' });
      out.push({
        type: 'link',
        url: `${n.targetKind}:${n.targetId}`,
        children: [{ type: 'text', value: n.displayName }],
        ...mdastPosField(n.position),
      });
    } else {
      out.push(inlineToMdast(n));
    }
  }
  return out;
}

function inlineToMdast(node: MarkdownInlineNode): MdastNode {
  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'emphasis':
      return {
        type: 'emphasis',
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'strong':
      return {
        type: 'strong',
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'delete':
      return {
        type: 'delete',
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'inlineCode':
      return {
        type: 'inlineCode',
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'link':
      return {
        type: 'link',
        url: node.url,
        ...(node.title != null ? { title: node.title } : {}),
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'image':
      return {
        type: 'image',
        url: node.url,
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...(node.title != null ? { title: node.title } : {}),
        ...mdastPosField(node.position),
      };

    case 'break':
      return {
        type: 'break',
        ...mdastPosField(node.position),
      };

    case 'htmlInline':
      return {
        type: 'html',
        value: node.rawHtml,
        ...mdastPosField(node.position),
      };

    case 'inlineMath':
      return {
        type: 'inlineMath',
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'footnoteReference':
      return {
        type: 'footnoteReference',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        ...mdastPosField(node.position),
      };

    case 'linkReference':
      return {
        type: 'linkReference',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: node.referenceType,
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'imageReference':
      return {
        type: 'imageReference',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: node.referenceType,
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...mdastPosField(node.position),
      };

    case 'textDirective':
      return {
        type: 'textDirective',
        name: node.name,
        ...(node.attributes ? { attributes: node.attributes } : {}),
        children: inlineChildrenToMdast(node.children),
        ...mdastPosField(node.position),
      };

    case 'mention':
      // Fallback: when `inlineToMdast` is called directly (not via
      // `inlineChildrenToMdast`), collapse the mention to just the link
      // form. The `@` prefix is lost, but the id+name still round-trip.
      // Normal call sites go through `inlineChildrenToMdast` and get
      // the proper text('@') + link pair.
      return {
        type: 'link',
        url: `${node.targetKind}:${node.targetId}`,
        children: [{ type: 'text', value: node.displayName }],
        ...mdastPosField(node.position),
      };

    case 'inlineIcon':
      // Serialize back to the authored token so source round-trips
      // byte-stable. The token already carries the qualified form when
      // required (the parser preserved it verbatim).
      return {
        type: 'text',
        value: `{[${node.token}]}`,
        ...mdastPosField(node.position),
      };

    default:
      return { type: 'text', value: '' };
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Convert a MarkdownDefinitionList to an HTML <dl> string.
 * Fallback for serialization since mdast doesn't support definition lists.
 */
function definitionListToHtml(list: {
  children: Array<{ type: string; children?: unknown[] }>;
}): string {
  let html = '<dl>\n';
  for (const child of list.children) {
    if (child.type === 'definitionTerm') {
      // Extract plain text from inline children
      const text = (child.children as Array<{ value?: string; children?: unknown[] }>)
        .map((c) => c.value ?? '')
        .join('');
      html += `  <dt>${text}</dt>\n`;
    } else if (child.type === 'definitionDescription') {
      html += `  <dd>...</dd>\n`;
    }
  }
  html += '</dl>';
  return html;
}
