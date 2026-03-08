import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index';
import { markdownToDoc, flattenBlocks, countBlocks, getBlockDepth } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import type { MarkdownParagraph, MarkdownHeading } from '../markdown/types';

// Helper: strip positions from markdown nodes for cleaner assertions
function stripPositions(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripPositions);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === 'position') continue;
    result[key] = stripPositions(value);
  }
  return result;
}

describe('markdownToDoc', () => {
  it('converts a simple heading + paragraph into a single block', () => {
    const md = parseMarkdown('# Title\n\nHello world');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].id).toBe('title');
    expect(doc.blocks[0].sourceHeading).toBeDefined();
    expect(doc.blocks[0].sourceHeading!.depth).toBe(1);
    expect(doc.blocks[0].contents).toHaveLength(1);
    expect(doc.blocks[0].contents![0].type).toBe('paragraph');
  });

  it('creates preamble block for content before first heading', () => {
    const md = parseMarkdown('Some intro text\n\n# First Heading\n\nBody');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(2);
    // Preamble block
    expect(doc.blocks[0].id).toBe('preamble');
    expect(doc.blocks[0].sourceHeading).toBeUndefined();
    expect(doc.blocks[0].contents).toHaveLength(1);
    expect(doc.blocks[0].contents![0].type).toBe('paragraph');
    // Heading block
    expect(doc.blocks[1].sourceHeading).toBeDefined();
    expect(doc.blocks[1].contents).toHaveLength(1);
  });

  it('nests H2 under H1 as children', () => {
    const md = parseMarkdown('# Chapter\n\nIntro\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(1); // One root block (H1)
    const root = doc.blocks[0];
    expect(root.sourceHeading!.depth).toBe(1);
    expect(root.contents).toHaveLength(1); // "Intro" paragraph

    expect(root.children).toHaveLength(2);
    expect(root.children![0].sourceHeading!.depth).toBe(2);
    expect(root.children![0].contents).toHaveLength(1); // "Content A"
    expect(root.children![1].sourceHeading!.depth).toBe(2);
    expect(root.children![1].contents).toHaveLength(1); // "Content B"
  });

  it('handles same-level headings as siblings', () => {
    const md = parseMarkdown('## A\n\nText A\n\n## B\n\nText B\n\n## C\n\nText C');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(3);
    expect(doc.blocks[0].id).toBe('a');
    expect(doc.blocks[1].id).toBe('b');
    expect(doc.blocks[2].id).toBe('c');
  });

  it('handles deep nesting H1→H2→H3→H4→H5→H6', () => {
    const md = parseMarkdown(
      '# L1\n\n## L2\n\n### L3\n\n#### L4\n\n##### L5\n\n###### L6\n\nDeep content'
    );
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(1); // One root
    let block = doc.blocks[0];
    for (let depth = 1; depth <= 5; depth++) {
      expect(block.sourceHeading!.depth).toBe(depth);
      expect(block.children).toHaveLength(1);
      block = block.children![0];
    }
    expect(block.sourceHeading!.depth).toBe(6);
    expect(block.contents).toHaveLength(1);
    expect(block.children).toBeUndefined();
  });

  it('handles mixed content between headings', () => {
    const md = parseMarkdown(
      '# Title\n\nParagraph\n\n- Item 1\n- Item 2\n\n```js\ncode\n```\n\n> Quote'
    );
    const doc = markdownToDoc(md);

    expect(doc.blocks[0].contents).toHaveLength(4); // paragraph, list, code, blockquote
    expect(doc.blocks[0].contents![0].type).toBe('paragraph');
    expect(doc.blocks[0].contents![1].type).toBe('list');
    expect(doc.blocks[0].contents![2].type).toBe('code');
    expect(doc.blocks[0].contents![3].type).toBe('blockquote');
  });

  it('deduplicates IDs for duplicate headings', () => {
    const md = parseMarkdown('# Intro\n\n# Intro\n\n# Intro');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(3);
    expect(doc.blocks[0].id).toBe('intro');
    expect(doc.blocks[1].id).toBe('intro-2');
    expect(doc.blocks[2].id).toBe('intro-3');
  });

  it('handles empty document', () => {
    const md = parseMarkdown('');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(0);
    expect(doc.duration).toBe(0);
  });

  it('handles document with only content (no headings)', () => {
    const md = parseMarkdown('Just some text\n\nAnd more text');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].id).toBe('preamble');
    expect(doc.blocks[0].sourceHeading).toBeUndefined();
    expect(doc.blocks[0].contents).toHaveLength(2);
  });

  it('sets default template on heading blocks', () => {
    const md = parseMarkdown('# Hello');
    const doc = markdownToDoc(md);
    expect(doc.blocks[0].template).toBe('sectionHeader');
  });

  it('respects custom options', () => {
    const md = parseMarkdown('# Test');
    const doc = markdownToDoc(md, {
      articleId: 'custom-article',
      defaultTemplate: 'titleBlock',
      defaultDuration: 10,
    });

    expect(doc.articleId).toBe('custom-article');
    expect(doc.blocks[0].template).toBe('titleBlock');
    expect(doc.blocks[0].duration).toBe(10);
  });

  it('respects custom ID generator', () => {
    const md = parseMarkdown('# Hello\n\n## World');
    const doc = markdownToDoc(md, {
      generateId: (_heading, index) => `block-${index}`,
    });

    expect(doc.blocks[0].id).toBe('block-0');
    expect(doc.blocks[0].children![0].id).toBe('block-1');
  });

  it('calculates timing sequentially across all blocks', () => {
    const md = parseMarkdown('# A\n\n## A1\n\n## A2\n\n# B');
    const doc = markdownToDoc(md, { defaultDuration: 5 });

    const flat = flattenBlocks(doc.blocks);
    expect(flat).toHaveLength(4);
    expect(flat[0].startTime).toBe(0);  // # A
    expect(flat[1].startTime).toBe(5);  // ## A1
    expect(flat[2].startTime).toBe(10); // ## A2
    expect(flat[3].startTime).toBe(15); // # B
    expect(doc.duration).toBe(20);
  });

  it('handles heading depth going back up (H3 → H1)', () => {
    const md = parseMarkdown('# Top\n\n### Deep\n\nDeep content\n\n# Back to top\n\nTop content');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].sourceHeading!.depth).toBe(1);
    // H3 nests under H1 even though H2 was skipped
    expect(doc.blocks[0].children).toHaveLength(1);
    expect(doc.blocks[0].children![0].sourceHeading!.depth).toBe(3);
    expect(doc.blocks[1].sourceHeading!.depth).toBe(1);
    expect(doc.blocks[1].contents).toHaveLength(1);
  });
});

