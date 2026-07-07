/**
 * Shared key=value attribute machinery for the two heading annotation forms:
 * the squisq-native `{[templateName key=value …]}` template annotation and
 * the Pandoc-style `{#id .class key=value}` attribute block.
 *
 * Both forms share one interior grammar — whitespace-separated tokens whose
 * values may be quoted (double or single) to include spaces, brackets, or
 * quote characters. This module is the single implementation of that
 * grammar: one tokenizer, one value un/escaper, one quoting rule. The
 * trailing-annotation recognizers live here too so the editor bridge
 * (packages/editor-react/src/tiptapBridge.ts) stays in sync by importing
 * them rather than copying regexes.
 *
 * Value syntax:
 * - Unquoted: no whitespace, quotes, or `[ ] { }` (those would collide with
 *   the surrounding annotation delimiters), e.g. `columns=3`, `name=O'Brien`
 *   (a quote *inside* an unquoted value is literal).
 * - Quoted: `key="value with spaces"` or `key='…'`. Inside a quoted run,
 *   `\` escapes the active quote character and itself; any other `\` is
 *   literal. Quoted values may contain `]` and `}`.
 * - Serialization emits double quotes, switching to single quotes when the
 *   value contains a double quote (markdown character-escape resolution
 *   makes backslash-escaped quotes fragile in `.md` source, so picking the
 *   other quote character is preferred over escaping). A value containing
 *   BOTH quote characters falls back to double quotes with `\"` escapes —
 *   that survives the API path but is best avoided in markdown source.
 */

// ============================================
// Trailing-annotation recognizers
// ============================================

/** Regex source for a double-quoted run with `\"` / `\\` escapes. */
const DQ_RUN = `"(?:[^"\\\\]|\\\\.)*"`;
/** Regex source for a single-quoted run with `\'` / `\\` escapes. */
const SQ_RUN = `'(?:[^'\\\\]|\\\\.)*'`;

/**
 * Quote-aware match for a trailing `{[…]}` annotation: the interior is any
 * mix of quoted runs and characters other than `]` and quotes, so quoted
 * values may contain `]`. The trailing `[\s\]}]*` tolerates an accidental
 * doubled `]}` that users sometimes type when learning the syntax.
 */
const TEMPLATE_STRICT_RE = new RegExp(
  `\\s*\\{\\[((?:[^\\]"']|${DQ_RUN}|${SQ_RUN})+)\\]\\}[\\s\\]}]*$`,
);

/**
 * Legacy fallback matching the pre-quote-aware grammar (`[^\]]+` interior).
 * Tried after the strict form so inputs with unbalanced quotes keep parsing
 * exactly as they did before quote support landed.
 */
const TEMPLATE_LEGACY_RE = /\s*\{\[([^\]]+)\]\}[\s\]}]*$/;

/**
 * Quote-aware match for a trailing Pandoc `{…}` block. The negative
 * lookahead `(?!\[)` keeps it from colliding with the `{[…]}` template
 * form. Quoted values may contain `}`.
 */
const PANDOC_STRICT_RE = new RegExp(`\\s*\\{(?!\\[)((?:[^}"']|${DQ_RUN}|${SQ_RUN})*)\\}\\s*$`);

/** Legacy fallback for the Pandoc block (`[^}]*` interior). */
const PANDOC_LEGACY_RE = /\s*\{(?!\[)([^}]*)\}\s*$/;

/** Result of matching a trailing annotation against a text run. */
export interface TrailingAnnotationMatch {
  /** Interior of the brace block (between `{[`/`{` and `]}`/`}`), untrimmed. */
  inner: string;
  /** Offset of the match start (including leading whitespace) in the input. */
  index: number;
}

function matchTrailing(
  text: string,
  strict: RegExp,
  legacy: RegExp,
): TrailingAnnotationMatch | null {
  const m = strict.exec(text) ?? legacy.exec(text);
  return m ? { inner: m[1], index: m.index } : null;
}

/**
 * Match a trailing `{[templateName key=value …]}` annotation. Quote-aware
 * (values may contain `]` when quoted), with a legacy fallback so inputs
 * the old `[^\]]+` grammar accepted still match.
 */
export function matchTrailingTemplateAnnotation(text: string): TrailingAnnotationMatch | null {
  return matchTrailing(text, TEMPLATE_STRICT_RE, TEMPLATE_LEGACY_RE);
}

/**
 * Match a trailing Pandoc `{#id .class key=value}` block. Quote-aware
 * (values may contain `}` when quoted), with a legacy fallback.
 */
export function matchTrailingPandocAttr(text: string): TrailingAnnotationMatch | null {
  return matchTrailing(text, PANDOC_STRICT_RE, PANDOC_LEGACY_RE);
}

// ============================================
// Tokenizer
// ============================================

