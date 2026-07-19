/**
 * Markdown Tree Utilities
 *
 * Helper functions for traversing and querying the MarkdownDocument tree.
 * All functions are pure and operate on the JSON node interfaces.
 */

import type { MarkdownNode, MarkdownDocument, HtmlNode } from './types.js';
import { parseHtmlToNodes } from './htmlParse.js';

/**
 * Get the children of any markdown node, if it has children.
 * Returns an empty array for leaf nodes (text, code, break, etc.).
 *
 * This is useful for generic tree walking where you don't want to
 * check the specific node type.
 */
export function getChildren(node: MarkdownNode): MarkdownNode[] {
  if ('children' in node && Array.isArray(node.children)) {
    return node.children as MarkdownNode[];
  }
  return [];
}

/**
 * Walk the markdown tree depth-first, calling the visitor for each node.
 *
 * The visitor receives the current node and its parent. Return `true`
 * from the visitor to skip the node's children (prune).
 *
 * @param node - The root node to start walking from
 * @param visitor - Called for each node; return true to skip children
 * @param parent - (internal) Parent node
 */
export function walkMarkdownTree(
  node: MarkdownNode,
  visitor: (node: MarkdownNode, parent?: MarkdownNode) => void | boolean,
  parent?: MarkdownNode,
): void {
  const skip = visitor(node, parent);
  if (skip === true) return;

  const children = getChildren(node);
  for (const child of children) {
    walkMarkdownTree(child, visitor, node);
  }
}

/**
 * Find all nodes of a specific type in the tree.
 *
 * @param root - The document or node to search within
 * @param type - The node type to find (e.g., 'heading', 'link', 'text')
 * @returns Array of matching nodes
 *
 * @example
 * ```ts
 * const headings = findNodesByType(doc, 'heading');
 * const links = findNodesByType(doc, 'link');
 * ```
 */
export function findNodesByType<T extends MarkdownNode>(root: MarkdownNode, type: T['type']): T[] {
  const results: T[] = [];
  walkMarkdownTree(root, (node) => {
    if (node.type === type) {
      results.push(node as T);
    }
  });
  return results;
}

/**
 * Extract all plain text content from a node and its descendants.
 * Concatenates text values, ignoring formatting, links, etc.
 *
 * @param node - The node to extract text from
 * @returns Plain text content
 *
 * @example
 * ```ts
 * const heading = doc.children[0]; // { type: 'heading', children: [{ type: 'text', value: 'Hello' }] }
 * extractPlainText(heading); // 'Hello'
 * ```
 */
export function extractPlainText(node: MarkdownNode): string {
  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }

  const children = getChildren(node);
  // Preserve boundaries between block-level elements (list items, paragraphs
  // inside list items, blockquotes) so downstream consumers like caption
  // splitting can treat each item as a separate phrase.
  const separator = node.type === 'list' || node.type === 'listItem' ? '\n' : '';
  return children.map(extractPlainText).join(separator);
}

/**
 * Count the total number of nodes in the tree.
 *
 * @param node - The root node
 * @returns Total node count (including the root)
 */
export function countNodes(node: MarkdownNode): number {
  let count = 1;
  const children = getChildren(node);
  for (const child of children) {
    count += countNodes(child);
  }
  return count;
}

// ============================================
// YAML frontmatter (supported subset)
// ============================================

