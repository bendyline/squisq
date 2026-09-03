/**
 * Table view state — the non-destructive sort/filter vocabulary that rides a
 * `{[dataTable src=… sort=… filter=…]}` annotation. The data bytes are never
 * touched; view state is part of the DOCUMENT (an author's sort shapes the
 * bounded previews and exports), exactly like `sheet`/`anchor` are part of
 * the reference.
 *
 * Grammar (inside the param value; the whole value then rides the ordinary
 * `{[…]}` attr quoting):
 *
 *   sort   := term (',' term)*
 *   term   := colName (':' ('asc'|'desc'))?          // default asc
 *   filter := clause (';' clause)*                    // conjunction (AND) only
 *   clause := colName op value
 *   op     := textOp '*'? | cmpOp
 *   textOp := '=' | '!=' | '~' | '!~' | '^~' | '$~'
 *   cmpOp  := '>' | '<' | '>=' | '<='
 *
 * Text-matching ops (`= != ~ !~ ^~ $~`) are CASE-INSENSITIVE by default
 * (Excel AutoFilter semantics); a `*` suffix makes the match case-sensitive
 * (`Region=*West`). `~` is contains, `^~` starts-with, `$~` ends-with (the
 * `~` marks the text family; `^`/`$` are the regex-anchor mnemonics).
 * Comparison ops compare numerically on numeric columns and via the shared
 * collator otherwise, and take no `*`. Column names address headers by exact
 * text. Names/values containing structural characters are quoted CSV-style —
 * double quotes with `""` doubling, NO backslashes (the outer `{[…]}` layer
 * already owns backslash escaping inside quoted attr values; stacking a
 * second backslash grammar inside would be unreadable and fragile):
 *
 *   sort=Revenue:desc,Region
 *   sort="Ratio A:B":desc
 *   filter=Region=West;Revenue>=1000
 *   filter=Note~"a;b"
 *
 * Parsing NEVER throws: an unknown column drops that term/clause with a
 * `data-view-unknown-column` issue; malformed syntax drops the whole param
 * with `data-view-invalid`. Renderers fall back to natural order.
 */

export interface SortTerm {
  column: string;
  dir: 'asc' | 'desc';
}

export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | '!~' | '^~' | '$~';

/** The ops that match TEXT (and therefore accept the `*` case modifier). */
export const TEXT_FILTER_OPS: readonly FilterOp[] = ['=', '!=', '~', '!~', '^~', '$~'];

export interface FilterClause {
  column: string;
  op: FilterOp;
  value: string;
  /**
   * Case-sensitive matching for text ops (serialized as a `*` op suffix).
   * Absent/false = the default case-insensitive match. Meaningless on the
   * comparison ops and never serialized for them.
   */
  caseSensitive?: boolean;
}

export interface TableViewState {
  sort: SortTerm[];
  filter: FilterClause[];
}

export interface ViewIssue {
  code: 'data-view-unknown-column' | 'data-view-invalid';
  message: string;
}

export interface ParsedTableViewState {
  view: TableViewState;
  issues: ViewIssue[];
}

export const EMPTY_TABLE_VIEW_STATE: TableViewState = Object.freeze({
  sort: [],
  filter: [],
});

/** True when the view state changes nothing. */
export function isEmptyViewState(view: TableViewState): boolean {
  return view.sort.length === 0 && view.filter.length === 0;
}

// ── Shared typing/collation constants ────────────────────────────────
// One rule for "is this column numeric", used by the reference
// implementation AND (copied verbatim, zero-import constraint) by the grid
// worker kernel — parity between the two is a tested property.

/**
 * A column is numeric iff every non-blank trimmed cell parses to a finite
 * number AND is not a leading-zero string (`"007"` stays text — zip codes,
 * ids). Blank cells don't vote.
 */
export function isNumericCellText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (/^0\d/.test(trimmed)) return false;
  return Number.isFinite(Number(trimmed));
}

export function inferNumericColumn(rows: readonly (readonly string[])[], col: number): boolean {
  let sawValue = false;
  for (const row of rows) {
    const cell = row[col] ?? '';
    if (cell.trim() === '') continue;
    if (!isNumericCellText(cell)) return false;
    sawValue = true;
  }
  return sawValue;
}

/** The one collator both sides of the parity contract use. */
export function makeTableCollator(): Intl.Collator {
  return new Intl.Collator(undefined, { numeric: true });
}

// ── Inner-grammar tokenizing (CSV-style quote doubling) ──────────────

/** Characters that force quoting of a name/value on serialization. `^ $ *`
 * are op/modifier characters: unquoted they could fuse with an adjacent op
 * (`~` + value `*x` would re-parse as the `~*` op). */
