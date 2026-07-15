import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';

/**
 * Regression tests for two document-corruption bugs in the bridge.
 *
 * These matter more than their size suggests: WysiwygEditor reserializes the
 * ENTIRE document through this bridge on every keystroke, so a construct
 * outside the supported subset is corrupted document-wide rather than at the
 * edit site. Both bugs below were reachable by typing one character into a
 * document that merely CONTAINED a nested list or an identifier.
 */

const roundTrip = (md: string) => tiptapToMarkdown(markdownToTiptap(md));

// ---------------------------------------------------------------------------
// BUG 1 — nested lists
// ---------------------------------------------------------------------------

describe('nested lists: serialize (Tiptap HTML → markdown)', () => {
  it('does not fuse a nested item into its parent bullet', () => {
    // Verbatim from the bug report. This is exactly what Tiptap emits for
    // any nested list. The lazy `/^<ul>(.*?)<\/ul>/s` stopped at the INNER
    // `</ul>`, producing "- parentchild\n\nsecond\n": the child's text was
    // fused into the parent bullet with no separator, and `second` lost its
    // bullet entirely.
    const html =
      '<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li><li><p>second</p></li></ul>';

    expect(tiptapToMarkdown(html)).toBe('- parent\n  - child\n- second\n');
  });

  it('keeps sibling bullets after a nested list', () => {
    const md = tiptapToMarkdown(
      '<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li><li><p>second</p></li></ul>',
    );
    // The regression signature: text fusion and a marker-less sibling.
    expect(md).not.toContain('parentchild');
    expect(md).toContain('- second');
  });

  it('serializes three levels of nesting', () => {
    const html =
      '<ul><li><p>a</p><ul><li><p>b</p><ul><li><p>c</p></li></ul></li></ul></li><li><p>d</p></li></ul>';

    expect(tiptapToMarkdown(html)).toBe('- a\n  - b\n    - c\n- d\n');
  });

  it('serializes an ordered list nested inside a bullet', () => {
    const html =
      '<ul><li><p>a</p><ol><li><p>one</p></li><li><p>two</p></li></ol></li><li><p>b</p></li></ul>';

    expect(tiptapToMarkdown(html)).toBe('- a\n  1. one\n  2. two\n- b\n');
  });

  it('serializes a bullet list nested inside an ordered item, indented past the marker', () => {
    const html = '<ol><li><p>first</p><ul><li><p>sub</p></li></ul></li><li><p>second</p></li></ol>';

    // Three spaces — a sub-item must clear the `1. ` marker to re-parse as a child.
    expect(tiptapToMarkdown(html)).toBe('1. first\n   - sub\n2. second\n');
  });

  it('numbers each ordered level independently', () => {
    const html =
      '<ol><li><p>a</p><ol><li><p>a1</p></li><li><p>a2</p></li></ol></li><li><p>b</p></li></ol>';

    expect(tiptapToMarkdown(html)).toBe('1. a\n   1. a1\n   2. a2\n2. b\n');
  });
});

describe('nested lists: parse (markdown → Tiptap HTML)', () => {
  it('nests an indented bullet inside its parent <li>', () => {
    // The nested <ul> must be a CHILD of the parent <li>, alongside that
    // item's <p> — the shape Tiptap produces and consumes. Previously this
    // flattened into a list + an nbsp-paragraph + a second list.
    expect(markdownToTiptap('- parent\n  - child\n- second')).toBe(
      '<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li><li><p>second</p></li></ul>',
    );
  });

  it('does not leak an indented item into a paragraph', () => {
    const html = markdownToTiptap('- parent\n  - child\n- second');
    expect(html).not.toContain('&nbsp;');
    expect(html).not.toContain('<p>&nbsp;&nbsp;- child</p>');
    expect(html.match(/<ul>/g)).toHaveLength(2);
  });

  it('parses three levels of nesting', () => {
    expect(markdownToTiptap('- a\n  - b\n    - c\n- d')).toBe(
      '<ul><li><p>a</p><ul><li><p>b</p><ul><li><p>c</p></li></ul></li></ul></li><li><p>d</p></li></ul>',
    );
  });

  it('parses an ordered list nested inside a bullet', () => {
    expect(markdownToTiptap('- a\n  1. one\n  2. two\n- b')).toBe(
      '<ul><li><p>a</p><ol><li><p>one</p></li><li><p>two</p></li></ol></li><li><p>b</p></li></ul>',
    );
  });

  it('parses a bullet nested inside an ordered item', () => {
    expect(markdownToTiptap('1. first\n   - sub\n2. second')).toBe(
      '<ol><li><p>first</p><ul><li><p>sub</p></li></ul></li><li><p>second</p></li></ol>',
    );
  });

  it('keeps a ragged dedent inside the parent item, as core does', () => {
    // Ambiguous authoring. Core's CommonMark parser reads both `b` and `c`
    // as siblings of one sublist inside `a` (both clear a's content column),
    // so the bridge must agree rather than letting `c` escape to the outer
    // list or spawning a spurious third level.
    const html = markdownToTiptap('- a\n    - b\n  - c');
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).toBe('<ul><li><p>a</p><ul><li><p>b</p></li><li><p>c</p></li></ul></li></ul>');
  });
});

