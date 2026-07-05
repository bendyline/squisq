/**
 * Structured template data from markdown body content.
 *
 * Attribute strings on a heading annotation are fine for scalar params,
 * but tabular or nested inputs (dataTable rows, map markers, chart data)
 * don't pack well into a single quoted line. This module supplies the two
 * structured channels instead:
 *
 * 1. **Data fences** — a fenced code block whose info string is
 *    `json data` or `yaml data`, placed in a heading's body content:
 *
 *    ````markdown
 *    ## Quarterly numbers {[dataTable]}
 *
 *    ```json data
 *    { "headers": ["Q", "Revenue"], "rows": [["Q1", "1.2M"], ["Q2", "1.4M"]] }
 *    ```
 *    ````
 *
 *    The parsed object lands on `block.templateData` and merges into the
 *    template input (after defaults, before `{[…]}` string overrides).
 *    The `data` marker keeps ordinary ```json code samples — which should
 *    render as code — out of the template input.
 *
 * 2. **GFM tables** — for the `dataTable` template, the first table in the
 *    section body supplies `headers` / `rows` / `align` when the author
 *    didn't provide them explicitly.
 *
 * YAML support is a documented subset (this package has no YAML
 * dependency): top-level `key: scalar`, `key: [inline, array]`, `key:`
 * followed by an indented `- item` block sequence (scalars or inline
 * arrays), and `key:` followed by *one level* of indented `subkey: scalar`
 * lines (a nested map, e.g. `center:` + indented `lat:` / `lng:`). Deeper
 * nesting, and mixing list items with mapping keys under one key, are
 * rejected with a clear error — use a `json data` fence for those.
 */

import type {
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownTable,
  MarkdownTableRow,
} from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';

// ============================================
// Data fences
// ============================================

/** Languages accepted for data fences. */
const DATA_FENCE_LANGS = new Set(['json', 'yaml', 'yml']);

/**
 * Whether a code block is a structured-data fence: lang `json`/`yaml`/`yml`
 * with the word `data` in the fence meta (` ```json data `).
 */
export function isDataFence(node: MarkdownCodeBlock): boolean {
  if (!node.lang || !DATA_FENCE_LANGS.has(node.lang.toLowerCase())) return false;
  const meta = node.meta ?? '';
  return /\bdata\b/.test(meta);
}

export interface DataFenceParseResult {
  /** Parsed key→value map. Undefined when parsing failed. */
  data?: Record<string, unknown>;
  /** Parse failure description. Undefined when parsing succeeded. */
  error?: string;
}

/**
 * Parse a data fence's content into a key→value map. JSON fences must
 * contain a top-level object (arrays have no key to merge under); YAML
 * fences are parsed with {@link parseYamlSubset}.
 */
