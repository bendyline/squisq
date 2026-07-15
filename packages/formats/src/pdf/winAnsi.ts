/**
 * WinAnsi text safety for PDF export.
 *
 * PDF export embeds only the 14 standard PDF fonts, which pdf-lib encodes with
 * WinAnsi (CP1252). `drawText` / `widthOfTextAtSize` THROW on any code point
 * outside that repertoire — so a single emoji, CJK glyph, Cyrillic letter or
 * even a literal tab anywhere in the document failed the entire conversion.
 *
 * This module makes the text boundary total: unsupported characters are
 * transliterated where a sensible ASCII rendering exists, and replaced with a
 * deterministic `?` otherwise, so export SUCCEEDS with degraded text. Callers
 * are told once that substitution happened.
 *
 * Scope note: characters WinAnsi *can* encode are passed through untouched.
 * Empirically (see `winAnsi.test.ts`, which asserts the predicate against
 * pdf-lib itself) that includes smart quotes, en/em dashes, the ellipsis,
 * bullets, NBSP, `€`, `™` and every Latin-1 accented letter — pdf-lib renders
 * those correctly today, so "helpfully" downgrading them to ASCII would be a
 * fidelity regression, not a fix.
 *
 * Every table below is keyed by NUMERIC code point on purpose: a literal
 * zero-width space or NBSP in source is unreviewable and does not survive
 * routine editing.
 */

/**
 * The CP1252 0x80–0x9F block, which maps to Unicode code points well outside
 * Latin-1. These are the non-obvious members of the WinAnsi repertoire.
 */
const CP1252_HIGH_SPECIALS: ReadonlySet<number> = new Set([
  0x20ac, // euro sign
  0x201a, // single low-9 quotation mark
  0x0192, // latin small letter f with hook
  0x201e, // double low-9 quotation mark
  0x2026, // horizontal ellipsis
  0x2020, // dagger
  0x2021, // double dagger
  0x02c6, // modifier letter circumflex accent
  0x2030, // per mille sign
  0x0160, // latin capital letter S with caron
  0x2039, // single left-pointing angle quotation mark
  0x0152, // latin capital ligature OE
  0x017d, // latin capital letter Z with caron
  0x2018, // left single quotation mark
  0x2019, // right single quotation mark
  0x201c, // left double quotation mark
  0x201d, // right double quotation mark
  0x2022, // bullet
  0x2013, // en dash
  0x2014, // em dash
  0x02dc, // small tilde
  0x2122, // trade mark sign
  0x0161, // latin small letter s with caron
  0x203a, // single right-pointing angle quotation mark
  0x0153, // latin small ligature oe
  0x017e, // latin small letter z with caron
  0x0178, // latin capital letter Y with diaeresis
]);

/** Whether pdf-lib's WinAnsi encoding can represent `codePoint`. */
export function isWinAnsiEncodable(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true; // ASCII printable
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true; // Latin-1 supplement
  return CP1252_HIGH_SPECIALS.has(codePoint);
}

/** Deterministic stand-in for a character with no sensible transliteration. */
export const WINANSI_REPLACEMENT = '?';

/**
 * Transliterations for characters WinAnsi cannot encode, as
 * `[codePoint, replacement]`. Consulted ONLY after `isWinAnsiEncodable` says
 * no, so nothing here can degrade text that already renders correctly.
 */
const TRANSLITERATIONS: ReadonlyMap<number, string> = new Map([
  // ── Whitespace & invisibles ──
  // A tab keeps its visual width (code fences are the common case); every
  // other control/format character collapses to a space or disappears.
  [0x0009, '    '], // tab
  [0x000a, ' '], // line feed
  [0x000b, ' '], // vertical tab
  [0x000c, ' '], // form feed
  [0x000d, ' '], // carriage return
  [0x0085, ' '], // next line
  [0x2028, ' '], // line separator
  [0x2029, ' '], // paragraph separator
  [0x2000, ' '], // en quad
  [0x2001, ' '], // em quad
  [0x2002, ' '], // en space
  [0x2003, ' '], // em space
  [0x2004, ' '], // three-per-em space
  [0x2005, ' '], // four-per-em space
  [0x2006, ' '], // six-per-em space
  [0x2007, ' '], // figure space
  [0x2008, ' '], // punctuation space
  [0x2009, ' '], // thin space
  [0x200a, ' '], // hair space
  [0x202f, ' '], // narrow no-break space
  [0x205f, ' '], // medium mathematical space
  [0x3000, ' '], // ideographic space
  [0x200b, ''], // zero-width space
  [0x200c, ''], // zero-width non-joiner
  [0x200d, ''], // zero-width joiner
  [0x2060, ''], // word joiner
  [0xfeff, ''], // zero-width no-break space / BOM

  // ── Dashes & hyphens (en/em dash ARE encodable and stay verbatim) ──
  [0x2010, '-'], // hyphen
  [0x2011, '-'], // non-breaking hyphen
  [0x2012, '-'], // figure dash
  [0x2015, '--'], // horizontal bar
  [0x2212, '-'], // minus sign

  // ── Quotes & primes (curly quotes ARE encodable and stay verbatim) ──
  [0x2032, "'"], // prime
  [0x2033, '"'], // double prime
  [0x2035, "'"], // reversed prime
  [0x2036, '"'], // reversed double prime

  // ── Arrows ──
  [0x2190, '<-'], // leftwards arrow
  [0x2191, '^'], // upwards arrow
  [0x2192, '->'], // rightwards arrow
  [0x2193, 'v'], // downwards arrow
  [0x2194, '<->'], // left right arrow
  [0x21d0, '<='], // leftwards double arrow
  [0x21d2, '=>'], // rightwards double arrow
  [0x21d4, '<=>'], // left right double arrow

  // ── Math & comparison ──
  [0x2260, '!='], // not equal to
  [0x2264, '<='], // less-than or equal to
  [0x2265, '>='], // greater-than or equal to
  [0x2248, '~='], // almost equal to
  [0x2261, '=='], // identical to
  [0x221e, 'inf'], // infinity
  [0x221a, 'sqrt'], // square root
  [0x2211, 'sum'], // n-ary summation
  [0x220f, 'prod'], // n-ary product
  [0x2044, '/'], // fraction slash

  // ── Bullets & marks (U+2022 bullet IS encodable) ──
  [0x2023, '*'], // triangular bullet
  [0x2043, '-'], // hyphen bullet
  [0x2219, '*'], // bullet operator
  [0x25aa, '*'], // black small square
  [0x25ab, '*'], // white small square
  [0x25cb, 'o'], // white circle
  [0x25cf, '*'], // black circle
  [0x25e6, 'o'], // white bullet
  [0x2713, 'v'], // check mark
  [0x2714, 'v'], // heavy check mark
  [0x2717, 'x'], // ballot x
  [0x2718, 'x'], // heavy ballot x

  // ── Ellipsis variants (U+2026 itself IS encodable) ──
  [0x2025, '..'], // two dot leader
  [0x22ef, '...'], // midline horizontal ellipsis

  // ── Ligatures ──
  [0xfb00, 'ff'],
  [0xfb01, 'fi'],
  [0xfb02, 'fl'],
  [0xfb03, 'ffi'],
  [0xfb04, 'ffl'],
]);