const NEEDS_INNER_QUOTING_RE = /[,:;=!<>~"^$*]|^\s|\s$/;

export function quoteViewToken(text: string): string {
  if (text === '' || NEEDS_INNER_QUOTING_RE.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

interface Scanner {
  text: string;
  pos: number;
}

/** Read a quoted token starting at a `"`; returns null on unterminated. */
function readQuoted(scanner: Scanner): string | null {
  let out = '';
  let i = scanner.pos + 1;
  const { text } = scanner;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      scanner.pos = i + 1;
      return out;
    }
    out += ch;
    i++;
  }
  return null;
}

/** Read a bare token up to (not including) any of `stops`. */
function readBare(scanner: Scanner, stops: string): string {
  const { text } = scanner;
  let i = scanner.pos;
  while (i < text.length && !stops.includes(text[i]!)) i++;
  const out = text.slice(scanner.pos, i);
  scanner.pos = i;
  return out.trim();
}

function skipSpaces(scanner: Scanner): void {
  while (scanner.text[scanner.pos] === ' ') scanner.pos++;
}

// ── Parsing ──────────────────────────────────────────────────────────

/** Longest-match-first op table, `*`-modified text ops before their bare forms. */
const FILTER_OP_TOKENS: readonly { token: string; op: FilterOp; caseSensitive: boolean }[] = [
  { token: '>=', op: '>=', caseSensitive: false },
  { token: '<=', op: '<=', caseSensitive: false },
  { token: '!~*', op: '!~', caseSensitive: true },
  { token: '!~', op: '!~', caseSensitive: false },
  { token: '!=*', op: '!=', caseSensitive: true },
  { token: '!=', op: '!=', caseSensitive: false },
  { token: '^~*', op: '^~', caseSensitive: true },
  { token: '^~', op: '^~', caseSensitive: false },
  { token: '$~*', op: '$~', caseSensitive: true },
  { token: '$~', op: '$~', caseSensitive: false },
  { token: '~*', op: '~', caseSensitive: true },
  { token: '~', op: '~', caseSensitive: false },
  { token: '=*', op: '=', caseSensitive: true },
  { token: '=', op: '=', caseSensitive: false },
  { token: '>', op: '>', caseSensitive: false },
  { token: '<', op: '<', caseSensitive: false },
];

function parseSortParam(raw: string): SortTerm[] | null {
  const scanner: Scanner = { text: raw, pos: 0 };
  const terms: SortTerm[] = [];
  for (;;) {
    skipSpaces(scanner);
    const column =
      scanner.text[scanner.pos] === '"' ? readQuoted(scanner) : readBare(scanner, ':,');
    if (column === null || column === '') return null;
    let dir: 'asc' | 'desc' = 'asc';
    skipSpaces(scanner);
    if (scanner.text[scanner.pos] === ':') {
      scanner.pos++;
      skipSpaces(scanner);
      const dirToken = readBare(scanner, ',').toLowerCase();
      if (dirToken !== 'asc' && dirToken !== 'desc') return null;
      dir = dirToken;
    }
    terms.push({ column, dir });
    skipSpaces(scanner);
    if (scanner.pos >= scanner.text.length) return terms;
    if (scanner.text[scanner.pos] !== ',') return null;
    scanner.pos++;
  }
}

function parseFilterParam(raw: string): FilterClause[] | null {
  const scanner: Scanner = { text: raw, pos: 0 };
  const clauses: FilterClause[] = [];
  for (;;) {
    skipSpaces(scanner);
    const column =
      scanner.text[scanner.pos] === '"' ? readQuoted(scanner) : readBare(scanner, '=!<>~^$;');
    if (column === null || column === '') return null;
    skipSpaces(scanner);
    const rest = scanner.text.slice(scanner.pos);
    const match = FILTER_OP_TOKENS.find((candidate) => rest.startsWith(candidate.token));
    if (!match) return null;
    scanner.pos += match.token.length;
    skipSpaces(scanner);
    const value = scanner.text[scanner.pos] === '"' ? readQuoted(scanner) : readBare(scanner, ';');
    if (value === null) return null;
    const clause: FilterClause = { column, op: match.op, value };
    if (match.caseSensitive) clause.caseSensitive = true;
    clauses.push(clause);
    skipSpaces(scanner);
    if (scanner.pos >= scanner.text.length) return clauses;
    if (scanner.text[scanner.pos] !== ';') return null;
    scanner.pos++;
  }
}

/**
 * Parse the raw `sort`/`filter` param values against real headers.
 * Never throws; degradation is per the module contract.
 */
export function parseTableViewState(
  sortRaw: string | undefined,
  filterRaw: string | undefined,
  headers: readonly string[],
): ParsedTableViewState {
  const issues: ViewIssue[] = [];
  const known = new Set(headers);

  let sort: SortTerm[] = [];
  if (sortRaw !== undefined && sortRaw.trim() !== '') {
    const parsed = parseSortParam(sortRaw);
    if (parsed === null) {
      issues.push({ code: 'data-view-invalid', message: `sort "${sortRaw}" could not be parsed` });
    } else {
      sort = parsed.filter((term) => {
        if (known.has(term.column)) return true;
        issues.push({
          code: 'data-view-unknown-column',
          message: `sort column "${term.column}" is not a header`,
        });
        return false;
      });
    }
  }

  let filter: FilterClause[] = [];
  if (filterRaw !== undefined && filterRaw.trim() !== '') {
    const parsed = parseFilterParam(filterRaw);
    if (parsed === null) {
      issues.push({
        code: 'data-view-invalid',
        message: `filter "${filterRaw}" could not be parsed`,
      });
    } else {
      filter = parsed.filter((clause) => {
        if (known.has(clause.column)) return true;
        issues.push({
          code: 'data-view-unknown-column',
          message: `filter column "${clause.column}" is not a header`,
        });
        return false;
      });
    }
  }

  return { view: { sort, filter }, issues };
}

// ── Serialization ────────────────────────────────────────────────────

/** Serialize to `{ sort?, filter? }` raw param values (undefined = omit). */
export function serializeTableViewState(view: TableViewState): {
  sort?: string;
  filter?: string;
} {
  const out: { sort?: string; filter?: string } = {};
  if (view.sort.length > 0) {
    out.sort = view.sort
      .map((term) => `${quoteViewToken(term.column)}${term.dir === 'desc' ? ':desc' : ''}`)
      .join(',');
  }
  if (view.filter.length > 0) {
    out.filter = view.filter
      .map((clause) => {
        const star =
          clause.caseSensitive === true && TEXT_FILTER_OPS.includes(clause.op) ? '*' : '';
        return `${quoteViewToken(clause.column)}${clause.op}${star}${quoteViewToken(clause.value)}`;
      })
      .join(';');
  }
  return out;
}