export function parseDataFence(node: MarkdownCodeBlock): DataFenceParseResult {
  const lang = node.lang?.toLowerCase();
  if (lang === 'json') {
    try {
      const parsed: unknown = JSON.parse(node.value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'JSON data fence must contain a top-level object ({"key": …})' };
      }
      return { data: parsed as Record<string, unknown> };
    } catch (err) {
      return { error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  try {
    return { data: parseYamlSubset(node.value) };
  } catch (err) {
    return { error: `invalid YAML: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Return a new contents array with the first data fence's code content
 * replaced by `data` (pretty-printed JSON). The fence node keeps its
 * language and `data` marker; only `value` changes. When no data fence
 * exists, a new ` ```json data ` fence is appended instead.
 *
 * Pure: neither `contents` nor its nodes are mutated. This is the write
 * half of the data-fence channel — editors update `block.templateData`
 * and call this to reflect the change back into `block.contents`.
 */
export function replaceDataFence(
  contents: MarkdownBlockNode[],
  data: Record<string, unknown>,
): MarkdownBlockNode[] {
  const value = JSON.stringify(data, null, 2);
  const index = contents.findIndex((node) => node.type === 'code' && isDataFence(node));
  if (index < 0) {
    const fence: MarkdownCodeBlock = { type: 'code', lang: 'json', meta: 'data', value };
    return [...contents, fence];
  }
  const next = [...contents];
  next[index] = { ...(contents[index] as MarkdownCodeBlock), value };
  return next;
}

// ============================================
// YAML subset parser
// ============================================

/** Parse a scalar token: quoted string, boolean, null, number, or string. */
function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const q = trimmed[0];
    if ((q === '"' || q === "'") && trimmed.endsWith(q)) {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed !== '' && !isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

/**
 * Split an inline-array interior on top-level commas, respecting quotes.
 */
function splitInlineArray(interior: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of interior) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  // A trailing comma (or empty interior) leaves an empty final item — drop it.
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

/** Parse a value that may be an inline array `[a, b]` or a scalar. */
function parseInlineValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitInlineArray(trimmed.slice(1, -1)).map(parseScalar);
  }
  return parseScalar(trimmed);
}

/**
 * Parse the supported YAML subset (see module doc) into a key→value map.
 * Throws an Error with a line-anchored message on anything outside the
 * subset, so callers can surface a precise diagnostic.
 */
export function parseYamlSubset(src: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = src.split('\n');

  // Open block under the most recent `key:` line: whether its children are a
  // block sequence (`- …`) or a nested map (`subkey: …`) is decided by the
  // first indented child; `childIndent` pins the one allowed child depth.
  let pendingKey: string | null = null;
  let pendingKind: 'list' | 'map' | null = null;
  let childIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    if (indent > 0) {
      if (!pendingKey) {
        throw new Error(`line ${i + 1}: unexpected indented line without a preceding "key:" line`);
      }
      if (childIndent < 0) childIndent = indent;
      if (indent > childIndent) {
        throw new Error(
          `line ${i + 1}: nesting deeper than one level is not supported — use a \`\`\`json data fence for nested input`,
        );
      }

      if (trimmed.startsWith('- ')) {
        if (pendingKind === 'map') {
          throw new Error(
            `line ${i + 1}: cannot mix list items and mapping keys under "${pendingKey}"`,
          );
        }
        pendingKind = 'list';
        (result[pendingKey] as unknown[]).push(parseInlineValue(trimmed.slice(2)));
        continue;
      }

      // Otherwise this is a nested `subkey: value` mapping line.
      if (pendingKind === 'list') {
        throw new Error(
          `line ${i + 1}: cannot mix mapping keys and list items under "${pendingKey}"`,
        );
      }
      const subColon = trimmed.indexOf(':');
      if (subColon < 1) {
        throw new Error(`line ${i + 1}: expected "key: value"`);
      }
      const subValue = trimmed.slice(subColon + 1).trim();
      if (subValue === '') {
        // A nested `subkey:` opening its own block would be a second level.
        throw new Error(
          `line ${i + 1}: nesting deeper than one level is not supported — use a \`\`\`json data fence for nested input`,
        );
      }
      if (pendingKind !== 'map') {
        pendingKind = 'map';
        result[pendingKey] = {};
      }
      (result[pendingKey] as Record<string, unknown>)[trimmed.slice(0, subColon).trim()] =
        parseInlineValue(subValue);
      continue;
    }

    pendingKey = null;
    pendingKind = null;
    childIndent = -1;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 1) {
      throw new Error(`line ${i + 1}: expected "key: value"`);
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === '') {
      // `key:` opens a block: an indented `- …` sequence or a `subkey: …`
      // map. Default to an empty list so a `key:` with no children stays
      // back-compatible (`{ key: [] }`); the map branch replaces it wholesale.
      result[key] = [];
      pendingKey = key;
    } else {
      result[key] = parseInlineValue(rawValue);
    }
  }

  return result;
}

// ============================================
// GFM table extraction
// ============================================

export interface ExtractedTableData {
  headers: string[];
  rows: string[][];
  align?: (('left' | 'right' | 'center') | null)[];
}

/** Find the first GFM table among a block's body contents. */
export function findFirstTable(
  contents: MarkdownBlockNode[] | undefined,
): MarkdownTable | undefined {
  return contents?.find((n): n is MarkdownTable => n.type === 'table');
}

/**
 * Extract `headers` / `rows` / `align` (the `dataTable` input shape) from a
 * GFM table node. The first row is the header row.
 */
export function extractTableData(table: MarkdownTable): ExtractedTableData {
  const toCells = (row: MarkdownTableRow): string[] =>
    row.children.map((cell) => extractPlainText(cell).trim());

  const [headerRow, ...bodyRows] = table.children;
  return {
    headers: headerRow ? toCells(headerRow) : [],
    rows: bodyRows.map(toCells),
    ...(table.align && table.align.some((a) => a != null) ? { align: table.align } : {}),
  };
}