/**
 * Squisq parses and emits a deliberately bounded subset of YAML for
 * frontmatter. `MarkdownDocument` is the pivot format for every converter
 * (DOCX/PDF/HTML/EPUB/PPTX/XLSX/CSV), so the parser and the serializer are
 * built as one **round-trip pair**: whatever `formatFrontmatterYaml` writes,
 * `parseFrontmatter` reads back with the same value *and the same type*.
 *
 * Supported:
 *   - nested block mappings (`author:` + indented `name: Bob`)
 *   - block sequences of scalars and of mappings (`- a` / `- name: a`),
 *     at the key's indent or deeper
 *   - single- and double-quoted scalars (always strings)
 *   - literal (`|`, `|-`, `|+`) and folded (`>`, `>-`, `>+`) block scalars
 *   - `true`/`false` (+ `True`/`TRUE` casings), `null`/`~`, and numbers
 *   - comments on their own line
 *
 * Deliberately NOT interpreted, and preserved **verbatim as strings**
 * instead of being guessed at:
 *   - **flow collections** (`key: {…}` / `key: [a, b]`). Squisq's own
 *     payload convention writes compact single-line JSON unquoted (see
 *     `formatFrontmatterValue` and the custom-templates / custom-themes
 *     codecs), and those payloads must survive a parse→stringify pass
 *     byte-for-byte. Treating them as YAML flow would retype a string into
 *     an object and reformat a one-line payload into hundreds of lines.
 *     The only exceptions are the empty forms `[]` / `{}`, which the
 *     serializer needs in order to round-trip empty collections (a string
 *     that is literally `"[]"` is quoted on the way out, so the two stay
 *     distinguishable).
 *   - anchors/aliases/tags/merge keys — kept as their literal scalar text.
 *
 * Known deviations from the YAML spec, kept on purpose:
 *   - `|` does not clip a trailing newline (it behaves like `|-`). This is
 *     long-standing Squisq behavior with a test pinning it, and our writer
 *     only ever emits `|-`.
 *   - `#` does not start a comment *within* a value line. Real YAML reads
 *     `color: #ff0000` as null; dropping the value would be silent data
 *     loss, so the text is kept. Our writer always quotes values containing
 *     `#`, so emitted frontmatter is unaffected either way.
 */

const YAML_TRUE = new Set(['true', 'True', 'TRUE']);
const YAML_FALSE = new Set(['false', 'False', 'FALSE']);
const YAML_NULL = new Set(['null', 'Null', 'NULL', '~']);

/**
 * Only canonical numbers are coerced. The pair of tests — "looks like a plain
 * decimal (or the exponent form `String(number)` produces)" **and** "survives
 * a `Number` → `String` round-trip byte-for-byte" — is what keeps authored
 * forms intact: `1.10` (trailing zero), `1e5` (non-canonical exponent),
 * `0x10` (hex), `007` (padded), `+5`, and integers beyond float precision all
 * fail the second test and stay strings, while `42`, `-5`, `0` and `3.14`
 * become numbers.
 *
 * The exponent branch is what closes the round trip at the extremes: `String`
 * switches to exponent notation outside 1e-7…1e21, so `formatFrontmatterYaml`
 * writes `1e+21` / `1e-7`, and without this those would read back as STRINGS —
 * a silent type change across a pure parse→stringify pass.
 *
 * `Infinity`/`NaN` are excluded by the regex (`Number()` would accept them,
 * but they have no YAML spelling we emit).
 */
const YAML_CANONICAL_NUMBER_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-][0-9]+)?$/;

function isCanonicalNumber(text: string): boolean {
  return YAML_CANONICAL_NUMBER_RE.test(text) && String(Number(text)) === text;
}

/**
 * Define keys as data properties so a frontmatter key named `__proto__`
 * cannot invoke Object.prototype's legacy setter.
 */
