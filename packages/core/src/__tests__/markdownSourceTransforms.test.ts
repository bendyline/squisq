import { describe, it, expect } from 'vitest';
import {
  MARKDOWN_SOURCE_TRANSFORMS,
  DEFAULT_WRAP_WIDTH,
  applyMarkdownSourceTransform,
  unwrapMarkdownSource,
  wrapMarkdownSource,
  cleanupMarkdownSource,
  detectMarkdownWrapState,
  parseMarkdown,
} from '../markdown/index';

const STRICT = { strict: true };

describe('markdown source transforms — registry', () => {
  it('registers exactly unwrap, wrap, cleanup with labels and descriptions', () => {
    expect(MARKDOWN_SOURCE_TRANSFORMS.map((t) => t.id)).toEqual(['unwrap', 'wrap', 'cleanup']);
    for (const t of MARKDOWN_SOURCE_TRANSFORMS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('dispatches by id and rejects unknown ids', () => {
    const result = applyMarkdownSourceTransform('unwrap', 'a\nb\n', STRICT);
    expect(result.output).toBe('a b\n');
    expect(() => applyMarkdownSourceTransform('nope', 'x', STRICT)).toThrow(
      /Unknown markdown source transform/,
    );
  });

  it('exposes the default wrap width', () => {
    expect(DEFAULT_WRAP_WIDTH).toBe(80);
  });
});

describe('unwrapMarkdownSource', () => {
  it('joins a simple wrapped paragraph', () => {
    expect(unwrapMarkdownSource('Hello\nworld.\n', STRICT)).toBe('Hello world.\n');
  });

  it('leaves single-line paragraphs byte-identical', () => {
    const src = 'Just one line.\n\nAnother one.\n';
    const result = applyMarkdownSourceTransform('unwrap', src, STRICT);
    expect(result.output).toBe(src);
    expect(result.changed).toBe(false);
    expect(result.degraded).toBe(false);
  });

  it('strips a trailing single space at a soft join (no fabricated double space)', () => {
    expect(unwrapMarkdownSource('foo \nbar\n', STRICT)).toBe('foo bar\n');
  });

  it('joins blockquote paragraphs keeping the quote marker', () => {
    expect(unwrapMarkdownSource('> foo\n> bar\n', STRICT)).toBe('> foo bar\n');
  });

  it('joins lazy continuation lines', () => {
    expect(unwrapMarkdownSource('> quote\ncontinues\n', STRICT)).toBe('> quote continues\n');
  });

  it('joins list-item continuations', () => {
    expect(unwrapMarkdownSource('- item one\n  continues\n', STRICT)).toBe(
      '- item one continues\n',
    );
  });

  it('joins nested quote+list continuations', () => {
    expect(unwrapMarkdownSource('> - foo\n>   bar\n', STRICT)).toBe('> - foo bar\n');
  });

  it('joins task-item continuations', () => {
    expect(unwrapMarkdownSource('- [x] done item\n  more text\n', STRICT)).toBe(
      '- [x] done item more text\n',
    );
  });

  it('joins footnote-definition paragraphs', () => {
    expect(unwrapMarkdownSource('[^1]: first line\n    second line\n', STRICT)).toBe(
      '[^1]: first line second line\n',
    );
  });

  it('joins paragraphs inside container directives', () => {
    expect(unwrapMarkdownSource(':::note\nsome wrapped\ntext here\n:::\n', STRICT)).toBe(
      ':::note\nsome wrapped text here\n:::\n',
    );
  });

  it('preserves two-space hard breaks', () => {
    const src = 'line one  \nline two\n';
    expect(unwrapMarkdownSource(src, STRICT)).toBe(src);
  });

  it('preserves backslash hard breaks', () => {
    const src = 'alpha\\\nbeta\n';
    expect(unwrapMarkdownSource(src, STRICT)).toBe(src);
  });

  it('joins soft breaks around a preserved hard break', () => {
    expect(unwrapMarkdownSource('word a\nword b  \nword c\nword d\n', STRICT)).toBe(
      'word a word b  \nword c word d\n',
    );
  });

  it('preserves hard breaks inside blockquotes with the quote prefix', () => {
    expect(unwrapMarkdownSource('> a b\n> c  \n> d\n', STRICT)).toBe('> a b c  \n> d\n');
  });

  it('does not join inside a multi-line inline code span', () => {
    const src = '`a\nb` more\n';
    expect(unwrapMarkdownSource(src, STRICT)).toBe(src);
  });

  it('does not join inside a multi-line link title', () => {
    expect(unwrapMarkdownSource('[t](u "a\nb")\nnext\n', STRICT)).toBe('[t](u "a\nb") next\n');
  });

  it('joins across emphasis spanning a soft break', () => {
    expect(unwrapMarkdownSource('**strong\ntext** here\n', STRICT)).toBe('**strong text** here\n');
  });

  it('handles CRLF documents', () => {
    expect(unwrapMarkdownSource('a b c\r\nd e\r\n', STRICT)).toBe('a b c d e\r\n');
  });

  it('is idempotent', () => {
    const src = 'one two\nthree four\n\n> five\n> six\n';
    const once = unwrapMarkdownSource(src, STRICT);
    expect(unwrapMarkdownSource(once, STRICT)).toBe(once);
  });

  it('leaves headings, tables, code fences, math, and frontmatter byte-identical', () => {
    const src = [
      '---',
      'title: Test',
      '---',
      '',
      '# Heading {[quote]}',
      '',
      'wrapped body\ntext here',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```diagram',
      'raw\nfence lines',
      '```',
      '',
      '$$',
      'x = 1\ny = 2',
      '$$',
      '',
    ].join('\n');
    const expected = src.replace('wrapped body\ntext here', 'wrapped body text here');
    expect(unwrapMarkdownSource(src, STRICT)).toBe(expected);
  });
});

describe('wrapMarkdownSource', () => {
  it('wraps at the requested width on word boundaries', () => {
    expect(
      wrapMarkdownSource('one two three four five six seven eight\n', { width: 20, strict: true }),
    ).toBe('one two three four\nfive six seven eight\n');
  });

  it('defaults to width 80', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const out = wrapMarkdownSource(`${words}\n`, STRICT);
    const lines = out.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('wraps list items with continuation indent', () => {
    expect(
      wrapMarkdownSource('- alpha beta gamma delta epsilon\n', { width: 20, strict: true }),
    ).toBe('- alpha beta gamma\n  delta epsilon\n');
  });

  it('wraps blockquote paragraphs with the quote prefix', () => {
    expect(wrapMarkdownSource('> alpha beta gamma delta\n', { width: 20, strict: true })).toBe(
      '> alpha beta gamma\n> delta\n',
    );
  });

  it('never starts a continuation line with an ordered-list marker', () => {
    const out = wrapMarkdownSource('sentence about thing 2. next words here\n', {
      width: 20,
      strict: true,
    });
    expect(out).toBe('sentence about thing 2.\nnext words here\n');
    for (const line of out.trimEnd().split('\n')) {
      expect(line).not.toMatch(/^\d+[.)](?:\s|$)/);
    }
  });

  it('never starts a continuation line with a bullet marker', () => {
    const out = wrapMarkdownSource('aaaa bbbb cccc dddd - eeee\n', { width: 20, strict: true });
    expect(out).toBe('aaaa bbbb cccc dddd -\neeee\n');
  });

  it('keeps oversize tokens (URLs) unbroken on their own line', () => {
    const url = 'https://example.com/a/very/long/path/that/exceeds';
    const out = wrapMarkdownSource(`see ${url} width\n`, { width: 20, strict: true });
    expect(out).toBe(`see\n${url}\nwidth\n`);
  });

  it('never breaks inside a {[…]} annotation span', () => {
    const out = wrapMarkdownSource('before {[audio src=a.mp3 anchor=document]} after\n', {
      width: 20,
      strict: true,
    });
    expect(out).toContain('{[audio src=a.mp3 anchor=document]}');
  });

  it('never breaks inside inline code with spaces', () => {
    const out = wrapMarkdownSource('call `fn(a, b)` and then some more words\n', {
      width: 16,
      strict: true,
    });
    expect(out).toContain('`fn(a, b)`');
    for (const line of out.trimEnd().split('\n')) {
      expect(line.length).toBeLessThanOrEqual('`fn(a, b)`'.length + 16);
    }
  });

  it('never breaks a mention display name', () => {
    const out = wrapMarkdownSource('hi @[John Smith](person:1) ok then more words\n', {
      width: 10,
      strict: true,
    });
    expect(out).toContain('@[John Smith](person:1)');
  });

  it('never breaks inside a link resource segment', () => {
    const out = wrapMarkdownSource('read [some linked words here](https://e.co "my title") now\n', {
      width: 16,
      strict: true,
    });
    expect(out).toContain('(https://e.co "my title")');
  });

  it('does not fabricate a hard break after a backslash-ending token', () => {
    const out = wrapMarkdownSource('path C:\\temp\\ and more words following\n', {
      width: 14,
      strict: true,
    });
    // No line may end with a backslash (that would parse as a hard break).
    for (const line of out.trimEnd().split('\n')) {
      expect(line.endsWith('\\')).toBe(false);
    }
  });

  it('preserves hard breaks as segment boundaries', () => {
    const out = wrapMarkdownSource('aaaa bbbb cccc dddd eeee  \nffff gggg hhhh iiii jjjj\n', {
      width: 20,
      strict: true,
    });
    expect(out).toBe('aaaa bbbb cccc dddd\neeee  \nffff gggg hhhh iiii\njjjj\n');
  });

  it('uses CRLF for inserted newlines in CRLF documents', () => {
    expect(
      wrapMarkdownSource('aaaa bbbb cccc dddd eeee ffff\r\n', { width: 20, strict: true }),
    ).toBe('aaaa bbbb cccc dddd\r\neeee ffff\r\n');
  });

  it('is idempotent at the same width', () => {
    const src =
      'one two three four five six seven eight nine ten eleven twelve\n\n- alpha beta gamma delta\n';
    const once = wrapMarkdownSource(src, { width: 20, strict: true });
    expect(wrapMarkdownSource(once, { width: 20, strict: true })).toBe(once);
  });

  it('unwrap of wrap returns the unwrapped form', () => {
    const src = 'one two three four five six seven eight nine ten\n';
    const wrapped = wrapMarkdownSource(src, { width: 12, strict: true });
    expect(unwrapMarkdownSource(wrapped, STRICT)).toBe(src);
  });

  it('leaves code fences and tables byte-identical', () => {
    const src =
      '```\nsome very long code line that exceeds every width limit set here\n```\n\n| col one | col two |\n| ------- | ------- |\n| a very long cell | another long cell |\n';
    const result = applyMarkdownSourceTransform('wrap', src, { width: 20, strict: true });
    expect(result.output).toBe(src);
    expect(result.changed).toBe(false);
  });

  it('clamps degenerate widths', () => {
    const out = wrapMarkdownSource('aa bb cc dd ee ff gg hh\n', { width: 1, strict: true });
    // Clamped to the 20-column minimum, not one word per line.
    expect(out).toBe('aa bb cc dd ee ff gg\nhh\n');
  });

  it('reports minimal per-paragraph edits that reproduce the output', () => {
    const src =
      '# Title\n\nfirst paragraph with several words to wrap here\n\nsecond paragraph also has words to wrap around\n';
    const result = applyMarkdownSourceTransform('wrap', src, { width: 20, strict: true });
    expect(result.changed).toBe(true);
    expect(result.edits.length).toBe(2);
    // Descending start order.
    expect(result.edits[0].start).toBeGreaterThan(result.edits[1].start);
    let patched = src;
    for (const edit of result.edits) {
      patched = patched.slice(0, edit.start) + edit.text + patched.slice(edit.end);
    }
    expect(patched).toBe(result.output);
  });
});

describe('cleanupMarkdownSource', () => {
  it('normalizes bullets and emphasis to the house style', () => {
    expect(cleanupMarkdownSource('* item one\n* item two\n', STRICT)).toBe(
      '- item one\n- item two\n',
    );
    expect(cleanupMarkdownSource('__strong__ and _em_\n', STRICT)).toBe('**strong** and *em*\n');
  });

  it('preserves heading template annotations', () => {
    const src = '## A Quote {[quote]}\n\nBody text.\n';
    expect(cleanupMarkdownSource(src, STRICT)).toBe(src);
  });

  it('preserves frontmatter bytes verbatim, including comments', () => {
    const src = '---\n# a comment\ntitle: Test\n---\n\n* item\n';
    expect(cleanupMarkdownSource(src, STRICT)).toBe(
      '---\n# a comment\ntitle: Test\n---\n\n- item\n',
    );
  });

  it('does not eat a body that begins with a thematic break', () => {
    const src = '---\na: 1\n---\n\n---\n\nAfter\n';
    expect(cleanupMarkdownSource(src, STRICT)).toBe(src);
  });

  it('handles documents without frontmatter', () => {
    expect(cleanupMarkdownSource('Hello **world**\n', STRICT)).toBe('Hello **world**\n');
  });

  it('normalizes CRLF documents to LF', () => {
    const result = applyMarkdownSourceTransform('cleanup', 'a\r\n\r\nb\r\n', STRICT);
    expect(result.output).toBe('a\n\nb\n');
    expect(result.changed).toBe(true);
  });

  it('collapses excess blank lines', () => {
    expect(cleanupMarkdownSource('one\n\n\n\ntwo\n', STRICT)).toBe('one\n\ntwo\n');
  });

  it('is idempotent', () => {
    const src = '# H\n\n* a\n* b\n\n| x | y |\n|--|--|\n| 1 | 2 |\n';
    const once = cleanupMarkdownSource(src, STRICT);
    expect(cleanupMarkdownSource(once, STRICT)).toBe(once);
  });
});

describe('safety net', () => {
  const CORPUS = [
    'plain text\nwith wrapping\n',
    '> quoted\n> stuff\n\n- list one\n  cont\n- list two\n',
    '# H {[statHighlight value=42]}\n\nsome **bold\ntext** with `code\nspan` inside\n',
    '[^n]: a footnote\n    across lines\n\nBody with a [link](https://x.y "t") here\n',
    ':::note\ndirective body\nwrapped\n:::\n',
    'para with icon {[fa-solid:user]} inline\nand a second line\n',
  ];

  it('never degrades across the corpus (transform result stays equivalent)', () => {
    for (const src of CORPUS) {
      for (const id of ['unwrap', 'wrap', 'cleanup'] as const) {
        const result = applyMarkdownSourceTransform(id, src, { width: 30, strict: true });
        expect(result.degraded).toBe(false);
      }
    }
  });

  it('wrap/unwrap outputs reparse to structurally equal documents', () => {
    for (const src of CORPUS) {
      const unwrapped = unwrapMarkdownSource(src, STRICT);
      const wrapped = wrapMarkdownSource(src, { width: 24, strict: true });
      for (const out of [unwrapped, wrapped]) {
        // Same block structure, same plain text (modulo whitespace).
        const before = parseMarkdown(src);
        const after = parseMarkdown(out);
        expect(after.children.map((c) => c.type)).toEqual(before.children.map((c) => c.type));
      }
    }
  });
});

describe('detectMarkdownWrapState', () => {
  const LONG_WORDS = (n: number): string =>
    Array.from({ length: n }, (_, i) => `word${String(i).padStart(2, '0')}`).join(' ');

  it('detects an 80-column convention and snaps to it', () => {
    const wrapped = wrapMarkdownSource(`${LONG_WORDS(60)}\n\n${LONG_WORDS(50)}\n`, {
      width: 80,
      strict: true,
    });
    const state = detectMarkdownWrapState(wrapped);
    expect(state.kind).toBe('wrapped');
    expect(state.width).toBe(80);
    expect(state.wrappedParagraphs).toBe(2);
  });

  it('detects other conventions (72, 100)', () => {
    for (const width of [72, 100]) {
      const wrapped = wrapMarkdownSource(`${LONG_WORDS(60)}\n`, { width, strict: true });
      const state = detectMarkdownWrapState(wrapped);
      expect(state.kind).toBe('wrapped');
      expect(state.width).toBe(width);
    }
  });

  it('reports unwrapped for single-line prose', () => {
    const state = detectMarkdownWrapState(`${LONG_WORDS(40)}\n\n${LONG_WORDS(30)}\n`);
    expect(state.kind).toBe('unwrapped');
    expect(state.wrappedParagraphs).toBe(0);
  });

  it('never reads hard-break poetry as wrapped', () => {
    const poem = 'roses are red  \nviolets are blue  \nsugar is sweet  \nand so are you\n';
    const state = detectMarkdownWrapState(poem);
    expect(state.kind).toBe('unwrapped');
  });

  it('reports mixed when long unwrapped paragraphs outnumber wrapped ones', () => {
    const wrapped = wrapMarkdownSource(`${LONG_WORDS(30)}\n`, { width: 40, strict: true });
    const source = `${wrapped}\n${LONG_WORDS(40)}\n\n${LONG_WORDS(40)}\n\n${LONG_WORDS(40)}\n`;
    const state = detectMarkdownWrapState(source);
    expect(state.kind).toBe('mixed');
    expect(state.width).toBeUndefined();
  });

  it('treats a couple of short soft-wrapped lines as inconclusive, never wrapped', () => {
    // Without the confidence floor this would read as "wrapped at 3" and an
    // auto-consumer would destructively re-wrap the whole doc at that width.
    const state = detectMarkdownWrapState('foo\nbar\n');
    expect(state.kind).toBe('mixed');
    expect(state.width).toBeUndefined();
  });

  it('reports no-prose when there are no paragraphs', () => {
    expect(detectMarkdownWrapState('# Heading\n\n```\ncode\n```\n').kind).toBe('no-prose');
    expect(detectMarkdownWrapState('').kind).toBe('no-prose');
  });

  it('detection is stable through wrapMarkdownSource', () => {
    const src = `${LONG_WORDS(60)}\n`;
    for (const width of [60, 80, 120]) {
      const state = detectMarkdownWrapState(wrapMarkdownSource(src, { width, strict: true }));
      expect(state.kind).toBe('wrapped');
      expect(state.width).toBe(width);
    }
  });
});
