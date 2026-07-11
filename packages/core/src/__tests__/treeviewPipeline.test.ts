import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index';
import { markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import { getLayers } from '../doc/getLayers';
import { profileBlockContents, recommendTemplatesForBlock } from '../recommend/templates';
import type { Block, Layer } from '../schemas/Doc';
import type { TreeTemplateItem } from '../schemas/BlockTemplates';

const TREE_ART = ['src/', '├── index.ts', '├── components/', '│   └── App.tsx', '└── utils/'].join(
  '\n',
);
const fenced = (art: string, lang = ''): string => '```' + lang + '\n' + art + '\n```';
const AUTO_DOC = ['# Project', '', '## Layout', '', fenced(TREE_ART), ''].join('\n');

function convert(md: string, options?: Parameters<typeof markdownToDoc>[1]) {
  return markdownToDoc(parseMarkdown(md), { generateCoverBlock: false, ...options });
}
function findBlock(doc: { blocks: Block[] }, title: string): Block | undefined {
  const walk = (blocks: Block[]): Block | undefined => {
    for (const b of blocks) {
      if (b.title === title) return b;
      const inner = b.children ? walk(b.children) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(doc.blocks);
}

describe('auto-template conversion of tree fences', () => {
  it('converts a heading with a lone tree fence into an ephemeral tree block', () => {
    const block = findBlock(convert(AUTO_DOC), 'Layout');
    expect(block?.template).toBe('tree');
    expect(block?.autoTemplate).toBe(true);
    const items = block?.templateData?.items as TreeTemplateItem[];
    expect(items?.map((i) => i.label)).toEqual(['src/']);
    expect(items?.[0].children.map((c) => c.label)).toEqual(['index.ts', 'components/', 'utils/']);
    expect(block?.templateData?.title).toBe('Layout');
  });

  it('round-trips losslessly: fence byte-identical, no annotation injected', () => {
    const output = stringifyMarkdown(docToMarkdown(convert(AUTO_DOC)));
    expect(output).toContain(TREE_ART);
    expect(output).not.toContain('{[tree');
  });

  it('respects the autoTemplates kill switch', () => {
    expect(findBlock(convert(AUTO_DOC, { autoTemplates: false }), 'Layout')?.template).not.toBe(
      'tree',
    );
  });

  it('respects the frontmatter kill switch', () => {
    const md = `---\nsquisq-auto-templates: false\n---\n\n${AUTO_DOC}`;
    expect(findBlock(convert(md), 'Layout')?.template).not.toBe('tree');
  });

  it('does not convert a real-language fence', () => {
    const md = ['## Layout', '', fenced(TREE_ART, 'bash'), ''].join('\n');
    expect(findBlock(convert(md), 'Layout')?.template).not.toBe('tree');
  });

  it('does not convert when a table competes with the fence', () => {
    const md = [
      '## Layout',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      fenced(TREE_ART),
      '',
    ].join('\n');
    expect(findBlock(convert(md), 'Layout')?.template).not.toBe('tree');
  });

  it('does not steal a box-diagram fence (mutual exclusion)', () => {
    const diagram = [
      '┌────────┐',
      '│ Alpha  │',
      '└───┬────┘',
      '    ▼',
      '┌────────┐',
      '│ Beta   │',
      '└────────┘',
    ].join('\n');
    const block = findBlock(convert(['## Arch', '', fenced(diagram), ''].join('\n')), 'Arch');
    expect(block?.template).toBe('diagram');
  });
});

describe('explicit `tree`-tagged fence (survives flatten → round-trip)', () => {
  // A flattened tree loses its connector lines, so an untagged fence would no
  // longer auto-detect. The `tree` fence LANGUAGE is the durable "block tag"
  // (it round-trips through markdown ↔ Tiptap as `class="language-tree"`),
  // and explicit-lang detection accepts the flat art.
  const FLAT_ART = ['README.md', 'index.ts', 'package.json'].join('\n');
  const FLAT_DOC = ['# Project', '', '## Files', '', fenced(FLAT_ART, 'tree'), ''].join('\n');

  it('a bare flat fence does NOT become a tree', () => {
    const md = ['## Files', '', fenced(FLAT_ART), ''].join('\n');
    expect(findBlock(convert(md), 'Files')?.template).not.toBe('tree');
  });

  it('a `tree`-tagged flat fence DOES become a tree', () => {
    const block = findBlock(convert(FLAT_DOC), 'Files');
    expect(block?.template).toBe('tree');
    expect(block?.autoTemplate).toBe(true);
    const items = block?.templateData?.items as TreeTemplateItem[];
    expect(items?.map((i) => i.label)).toEqual(['README.md', 'index.ts', 'package.json']);
  });

  it('round-trips losslessly: fence + `tree` lang preserved, no annotation injected', () => {
    const output = stringifyMarkdown(docToMarkdown(convert(FLAT_DOC)));
    expect(output).toContain('```tree');
    expect(output).toContain(FLAT_ART);
    expect(output).not.toContain('{[tree');
    // Re-importing the output keeps it a tree — the identity is sticky.
    expect(findBlock(convert(output), 'Files')?.template).toBe('tree');
  });

  it('profiles a `tree`-tagged flat fence as hasTree', () => {
    const md = parseMarkdown(fenced(FLAT_ART, 'tree'));
    const profile = profileBlockContents(md.children as Parameters<typeof profileBlockContents>[0]);
    expect(profile.hasTree).toBe(true);
  });
});

describe('explicit {[tree]} annotation', () => {
  it('derives items even with autoTemplates off', () => {
    const md = ['## Files {[tree]}', '', fenced(TREE_ART), ''].join('\n');
    const block = findBlock(convert(md, { autoTemplates: false }), 'Files');
    expect(block?.template).toBe('tree');
    expect((block?.templateData?.items as TreeTemplateItem[])?.length).toBe(1);
  });

  it('converts a nested markdown list under an explicit annotation', () => {
    const md = ['## Files {[tree]}', '', '- src/', '  - index.ts', '  - utils/', ''].join('\n');
    const block = findBlock(convert(md, { autoTemplates: false }), 'Files');
    const items = block?.templateData?.items as TreeTemplateItem[];
    expect(items?.[0].label).toBe('src/');
    expect(items?.[0].children.map((c) => c.label)).toEqual(['index.ts', 'utils/']);
  });

  it('records a diagnostic when the body does not parse as a tree', () => {
    const md = ['## Files {[tree]}', '', 'just prose, no hierarchy at all', ''].join('\n');
    const doc = convert(md);
    expect(doc.diagnostics?.some((d) => d.code === 'tree-parse')).toBe(true);
  });
});

describe('rendering a derived tree through getLayers', () => {
  it('emits a single tree layer with the item hierarchy', () => {
    const block = findBlock(convert(AUTO_DOC), 'Layout') as Block;
    const layers = getLayers(block, {});
    const treeLayer = layers.find((l: Layer) => l.type === 'tree');
    expect(treeLayer).toBeDefined();
    if (treeLayer?.type === 'tree') {
      expect(treeLayer.content.items[0].label).toBe('src/');
      expect(treeLayer.content.items[0].isDir).toBe(true);
    }
  });
});

describe('duration/caption hygiene', () => {
  it('excludes the consumed tree fence from captions', () => {
    const doc = convert(AUTO_DOC);
    const captionText = (doc.captions?.phrases ?? []).map((p) => p.text).join(' ');
    expect(captionText).not.toContain('├──');
    expect(captionText).not.toContain('index.ts');
  });
});

describe('template picker recommendation', () => {
  it('surfaces tree for a tree-fence profile', () => {
    const md = parseMarkdown(fenced(TREE_ART));
    const profile = profileBlockContents(md.children as Parameters<typeof profileBlockContents>[0]);
    expect(profile.hasTree).toBe(true);
    const { recommended } = recommendTemplatesForBlock(profile, ['tree', 'list', 'title']);
    expect(recommended).toContain('tree');
  });
});