function assignKey(map: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(map, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

interface YamlCursor {
  readonly lines: string[];
  i: number;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/** Index of the next blank/comment-free line, without moving the cursor. */
function nextSignificant(cur: YamlCursor): number {
  let j = cur.i;
  while (j < cur.lines.length && isSkippableLine(cur.lines[j])) j++;
  return j;
}

function isSequenceItem(content: string): boolean {
  return content === '-' || content.startsWith('- ');
}

/**
 * Read a complete quoted scalar from the start of `text`, returning the
 * decoded value and whatever follows the closing quote. Returns null when
 * the run never closes (so callers can fall back to verbatim text).
 */
function readQuotedScalar(text: string): { value: string; rest: string } | null {
  const quote = text[0];
  if (quote === '"') {
    for (let i = 1; i < text.length; i++) {
      if (text[i] === '\\') {
        i++; // skip the escaped character
        continue;
      }
      if (text[i] !== '"') continue;
      const raw = text.slice(0, i + 1);
      try {
        // Double-quoted YAML shares JSON's escape vocabulary for everything
        // our formatter emits.
        return { value: JSON.parse(raw) as string, rest: text.slice(i + 1) };
      } catch {
        // Be permissive for hand-authored YAML outside our formatter's subset.
        return { value: raw.slice(1, -1), rest: text.slice(i + 1) };
      }
    }
    return null;
  }
  if (quote === "'") {
    let value = '';
    for (let i = 1; i < text.length; i++) {
      if (text[i] !== "'") {
        value += text[i];
        continue;
      }
      // Single-quoted YAML represents a literal quote as two consecutive quotes.
      if (text[i + 1] === "'") {
        value += "'";
        i++;
        continue;
      }
      return { value, rest: text.slice(i + 1) };
    }
    return null;
  }
  return null;
}

/**
 * Split `content` into a mapping key and the text after the colon, or null
 * when the line isn't a mapping entry.
 *
 * Flow-looking content is never treated as a mapping: `{"a":1}` is one of
 * Squisq's opaque JSON payloads, and splitting it on the inner colon would
 * invent the key `{"a"`.
 */
function splitMappingKey(content: string): { key: string; rest: string } | null {
  if (content.startsWith('{') || content.startsWith('[')) return null;

  if (content.startsWith('"') || content.startsWith("'")) {
    const quoted = readQuotedScalar(content);
    if (!quoted) return null;
    const after = quoted.rest;
    if (after === ':' || after.startsWith(': ') || after.startsWith(':\t')) {
      return { key: quoted.value, rest: after.slice(1).trim() };
    }
    return null;
  }

  // YAML proper: the separator is `:` followed by whitespace or end-of-line.
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== ':') continue;
    const next = content[i + 1];
    if (next !== undefined && next !== ' ' && next !== '\t') continue;
    const key = content.slice(0, i).trim();
    if (!key) return null;
    return { key, rest: content.slice(i + 1).trim() };
  }

  // Lenient fallback for hand-authored `key:value` (no space), which older
  // Squisq accepted. Guarded against `http://…` so a bare URL value doesn't
  // get split into a key.
  const colon = content.indexOf(':');
  if (colon > 0 && content[colon + 1] !== '/') {
    const key = content.slice(0, colon).trim();
    if (key && !key.includes(' ')) return { key, rest: content.slice(colon + 1).trim() };
  }
  return null;
}

/** Fold a dedented `>` block scalar body per YAML's folding rules. */
function foldBlockLines(lines: string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === '') {
      // A blank line folds to a literal newline instead of a space.
      parts.push('\n');
      i++;
      continue;
    }
    if (/^\s/.test(line)) {
      // More-indented lines are kept literally.
      parts.push((parts.length > 0 ? '\n' : '') + line);
      i++;
      continue;
    }
    parts.push(line);
    i++;
    while (i < lines.length && lines[i] !== '' && !/^\s/.test(lines[i])) {
      parts.push(` ${lines[i]}`);
      i++;
    }
  }
  return parts.join('');
}

/**
 * Read a block scalar body. The cursor must already sit on the first body
 * line; it is left on the first line that ends the scalar.
 */
function parseBlockScalar(
  cur: YamlCursor,
  keyIndent: number,
  folded: boolean,
  chomp: string,
): string {
  const blockLines: string[] = [];
  let j = cur.i;
  for (; j < cur.lines.length; j++) {
    const line = cur.lines[j];
    if (line.trim() === '') {
      blockLines.push('');
      continue;
    }
    if (indentOf(line) <= keyIndent) break; // dedent ends the scalar
    blockLines.push(line);
  }
  cur.i = j;

  // `-` (strip) and the default both drop trailing blank lines; `+` keeps them.
  if (chomp !== '+') {
    while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') blockLines.pop();
  }

  // Dedent by the common leading whitespace of the non-blank lines.
  let commonIndent = Infinity;
  for (const line of blockLines) {
    if (line === '') continue;
    commonIndent = Math.min(commonIndent, indentOf(line));
  }
  if (!isFinite(commonIndent)) commonIndent = 0;
  const dedented = blockLines.map((line) => (line === '' ? '' : line.slice(commonIndent)));

  return folded ? foldBlockLines(dedented) : dedented.join('\n');
}

function scalarFromText(text: string): unknown {
  if (text === '' || YAML_NULL.has(text)) return null;
  if (YAML_TRUE.has(text)) return true;
  if (YAML_FALSE.has(text)) return false;
  if (isCanonicalNumber(text)) return Number(text);
  return text;
}