describe('flattenBlocks', () => {
  it('flattens nested blocks depth-first', () => {
    const md = parseMarkdown('# A\n\n## A1\n\n### A1a\n\n## A2\n\n# B');
    const doc = markdownToDoc(md);
    const flat = flattenBlocks(doc.blocks);

    expect(flat.map(b => b.id)).toEqual(['a', 'a1', 'a1a', 'a2', 'b']);
  });
});

describe('countBlocks', () => {
  it('counts all blocks including nested children', () => {
    const md = parseMarkdown('# A\n\n## A1\n\n### A1a\n\n## A2\n\n# B');
    const doc = markdownToDoc(md);

    expect(countBlocks(doc.blocks)).toBe(5);
  });
});

describe('getBlockDepth', () => {
  it('returns heading depth for heading blocks', () => {
    const md = parseMarkdown('# Title');
    const doc = markdownToDoc(md);
    expect(getBlockDepth(doc.blocks[0])).toBe(1);
  });

  it('returns 0 for preamble blocks', () => {
    const md = parseMarkdown('Just text');
    const doc = markdownToDoc(md);
    expect(getBlockDepth(doc.blocks[0])).toBe(0);
  });
});

describe('docToMarkdown (round-trip)', () => {
  it('converts a doc back to equivalent markdown', () => {
    const input = '# Hello\n\nWorld\n\n## Details\n\nMore content\n';
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);
    const roundTripped = docToMarkdown(doc);

    // The resulting MarkdownDocument should have the same structure
    expect(stripPositions(roundTripped)).toEqual(stripPositions(md));
  });

  it('round-trips through stringify', () => {
    const input = '# Intro\n\nParagraph one.\n\n## Sub\n\nParagraph two.\n';
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);
    const markdown2 = docToMarkdown(doc);
    const output = stringifyMarkdown(markdown2);
    // Parse again and compare ASTs
    const md2 = parseMarkdown(output);
    expect(stripPositions(md2)).toEqual(stripPositions(md));
  });

  it('round-trips preamble content', () => {
    const input = 'Preamble text\n\n# Heading\n\nBody\n';
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);
    const roundTripped = docToMarkdown(doc);
    expect(stripPositions(roundTripped)).toEqual(stripPositions(md));
  });

  it('round-trips deeply nested headings', () => {
    const input = '# L1\n\nT1\n\n## L2\n\nT2\n\n### L3\n\nT3\n\n#### L4\n\nT4\n';
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);
    const roundTripped = docToMarkdown(doc);
    expect(stripPositions(roundTripped)).toEqual(stripPositions(md));
  });

  it('round-trips complex mixed content', () => {
    const input = `# Title

Intro paragraph.

- List item 1
- List item 2

## Code Section

\`\`\`js
const x = 1;
\`\`\`

## Quote Section

> A blockquote

---
`;
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);
    const roundTripped = docToMarkdown(doc);
    expect(stripPositions(roundTripped)).toEqual(stripPositions(md));
  });

  it('handles empty doc → empty markdown', () => {
    const md = parseMarkdown('');
    const doc = markdownToDoc(md);
    const roundTripped = docToMarkdown(doc);
    expect(roundTripped.children).toEqual([]);
  });
});