/**
 * Code points whose substitution is layout-only, never information loss — a
 * tab in a code fence must not trip the "characters were substituted" warning.
 */
const WHITESPACE_LIKE: ReadonlySet<number> = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0085, 0x2028, 0x2029, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x200b, 0x200c,
  0x200d, 0x2060, 0xfeff,
]);

const MAX_SAMPLES = 5;

/** Pure ASCII needs no work at all — the overwhelmingly common case. */
const ASCII_ONLY = /^[\x20-\x7e]*$/;

/** Unicode combining marks (U+0300–U+036F), dropped by `stripDiacritics`. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Last-resort degradation for letters outside WinAnsi: decompose and drop the
 * combining marks, so `ā` → `a` and `№` → `No` instead of `?`. Returns
 * undefined when the result still isn't encodable (e.g. `ł`, `中`).
 */
function stripDiacritics(ch: string): string | undefined {
  const decomposed = ch.normalize('NFKD').replace(COMBINING_MARKS, '');
  if (!decomposed) return undefined;
  for (const c of decomposed) {
    if (!isWinAnsiEncodable(c.codePointAt(0)!)) return undefined;
  }
  return decomposed;
}

export interface WinAnsiSanitizeResult {
  /** Text guaranteed safe to hand to pdf-lib for drawing AND measuring. */
  text: string;
  /** Count of substituted characters, excluding whitespace normalization. */
  substitutions: number;
  /** Up to five distinct `"x" -> "y"` examples, for a human-readable warning. */
  samples: string[];
}

/**
 * Make `input` safe for the standard-14 PDF fonts.
 *
 * Normalizes to NFC first: decomposed text (`e` + U+0301) composes into a
 * precomposed Latin-1 character WinAnsi *can* encode, so `é` survives instead
 * of degrading to `e?`.
 */
export function sanitizeWinAnsi(input: string): WinAnsiSanitizeResult {
  if (ASCII_ONLY.test(input)) return { text: input, substitutions: 0, samples: [] };

  const text = input.normalize('NFC');
  let out = '';
  let substitutions = 0;
  const samples: string[] = [];

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isWinAnsiEncodable(cp)) {
      out += ch;
      continue;
    }

    const mapped = TRANSLITERATIONS.get(cp) ?? stripDiacritics(ch) ?? WINANSI_REPLACEMENT;
    out += mapped;

    if (WHITESPACE_LIKE.has(cp)) continue;
    substitutions++;
    const sample = `"${ch}" -> "${mapped}"`;
    if (samples.length < MAX_SAMPLES && !samples.includes(sample)) samples.push(sample);
  }

  return { text: out, substitutions, samples };
}

/**
 * Per-export accumulator: sanitizes every string on its way to pdf-lib and
 * remembers enough to raise a single summary warning at the end.
 */
export class WinAnsiTracker {
  private count = 0;
  private readonly samples: string[] = [];

  /** Sanitize `text` for pdf-lib and record any substitutions. */
  clean(text: string): string {
    const result = sanitizeWinAnsi(text);
    this.count += result.substitutions;
    for (const sample of result.samples) {
      if (this.samples.length >= MAX_SAMPLES) break;
      if (!this.samples.includes(sample)) this.samples.push(sample);
    }
    return result.text;
  }

  /** Total substituted characters across the export. */
  get substitutions(): number {
    return this.count;
  }

  /** One-shot summary for the export, or undefined when nothing was lost. */
  warning(): string | undefined {
    if (this.count === 0) return undefined;
    return (
      `PDF export replaced ${this.count} character(s) that the standard PDF fonts ` +
      `cannot encode (${this.samples.join(', ')}). ` +
      `Scripts such as emoji, CJK and Cyrillic require an embedded Unicode font.`
    );
  }
}