/**
 * Consume a plain scalar's continuation lines (any directly-following lines
 * indented deeper than the key), folding them into the value with spaces —
 * YAML's multi-line plain scalar. Without this, such lines would be dropped.
 */
function collectPlainContinuation(cur: YamlCursor, keyIndent: number, first: string): string {
  const parts = [first];
  while (cur.i < cur.lines.length) {
    const line = cur.lines[cur.i];
    if (isSkippableLine(line)) break;
    if (indentOf(line) <= keyIndent) break;
    parts.push(line.trim());
    cur.i++;
  }
  return parts.join(' ');
}

/** Parse the value of a mapping key, given the text after its colon. */
function parseValue(cur: YamlCursor, keyIndent: number, inline: string): unknown {
  const blockScalar = /^([|>])([0-9]*)([+-]?)$/.exec(inline);
  if (blockScalar) {
    // An explicit indentation indicator (`|2`) is accepted but ignored — the
    // body's own common indent is used. Consuming it here still beats
    // mis-reading the body as sibling keys.
    return parseBlockScalar(cur, keyIndent, blockScalar[1] === '>', blockScalar[3]);
  }

  if (inline === '') return parseNodeBelowKey(cur, keyIndent);

  if (inline.startsWith('"') || inline.startsWith("'")) {
    const quoted = readQuotedScalar(inline);
    if (quoted && quoted.rest.trim() === '') return quoted.value;
    // Permissive fallback for hand-authored YAML outside our formatter's
    // subset, kept for backward compatibility: a value wrapped in quotes
    // whose interior quotes were never escaped (e.g. a JSON payload written
    // as `key: "{"a":1}"`) is read by stripping the outer pair.
    const quote = inline[0];
    if (inline.length >= 2 && inline.endsWith(quote)) {
      const body = inline.slice(1, -1);
      return quote === "'" ? body.replace(/''/g, "'") : body;
    }
    // Trailing junk after the closing quote is outside the subset — keep the
    // raw text rather than silently discarding part of it.
    return inline;
  }

  // Flow collections are opaque payloads (see the subset note above).
  if (inline === '[]') return [];
  if (inline === '{}') return {};
  if (inline.startsWith('{') || inline.startsWith('[')) return inline;

  return scalarFromText(collectPlainContinuation(cur, keyIndent, inline));
}

/** Resolve a `key:` with nothing after the colon: nested node, or null. */
function parseNodeBelowKey(cur: YamlCursor, keyIndent: number): unknown {
  const j = nextSignificant(cur);
  if (j >= cur.lines.length) return null;
  const line = cur.lines[j];
  const ind = indentOf(line);
  const content = line.slice(ind);

  // A sequence may sit at the key's own indent — `tags:` then `- a` at
  // column 0 is the canonical hand-authored form.
  if (isSequenceItem(content) && ind >= keyIndent) {
    cur.i = j;
    return parseSequence(cur, ind);
  }
  if (ind > keyIndent) {
    cur.i = j;
    if (splitMappingKey(content)) return parseMapping(cur, ind);
    cur.i = j + 1;
    return scalarFromText(collectPlainContinuation(cur, keyIndent, content.trim()));
  }
  return null;
}

/** Resolve a bare `-` whose item body lives on the following lines. */
function parseNodeBelowDash(cur: YamlCursor, dashIndent: number): unknown {
  const j = nextSignificant(cur);
  if (j >= cur.lines.length) return null;
  const line = cur.lines[j];
  const ind = indentOf(line);
  if (ind <= dashIndent) return null;
  const content = line.slice(ind);
  cur.i = j;
  if (isSequenceItem(content)) return parseSequence(cur, ind);
  if (splitMappingKey(content)) return parseMapping(cur, ind);
  cur.i = j + 1;
  return scalarFromText(collectPlainContinuation(cur, dashIndent, content.trim()));
}