describe('nested lists: round-trip', () => {
  it.each([
    ['two levels', '- parent\n  - child\n- second\n'],
    ['three levels', '- a\n  - b\n    - c\n- d\n'],
    ['ordered in bullet', '- a\n  1. one\n  2. two\n- b\n'],
    ['bullet in ordered', '1. first\n   - sub\n2. second\n'],
    ['nested ordered', '1. a\n   1. a1\n   2. a2\n2. b\n'],
    ['nested task list', '- [ ] a\n  - [x] b\n'],
    ['deep single chain', '- a\n  - b\n    - c\n      - d\n'],
  ])('is byte-identical for %s', (_name, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it('survives Tiptap normalizing the nested markup', () => {
    // Proves the bridge emits the HTML shape Tiptap actually accepts: if the
    // nesting were malformed, ProseMirror's schema would silently flatten or
    // drop it here.
    const md = '- parent\n  - child\n- second';
    const editor = new Editor({ extensions: [StarterKit], content: markdownToTiptap(md) });

    const html = editor.getHTML();
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(tiptapToMarkdown(html)).toBe(md + '\n');
    editor.destroy();
  });

  it('survives Tiptap normalizing a mixed ul/ol nest', () => {
    const md = '- a\n  1. one\n  2. two\n- b';
    const editor = new Editor({ extensions: [StarterKit], content: markdownToTiptap(md) });

    expect(tiptapToMarkdown(editor.getHTML())).toBe(md + '\n');
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Conformance with core's CommonMark parser
// ---------------------------------------------------------------------------

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  start?: number | null;
  url?: string;
  title?: string | null;
  lang?: string | null;
}

/**
 * Compact structural sketch of an mdast, ignoring source positions. The
 * existing conformance test only compares TOP-LEVEL block types, which is
 * blind to nesting — the exact axis both bugs corrupted.
 *
 * The attribute tail matters as much as the shape: heading `depth`, list
 * `start`, code `lang` and link `url`/`title` are each a field a bridge bug
 * silently dropped while leaving the node type itself intact.
 */
const sketch = (node: MdNode): string => {
  if (node.type === 'text') return JSON.stringify(node.value);
  if (node.type === 'inlineCode') return `inlineCode(${JSON.stringify(node.value)})`;
  if (node.type === 'code') return `code<${node.lang ?? ''}>(${JSON.stringify(node.value)})`;
  const attrs = [
    node.depth != null ? `d${node.depth}` : '',
    node.start != null ? `start=${node.start}` : '',
    node.url != null ? `url=${node.url}` : '',
    node.title != null ? `title=${JSON.stringify(node.title)}` : '',
  ]
    .filter(Boolean)
    .join(',');
  return `${node.type}${attrs ? `[${attrs}]` : ''}(${(node.children ?? []).map(sketch).join(',')})`;
};
const structure = (md: string): string =>
  (parseMarkdown(md).children as MdNode[]).map(sketch).join(' | ');

describe('bridge round-trip preserves the structure core reads', () => {
  it.each([
    ['nested bullets', '- parent\n  - child\n- second'],
    ['three levels', '- a\n  - b\n    - c\n- d'],
    ['ordered in bullet', '- a\n  1. one\n  2. two\n- b'],
    ['bullet in ordered', '1. first\n   - sub\n2. second'],
    ['ragged dedent', '- a\n    - b\n  - c'],
    ['intraword underscores', 'Rename snake_case_name in my_file_v2.txt'],
    ['escaped emphasis', 'Escaped \\*not italic\\* here'],
    ['whitespace-flanked stars', '2 * 3 * 4'],
    // ↓ the five round-trip bugs, stated as agreement with core
    ['setext h1', 'Title\n==='],
    ['setext h2', 'My Title\n---'],
    ['ordered list start', '5. five\n6. six'],
    ['table then fence', '| a | b |\n| --- | --- |\n| 1 | 2 |\n```js\nx\n```'],
    ['indented code', 'para\n\n    const x = *ptr;'],
    ['link with title', 'A [a](http://x.com "T") link.'],
  ])('agrees with core for: %s', (_name, md) => {
    expect(structure(tiptapToMarkdown(markdownToTiptap(md)))).toBe(structure(md));
  });
});

// ---------------------------------------------------------------------------
// BUG 3 — setext headings
// ---------------------------------------------------------------------------

describe('setext headings survive the bridge', () => {
  it('does not destroy a setext h2 into a paragraph + thematic break', () => {
    // The exact repro. `My Title\n---` used to become `<p>My Title</p><hr>`,
    // which re-serializes as `My Title\n\n---`: the heading is GONE, replaced
    // by prose and a rule. Every setext-authored document lost its headings on
    // the first WYSIWYG keystroke.
    expect(markdownToTiptap('My Title\n---')).toBe('<h2>My Title</h2>');
    expect(roundTrip('My Title\n---\n')).toBe('## My Title\n');
  });

  it('does not turn a setext h1 into two plain paragraphs', () => {
    // `Title\n===` was worse still: `<p>Title</p><p>===</p>`, so the underline
    // itself became visible prose.
    expect(markdownToTiptap('Title\n===')).toBe('<h1>Title</h1>');
    expect(roundTrip('Title\n===\n')).toBe('# Title\n');
  });

  it.each([
    ['h1 via ===', 'Title\n===', 1],
    ['h2 via ---', 'Title\n---', 2],
    ['h1 via a long run', 'Title\n=========', 1],
    ['h2 via a single dash', 'Title\n-', 2],
    ['h2 via an indented underline', 'Title\n  ---', 2],
    ['h1 with trailing spaces', 'Title\n===   ', 1],
  ])('reads %s at the right depth', (_name, md, depth) => {
    // Core is the authority on every one of these shapes — a lone `-` really
    // is an h2 underline, and up to three columns of indent are allowed.
    expect(markdownToTiptap(md)).toBe(`<h${depth}>Title</h${depth}>`);
    expect(structure(roundTrip(md))).toBe(structure(md));
  });

  it('normalizes to ATX on the way out, exactly as core does', () => {
    // Tiptap's heading node has no setext/ATX distinction, so the spelling
    // cannot survive. Pinned because core's own serializer normalizes the
    // same way: this is agreement, not loss.
    expect(roundTrip('My Title\n---\n')).toBe('## My Title\n');
    expect(stringifyMarkdown(parseMarkdown('My Title\n---\n'))).toBe('## My Title\n');
  });

  it('handles setext headings among other blocks', () => {
    const md = 'intro\n\nTitle\n===\n\nbody\n';
    expect(markdownToTiptap(md)).toBe('<p>intro</p><h1>Title</h1><p>body</p>');
    expect(roundTrip(md)).toBe('intro\n\n# Title\n\nbody\n');
  });

  it('carries a template annotation through a setext heading', () => {
    // The two heading spellings produce the SAME node, so annotation peeling
    // must not depend on which one the author used.
    expect(markdownToTiptap('My Title {[title]}\n---')).toBe(
      '<h2 data-template="title">My Title</h2>',
    );
    expect(roundTrip('My Title {[title]}\n---\n')).toBe('## My Title {[title]}\n');
  });

  it.each([
    ['a list followed by a thematic break', '- foo\n---\n'],
    ['an ATX heading followed by a thematic break', '# H\n---\n'],
    ['a paragraph, a blank line, then a thematic break', 'before\n\n---\n\nafter\n'],
  ])('does NOT read %s as setext', (_name, md) => {
    // A setext underline may only follow a PARAGRAPH. Core agrees on all
    // three, which is why the setext check must run last in the block loop.
    expect(markdownToTiptap(md)).toContain('<hr>');
    expect(structure(roundTrip(md))).toBe(structure(md));
  });

  it('does not eat a frontmatter fence', () => {
    // `squisq-theme: fresh` sitting directly above the closing `---` is
    // indistinguishable from a setext h2 by shape alone. Claiming it would
    // consume the fence and destroy the whole frontmatter block — which is
    // how this fix first broke the custom-theme write path.
    const md = '---\ntitle: Hi\nsquisq-theme: fresh\n---\n\n# Hello\n';
    const html = markdownToTiptap(md);
    expect(html).not.toContain('<h2>squisq-theme: fresh</h2>');
    expect(html.match(/<hr>/g)).toHaveLength(2);
    expect(tiptapToMarkdown(html)).toContain('---\n\ntitle: Hi\n\nsquisq-theme: fresh\n\n---');
  });

  it('still reads a setext heading in the body AFTER frontmatter', () => {
    // The guard must skip the frontmatter block, not disable setext outright.
    const html = markdownToTiptap('---\ntitle: Hi\n---\n\nMy Title\n---\n');
    expect(html).toContain('<h2>My Title</h2>');
  });
});

// ---------------------------------------------------------------------------
// BUG 4 — ordered-list `start`
// ---------------------------------------------------------------------------

describe('ordered lists keep their start ordinal', () => {
  it('does not renumber a list that continues after an interruption', () => {
    // `5. five` came back as `1. five`: a numbered list resumed after an
    // interruption silently renumbered itself from 1 on the next keystroke.
    expect(markdownToTiptap('5. five\n6. six')).toBe(
      '<ol start="5"><li><p>five</p></li><li><p>six</p></li></ol>',
    );
    expect(roundTrip('5. five\n6. six\n')).toBe('5. five\n6. six\n');
  });

  it('serializes an <ol start> back to the authored ordinals', () => {
    expect(tiptapToMarkdown('<ol start="5"><li><p>five</p></li><li><p>six</p></li></ol>')).toBe(
      '5. five\n6. six\n',
    );
  });

  it('omits start="1", which is the default', () => {
    expect(markdownToTiptap('1. a\n2. b')).toBe('<ol><li><p>a</p></li><li><p>b</p></li></ol>');
  });

  it.each([
    ['start 5', '5. five\n6. six\n'],
    ['start 0', '0. zero\n1. one\n'],
    ['two-digit rollover', '9. nine\n10. ten\n11. eleven\n'],
    ['nested ol keeps its own start', '5. five\n   1. a\n   2. b\n6. six\n'],
    ['nested ul under a started ol', '5. five\n   - sub\n6. six\n'],
  ])('round-trips %s byte-identically', (_name, md) => {
    expect(roundTrip(md)).toBe(md);
    expect(structure(roundTrip(md))).toBe(structure(md));
  });

  it('keeps the start attribute on a NESTED ordered list', () => {
    expect(
      tiptapToMarkdown(
        '<ul><li><p>a</p><ol start="3"><li><p>x</p></li><li><p>y</p></li></ol></li></ul>',
      ),
    ).toBe('- a\n  3. x\n  4. y\n');
  });

  it('indents children past a two-digit marker', () => {
    // Marker WIDTH follows from the real ordinal; a child must clear it to
    // re-parse as a child rather than escaping to the outer list.
    const md = tiptapToMarkdown(
      '<ol start="10"><li><p>ten</p><ul><li><p>sub</p></li></ul></li></ol>',
    );
    expect(md).toBe('10. ten\n    - sub\n');
    expect(structure(md)).toBe(structure('10. ten\n    - sub\n'));
  });

  it('survives Tiptap normalizing an <ol start>', () => {
    const md = '5. five\n   1. a\n   2. b\n6. six';
    const editor = new Editor({ extensions: [StarterKit], content: markdownToTiptap(md) });
    expect(editor.getHTML()).toContain('start="5"');
    expect(tiptapToMarkdown(editor.getHTML())).toBe(md + '\n');
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// BUG 5 — block ORDER around tables
// ---------------------------------------------------------------------------

describe('a table keeps its place relative to the block after it', () => {
  it('does not emit a fence BEFORE the table it follows', () => {
    // The fence branch never called flushTable(), so the buffered table rows
    // flushed after the fence closed and the <pre> came out FIRST. Document
    // block order changed on round-trip — the worst class of bridge bug,
    // since nothing about the edit site explains it.
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n```js\nx\n```\n';
    const html = markdownToTiptap(md);
    expect(html.indexOf('<table>')).toBeLessThan(html.indexOf('<pre>'));
    expect(roundTrip(md)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nx\n```\n');
  });

  it.each([
    ['fence', '```js\nx\n```', '<pre>'],
    ['heading', '# H', '<h1>'],
    ['blockquote', '> q', '<blockquote>'],
    ['bullet list', '- x', '<ul>'],
    ['ordered list', '1. x', '<ol>'],
    ['thematic break', '***', '<hr>'],
  ])('keeps a table before a following %s', (_name, after, tag) => {
    // The fence was the only branch reached before the loop's generic
    // "not a table row → flushTable()" guard, but the whole family is pinned
    // so a future branch added above that guard cannot silently reorder.
    const md = `| a | b |\n| --- | --- |\n| 1 | 2 |\n${after}\n`;
    const html = markdownToTiptap(md);
    expect(html.indexOf('<table>')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('<table>')).toBeLessThan(html.indexOf(tag));
    expect(structure(roundTrip(md))).toBe(structure(md));
  });

  it('keeps a table before a fence even with no trailing newline', () => {
    const html = markdownToTiptap('| a |\n| --- |\n| 1 |\n```\nx\n```');
    expect(html.indexOf('<table>')).toBeLessThan(html.indexOf('<pre>'));
  });
});

// ---------------------------------------------------------------------------
// BUG 6 — indented (4-space) code blocks
// ---------------------------------------------------------------------------

describe('indented code blocks are code, not emphasised prose', () => {
  it('does not run the inline-emphasis regexes over indented code', () => {
    // `    const x = *ptr;` became `<p>&nbsp;…const x = *ptr;</p>`, and the
    // emphasis rules then rewrote the code text itself. The `*` survived here
    // only because it was later re-escaped as `\*ptr` — a different program.
    const md = 'para\n\n    const x = *ptr;\n    y_z = 1;\n';
    const html = markdownToTiptap(md);
    expect(html).toBe('<p>para</p><pre><code>const x = *ptr;\ny_z = 1;</code></pre>');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('&nbsp;');
    expect(roundTrip(md)).toBe('para\n\n```\nconst x = *ptr;\ny_z = 1;\n```\n');
  });

  it.each([
    ['a star deref', 'p\n\n    x = *ptr;\n'],
    ['snake_case', 'p\n\n    my_var_name = 1;\n'],
    ['a bold-looking pair', 'p\n\n    a **b** c\n'],
    ['an underscore pair', 'p\n\n    _leading and trailing_\n'],
    ['a tilde pair', 'p\n\n    ~~x~~\n'],
  ])('leaves %s literal', (_name, md) => {
    expect(structure(roundTrip(md))).toBe(structure(md));
    expect(markdownToTiptap(md)).not.toContain('<em>');
    expect(markdownToTiptap(md)).not.toContain('<strong>');
  });

  it('recognizes indented code at the start of a document', () => {
    expect(markdownToTiptap('    code here')).toBe('<pre><code>code here</code></pre>');
  });

  it('reads an indented list-looking line as code, as core does', () => {
    // 4 columns of indent disqualify a list marker just as they disqualify an
    // ATX heading. Core reads this as code whose TEXT is "- item".
    expect(markdownToTiptap('para\n\n    - item')).toBe(
      '<p>para</p><pre><code>- item</code></pre>',
    );
    expect(structure(roundTrip('para\n\n    - item\n'))).toBe(structure('para\n\n    - item\n'));
  });

  it('keeps blank lines inside an indented code block', () => {
    expect(markdownToTiptap('p\n\n    a\n\n    b')).toBe('<p>p</p><pre><code>a\n\nb</code></pre>');
  });

  it('hands trailing blank lines back to the following block', () => {
    expect(markdownToTiptap('p\n\n    code\n\nafter')).toBe(
      '<p>p</p><pre><code>code</code></pre><p>after</p>',
    );
  });

  it('accepts a tab as the code indent', () => {
    expect(markdownToTiptap('p\n\n\tcode')).toBe('<p>p</p><pre><code>code</code></pre>');
  });

  it('does NOT treat 3 spaces as code', () => {
    // The existing nbsp-paragraph behavior below 4 columns is unchanged.
    expect(markdownToTiptap('Alpha\n\n   Beta')).toBe('<p>Alpha</p><p>&nbsp;&nbsp;&nbsp;Beta</p>');
  });

  it('does NOT treat indented LIST content as code', () => {
    // The other meaning of a 4-space indent. An open list level means we are
    // inside item content, so `    - c` is a sub-bullet, not a code block.
    const html = markdownToTiptap('- a\n  - b\n    - c');
    expect(html).not.toContain('<pre>');
    expect(html.match(/<ul>/g)).toHaveLength(3);
  });

  it('does NOT treat a 4-space line right after a list as code', () => {
    // Core reads `- a\n\n    - b` as a NESTED list: a blank line does not
    // close a list, so the indent is still item content. The bridge's own
    // list handling is looser than core's here, but the important part is
    // that this stays a LIST rather than silently becoming a code block.
    const html = markdownToTiptap('- a\n\n    - b');
    expect(html).not.toContain('<pre>');
    expect(html).toContain('<li><p>b</p></li>');
  });

  it('does NOT let indented code interrupt a paragraph', () => {
    // Without a blank line, core reads the indented line as a lazy paragraph
    // continuation — never as code.
    expect(markdownToTiptap('para\n    not code')).not.toContain('<pre>');
  });
});

// ---------------------------------------------------------------------------
// BUG 7 — link titles
// ---------------------------------------------------------------------------

describe('link titles do not fold into the href', () => {
  it('keeps the href clean and puts the title in its own attribute', () => {
    // `<a href="http://x.com &quot;T&quot;">` — the link is BROKEN for as
    // long as the document is open in the editor. The title survived a
    // round-trip only by string luck, not because it was ever parsed.
    expect(markdownToTiptap('A [a](http://x.com "T") link.')).toBe(
      '<p>A <a href="http://x.com" title="T">a</a> link.</p>',
    );
    expect(roundTrip('A [a](http://x.com "T") link.\n')).toBe('A [a](http://x.com "T") link.\n');
  });

  it.each([
    ['a plain title', 'A [a](http://x.com "T") link.\n'],
    ['parens in the title', '[a](http://x.com "a (b)")\n'],
    ['quotes in the title', '[a](http://x.com "He said \\"hi\\"")\n'],
    ['a title on a relative url', '[a](./docs/x_y.md "The Doc")\n'],
    ['no title at all', 'A [a](http://x.com) link.\n'],
  ])('round-trips %s byte-identically', (_name, md) => {
    expect(roundTrip(md)).toBe(md);
    expect(structure(roundTrip(md))).toBe(structure(md));
  });

  it('escapes a quote inside the title exactly once', () => {
    const html = markdownToTiptap('[a](http://x.com "He said \\"hi\\"")');
    // The attribute holds the DECODED title...
    expect(html).toContain('title="He said &quot;hi&quot;"');
    // ...and the markdown re-escapes it, rather than emitting a raw quote
    // that would truncate the title on the next parse.
    expect(tiptapToMarkdown(html)).toBe('[a](http://x.com "He said \\"hi\\"")\n');
  });

  it('survives a real Tiptap editor round-trip, not just the bridge', () => {
    // The bridge is only half the contract. `@tiptap/extension-link`'s
    // default attributes are href/target/rel/class, so a title had nowhere
    // to live in the node schema and was dropped by the REAL editor even
    // once the bridge parsed it correctly — the author's title vanished the
    // first time the document was opened in WYSIWYG. `LinkWithTitle`
    // (WysiwygEditor.tsx) adds the attribute; this pins that pairing.
    const md = 'A [a](http://x.com "T") link.';
    const editor = new Editor({
      extensions: [StarterKit, LinkWithTitle],
      content: markdownToTiptap(md),
    });

    expect(editor.getHTML()).toContain('title="T"');
    expect(tiptapToMarkdown(editor.getHTML())).toBe(md + '\n');
    editor.destroy();
  });

  it('does not mistake parens IN the url for a title', () => {
    // No whitespace before the `(`, so the whole string is the destination.
    expect(markdownToTiptap('[a](http://x.com/a_(b))')).toBe(
      '<p><a href="http://x.com/a_(b)">a</a></p>',
    );
    expect(roundTrip('[a](http://x.com/a_(b))\n')).toBe('[a](http://x.com/a_(b))\n');
  });

  it('normalizes the alternate title delimiters core accepts', () => {
    // CommonMark allows 'single' and (paren) titles; core rewrites both to
    // the double-quoted form, so the bridge agreeing is the correct outcome.
    expect(roundTrip("[a](http://x.com 'T')\n")).toBe('[a](http://x.com "T")\n');
    expect(roundTrip('[a](http://x.com (T))\n')).toBe('[a](http://x.com "T")\n');
  });

  it('reads a title off an anchor whose attributes are in Tiptap order', () => {
    // The real Link extension renders `<a target rel href>`; ours emits
    // `<a href title>`. Attribute ORDER must not decide whether a title is found.
    expect(
      tiptapToMarkdown(
        '<p><a target="_blank" rel="noopener" title="T" href="http://x.com">a</a></p>',
      ),
    ).toBe('[a](http://x.com "T")\n');
  });

  it('keeps inline formatting inside a titled link label', () => {
    const md = 'See [the **bold** doc](http://x.com "T") now.\n';
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// BUG 2 — intraword underscores and backslash escapes
// ---------------------------------------------------------------------------

describe('intraword underscores are not emphasis', () => {
  it.each([
    ['snake_case_name'],
    ['my_file_v2.txt'],
    ['a_b'],
    ['SCREAMING_SNAKE_CASE'],
    ['user_id and order_id'],
  ])('leaves %s alone in the editor HTML', (text) => {
    const html = markdownToTiptap(text);
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<strong>');
    expect(html).toContain(text);
  });

  it('still bolds __init__ (word-BOUNDARY underscores, which CommonMark honors)', () => {
    // Deliberate: the fix targets INTRAword underscores. `__init__` has its
    // delimiters at word boundaries, so CommonMark — and core's parser —
    // really do make it strong. Pinned so a future "fix" for the Python
    // gotcha can't silently diverge from the spec.
    expect(markdownToTiptap('__init__')).toBe('<p><strong>init</strong></p>');
  });

  it.each([
    ['snake_case_name\n'],
    ['my_file_v2.txt\n'],
    ['Set `x` from my_file_v2.txt and snake_case_name here.\n'],
    ['SCREAMING_SNAKE_CASE\n'],
  ])('round-trips %j byte-identically', (md) => {
    // The corruption was permanent: `snake_case_name` became
    // `snake*case*name` in the source file on the next keystroke.
    expect(roundTrip(md)).toBe(md);
    expect(roundTrip(md)).not.toContain('*');
  });

  it.each([
    ['Visit https://example.com/_next/static/chunk.js now\n'],
    ['https://en.wikipedia.org/wiki/Foo_(bar)_baz\n'],
    ['See www.example.com/a_b_c for more\n'],
    ['Ping http://host/x_y?a=1&b=2#frag_id\n'],
    ['Two https://a.test/p_q and https://b.test/r_s links\n'],
  ])('leaves the delimiters inside a bare URL alone: %j', (md) => {
    // A backslash inside an autolink destination is NOT an escape — it is a
    // literal character of the URL. Escaping `_`/`*` there rewrote the link
    // itself (`/_next/` → `/\_next/`), which is a broken URL, not a styled
    // one. Inside the autolink's extent the delimiters are inert anyway.
    expect(roundTrip(md)).toBe(md);
    expect(roundTrip(md)).not.toContain('\\');
  });

  it('still escapes delimiters in prose sitting next to a bare URL', () => {
    // The URL skip must not leak into the surrounding text.
    const md = 'see *this* at https://x.test/a_b then 3*3=9\n';
    const out = roundTrip(md);
    expect(out).toContain('https://x.test/a_b'); // URL verbatim
    expect(out).toContain('3\\*3=9'); // prose still escaped
  });

  it('still honors underscore emphasis at word boundaries', () => {
    expect(markdownToTiptap('_real emphasis_')).toBe('<p><em>real emphasis</em></p>');
    expect(markdownToTiptap('__real strong__')).toBe('<p><strong>real strong</strong></p>');
    expect(markdownToTiptap('a _real emphasis_ b')).toContain('<em>real emphasis</em>');
  });

  it('emphasizes across an intraword underscore (CommonMark)', () => {
    // `_snake_case_` IS emphasis of the text `snake_case`.
    expect(markdownToTiptap('_snake_case_')).toBe('<p><em>snake_case</em></p>');
  });

  it('keeps asterisk emphasis working intraword (allowed in CommonMark)', () => {
    expect(markdownToTiptap('a*b*c')).toContain('<em>b</em>');
  });
});

describe('backslash escapes are honored by emphasis', () => {
  it('does not emphasize an escaped delimiter, and leaves no stray backslash', () => {
    // Previously `\<em>not italic\</em>`: real emphasis PLUS visible backslashes.
    expect(markdownToTiptap('\\*not italic\\*')).toBe('<p>*not italic*</p>');
    expect(markdownToTiptap('\\_not em\\_')).toBe('<p>_not em_</p>');
    expect(markdownToTiptap('\\~\\~not struck\\~\\~')).toBe('<p>~~not struck~~</p>');
  });

  it.each([['\\*not italic\\*\n'], ['\\_not em\\_\n'], ['\\~\\~not struck\\~\\~\n']])(
    'round-trips %j byte-identically',
    (md) => {
      expect(roundTrip(md)).toBe(md);
    },
  );

  it('still emphasizes after an escaped backslash', () => {
    // `\\` is a literal backslash; the `*` that follows is a live delimiter.
    expect(markdownToTiptap('\\\\*italic*')).toBe('<p>\\<em>italic</em></p>');
  });

  it('re-escapes literal delimiters coming back out of the editor', () => {
    expect(tiptapToMarkdown('<p>*not italic*</p>')).toBe('\\*not italic\\*\n');
    expect(tiptapToMarkdown('<p>_not em_</p>')).toBe('\\_not em\\_\n');
  });

  it('does not escape delimiters inside code spans', () => {
    const md = 'Use `a * b` and `snake_case` here.\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('does not over-escape non-delimiter punctuation', () => {
    // A `*` flanked by whitespace can neither open nor close, so it stays bare.
    expect(roundTrip('2 * 3 * 4\n')).toBe('2 * 3 * 4\n');
    // A lone `~` is not strikethrough.
    expect(roundTrip('~/home/user\n')).toBe('~/home/user\n');
    // A backslash not guarding a delimiter is left alone.
    expect(roundTrip('C:\\path\\to\\file\n')).toBe('C:\\path\\to\\file\n');
  });

  it('keeps whitespace-flanked delimiters from forming emphasis', () => {
    const html = markdownToTiptap('2 * 3 * 4');
    expect(html).not.toContain('<em>');
    expect(html).toBe('<p>2 * 3 * 4</p>');
  });
});

// ---------------------------------------------------------------------------
// Whole-document stability — the property the editor actually depends on
// ---------------------------------------------------------------------------

describe('whole-document round-trip stability', () => {
  const DOC = [
    '# Release Notes',
    '',
    'Rename `old_field_name` to snake_case_name in my_file_v2.txt.',
    '',
    '## Steps',
    '',
    '- Update the parser',
    // `*` not `_`: the bridge has always normalized <em> to the star form.
    // That is pre-existing, orthogonal behavior — the fixture uses the
    // settled form so this test measures nesting/escaping, not that.
    '  - Handle *real emphasis*',
    '  - Handle **bold** text',
    '    - Even when nested deeply',
    '- Update the serializer',
    '  1. Walk the tree',
    '  2. Emit markdown',
    '- Ship it',
    '',
    '> A quote with a_b intraword text',
    '',
    '```js',
    'const snake_case = 1;',
    '```',
    '',
    'Escaped \\*not italic\\* and 2 * 3 * 4 arithmetic.',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
  ].join('\n');

  it('is a fixpoint (markdown → tiptap → markdown changes nothing)', () => {
    expect(roundTrip(DOC)).toBe(DOC);
  });

  it('stays a fixpoint across repeated passes (simulating keystrokes)', () => {
    // WysiwygEditor reserializes the whole document on every keystroke, so
    // any non-idempotent step compounds into drift.
    let current = DOC;
    for (let i = 0; i < 5; i++) current = roundTrip(current);
    expect(current).toBe(DOC);
  });

  it('is a fixpoint after Tiptap normalization', () => {
    const editor = new Editor({ extensions: [StarterKit], content: markdownToTiptap(DOC) });
    const once = tiptapToMarkdown(editor.getHTML());
    editor.destroy();

    const editor2 = new Editor({ extensions: [StarterKit], content: markdownToTiptap(once) });
    expect(tiptapToMarkdown(editor2.getHTML())).toBe(once);
    editor2.destroy();
  });

  it('preserves the identifiers and nesting the bugs destroyed', () => {
    const result = roundTrip(DOC);
    expect(result).toContain('snake_case_name');
    expect(result).toContain('my_file_v2.txt');
    expect(result).toContain('  - Handle *real emphasis*');
    expect(result).toContain('    - Even when nested deeply');
    expect(result).toContain('  1. Walk the tree');
    expect(result).toContain('- Ship it');
    expect(result).not.toContain('snake*case*name');
  });
});

// ---------------------------------------------------------------------------
// The five round-trip bugs, together, as one document
// ---------------------------------------------------------------------------

describe('a document using every repaired construct is editor-stable', () => {
  // Setext headings and indented code have no distinct Tiptap node, so they
  // NORMALIZE on the first pass (to ATX and to a fence) exactly as core's own
  // serializer normalizes them. The property the editor depends on is
  // therefore not "byte-identical on pass 1" but "settles after one pass and
  // never drifts again" — a keystroke on line 1 must not keep rewriting line 40.
  const AUTHORED = [
    'Release Notes',
    '=============',
    '',
    'See the [changelog](http://x.com/log "Full History") for details.',
    '',
    'Setext Section',
    '--------------',
    '',
    '    const x = *ptr;',
    '    y_z = snake_case;',
    '',
    '| col | val |',
    '| --- | --- |',
    '| a | 1 |',
    '```js',
    'const after_table = 1;',
    '```',
    '',
    '5. five',
    '6. six',
    '   1. nested',
    '   2. items',
    '7. seven',
    '',
  ].join('\n');

  const SETTLED = roundTrip(AUTHORED);

  it('settles after one pass and is then a fixpoint', () => {
    expect(roundTrip(SETTLED)).toBe(SETTLED);
  });

  it('stays put across repeated passes (simulating keystrokes)', () => {
    let current = SETTLED;
    for (let i = 0; i < 5; i++) current = roundTrip(current);
    expect(current).toBe(SETTLED);
  });

  it('preserves the structure core reads from the AUTHORED source', () => {
    // The real assertion: normalization changed the spelling, not the meaning.
    expect(structure(SETTLED)).toBe(structure(AUTHORED));
  });

  it('keeps every construct the five bugs destroyed', () => {
    expect(SETTLED).toContain('# Release Notes'); // setext h1 → ATX, not two paragraphs
    expect(SETTLED).toContain('## Setext Section'); // setext h2 → ATX, not <p> + <hr>
    expect(SETTLED).toContain('[changelog](http://x.com/log "Full History")'); // title intact
    expect(SETTLED).toContain('const x = *ptr;'); // code not emphasised
    expect(SETTLED).not.toContain('\\*ptr'); // and not escaped-as-prose either
    expect(SETTLED).toContain('5. five'); // ol start not reset to 1
    // Table still precedes the fence that follows it.
    expect(SETTLED.indexOf('| col | val |')).toBeLessThan(SETTLED.indexOf('const after_table'));
  });

  it('is a fixpoint after Tiptap normalization too', () => {
    const editor = new Editor({ extensions: [StarterKit], content: markdownToTiptap(SETTLED) });
    const once = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    const editor2 = new Editor({ extensions: [StarterKit], content: markdownToTiptap(once) });
    expect(tiptapToMarkdown(editor2.getHTML())).toBe(once);
    editor2.destroy();
  });
});
