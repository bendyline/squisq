import { describe, it, expect } from 'vitest';
import {
  parseMarkdown,
  stringifyMarkdown,
  parseHtmlToNodes,
  stringifyHtmlNodes,
  getChildren,
  walkMarkdownTree,
  findNodesByType,
  extractPlainText,
  countNodes,
  createDocument,
  parseFrontmatter,
} from '../markdown/index';
import type {
  MarkdownDocument,
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownList,
  MarkdownListItem,
  MarkdownCodeBlock,
  MarkdownTable,
  MarkdownBlockquote,
  MarkdownLink,
  MarkdownImage,
  MarkdownHtmlBlock,
  MarkdownMathBlock,
  MarkdownInlineMath,
  MarkdownStrikethrough,
  MarkdownFootnoteDefinition,
  MarkdownFootnoteReference,
  MarkdownLinkDefinition,
  MarkdownLinkReference,
  MarkdownImageReference,
} from '../markdown/index';

// ============================================
// Helper: strip positions for cleaner assertions
// ============================================

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

/**
 * Parse, strip positions, and return the tree.
 */
function parse(md: string) {
  return stripPositions(parseMarkdown(md)) as MarkdownDocument;
}

// ============================================
// CommonMark Basics
// ============================================

describe('parseMarkdown / stringifyMarkdown', () => {
  describe('CommonMark basics', () => {
    it('parses headings', () => {
      const doc = parse('# H1\n\n## H2\n\n### H3');
      expect(doc.children).toHaveLength(3);

      const h1 = doc.children[0] as MarkdownHeading;
      expect(h1.type).toBe('heading');
      expect(h1.depth).toBe(1);
      expect(h1.children[0]).toEqual({ type: 'text', value: 'H1' });

      const h2 = doc.children[1] as MarkdownHeading;
      expect(h2.depth).toBe(2);

      const h3 = doc.children[2] as MarkdownHeading;
      expect(h3.depth).toBe(3);
    });

    it('parses paragraphs with inline formatting', () => {
      const doc = parse('Hello **bold** and *italic* text');
      const p = doc.children[0] as MarkdownParagraph;
      expect(p.type).toBe('paragraph');
      expect(p.children).toHaveLength(5);
      expect(p.children[0]).toEqual({ type: 'text', value: 'Hello ' });
      expect(p.children[1]).toEqual({
        type: 'strong',
        children: [{ type: 'text', value: 'bold' }],
      });
      expect(p.children[2]).toEqual({ type: 'text', value: ' and ' });
      expect(p.children[3]).toEqual({
        type: 'emphasis',
        children: [{ type: 'text', value: 'italic' }],
      });
      expect(p.children[4]).toEqual({ type: 'text', value: ' text' });
    });

    it('parses unordered lists', () => {
      const doc = parse('- Item 1\n- Item 2\n- Item 3');
      const list = doc.children[0] as MarkdownList;
      expect(list.type).toBe('list');
      expect(list.ordered).toBe(false);
      expect(list.children).toHaveLength(3);

      const item = list.children[0] as MarkdownListItem;
      expect(item.type).toBe('listItem');
      const itemP = item.children[0] as MarkdownParagraph;
      expect(itemP.children[0]).toEqual({ type: 'text', value: 'Item 1' });
    });

    it('parses ordered lists', () => {
      const doc = parse('1. First\n2. Second\n3. Third');
      const list = doc.children[0] as MarkdownList;
      expect(list.ordered).toBe(true);
      expect(list.start).toBe(1);
      expect(list.children).toHaveLength(3);
    });

    it('parses code blocks', () => {
      const doc = parse('```typescript\nconst x = 1;\n```');
      const code = doc.children[0] as MarkdownCodeBlock;
      expect(code.type).toBe('code');
      expect(code.lang).toBe('typescript');
      expect(code.value).toBe('const x = 1;');
    });

    it('parses blockquotes', () => {
      const doc = parse('> This is a quote\n>\n> With two paragraphs');
      const bq = doc.children[0] as MarkdownBlockquote;
      expect(bq.type).toBe('blockquote');
      expect(bq.children).toHaveLength(2);
    });

    it('parses inline code', () => {
      const doc = parse('Use `console.log()` for debugging');
      const p = doc.children[0] as MarkdownParagraph;
      expect(p.children[1]).toEqual({ type: 'inlineCode', value: 'console.log()' });
    });

    it('parses links', () => {
      const doc = parse('[Click here](https://example.com "Title")');
      const p = doc.children[0] as MarkdownParagraph;
      const link = p.children[0] as MarkdownLink;
      expect(link.type).toBe('link');
      expect(link.url).toBe('https://example.com');
      expect(link.title).toBe('Title');
      expect(link.children[0]).toEqual({ type: 'text', value: 'Click here' });
    });

    it('parses images', () => {
      const doc = parse('![Alt text](image.png "Image title")');
      const p = doc.children[0] as MarkdownParagraph;
      const img = p.children[0] as MarkdownImage;
      expect(img.type).toBe('image');
      expect(img.url).toBe('image.png');
      expect(img.alt).toBe('Alt text');
      expect(img.title).toBe('Image title');
    });

    it('parses thematic breaks', () => {
      const doc = parse('Before\n\n---\n\nAfter');
      expect(doc.children).toHaveLength(3);
      expect(doc.children[1].type).toBe('thematicBreak');
    });

    it('parses hard line breaks', () => {
      const doc = parse('Line one  \nLine two');
      const p = doc.children[0] as MarkdownParagraph;
      expect(p.children).toHaveLength(3);
      expect(p.children[1].type).toBe('break');
    });
  });

  // ============================================
  // GFM Extensions
  // ============================================

  describe('GFM extensions', () => {
    it('parses tables', () => {
      const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
      const doc = parse(md);
      const table = doc.children[0] as MarkdownTable;
      expect(table.type).toBe('table');
      expect(table.children).toHaveLength(3); // header + 2 data rows

      // Header row
      const headerRow = table.children[0];
      expect(headerRow.children[0].isHeader).toBe(true);
      expect(headerRow.children[0].children[0]).toEqual({ type: 'text', value: 'Name' });

      // Data row
      const dataRow = table.children[1];
      expect(dataRow.children[0].isHeader).toBeUndefined();
    });

    it('parses strikethrough', () => {
      const doc = parse('This is ~~deleted~~ text');
      const p = doc.children[0] as MarkdownParagraph;
      const del = p.children[1] as MarkdownStrikethrough;
      expect(del.type).toBe('delete');
      expect(del.children[0]).toEqual({ type: 'text', value: 'deleted' });
    });

    it('parses task lists', () => {
      const doc = parse('- [x] Done\n- [ ] Todo\n- Regular');
      const list = doc.children[0] as MarkdownList;
      expect(list.children[0].checked).toBe(true);
      expect(list.children[1].checked).toBe(false);
      // Regular item has no checked property
      expect(list.children[2].checked).toBeUndefined();
    });

    it('parses footnotes', () => {
      const md = 'Text with a footnote[^1].\n\n[^1]: This is the footnote content.';
      const doc = parse(md);

      // Find footnote reference in the paragraph
      const p = doc.children[0] as MarkdownParagraph;
      const ref = p.children.find(
        (c) => c.type === 'footnoteReference',
      ) as MarkdownFootnoteReference;
      expect(ref).toBeDefined();
      expect(ref.identifier).toBe('1');

      // Find footnote definition
      const fnDef = doc.children.find(
        (c) => c.type === 'footnoteDefinition',
      ) as MarkdownFootnoteDefinition;
      expect(fnDef).toBeDefined();
      expect(fnDef.identifier).toBe('1');
    });
  });

  // ============================================
  // Math Extensions
  // ============================================

  describe('Math extensions', () => {
    it('parses inline math', () => {
      const doc = parse('The equation $E = mc^2$ is famous');
      const p = doc.children[0] as MarkdownParagraph;
      const math = p.children.find((c) => c.type === 'inlineMath') as MarkdownInlineMath;
      expect(math).toBeDefined();
      expect(math.value).toBe('E = mc^2');
    });

    it('parses display math blocks', () => {
      const doc = parse('$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$');
      const math = doc.children[0] as MarkdownMathBlock;
      expect(math.type).toBe('math');
      expect(math.value).toContain('\\frac{-b');
    });
  });

  // ============================================
  // Link/Image References
  // ============================================

  describe('Reference links', () => {
    it('parses link reference definitions', () => {
      const md = '[example]: https://example.com "Example"\n\nSee [example].';
      const doc = parse(md);

      const def = doc.children.find((c) => c.type === 'definition') as MarkdownLinkDefinition;
      expect(def).toBeDefined();
      expect(def.identifier).toBe('example');
      expect(def.url).toBe('https://example.com');
      expect(def.title).toBe('Example');
    });

    it('parses link references', () => {
      const md = '[Click here][ref]\n\n[ref]: https://example.com';
      const doc = parse(md);
      const p = doc.children[0] as MarkdownParagraph;
      const ref = p.children[0] as MarkdownLinkReference;
      expect(ref.type).toBe('linkReference');
      expect(ref.identifier).toBe('ref');
      expect(ref.referenceType).toBe('full');
    });

    it('parses image references', () => {
      const md = '![Alt text][img]\n\n[img]: image.png';
      const doc = parse(md);
      const p = doc.children[0] as MarkdownParagraph;
      const ref = p.children[0] as MarkdownImageReference;
      expect(ref.type).toBe('imageReference');
      expect(ref.identifier).toBe('img');
    });
  });

  // ============================================
  // HTML Handling
  // ============================================

  describe('HTML handling', () => {
    it('parses block-level HTML', () => {
      const doc = parse('<div class="container">\n  <p>Hello</p>\n</div>');
      const html = doc.children[0] as MarkdownHtmlBlock;
      expect(html.type).toBe('htmlBlock');
      expect(html.rawHtml).toContain('<div');
      expect(html.htmlChildren.length).toBeGreaterThan(0);
    });

    it('parses inline HTML', () => {
      const doc = parse('Text with <em>emphasis</em> inline');
      const p = doc.children[0] as MarkdownParagraph;
      const htmlNodes = p.children.filter((c) => c.type === 'htmlInline');
      expect(htmlNodes.length).toBeGreaterThan(0);
    });

    it('preserves rawHtml for round-tripping', () => {
      const input = '<div class="test">content</div>';
      const doc = parse(input);
      const html = doc.children[0] as MarkdownHtmlBlock;
      expect(html.rawHtml).toBe(input);
    });
  });

  // ============================================
  // Nested Structures
  // ============================================

  describe('Nested structures', () => {
    it('handles blockquote containing list', () => {
      const md = '> - Item 1\n> - Item 2';
      const doc = parse(md);
      const bq = doc.children[0] as MarkdownBlockquote;
      expect(bq.type).toBe('blockquote');
      const list = bq.children[0] as MarkdownList;
      expect(list.type).toBe('list');
      expect(list.children).toHaveLength(2);
    });

    it('handles nested lists', () => {
      const md = '- Outer\n  - Inner 1\n  - Inner 2';
      const doc = parse(md);
      const outerList = doc.children[0] as MarkdownList;
      const firstItem = outerList.children[0];
      // First item should have a paragraph and a nested list
      expect(firstItem.children.length).toBeGreaterThanOrEqual(2);
      const nestedList = firstItem.children.find((c) => c.type === 'list') as MarkdownList;
      expect(nestedList).toBeDefined();
      expect(nestedList.children).toHaveLength(2);
    });

    it('handles emphasis inside links', () => {
      const md = '[**Bold link**](https://example.com)';
      const doc = parse(md);
      const p = doc.children[0] as MarkdownParagraph;
      const link = p.children[0] as MarkdownLink;
      expect(link.type).toBe('link');
      expect(link.children[0].type).toBe('strong');
    });
  });

  // ============================================
  // Round-Trip Tests
  // ============================================

  describe('Round-trip (parse → stringify → parse)', () => {
    function roundTrip(md: string): void {
      const doc1 = parseMarkdown(md);
      const output = stringifyMarkdown(doc1);
      const doc2 = parseMarkdown(output);

      // Strip positions before comparing (positions will differ between parse runs)
      expect(stripPositions(doc2)).toEqual(stripPositions(doc1));
    }

    it('round-trips headings', () => {
      roundTrip('# Heading 1\n\n## Heading 2\n\n### Heading 3\n');
    });

    it('round-trips paragraphs with inline formatting', () => {
      roundTrip('Hello **bold** and *italic* text\n');
    });

    it('round-trips unordered lists', () => {
      roundTrip('- Item 1\n- Item 2\n- Item 3\n');
    });

    it('round-trips ordered lists', () => {
      roundTrip('1. First\n2. Second\n3. Third\n');
    });

    it('round-trips code blocks', () => {
      roundTrip('```js\nconst x = 1;\n```\n');
    });

    it('round-trips blockquotes', () => {
      roundTrip('> A quote\n>\n> Second paragraph\n');
    });

    it('round-trips links and images', () => {
      roundTrip('[Link](https://example.com)\n');
      roundTrip('![Alt](image.png)\n');
    });

    it('round-trips thematic breaks', () => {
      roundTrip('---\n');
    });

    it('round-trips tables', () => {
      roundTrip('| A | B |\n| - | - |\n| 1 | 2 |\n');
    });

    it('round-trips task lists', () => {
      roundTrip('- [x] Done\n- [ ] Todo\n');
    });

    it('round-trips inline math', () => {
      roundTrip('The formula $E = mc^2$ is famous.\n');
    });

    it('round-trips display math', () => {
      roundTrip('$$\nx^2 + y^2 = z^2\n$$\n');
    });

    it('round-trips strikethrough', () => {
      roundTrip('This is ~~deleted~~ text.\n');
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('Edge cases', () => {
    it('handles empty document', () => {
      const doc = parse('');
      expect(doc.type).toBe('document');
      expect(doc.children).toHaveLength(0);
    });

    it('handles single text paragraph', () => {
      const doc = parse('Hello');
      expect(doc.children).toHaveLength(1);
      const p = doc.children[0] as MarkdownParagraph;
      expect(p.type).toBe('paragraph');
      expect(p.children[0]).toEqual({ type: 'text', value: 'Hello' });
    });

    it('handles deeply nested blockquotes', () => {
      const doc = parse('> > > Deep');
      expect(doc.children[0].type).toBe('blockquote');
      const bq1 = doc.children[0] as MarkdownBlockquote;
      const bq2 = bq1.children[0] as MarkdownBlockquote;
      const bq3 = bq2.children[0] as MarkdownBlockquote;
      expect(bq3.type).toBe('blockquote');
    });

    it('preserves source positions when parsing', () => {
      const doc = parseMarkdown('# Hello\n\nWorld');
      expect(doc.position).toBeDefined();
      expect(doc.children[0].position).toBeDefined();
      expect(doc.children[0].position!.start.line).toBe(1);
      expect(doc.children[1].position!.start.line).toBe(3);
    });

    it('handles parseHtml: false option', () => {
      const doc = parseMarkdown('<div>content</div>', { parseHtml: false });
      const html = doc.children[0] as MarkdownHtmlBlock;
      expect(html.rawHtml).toBe('<div>content</div>');
      expect(html.htmlChildren).toEqual([]);
    });
  });
});

// ============================================
// HTML Sub-DOM Tests
// ============================================

describe('HTML sub-DOM (parseHtmlToNodes / stringifyHtmlNodes)', () => {
  it('parses a simple element', () => {
    const nodes = parseHtmlToNodes('<b>bold</b>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('htmlElement');
    const el = nodes[0] as import('../markdown/types').HtmlElement;
    expect(el.tagName).toBe('b');
    expect(el.children).toHaveLength(1);
    expect(el.children[0]).toEqual({ type: 'htmlText', value: 'bold' });
  });

  it('parses attributes', () => {
    const nodes = parseHtmlToNodes('<div class="foo" id="bar">content</div>');
    const el = nodes[0] as import('../markdown/types').HtmlElement;
    expect(el.attributes.class).toBe('foo');
    expect(el.attributes.id).toBe('bar');
  });

  it('handles self-closing elements', () => {
    const nodes = parseHtmlToNodes('<br>');
    const el = nodes[0] as import('../markdown/types').HtmlElement;
    expect(el.tagName).toBe('br');
    expect(el.selfClosing).toBe(true);
  });

  it('handles nested elements', () => {
    const nodes = parseHtmlToNodes('<div><span>inner</span></div>');
    const outer = nodes[0] as import('../markdown/types').HtmlElement;
    expect(outer.tagName).toBe('div');
    const inner = outer.children[0] as import('../markdown/types').HtmlElement;
    expect(inner.tagName).toBe('span');
    expect(inner.children[0]).toEqual({ type: 'htmlText', value: 'inner' });
  });

  it('handles empty input', () => {
    expect(parseHtmlToNodes('')).toEqual([]);
    expect(parseHtmlToNodes('   ')).toEqual([]);
  });

  it('stringifies nodes back to HTML', () => {
    const nodes = parseHtmlToNodes('<b>bold</b>');
    const html = stringifyHtmlNodes(nodes);
    expect(html).toBe('<b>bold</b>');
  });

  it('stringifies void elements', () => {
    const nodes = parseHtmlToNodes('<br>');
    const html = stringifyHtmlNodes(nodes);
    expect(html).toBe('<br>');
  });
});

// ============================================
// Tree Utility Tests
// ============================================

describe('Tree utilities', () => {
  const doc: MarkdownDocument = {
    type: 'document',
    children: [
      {
        type: 'heading',
        depth: 1,
        children: [{ type: 'text', value: 'Title' }],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Hello ' },
          {
            type: 'link',
            url: 'https://example.com',
            children: [{ type: 'text', value: 'world' }],
          },
        ],
      },
    ],
  };

  it('getChildren returns children for parent nodes', () => {
    expect(getChildren(doc)).toEqual(doc.children);
  });

  it('getChildren returns empty array for leaf nodes', () => {
    expect(getChildren({ type: 'text', value: 'hi' })).toEqual([]);
  });

  it('walkMarkdownTree visits all nodes', () => {
    const types: string[] = [];
    walkMarkdownTree(doc, (node) => {
      types.push(node.type);
    });
    expect(types).toEqual(['document', 'heading', 'text', 'paragraph', 'text', 'link', 'text']);
  });

  it('walkMarkdownTree supports pruning', () => {
    const types: string[] = [];
    walkMarkdownTree(doc, (node) => {
      types.push(node.type);
      if (node.type === 'paragraph') return true; // skip children
    });
    expect(types).toEqual(['document', 'heading', 'text', 'paragraph']);
  });

  it('findNodesByType finds matching nodes', () => {
    const headings = findNodesByType<MarkdownHeading>(doc, 'heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].depth).toBe(1);

    const texts = findNodesByType(doc, 'text');
    expect(texts).toHaveLength(3);
  });

  it('extractPlainText extracts all text', () => {
    expect(extractPlainText(doc)).toBe('TitleHello world');
  });

  it('countNodes counts all nodes', () => {
    expect(countNodes(doc)).toBe(7); // document + heading + text + paragraph + text + link + text
  });

  it('createDocument creates a minimal document', () => {
    const d = createDocument({ type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] });
    expect(d.type).toBe('document');
    expect(d.children).toHaveLength(1);
  });
});

// ============================================
// AST Stability Test
// ============================================

describe('AST stability', () => {
  it('parse(stringify(parse(input))) === parse(input)', () => {
    const input = `# Hello World

This is a **bold** and *italic* paragraph with \`code\`.

- Item 1
- Item 2
  - Nested

> A blockquote

\`\`\`js
const x = 1;
\`\`\`

| A | B |
| - | - |
| 1 | 2 |

---

[Link](https://example.com)

![Image](image.png)
`;

    const doc1 = parseMarkdown(input);
    const output = stringifyMarkdown(doc1);
    const doc2 = parseMarkdown(output);
    const output2 = stringifyMarkdown(doc2);
    const doc3 = parseMarkdown(output2);

    // After one round-trip, the AST should be stable
    expect(stripPositions(doc3)).toEqual(stripPositions(doc2));
  });
});

// ============================================
// Template Annotation on Headings
// ============================================

describe('heading template annotation', () => {
  it('parses {[templateName]} from heading text', () => {
    const doc = parseMarkdown('### Report Data {[chart]}');
    const heading = doc.children[0] as MarkdownHeading;

    expect(heading.type).toBe('heading');
    expect(heading.depth).toBe(3);
    expect(heading.templateAnnotation).toEqual({ template: 'chart' });
    // The annotation text should be stripped from children
    expect(heading.children).toHaveLength(1);
    expect(heading.children[0].type).toBe('text');
    expect((heading.children[0] as any).value).toBe('Report Data');
  });

  it('parses template name with key=value params', () => {
    const doc = parseMarkdown('## Data {[statHighlight colorScheme=blue size=large]}');
    const heading = doc.children[0] as MarkdownHeading;

    expect(heading.templateAnnotation).toEqual({
      template: 'statHighlight',
      params: { colorScheme: 'blue', size: 'large' },
    });
    expect((heading.children[0] as any).value).toBe('Data');
  });

  it('returns no annotation for plain headings', () => {
    const doc = parseMarkdown('# Just a title');
    const heading = doc.children[0] as MarkdownHeading;

    expect(heading.templateAnnotation).toBeUndefined();
    expect((heading.children[0] as any).value).toBe('Just a title');
  });

  it('does not match incomplete bracket syntax', () => {
    const doc = parseMarkdown('## Title {chart}');
    const heading = doc.children[0] as MarkdownHeading;

    // Regular curly braces should not trigger annotation parsing
    expect(heading.templateAnnotation).toBeUndefined();
  });

  it('does not match {[...]} in the middle of heading text', () => {
    // The annotation must be trailing
    const doc = parseMarkdown('## The {[chart]} section');
    const heading = doc.children[0] as MarkdownHeading;

    // remark may split this into multiple text nodes or keep as one;
    // either way, no trailing annotation should be extracted
    expect(heading.templateAnnotation).toBeUndefined();
  });

  it('round-trips annotation through parse → stringify → parse', () => {
    const input = '### My Section {[factCard colorScheme=warm]}';
    const doc1 = parseMarkdown(input);
    const output = stringifyMarkdown(doc1);
    const doc2 = parseMarkdown(output);

    const h1 = doc1.children[0] as MarkdownHeading;
    const h2 = doc2.children[0] as MarkdownHeading;

    expect(h2.templateAnnotation).toEqual(h1.templateAnnotation);
    expect(stripPositions(h2.children)).toEqual(stripPositions(h1.children));
  });

  it('handles heading with only annotation (no display text)', () => {
    const doc = parseMarkdown('## {[chart]}');
    const heading = doc.children[0] as MarkdownHeading;

    expect(heading.templateAnnotation).toEqual({ template: 'chart' });
    // Children should be empty after stripping the annotation
    expect(heading.children).toHaveLength(0);
  });

  it('handles heading with bold text before annotation', () => {
    const doc = parseMarkdown('## **Bold Title** {[quoteBlock]}');
    const heading = doc.children[0] as MarkdownHeading;

    expect(heading.templateAnnotation).toEqual({ template: 'quoteBlock' });
    // The bold node should remain, trailing text stripped
    const types = heading.children.map((c) => c.type);
    expect(types).toContain('strong');
  });

  it('preserves annotation through stringify', () => {
    const input = '## Section {[chart]}';
    const doc = parseMarkdown(input);
    const output = stringifyMarkdown(doc);

    // Output should contain the annotation
    expect(output).toContain('{[chart]}');
    // The heading text should be there too
    expect(output).toContain('Section');
  });
});

// ============================================
// YAML Frontmatter
// ============================================

describe('parseFrontmatter', () => {
  it('parses simple key-value pairs', () => {
    const result = parseFrontmatter('title: My Doc\nauthor: Jane');
    expect(result).toEqual({ title: 'My Doc', author: 'Jane' });
  });

  it('parses booleans and numbers', () => {
    const result = parseFrontmatter('draft: true\ncount: 42\nratio: 3.14');
    expect(result).toEqual({ draft: true, count: 42, ratio: 3.14 });
  });

  it('strips surrounding quotes', () => {
    const result = parseFrontmatter('title: "Hello World"\nname: \'Jane\'');
    expect(result).toEqual({ title: 'Hello World', name: 'Jane' });
  });

  it('skips comment lines and blank lines', () => {
    const result = parseFrontmatter('# comment\n\ntitle: Test');
    expect(result).toEqual({ title: 'Test' });
  });

  it('returns null for empty input', () => {
    expect(parseFrontmatter('')).toBeNull();
    expect(parseFrontmatter('  \n  ')).toBeNull();
  });
});

describe('frontmatter in parseMarkdown', () => {
  it('extracts frontmatter from markdown with YAML header', () => {
    const md = '---\ndocument-render-as: landscape\ntitle: Test\n---\n\n# Hello';
    const doc = parseMarkdown(md);
    expect(doc.frontmatter).toEqual({ 'document-render-as': 'landscape', title: 'Test' });
    // The heading should still be there
    expect(doc.children.length).toBeGreaterThanOrEqual(1);
    expect(doc.children[0].type).toBe('heading');
  });

  it('has no frontmatter when YAML header is absent', () => {
    const doc = parseMarkdown('# Just a heading');
    expect(doc.frontmatter).toBeUndefined();
  });

  it('round-trips frontmatter through stringify', () => {
    const md = '---\ndocument-render-as: portrait\n---\n\n# Test';
    const doc = parseMarkdown(md);
    const output = stringifyMarkdown(doc);
    expect(output).toContain('---');
    expect(output).toContain('document-render-as: portrait');
    expect(output).toContain('# Test');
  });

  it('can disable frontmatter parsing', () => {
    const md = '---\ntitle: Disabled\n---\n\n# Hello';
    const doc = parseMarkdown(md, { frontmatter: false });
    expect(doc.frontmatter).toBeUndefined();
  });
});
