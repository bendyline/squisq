import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';

describe('Template annotation in Heading parse path', () => {
  it('parseMarkdown extracts {[template]} from a heading', () => {
    const md = '## Getting Started {[comparisonBar]}';
    const doc = parseMarkdown(md);
    const heading = doc.children[0];
    expect(heading.type).toBe('heading');
    if (heading.type !== 'heading') return;
    expect(heading.templateAnnotation).toEqual({ template: 'comparisonBar' });
  });

  it('markdownToDoc preserves templateAnnotation on the resulting block', () => {
    const md = '# Title\n\n## Getting Started {[comparisonBar]}\n\nBody.';
    const parsed = parseMarkdown(md);
    const doc = markdownToDoc(parsed, { articleId: 'test' });
    // The h1 is the root; first child is the h2 with annotation
    const h1 = doc.blocks[0];
    expect(h1.sourceHeading?.depth).toBe(1);
    const h2 = h1.children?.[0];
    expect(h2?.sourceHeading?.depth).toBe(2);
    expect(h2?.sourceHeading?.templateAnnotation).toEqual({ template: 'comparisonBar' });
  });

  it('tolerates accidentally-doubled trailing `]}` (user typo)', () => {
    const md = '## Getting Started {[comparisonBar]}]}';
    const doc = parseMarkdown(md);
    const heading = doc.children[0];
    if (heading.type !== 'heading') throw new Error('expected heading');
    expect(heading.templateAnnotation).toEqual({ template: 'comparisonBar' });
  });

  it('still rejects non-trailing annotations (regex stays anchored)', () => {
    const md = '## The {[chart]} section'; // word continues after — not an annotation
    const doc = parseMarkdown(md);
    const heading = doc.children[0];
    if (heading.type !== 'heading') throw new Error('expected heading');
    expect(heading.templateAnnotation).toBeUndefined();
  });
});
