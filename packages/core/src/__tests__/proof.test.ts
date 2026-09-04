import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PROOF_DIALECTS,
  LINT_KIND_CATEGORIES,
  categorizeLintKind,
  blankProtectedSpans,
  dropMaskedFindings,
  PROOF_JOIN_SEPARATOR,
  buildJoinedText,
  mapJoinedSpanToSegment,
  PROOF_FRONTMATTER_KEYS,
  DEFAULT_PROOF_SETTINGS,
  resolveProofDialect,
  parseProofDictionary,
  formatProofDictionary,
  readProofingSettings,
} from '../proof/index';

describe('lint kind categories', () => {
  it('covers the exact LintKind union of the installed harper.js', () => {
    // The map is the contract between harper's vocabulary and squisq's
    // three squiggle tiers. Parse the union straight out of the installed
    // engine's declarations so a harper upgrade that adds/renames a kind
    // fails here instead of silently falling back to `style`.
    const dts = readFileSync(
      join(__dirname, '../../../../node_modules/harper.js/dist/index.d.ts'),
      'utf8',
    );
    const union = /LintKind = ([^;]+);/.exec(dts)?.[1];
    expect(union).toBeTruthy();
    const kinds = [...(union as string).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThanOrEqual(21);
    expect(Object.keys(LINT_KIND_CATEGORIES).sort()).toEqual([...kinds].sort());
  });

  it.each([
    ['Typo', 'spelling'],
    ['Spelling', 'spelling'],
    ['Agreement', 'grammar'],
    ['Repetition', 'grammar'],
    ['Punctuation', 'grammar'],
    ['Readability', 'style'],
    ['Formatting', 'style'],
  ] as const)('categorizes %s as %s', (kind, category) => {
    expect(categorizeLintKind(kind)).toBe(category);
  });

  it('falls back to style for unknown future kinds', () => {
    expect(categorizeLintKind('SomeFutureKind')).toBe('style');
  });
});

describe('blankProtectedSpans', () => {
  it('replaces annotations with equal-length spaces, preserving every offset', () => {
    const text = '# Gallery {[imageWithCaption src=photo.jpg]}\n\nReal prose here.';
    const { text: blanked, blanked: ranges } = blankProtectedSpans(text);
    expect(blanked.length).toBe(text.length);
    expect(ranges).toEqual([{ start: 10, end: 44 }]);
    expect(blanked.slice(10, 44)).toBe(' '.repeat(34));
    // Untouched regions are byte-identical.
    expect(blanked.slice(0, 10)).toBe(text.slice(0, 10));
    expect(blanked.slice(44)).toBe(text.slice(44));
  });

  it('handles multiple annotations and inline icon tokens', () => {
    const text = 'Icon {[fa-solid:envelope]} and {[audio src=a.webm anchor=document]} end';
    const { text: blanked, blanked: ranges } = blankProtectedSpans(text);
    expect(ranges).toHaveLength(2);
    expect(blanked.length).toBe(text.length);
    expect(blanked.startsWith('Icon ')).toBe(true);
    expect(blanked.endsWith(' end')).toBe(true);
    expect(blanked).not.toContain('fa-solid');
  });

  it('keeps a ] inside a quoted param within the span', () => {
    const text = '{[imageWithCaption alt="a [bracketed] caption"]} tail';
    const { blanked } = blankProtectedSpans(text);
    expect(blanked).toEqual([{ start: 0, end: 48 }]);
  });

  it('never crosses a line boundary', () => {
    const text = '{[unclosed\nnext line]}';
    const { text: blanked, blanked: ranges } = blankProtectedSpans(text);
    expect(ranges).toEqual([]);
    expect(blanked).toBe(text);
  });

  it('preserves offsets around surrogate pairs', () => {
    const text = 'Hi 😀 {[list]} teh';
    const { text: blanked } = blankProtectedSpans(text);
    expect(blanked.length).toBe(text.length);
    expect(blanked.slice(text.length - 3)).toBe('teh');
  });
});

describe('blankProtectedSpans — markdownCode', () => {
  const opts = { markdownCode: true } as const;

  it('leaves code alone unless asked', () => {
    const text = 'call `raycast(dir)` now';
    expect(blankProtectedSpans(text).text).toBe(text);
  });

  it('blanks an inline span, delimiters included, preserving length', () => {
    const text = 'call `raycast(dir)` now';
    const { text: blanked, blanked: ranges } = blankProtectedSpans(text, opts);
    expect(blanked).toBe('call                now');
    expect(blanked).toHaveLength(text.length);
    expect(ranges).toEqual([{ start: 5, end: 19 }]);
  });

  it('blanks a fence, info string and delimiters included, keeping newlines', () => {
    const text = 'a\n```ts\nconst dir = 1;\n```\nb';
    const { text: blanked } = blankProtectedSpans(text, opts);
    expect(blanked).toBe('a\n     \n              \n   \nb');
    expect(blanked).toHaveLength(text.length);
  });

  it('does not treat backticks inside a fence as inline spans', () => {
    const text = '```\na ` b\n```\nthen `code` here';
    const { blanked } = blankProtectedSpans(text, opts);
    expect(blanked).toHaveLength(2);
    expect(text.slice(blanked[1].start, blanked[1].end)).toBe('`code`');
  });

  it('spans a soft line break but not a blank line', () => {
    const wrapped = '`{shape: circle,\nisStatic}` ok';
    expect(blankProtectedSpans(wrapped, opts).text).toBe('                \n           ok');

    const across = 'open ` here\n\nclosed ` there';
    expect(blankProtectedSpans(across, opts).text).toBe(across);
  });

  it('requires a closing run of the same length', () => {
    const text = 'a ``holds a ` tick`` b';
    const { text: blanked } = blankProtectedSpans(text, opts);
    expect(blanked).toBe('a                    b');
  });

  it('runs an unclosed fence to the end of the document', () => {
    const text = 'intro\n```js\nlet a;';
    expect(blankProtectedSpans(text, opts).text).toBe('intro\n     \n      ');
  });

  it('merges an annotation that sits inside a fence', () => {
    const text = '```\n{[dataTable src=a.csv]}\n```';
    const { blanked } = blankProtectedSpans(text, opts);
    expect(blanked).toEqual([{ start: 0, end: text.length }]);
  });

  it('keeps offsets exact across an astral character', () => {
    const text = '\u{1F600} ok `dir`';
    const { text: blanked, blanked: ranges } = blankProtectedSpans(text, opts);
    expect(blanked).toHaveLength(text.length);
    expect(blanked.startsWith('\u{1F600} ok ')).toBe(true);
    // 6, not 7: the emoji is TWO UTF-16 units, and offsets are UTF-16.
    expect(ranges).toEqual([{ start: 6, end: 11 }]);
  });
});

describe('dropMaskedFindings', () => {
  const blanked = [{ start: 10, end: 20 }];
  it('drops findings intersecting a blanked range and keeps abutting ones', () => {
    const findings = [
      { start: 0, end: 5 }, // before — kept
      { start: 8, end: 12 }, // overlaps start — dropped
      { start: 12, end: 18 }, // inside — dropped
      { start: 18, end: 25 }, // overlaps end — dropped
      { start: 20, end: 24 }, // abuts end — kept (half-open ranges)
      { start: 5, end: 10 }, // abuts start — kept
    ];
    expect(dropMaskedFindings(findings, blanked)).toEqual([
      { start: 0, end: 5 },
      { start: 20, end: 24 },
      { start: 5, end: 10 },
    ]);
  });

  it('is a copy when nothing is blanked', () => {
    const findings = [{ start: 1, end: 3 }];
    const kept = dropMaskedFindings(findings, []);
    expect(kept).toEqual(findings);
    expect(kept).not.toBe(findings);
  });
});

describe('joined-segment mapping', () => {
  const segments = ['Revenue Highlights', 'Its a strong quarter.', 'reduced motion'];
  const joined = buildJoinedText(segments);

  it('joins with the separator and records starts/lengths', () => {
    expect(joined.text).toBe(segments.join(PROOF_JOIN_SEPARATOR));
    expect(joined.starts).toEqual([0, 20, 43]);
    expect(joined.lengths).toEqual([18, 21, 14]);
  });

  it('maps spans back to segment-local coordinates', () => {
    // "Its" starts at joined offset 20.
    expect(mapJoinedSpanToSegment(joined, 20, 23)).toEqual({
      segmentIndex: 1,
      start: 0,
      end: 3,
    });
    // Last word of the last segment.
    const motion = joined.text.indexOf('motion');
    expect(mapJoinedSpanToSegment(joined, motion, motion + 6)).toEqual({
      segmentIndex: 2,
      start: 8,
      end: 14,
    });
  });

  it('round-trips every word of every segment', () => {
    segments.forEach((segment, index) => {
      for (const match of segment.matchAll(/\S+/g)) {
        const start = joined.starts[index] + (match.index as number);
        const mapped = mapJoinedSpanToSegment(joined, start, start + match[0].length);
        expect(mapped).toEqual({
          segmentIndex: index,
          start: match.index,
          end: (match.index as number) + match[0].length,
        });
        expect(segment.slice(mapped!.start, mapped!.end)).toBe(match[0]);
      }
    });
  });

  it('rejects spans that touch separators, cross segments, or are empty', () => {
    // Span covering the first separator.
    expect(mapJoinedSpanToSegment(joined, 18, 20)).toBeNull();
    // Span starting in segment 0 and ending in segment 1.
    expect(mapJoinedSpanToSegment(joined, 10, 25)).toBeNull();
    // Empty span.
    expect(mapJoinedSpanToSegment(joined, 5, 5)).toBeNull();
    // Past the end.
    expect(mapJoinedSpanToSegment(joined, joined.text.length, joined.text.length + 2)).toBeNull();
  });

  it('handles a single segment and an empty list', () => {
    const single = buildJoinedText(['one two']);
    expect(mapJoinedSpanToSegment(single, 4, 7)).toEqual({ segmentIndex: 0, start: 4, end: 7 });
    const empty = buildJoinedText([]);
    expect(empty.text).toBe('');
    expect(mapJoinedSpanToSegment(empty, 0, 1)).toBeNull();
  });
});

describe('proofing frontmatter settings', () => {
  it('reads canonical keys with boolean/dialect tolerance', () => {
    expect(
      readProofingSettings({
        'squisq-proofing': 'off',
        'squisq-proof-dialect': 'british',
        'squisq-proof-dictionary': 'Squisq, gezellig Noord',
      }),
    ).toEqual({
      enabled: false,
      dialect: 'British',
      dictionary: ['Squisq', 'gezellig', 'Noord'],
    });
  });

  it('falls back to legacy bare keys and yields defaults-shaped emptiness', () => {
    expect(readProofingSettings({ proofing: true })).toEqual({
      enabled: true,
      dialect: undefined,
      dictionary: [],
    });
    expect(readProofingSettings(undefined).dictionary).toEqual([]);
  });

  it('exposes defaults and the dialect list', () => {
    expect(DEFAULT_PROOF_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_PROOF_SETTINGS.dialect).toBe('American');
    expect(PROOF_DIALECTS).toContain('Canadian');
    expect(resolveProofDialect(' AUSTRALIAN ')).toBe('Australian');
    expect(resolveProofDialect('klingon')).toBeUndefined();
  });

  it('dictionary codec round-trips and removes the key when empty', () => {
    expect(formatProofDictionary(['b', 'a', 'b', ' '])).toBe('b, a');
    expect(formatProofDictionary([])).toBeNull();
    expect(parseProofDictionary(['x, y', 'z'])).toEqual(['x', 'y', 'z']);
    expect(parseProofDictionary(42)).toEqual([]);
  });

  it('has no key for ignored findings — they never touch the document', () => {
    // Dismissals are one person's editing preference; persisting them in
    // the file would push them to everyone through git. The editor hands
    // that state to the host instead (ProofingIgnoreStore).
    expect(Object.keys(PROOF_FRONTMATTER_KEYS)).toEqual(['enabled', 'dialect', 'dictionary']);
    const settings = readProofingSettings({ 'squisq-proof-ignored': '{"context_hashes":[1]}' });
    expect(settings).toEqual({ enabled: undefined, dialect: undefined, dictionary: [] });
  });
});