function parseSequence(cur: YamlCursor, indent: number): unknown[] {
  const items: unknown[] = [];
  for (;;) {
    const j = nextSignificant(cur);
    if (j >= cur.lines.length) {
      cur.i = j;
      break;
    }
    const line = cur.lines[j];
    const ind = indentOf(line);
    if (ind !== indent) break;
    const content = line.slice(ind);
    if (!isSequenceItem(content)) break;

    const afterDash = content.slice(1);
    const itemText = afterDash.trimStart();
    if (itemText === '') {
      cur.i = j + 1;
      items.push(parseNodeBelowDash(cur, ind));
      continue;
    }

    const itemCol = ind + 1 + (afterDash.length - itemText.length);
    const entry = splitMappingKey(itemText);
    if (entry) {
      // Rewrite the dash to spaces so the item body becomes an ordinary
      // mapping starting at `itemCol`; sibling keys align there naturally.
      cur.lines[j] = ' '.repeat(itemCol) + itemText;
      cur.i = j;
      items.push(parseMapping(cur, itemCol));
      continue;
    }
    cur.i = j + 1;
    items.push(parseValue(cur, ind, itemText));
  }
  return items;
}

function parseMapping(cur: YamlCursor, indent: number): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (;;) {
    const j = nextSignificant(cur);
    if (j >= cur.lines.length) {
      cur.i = j;
      break;
    }
    const line = cur.lines[j];
    const ind = indentOf(line);
    if (ind !== indent) break;
    const content = line.slice(ind);
    if (isSequenceItem(content)) break;
    const entry = splitMappingKey(content);
    if (!entry) break;
    cur.i = j + 1;
    assignKey(map, entry.key, parseValue(cur, indent, entry.rest));
  }
  return map;
}

/**
 * Parse a YAML frontmatter string into a key-value record.
 *
 * Handles the subset documented above: nested mappings, block sequences,
 * quoted and block scalars, booleans/null, and conservatively-coerced
 * numbers. Returns `null` when the input is empty or carries no mapping
 * keys at all.
 *
 * @param yaml - The raw YAML string (without the `---` delimiters)
 * @returns A record of string keys to parsed values, or null
 */
