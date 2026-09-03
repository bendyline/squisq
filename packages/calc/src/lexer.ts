/**
 * Formula tokenizer. Deliberately small: the parser does the interesting
 * reference/name disambiguation, so the lexer only has to segment text.
 *
 * Notable choices:
 *  - `$` is an identifier character (`$A$1` is ONE token; `parseA1` reads
 *    the absolute flags), as are `.` and `_` (function names like
 *    `CEILING.MATH`, `_xlfn.` prefixes).
 *  - A quoted sheet name (`'Q3 Notes'`) is its own token kind; single
 *    quotes double to escape.
 *  - `[1]` (external-workbook prefix) is one token so the parser can mark
 *    the reference external instead of failing; any other `[` is a plain
 *    punct and parses as unsupported syntax.
 *  - Error literals are matched from the closed Excel list, longest first.
 */

export type TokenKind =
  | 'number'
  | 'string'
  | 'sheet-quoted'
  | 'ident'
  | 'error'
  | 'external'
  | 'op'
  | 'punct'
  | 'end';

export interface Token {
  kind: TokenKind;
  /** Decoded text for string/sheet tokens; raw source text otherwise. */
  text: string;
  pos: number;
}

export class CalcParseError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = 'CalcParseError';
    this.pos = pos;
  }
}

const ERROR_LITERALS = [
  '#DIV/0!',
  '#GETTING_DATA',
  '#NAME?',
  '#NULL!',
  '#NUM!',
  '#REF!',
  '#SPILL!',
  '#VALUE!',
  '#CALC!',
  '#N/A',
];

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isIdentStart = (ch: string): boolean => /[A-Za-z_$\\]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_.$\\]/.test(ch);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (isDigit(ch) || (ch === '.' && i + 1 < n && isDigit(source[i + 1]!))) {
      const start = i;
      while (i < n && (isDigit(source[i]!) || source[i] === '.')) i++;
      if (i < n && (source[i] === 'e' || source[i] === 'E')) {
        let j = i + 1;
        if (j < n && (source[j] === '+' || source[j] === '-')) j++;
        if (j < n && isDigit(source[j]!)) {
          i = j;
          while (i < n && isDigit(source[i]!)) i++;
        }
      }
      tokens.push({ kind: 'number', text: source.slice(start, i), pos: start });
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      let out = '';
      for (;;) {
        if (i >= n) throw new CalcParseError('Unterminated string literal', start);
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            out += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          out += source[i]!;
          i++;
        }
      }
      tokens.push({ kind: 'string', text: out, pos: start });
      continue;
    }

    if (ch === "'") {
      const start = i;
      i++;
      let out = '';
      for (;;) {
        if (i >= n) throw new CalcParseError('Unterminated sheet name', start);
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            out += "'";
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          out += source[i]!;
          i++;
        }
      }
      tokens.push({ kind: 'sheet-quoted', text: out, pos: start });
      continue;
    }

    if (ch === '#') {
      const rest = source.slice(i).toUpperCase();
      const literal = ERROR_LITERALS.find((candidate) => rest.startsWith(candidate));
      if (literal) {
        tokens.push({ kind: 'error', text: literal, pos: i });
        i += literal.length;
        continue;
      }
      throw new CalcParseError(`Unrecognized error literal at "${source.slice(i, i + 8)}"`, i);
    }

    if (ch === '[') {
      const m = /^\[\d+\]/.exec(source.slice(i));
      if (m) {
        tokens.push({ kind: 'external', text: m[0], pos: i });
        i += m[0].length;
        continue;
      }
      tokens.push({ kind: 'punct', text: '[', pos: i });
      i++;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < n && isIdentPart(source[i]!)) i++;
      tokens.push({ kind: 'ident', text: source.slice(start, i), pos: start });
      continue;
    }

    if (ch === '<') {
      if (source[i + 1] === '>' || source[i + 1] === '=') {
        tokens.push({ kind: 'op', text: source.slice(i, i + 2), pos: i });
        i += 2;
      } else {
        tokens.push({ kind: 'op', text: '<', pos: i });
        i++;
      }
      continue;
    }
    if (ch === '>') {
      if (source[i + 1] === '=') {
        tokens.push({ kind: 'op', text: '>=', pos: i });
        i += 2;
      } else {
        tokens.push({ kind: 'op', text: '>', pos: i });
        i++;
      }
      continue;
    }
    if ('=+-*/^&%'.includes(ch)) {
      tokens.push({ kind: 'op', text: ch, pos: i });
      i++;
      continue;
    }
    if ('():,;{}!'.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, pos: i });
      i++;
      continue;
    }

    throw new CalcParseError(`Unexpected character "${ch}"`, i);
  }

  tokens.push({ kind: 'end', text: '', pos: n });
  return tokens;
}
