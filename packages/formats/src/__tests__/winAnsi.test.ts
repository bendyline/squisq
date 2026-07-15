/**
 * Tests for the PDF export WinAnsi safety pass.
 *
 * The load-bearing test here is `isWinAnsiEncodable` vs pdf-lib: a FALSE
 * POSITIVE (we claim encodable, pdf-lib throws) reintroduces the original
 * whole-export failure, so the predicate is asserted against the real encoder
 * across the entire BMP rather than trusted from a hand-written table.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

import {
  isWinAnsiEncodable,
  sanitizeWinAnsi,
  WinAnsiTracker,
  WINANSI_REPLACEMENT,
} from '../pdf/winAnsi';

async function helvetica(): Promise<PDFFont> {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

/** What pdf-lib actually does with a single character. */
function pdfLibAccepts(font: PDFFont, ch: string): boolean {
  try {
    font.widthOfTextAtSize(ch, 12);
    return true;
  } catch {
    return false;
  }
}

describe('isWinAnsiEncodable', () => {
  it('agrees with pdf-lib across the entire BMP', async () => {
    const font = await helvetica();
    const disagreements: string[] = [];

    for (let cp = 0; cp <= 0xffff; cp++) {
      // Surrogates are not standalone characters; String.fromCodePoint would
      // produce a lone surrogate that means nothing to either side.
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const ours = isWinAnsiEncodable(cp);
      const theirs = pdfLibAccepts(font, ch);
      if (ours !== theirs) {
        disagreements.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')} ours=${ours}`);
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('accepts ASCII, Latin-1 and the CP1252 specials', () => {
    for (const ch of ['A', 'z', '0', ' ', '~', 'é', 'ü', 'ñ', '€', '™', '•', '–', '—', '…']) {
      expect(isWinAnsiEncodable(ch.codePointAt(0)!), ch).toBe(true);
    }
  });

  it('rejects the scripts and symbols that broke export', () => {
    for (const ch of ['\u{1F600}', '中', 'Ж', '→', '\t', '\n', '​', '−', '′']) {
      expect(isWinAnsiEncodable(ch.codePointAt(0)!), JSON.stringify(ch)).toBe(false);
    }
  });
});

describe('sanitizeWinAnsi', () => {
  it('passes through characters WinAnsi can already encode', () => {
    // Deliberate scope decision: smart quotes, en/em dashes, the ellipsis and
    // Latin-1 accents render correctly through pdf-lib today, so downgrading
    // them to ASCII would be a fidelity regression rather than a fix.
    const input = '“Smart” ‘quotes’ – en — em… café €5 • bullet™';
    const result = sanitizeWinAnsi(input);
    expect(result.text).toBe(input);
    expect(result.substitutions).toBe(0);
  });

  it('leaves pure ASCII untouched', () => {
    const result = sanitizeWinAnsi('Plain ASCII text 123.');
    expect(result.text).toBe('Plain ASCII text 123.');
    expect(result.substitutions).toBe(0);
  });

  it('transliterates arrows', () => {
    expect(sanitizeWinAnsi('a → b').text).toBe('a -> b');
    expect(sanitizeWinAnsi('a ← b').text).toBe('a <- b');
    expect(sanitizeWinAnsi('a ↔ b').text).toBe('a <-> b');
    expect(sanitizeWinAnsi('a ⇒ b').text).toBe('a => b');
    expect(sanitizeWinAnsi('a ⇔ b').text).toBe('a <=> b');
    expect(sanitizeWinAnsi('up ↑ down ↓').text).toBe('up ^ down v');
  });

  it('transliterates dashes, hyphens and primes that WinAnsi lacks', () => {
    expect(sanitizeWinAnsi('non‑breaking').text).toBe('non-breaking');
    expect(sanitizeWinAnsi('‐ ‒ ― −').text).toBe('- - -- -');
    expect(sanitizeWinAnsi('5′ 10″').text).toBe(`5' 10"`);
  });

  it('transliterates comparison and math symbols', () => {
    expect(sanitizeWinAnsi('a ≠ b').text).toBe('a != b');
    expect(sanitizeWinAnsi('a ≤ b ≥ c').text).toBe('a <= b >= c');
    expect(sanitizeWinAnsi('a ≈ b').text).toBe('a ~= b');
    expect(sanitizeWinAnsi('∞').text).toBe('inf');
    expect(sanitizeWinAnsi('√2').text).toBe('sqrt2');
  });

  it('expands tabs and collapses exotic spaces without reporting data loss', () => {
    expect(sanitizeWinAnsi('a\tb').text).toBe('a    b');
    expect(sanitizeWinAnsi('a b　c').text).toBe('a b c');
    // Zero-width characters disappear entirely.
    expect(sanitizeWinAnsi('a​b﻿c').text).toBe('abc');
    // Whitespace normalization is layout-only — it must not raise a warning.
    expect(sanitizeWinAnsi('a\tb​c').substitutions).toBe(0);
  });

  it('maps a newline inside author text to a space', () => {
    // wrapSpans only treats a span whose *entire* text is "\n" as a break;
    // an embedded newline used to reach drawText and throw.
    expect(sanitizeWinAnsi('line\nbreak').text).toBe('line break');
  });

  it('replaces emoji, CJK and Cyrillic with a deterministic fallback', () => {
    expect(sanitizeWinAnsi('hi \u{1F600}').text).toBe(`hi ${WINANSI_REPLACEMENT}`);
    expect(sanitizeWinAnsi('中文').text).toBe(WINANSI_REPLACEMENT.repeat(2));
    expect(sanitizeWinAnsi('Ж').text).toBe(WINANSI_REPLACEMENT);
    expect(sanitizeWinAnsi('\u{1F600}').substitutions).toBe(1);
  });

  it('treats an astral emoji as one character, not two surrogate halves', () => {
    const result = sanitizeWinAnsi('\u{1F600}');
    expect(result.text).toBe('?');
    expect(result.substitutions).toBe(1);
  });

  it('composes decomposed accents instead of degrading them', () => {
    // "e" + combining acute → "é", which WinAnsi CAN encode.
    const result = sanitizeWinAnsi('café');
    expect(result.text).toBe('café');
    expect(result.substitutions).toBe(0);
  });

  it('strips diacritics from letters outside WinAnsi rather than dropping them', () => {
    expect(sanitizeWinAnsi('ā').text).toBe('a'); // ā
    expect(sanitizeWinAnsi('ő').text).toBe('o'); // ő
    expect(sanitizeWinAnsi('№').text).toBe('No'); // №
  });

  it('reports distinct samples, capped', () => {
    const result = sanitizeWinAnsi('→→→\u{1F600}');
    // The repeated arrow is counted three times but sampled once.
    expect(result.substitutions).toBe(4);
    expect(result.samples).toEqual(['"→" -> "->"', '"\u{1F600}" -> "?"']);
  });

  it('produces text pdf-lib can actually measure and encode', async () => {
    const font = await helvetica();
    const nasty = 'Emoji \u{1F600} CJK 中文 Cyrillic Ж arrow → tab\there\nnewline ​';
    const { text } = sanitizeWinAnsi(nasty);
    expect(() => font.widthOfTextAtSize(text, 12)).not.toThrow();
    expect(() => font.encodeText(text)).not.toThrow();
  });
});

describe('WinAnsiTracker', () => {
  it('stays silent when nothing was substituted', () => {
    const tracker = new WinAnsiTracker();
    expect(tracker.clean('plain text')).toBe('plain text');
    expect(tracker.clean('café — “quoted”')).toBe('café — “quoted”');
    expect(tracker.substitutions).toBe(0);
    expect(tracker.warning()).toBeUndefined();
  });

  it('accumulates across calls and summarises once', () => {
    const tracker = new WinAnsiTracker();
    tracker.clean('\u{1F600}');
    tracker.clean('中');
    tracker.clean('→');
    expect(tracker.substitutions).toBe(3);

    const warning = tracker.warning();
    expect(warning).toContain('3 character(s)');
    expect(warning).toContain('"→" -> "->"');
    expect(warning).toContain('embedded Unicode font');
  });
});