// ============================================
// Template Annotation → Block mapping
// ============================================

describe('template annotation in markdownToDoc', () => {
  it('sets block.template from heading annotation', () => {
    const md = parseMarkdown('## Report {[chart]}\n\nSome data');
    const doc = markdownToDoc(md);

    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].template).toBe('chart');
  });

  it('sets block.templateOverrides from key=value params', () => {
    const md = parseMarkdown('## Stats {[statHighlight colorScheme=blue size=large]}\n\nContent');
    const doc = markdownToDoc(md);

    expect(doc.blocks[0].template).toBe('statHighlight');
    expect(doc.blocks[0].templateOverrides).toEqual({
      colorScheme: 'blue',
      size: 'large',
    });
  });

  it('uses defaultTemplate when no annotation is present', () => {
    const md = parseMarkdown('## Plain Heading\n\nBody');
    const doc = markdownToDoc(md);

    expect(doc.blocks[0].template).toBe('sectionHeader');
    expect(doc.blocks[0].templateOverrides).toBeUndefined();
  });

  it('annotation stripping does not affect heading display text in sourceHeading', () => {
    const md = parseMarkdown('## My Section {[chart]}\n\nBody');
    const doc = markdownToDoc(md);
    const heading = doc.blocks[0].sourceHeading!;

    // The heading children should have the annotation stripped
    expect(heading.templateAnnotation).toEqual({ template: 'chart' });
    const textChild = heading.children.find(c => c.type === 'text') as any;
    expect(textChild.value).toBe('My Section');
  });

  it('round-trips annotation through markdownToDoc → docToMarkdown → stringify', () => {
    const input = '## Data {[chart colorScheme=blue]}\n\nContent here';
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);
    const roundTripped = docToMarkdown(doc);
    const output = stringifyMarkdown(roundTripped);

    expect(output).toContain('{[chart colorScheme=blue]}');
    expect(output).toContain('Data');
  });

  it('docToMarkdown injects annotation when block.template differs from default', () => {
    // Create a doc programmatically with a non-default template
    const md = parseMarkdown('## Section\n\nBody');
    const doc = markdownToDoc(md);

    // Programmatically set a custom template
    doc.blocks[0].template = 'factCard';
    doc.blocks[0].templateOverrides = { style: 'minimal' };

    const roundTripped = docToMarkdown(doc);
    const output = stringifyMarkdown(roundTripped);

    expect(output).toContain('{[factCard style=minimal]}');
  });

  it('nested headings preserve their own annotations', () => {
    const input = '# Chapter {[titleBlock]}\n\nIntro\n\n## Section {[chart]}\n\nData';
    const md = parseMarkdown(input);
    const doc = markdownToDoc(md);

    expect(doc.blocks[0].template).toBe('titleBlock');
    expect(doc.blocks[0].children).toHaveLength(1);
    expect(doc.blocks[0].children![0].template).toBe('chart');
  });
});
