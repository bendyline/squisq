/**
 * What a slide shows for the blocks people insert from the Write view's
 * Insert menu. Found by a DocBlocks review (2026-11-12): a tagged timeline,
 * tree or diagram printed its source text beside the picture it became, an
 * untouched drawing or layout was a black slide in a white deck, and a task
 * list read "• [ ] Task 1".
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc, buildPreviewDoc, materializeBlockLayers } from '../doc/index.js';
import { isMaterializedMediaNode, renderMarkdownBlocksHtml } from '../doc/templateInputs.js';
import { DEFAULT_THEME as STANDARD_THEME } from '../schemas/themeLibrary.js';
import type { Layer, TextLayer } from '../schemas/Doc.js';
import type { MarkdownBlockNode } from '../markdown/types.js';

function slides(markdown: string) {
  return buildPreviewDoc(markdownToDoc(parseMarkdown(markdown))).blocks;
}

function layersOf(markdown: string, title: string): Layer[] {
  const block = slides(markdown).find((candidate) => candidate.title === title);
  if (!block) throw new Error(`no slide "${title}"`);
  return materializeBlockLayers(block, { theme: STANDARD_THEME }).layers;
}

function slideText(layers: readonly Layer[]): string {
  return layers
    .filter((layer): layer is TextLayer => layer.type === 'text')
    .map((layer) => layer.content.text ?? '')
    .join('\n');
}

const TIMELINE =
  '```timeline\nMilestones: ● Start {#start} ─────● Review {#review} ─────● Ship {#ship} ───►\n```';
const TREE = '```tree\nsrc/\n├── index.ts\n└── utils/\n    └── helpers.ts\n```';
const DIAGRAM =
  '```diagram\n┌─────────┐\n│  Start  │\n└────┬────┘\n     │\n     ▼\n┌────┴────┐\n│  Next   │\n└─────────┘\n```';

describe('a tagged diagram, tree or timeline on a slide', () => {
  it.each([
    ['timeline', TIMELINE, '● Start'],
    ['tree', TREE, '├──'],
    ['diagram', DIAGRAM, '┌──'],
  ])('%s: drawn beside the words, its source not printed with them', (_kind, fence, source) => {
    const layers = layersOf(`# Plan\n\n## Schedule\n\nThe key moments.\n\n${fence}\n`, 'Schedule');
    const text = slideText(layers);
    expect(text).toContain('The key moments.');
    expect(text).not.toContain(source);
    // Still drawn: the picture's own layers are there.
    expect(layers.length).toBeGreaterThan(3);
  });

  it('keeps an untagged code fence as code', () => {
    const node = parseMarkdown('```python\nprint(1)\n```').children[0] as MarkdownBlockNode;
    expect(isMaterializedMediaNode(node)).toBe(false);
  });

  it('keeps a tagged fence whose art does not parse, rather than losing it', () => {
    const node = parseMarkdown('```timeline\njust words\n```').children[0] as MarkdownBlockNode;
    expect(isMaterializedMediaNode(node)).toBe(false);
  });
});

describe('a drawing or layout slide', () => {
  it.each([
    ['an empty drawing', '## Room sketch\n\n### Drawing {[drawing]}\n'],
    [
      'a layout',
      '## Highlights\n\n### Layout {[layout]}\n\n#### {#text-1} {[text x=360 y=380 width=1200 height=320]}\n\nLayout\n',
    ],
  ])('%s sits on the theme page, not black', (_label, section) => {
    const block = slides(`# Plan\n\n${section}`).find((candidate) =>
      ['drawing', 'layout'].includes(String(candidate.template)),
    );
    expect(block).toBeDefined();
    const layers = materializeBlockLayers(block!, { theme: STANDARD_THEME }).layers;
    const first = layers[0];
    expect(first?.type).toBe('shape');
    expect(first?.type === 'shape' ? first.content.fill : undefined).toBe(
      STANDARD_THEME.colors.background,
    );
  });
});

describe('a task list on a slide', () => {
  it('shows a box for each item instead of "[ ]" after a bullet', () => {
    const list = parseMarkdown('- [ ] Book the venue\n- [x] Send invitations')
      .children as MarkdownBlockNode[];
    const html = renderMarkdownBlocksHtml(list);
    expect(html).not.toContain('[ ]');
    expect(html).not.toContain('[x]');
    expect(html).toContain('☐');
    expect(html).toContain('☑');
    expect(html).toContain('<li data-squisq-task>');
  });

  it('marks task paragraphs so native lists (PowerPoint) can draw the box', () => {
    const layers = layersOf(
      '# Plan\n\n## To do\n\nBefore we leave.\n\n- [ ] Book the venue\n- [x] Send invitations\n',
      'To do',
    );
    const body = layers.find(
      (layer): layer is TextLayer =>
        layer.type === 'text' && (layer.content.paragraphs?.length ?? 0) > 0,
    );
    const items = body?.content.paragraphs?.filter((paragraph) => paragraph.list) ?? [];
    expect(items.map((item) => item.list?.checked)).toEqual([false, true]);
    expect(body?.content.text).toContain('☐ Book the venue');
  });
});