export function parseFrontmatter(yaml: string): Record<string, unknown> | null {
  if (!yaml || !yaml.trim()) return null;

  const cur: YamlCursor = { lines: yaml.replace(/\r\n?/g, '\n').split('\n'), i: 0 };
  const result: Record<string, unknown> = {};

  // Root loop. A well-formed document is a single mapping and this runs
  // once; the loop exists so that malformed input (an unexpected indent, a
  // stray non-mapping line) still makes forward progress and contributes the
  // keys it does have, instead of silently swallowing the rest of the block.
  for (;;) {
    const j = nextSignificant(cur);
    if (j >= cur.lines.length) break;
    cur.i = j;
    const map = parseMapping(cur, indentOf(cur.lines[j]));
    for (const [key, value] of Object.entries(map)) assignKey(result, key, value);
    if (cur.i <= j) cur.i = j + 1; // guarantee progress on an unparseable line
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Format a multi-line string as a YAML literal block scalar body, i.e.
 * `|-` followed by each source line indented two spaces. Paired with
 * {@link parseFrontmatter}'s block-scalar reader so multi-line frontmatter
 * values (e.g. pretty-printed JSON payloads) round-trip. Blank lines stay
 * blank (no trailing whitespace) so the output diffs cleanly.
 */
export function formatBlockScalar(value: string): string {
  const body = value
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n');
  return `|-\n${body}`;
}

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/;

/** A frontmatter block with nothing between the fences (`---\n---`). */
const EMPTY_FRONTMATTER_BLOCK_RE = /^---\r?\n---(\r?\n)?/;

/**
 * Split a markdown source into its raw leading YAML frontmatter block and
 * the body that follows.
 *
 * `frontmatter` is the exact source bytes of the block — both `---` fence
 * lines and the trailing newline — or `null` when the source does not start
 * with one. Unlike {@link parseFrontmatter}, nothing is interpreted:
 * comment-only and empty blocks are preserved verbatim, which is what
 * source-level rewriters (`cleanupMarkdownSource`) need to keep authored
 * YAML byte-identical.
 */
export function splitFrontmatterBlock(source: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = FRONTMATTER_BLOCK_RE.exec(source) ?? EMPTY_FRONTMATTER_BLOCK_RE.exec(source);
  if (!match) return { frontmatter: null, body: source };
  return { frontmatter: match[0], body: source.slice(match[0].length) };
}

/** Quote a frontmatter scalar so it round-trips cleanly through `parseFrontmatter`. */
export function formatFrontmatterValue(value: string | number | boolean): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  // Multi-line strings can't live on one line — emit a YAML literal block
  // scalar (`|-`) that `parseFrontmatter` reads back. This carries pretty-
  // printed JSON payloads (opt-in custom templates/themes). Single-line
  // values keep their exact historical output below.
  if (/[\r\n]/.test(value)) return formatBlockScalar(value.replace(/\r\n?/g, '\n'));
  // A single-line JSON object/array literal round-trips verbatim: the parser
  // treats flow-looking values as opaque payload strings and never retypes
  // them (see the subset note above). Writing it unquoted keeps it
  // human-readable and diffable — the compact custom-templates /
  // custom-themes payloads depend on this. `[]` / `{}` are excluded: those
  // are the one flow form the parser *does* read, so a string that happens
  // to be `"[]"` must be quoted to stay a string.
  if (value !== '[]' && value !== '{}' && /^[{[]/.test(value)) return value;
  // Quote when needed: leading/trailing whitespace, leading punctuation that
  // could trigger YAML modes, or values that would otherwise be read back as
  // a non-string (reserved literals, empty collections, anything numeric).
  const needsQuote =
    /^\s|\s$/.test(value) ||
    /^[!&*?|>%@`~]/.test(value) ||
    /[:#]/.test(value) ||
    value === '' ||
    value === '[]' ||
    value === '{}' ||
    YAML_TRUE.has(value) ||
    YAML_FALSE.has(value) ||
    YAML_NULL.has(value) ||
    (value !== '' && !Number.isNaN(Number(value))) ||
    (/^["']/.test(value) && /["']$/.test(value));
  if (!needsQuote) return value;
  // Prefer double quotes; escape any embedded double-quote / backslash.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * A key is safe to write bare when it can't be mistaken for anything else on
 * re-read; otherwise it goes through the scalar quoter (which the parser's
 * quoted-key path understands).
 *
 * Interior spaces are fine, but a key may not START or END with one: the
 * parser trims around the `:`, so a bare `key : v` would read back as `key`,
 * silently renaming it. Such keys get quoted instead.
 */
function formatFrontmatterKey(key: string): string {
  return /^[A-Za-z0-9_](?:[A-Za-z0-9 _.-]*[A-Za-z0-9_.-])?$/.test(key)
    ? key
    : formatFrontmatterValue(key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Values with no YAML scalar spelling of their own are skipped, like JSON.stringify. */
function isOmittedValue(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

function toScalar(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Emit `prefix` + a formatted scalar, re-indenting a block scalar's body to
 * sit under the entry (`formatBlockScalar` only indents by two).
 */
function pushScalar(out: string[], pad: string, prefix: string, value: unknown): void {
  const formatted = formatFrontmatterValue(toScalar(value));
  if (!formatted.includes('\n')) {
    out.push(`${pad}${prefix}${formatted}`);
    return;
  }
  const [head, ...body] = formatted.split('\n');
  out.push(`${pad}${prefix}${head}`);
  for (const line of body) out.push(line === '' ? '' : `${pad}${line}`);
}

function emitSequence(items: readonly unknown[], indent: number, out: string[]): void {
  const pad = ' '.repeat(indent);
  for (const item of items) {
    if (item === null || isOmittedValue(item)) {
      out.push(`${pad}- null`);
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length === 0) {
        out.push(`${pad}- []`);
        continue;
      }
      // A nested sequence hangs below a bare dash: `- - a` would be read
      // back as the plain string "- a".
      out.push(`${pad}-`);
      emitSequence(item, indent + 2, out);
      continue;
    }
    if (isPlainRecord(item)) {
      const sub: string[] = [];
      emitMapping(item, indent + 2, sub);
      if (sub.length === 0) {
        out.push(`${pad}- {}`);
        continue;
      }
      // Hoist the first key onto the dash line: `- name: a`.
      sub[0] = `${pad}- ${sub[0].slice(indent + 2)}`;
      out.push(...sub);
      continue;
    }
    pushScalar(out, pad, '- ', item);
  }
}

function emitMapping(map: Record<string, unknown>, indent: number, out: string[]): void {
  const pad = ' '.repeat(indent);
  for (const [rawKey, value] of Object.entries(map)) {
    if (isOmittedValue(value)) continue;
    const key = formatFrontmatterKey(rawKey);
    if (value === null) {
      out.push(`${pad}${key}: null`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(`${pad}${key}: []`);
        continue;
      }
      out.push(`${pad}${key}:`);
      emitSequence(value, indent + 2, out);
      continue;
    }
    if (isPlainRecord(value)) {
      const sub: string[] = [];
      emitMapping(value, indent + 2, sub);
      if (sub.length === 0) {
        out.push(`${pad}${key}: {}`);
        continue;
      }
      out.push(`${pad}${key}:`);
      out.push(...sub);
      continue;
    }
    pushScalar(out, pad, `${key}: `, value);
  }
}

/**
 * Serialize a frontmatter record to YAML (without the `---` delimiters).
 *
 * The write half of the round-trip pair documented above: nested objects
 * become nested block mappings and arrays become block sequences, so
 * structured frontmatter reads back as the same structure with the same
 * types. Returns an empty string when nothing is writable.
 */
export function formatFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  const out: string[] = [];
  emitMapping(frontmatter, 0, out);
  return out.join('\n');
}

/**
 * Update a markdown source string's YAML frontmatter block, applying the
 * given key/value updates. A `null` or `undefined` value removes the key.
 * If no frontmatter block exists and any non-null update is supplied, a
 * new block is prepended; if every update is a removal and no block
 * exists, the source is returned unchanged.
 *
 * Existing key order is preserved; new keys are appended in the order
 * they appear in `updates`. Rewriting is **node-aware**: a key whose value
 * is a block scalar or a nested map/sequence owns its indented body, so
 * removing or replacing it takes the whole node with it, and body lines are
 * never mistaken for top-level keys (an indented `name: X` inside another
 * key's block scalar stays put even when `name` is being updated).
 *
 * @param source - The markdown source string.
 * @param updates - Map of key → new value (or null/undefined to remove).
 * @returns The updated markdown source string.
 */
export function setFrontmatterValues(
  source: string,
  updates: Record<string, string | number | boolean | null | undefined>,
): string {
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) return source;

  const match = source.match(FRONTMATTER_BLOCK_RE);
  const handled = new Set<string>();

  // Existing frontmatter block — rewrite node-by-node, preserving order.
  if (match) {
    const inner = match[1];
    const lines = inner.split(/\r?\n/);
    const newLines: string[] = [];

    // The root indent is whatever the first real entry uses (virtually
    // always 0); anything deeper belongs to a value, not to a key.
    const firstSignificant = lines.find((line) => !isSkippableLine(line));
    const rootIndent = firstSignificant === undefined ? 0 : indentOf(firstSignificant);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const ind = indentOf(line);
      const entry =
        isSkippableLine(line) || ind !== rootIndent ? null : splitMappingKey(line.slice(ind));
      if (!entry) {
        newLines.push(line);
        i++;
        continue;
      }

      // Span of this key's node: the key line plus every following line that
      // is indented deeper (its block scalar body / nested collection),
      // including blank lines that sit inside that body.
      let end = i + 1;
      while (end < lines.length) {
        if (lines[end].trim() === '') {
          let probe = end;
          while (probe < lines.length && lines[probe].trim() === '') probe++;
          if (probe < lines.length && indentOf(lines[probe]) > rootIndent) {
            end = probe;
            continue;
          }
          break;
        }
        if (indentOf(lines[end]) <= rootIndent) break;
        end++;
      }

      if (!Object.prototype.hasOwnProperty.call(updates, entry.key)) {
        for (let k = i; k < end; k++) newLines.push(lines[k]);
        i = end;
        continue;
      }
      handled.add(entry.key);
      const next = updates[entry.key];
      // Removal and replacement both drop the whole node, body included.
      if (next !== null && next !== undefined) {
        pushScalar(newLines, ' '.repeat(rootIndent), `${formatFrontmatterKey(entry.key)}: `, next);
      }
      i = end;
    }

    // Append any keys that weren't already present.
    for (const key of updateKeys) {
      if (handled.has(key)) continue;
      const next = updates[key];
      if (next === null || next === undefined) continue;
      pushScalar(newLines, '', `${formatFrontmatterKey(key)}: `, next);
    }

    // If every line got removed, drop the block entirely.
    const nonEmpty = newLines.filter((l) => l.trim().length > 0);
    const rest = source.slice(match[0].length);
    if (nonEmpty.length === 0) return rest;
    return `---\n${newLines.join('\n')}\n---\n${rest}`;
  }

  // No existing block — only create one if there's at least one non-null
  // value to write.
  const fresh: string[] = [];
  for (const key of updateKeys) {
    const next = updates[key];
    if (next === null || next === undefined) continue;
    pushScalar(fresh, '', `${formatFrontmatterKey(key)}: `, next);
  }
  if (fresh.length === 0) return source;
  return `---\n${fresh.join('\n')}\n---\n${source}`;
}

/**
 * Create a minimal MarkdownDocument from a list of block nodes.
 * Convenience function for programmatic document construction.
 */
export function createDocument(...children: MarkdownDocument['children']): MarkdownDocument {
  return {
    type: 'document',
    children,
  };
}

/**
 * Infer a human-readable title for a markdown document.
 *
 * Resolution order:
 *   1. `title:` value in YAML frontmatter (when present and non-empty)
 *   2. Text of the first heading found, walking top-level depth (H1, then
 *      H2, etc.) — the shallowest heading wins regardless of source order
 *
 * Returns `undefined` when no usable title is found.
 */
export function inferDocumentTitle(doc: MarkdownDocument): string | undefined {
  const fmTitle = doc.frontmatter?.title;
  if (typeof fmTitle === 'string') {
    const trimmed = fmTitle.trim();
    if (trimmed) return trimmed;
  }

  let best: { depth: number; text: string } | null = null;
  for (const node of doc.children) {
    if (node.type !== 'heading') continue;
    const text = extractPlainText(node).trim();
    if (!text) continue;
    if (best === null || node.depth < best.depth) {
      best = { depth: node.depth, text };
      if (best.depth === 1) break;
    }
  }

  return best?.text;
}

/**
 * Read a theme id from a markdown document's frontmatter.
 *
 * Checks the editor's canonical `squisq-theme` key first, then the
 * shorter legacy aliases (`themeId`, `theme`). Returns `undefined`
 * when none of them carry a non-empty string. Centralizing the lookup
 * keeps the export pipelines (DOCX, PPTX, HTML, plain-HTML bundle) in
 * sync with whatever the editor writes — adding a new frontmatter
 * spelling later is a one-file change.
 */
export function readFrontmatterThemeId(
  frontmatter: Record<string, unknown> | undefined,
): string | undefined {
  if (!frontmatter) return undefined;
  const keys = ['squisq-theme', 'themeId', 'theme'] as const;
  for (const key of keys) {
    const raw = frontmatter[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

/**
 * Project an inline-HTML string (as stored on `TextLayer.content.html`) down
 * to plain text — the value mirrored into `content.text` for plain consumers
 * (PDF/markdown export, search, accessibility) and the SVG `<text>` fallback.
 *
 * `<br>` and block-level tags (`p`, `div`, `h1`–`h6`, `li`, `blockquote`,
 * `pre`) become line breaks so multi-line rich content reads sensibly. Entity
 * decoding is handled by {@link parseHtmlToNodes} (parse5-backed), so this is
 * more correct than a regex tag-stripper.
 */
export function plainTextFromInlineHtml(html: string): string {
  const BLOCK = new Set([
    'p',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'blockquote',
    'pre',
  ]);
  const walk = (nodes: HtmlNode[]): string =>
    nodes
      .map((n) => {
        if (n.type === 'htmlText') return n.value;
        if (n.type !== 'htmlElement') return '';
        const tag = n.tagName.toLowerCase();
        if (tag === 'br') return '\n';
        const inner = walk(n.children);
        return BLOCK.has(tag) ? `${inner}\n` : inner;
      })
      .join('');
  return walk(parseHtmlToNodes(html))
    .replace(/\u00A0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
