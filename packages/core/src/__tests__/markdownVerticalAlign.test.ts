/**
 * Superscript / subscript folding.
 *
 * Markdown has no native syntax for vertical alignment, so the source form is
 * inline HTML. micromark hands `<sup>x</sup>` back as three UNPAIRED nodes
 * (`html`, `text`, `html`), which every consumer used to rebuild independently
 * — rendering an empty `<sup></sup>` with the content stranded beside it. The
 * parser folds the pair into a real container node instead; these tests pin
 * both that folding and the byte-exact expansion back to source.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown, extractPlainText } from '../markdown/index.js';
import type { MarkdownInlineNode, MarkdownParagraph } from '../markdown/index.js';

function inlines(src: string): MarkdownInlineNode[] {
  const doc = parseMarkdown(src);
  const first = doc.children[0] as MarkdownParagraph;
  return first.children;
}

/** Compact shape string, e.g. `text(Fresh) superscript(text(1))`. */
function shape(nodes: MarkdownInlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return `text(${n.value})`;
      if (n.type === 'htmlInline') return `raw(${n.rawHtml})`;
      if ('children' in n && Array.isArray(n.children)) {
        return `${n.type}(${shape(n.children as MarkdownInlineNode[])})`;
      }
      return n.type;
    })
    .join(' ');
}

describe('superscript / subscript folding', () => {
  it('folds a bare tag pair into a container node', () => {
    expect(shape(inlines('Fresh<sup>1</sup>'))).toBe('text(Fresh) superscript(text(1))');
    expect(shape(inlines('H<sub>2</sub>O'))).toBe('text(H) subscript(text(2)) text(O)');
  });

  it('nests', () => {
    expect(shape(inlines('<sup>a<sub>b</sub>c</sup>'))).toBe(
      'superscript(text(a) subscript(text(b)) text(c))',
    );
  });

  it('folds around other inline formatting', () => {
    expect(shape(inlines('<sup>**b** [x](y)</sup>'))).toBe(
      'superscript(strong(text(b)) text( ) link(text(x)))',
    );
  });

  it('keeps a tag with attributes as raw inline HTML', () => {
    // The folded node has nowhere to put the attributes, so folding would
    // silently drop them.
    expect(shape(inlines('<sup class="fn">1</sup>'))).toBe(
      'raw(<sup class="fn">) text(1) raw(</sup>)',
    );
  });

  it('leaves unmatched tags exactly as they were', () => {
    expect(shape(inlines('a<sup>b'))).toBe('text(a) raw(<sup>) text(b)');
    expect(shape(inlines('a</sup>b'))).toBe('text(a) raw(</sup>) text(b)');
  });

  it('unwinds an inner tag that never closed', () => {
    // `<sub>` opens inside `<sup>` but the `</sup>` arrives first. The outer
    // pair still folds; the orphan reverts to raw rather than swallowing it.
    expect(shape(inlines('<sup>a<sub>b</sup>c</sub>'))).toBe(
      'superscript(text(a) raw(<sub>) text(b)) text(c) raw(</sub>)',
    );
  });

  it('does not fold inside a code span', () => {
    expect(shape(inlines('`<sup>x</sup>`'))).toBe('inlineCode');
  });
});

describe('superscript / subscript serialization', () => {
  const sources = [
    'Fresh<sup>1</sup> and H<sub>2</sub>O',
    'x<sup>a<sub>b</sub>c</sup>y',
    'unclosed <sup>tag here',
    'stray </sup> close',
    'attrs <sup class="fn">1</sup> kept raw',
    'nested **bold <sup>1</sup>** ok',
    '<sup>[link](url)</sup>',
  ];

  it.each(sources)('round-trips %j byte for byte', (src) => {
    expect(stringifyMarkdown(parseMarkdown(src)).trim()).toBe(src);
  });

  it('survives inside a GFM table cell', () => {
    const src = '| Form | P |\n| --- | --- |\n| Fresh<sup>1</sup> | 1.40 |';
    const out = stringifyMarkdown(parseMarkdown(src));
    expect(out).toContain('Fresh<sup>1</sup>');
  });
});

describe('superscript / subscript plain-text extraction', () => {
  it('flattens to the bare characters', () => {
    // This is what keeps the SVG/slide path (which takes plain strings)
    // rendering exactly as it did before vertical alignment existed.
    expect(extractPlainText(parseMarkdown('Fresh<sup>1</sup> and H<sub>2</sub>O'))).toBe(
      'Fresh1 and H2O',
    );
  });
});