const WHITESPACE_RE = /\s/;

/**
 * Quote-aware whitespace tokenizer for the interior of either annotation
 * form.
 *
 * A quote run starts only at the beginning of a token or immediately after
 * `=` — a quote elsewhere (e.g. `name=O'Brien`) is a literal character.
 * Inside a run, `\` escapes the active quote character and itself; the
 * escape pair is preserved in the returned token (callers strip and
 * unescape via {@link splitKeyValueToken} / {@link unquoteAttrValue}).
 * An unbalanced opening quote is tolerated: the run extends to the end of
 * the input.
 */
export function tokenizeAttrTokens(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && WHITESPACE_RE.test(input[i])) i++;
    if (i >= n) break;

    let token = '';
    while (i < n && !WHITESPACE_RE.test(input[i])) {
      const ch = input[i];
      const atValueStart = token === '' || token.endsWith('=');
      if ((ch === '"' || ch === "'") && atValueStart) {
        token += ch;
        i++;
        while (i < n && input[i] !== ch) {
          if (input[i] === '\\' && i + 1 < n && (input[i + 1] === ch || input[i + 1] === '\\')) {
            token += input[i] + input[i + 1];
            i += 2;
          } else {
            token += input[i];
            i++;
          }
        }
        if (i < n && input[i] === ch) {
          token += ch;
          i++;
        }
      } else {
        token += ch;
        i++;
      }
    }
    if (token) tokens.push(token);
  }
  return tokens;
}

// ============================================
// Value un/escaping
// ============================================

const DQ_UNESCAPE_RE = /\\([\\"])/g;
const SQ_UNESCAPE_RE = /\\([\\'])/g;

/**
 * Strip surrounding quotes from a raw token value and unescape the active
 * quote character and backslash. Values not wrapped in matching quotes are
 * returned verbatim (including any interior quotes or backslashes).
 */
export function unquoteAttrValue(raw: string): string {
  if (raw.length >= 2) {
    const q = raw[0];
    if ((q === '"' || q === "'") && raw.endsWith(q)) {
      const body = raw.slice(1, -1);
      return body.replace(q === '"' ? DQ_UNESCAPE_RE : SQ_UNESCAPE_RE, '$1');
    }
  }
  return raw;
}

/**
 * Split a `key=value` token into its parts, unquoting/unescaping the value.
 * Returns null for tokens with no `=` past the first character (bare words,
 * `#id`, `.class`, or a leading `=`).
 */
export function splitKeyValueToken(token: string): { key: string; value: string } | null {
  const eqIdx = token.indexOf('=');
  if (eqIdx <= 0) return null;
  return { key: token.slice(0, eqIdx), value: unquoteAttrValue(token.slice(eqIdx + 1)) };
}

// ============================================
// Serialization
// ============================================

const NEEDS_QUOTING_RE = /[\s"'[\]{}]/;
const DQ_ESCAPE_RE = /[\\"]/g;
const SQ_ESCAPE_RE = /[\\']/g;

/**
 * Whether a value must be quoted to survive tokenization and the outer
 * annotation regexes: any whitespace, quote character, bracket, or brace —
 * or an empty value, which would otherwise serialize as a bare `key=`.
 */
export function needsQuoting(value: string): boolean {
  return value === '' || NEEDS_QUOTING_RE.test(value);
}

/**
 * Serialize an attribute value, quoting when {@link needsQuoting} says the
 * bare form would not round-trip.
 *
 * Double quotes are canonical; a value containing a double quote (but no
 * single quote) is single-quoted instead, because markdown resolves
 * backslash escapes in text runs before our parser sees them — switching
 * the quote character round-trips through `.md` source where `\"` would
 * not. Backslashes and the active quote character are escaped.
 */
export function quoteAttrValue(value: string): string {
  if (!needsQuoting(value)) return value;
  if (value.includes('"') && !value.includes("'")) {
    return `'${value.replace(SQ_ESCAPE_RE, (ch) => `\\${ch}`)}'`;
  }
  return `"${value.replace(DQ_ESCAPE_RE, (ch) => `\\${ch}`)}"`;
}

/**
 * Serialize a `{[templateName key=value …]}` template annotation. The inverse
 * of {@link parseStandaloneAnnotation} / the tokenizer: emits the template
 * name (when present) followed by each `key=value` pair in insertion order,
 * quoting values via {@link quoteAttrValue}. Used to re-emit heading-less
 * standalone annotation blocks in `docToMarkdown`.
 */
export function serializeAnnotation(
  template: string | undefined,
  params?: Record<string, string>,
): string {
  const parts: string[] = [];
  if (template) parts.push(template);
  for (const [key, value] of Object.entries(params ?? {})) {
    parts.push(`${key}=${quoteAttrValue(value)}`);
  }
  return `{[${parts.join(' ')}]}`;
}
