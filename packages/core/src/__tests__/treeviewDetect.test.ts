import { describe, expect, it } from 'vitest';
import {
  detectTree,
  isTreeFence,
  isEligibleTreeFenceLang,
  isExplicitTreeLang,
} from '../doc/treeview/index.js';
import { detectAsciiDiagram, isAsciiDiagramFence } from '../doc/asciiDiagram/index.js';
import type { MarkdownCodeBlock } from '../markdown/types.js';
import { TREE_FIXTURES } from './fixtures/treeviewFixtures.js';

const NEGATIVES: Record<string, string> = {
  boxDiagram: [
    '┌────────┐',
    '│ Alpha  │',
    '└───┬────┘',
    '    │',
    '    ▼',
    '┌────────┐',
    '│ Beta   │',
    '└────────┘',
  ].join('\n'),
  markdownTable: ['| Name  | Role     |', '|-------|----------|', '| Ada   | Engineer |'].join(
    '\n',
  ),
  prose: [
    'This is a paragraph of ordinary text.',
    'It has multiple lines but no tree structure at all.',
    'Nothing here should look like a hierarchy.',
  ].join('\n'),
  indentedCode: [
    'function foo() {',
    '  const x = 1;',
    '  if (x) {',
    '    return x;',
    '  }',
    '}',
  ].join('\n'),
  yaml: ['services:', '  web:', '    image: nginx', '    ports:', '      - "80:80"'].join('\n'),
  singleLine: 'just one line',
};

describe('detectTree — negative corpus (must all reject)', () => {
  for (const [name, art] of Object.entries(NEGATIVES)) {
    it(`rejects ${name}`, () => {
      const d = detectTree(art);
      expect(d.isTree).toBe(false);
      expect(d.reasons.length).toBeGreaterThan(0);
    });
  }
});

describe('detectTree — positive fixtures (must all accept)', () => {
  for (const fx of TREE_FIXTURES) {
    it(`accepts ${fx.name}`, () => {
      const d = detectTree(fx.art);
      expect(d.isTree).toBe(true);
      expect(d.tree).toBeDefined();
    });
  }
});

describe('mutual exclusion with the diagram codec', () => {
  it('a box diagram is a diagram, not a tree', () => {
    expect(detectAsciiDiagram(NEGATIVES.boxDiagram).isDiagram).toBe(true);
    expect(detectTree(NEGATIVES.boxDiagram).isTree).toBe(false);
  });

  it('every tree fixture is a tree, not a diagram', () => {
    for (const fx of TREE_FIXTURES) {
      expect(detectTree(fx.art).isTree).toBe(true);
      expect(detectAsciiDiagram(fx.art).isDiagram).toBe(false);
    }
  });
});

describe('explicit `tree` tag (lenient detection)', () => {
  const FLAT = ['README.md', 'index.ts', 'package.json'].join('\n');
  const SINGLE = 'src/';

  it('isExplicitTreeLang matches only the `tree` tag', () => {
    for (const lang of ['tree', ' Tree ', 'TREE']) expect(isExplicitTreeLang(lang)).toBe(true);
    for (const lang of [undefined, null, '', 'text', 'ascii', 'diagram', 'js'])
      expect(isExplicitTreeLang(lang)).toBe(false);
  });

  it('a flat connector-less list is rejected untagged but accepted when explicit', () => {
    // The exact bug the fence tag fixes: flattening a tree drops its
    // connectors, so auto-detection rejects it on round-trip. The explicit
    // `tree` tag trusts the author and keeps it a tree.
    expect(detectTree(FLAT).isTree).toBe(false);
    const explicit = detectTree(FLAT, { explicit: true });
    expect(explicit.isTree).toBe(true);
    expect(explicit.tree?.roots).toHaveLength(3);
  });

  it('a single-node tree is accepted when explicit', () => {
    expect(detectTree(SINGLE).isTree).toBe(false);
    expect(detectTree(SINGLE, { explicit: true }).isTree).toBe(true);
  });

  it('still rejects a box diagram even when explicitly tagged', () => {
    expect(detectTree(NEGATIVES.boxDiagram, { explicit: true }).isTree).toBe(false);
  });

  it('still rejects a markdown table even when explicitly tagged', () => {
    expect(detectTree(NEGATIVES.markdownTable, { explicit: true }).isTree).toBe(false);
  });

  it('isTreeFence accepts a flat `tree`-tagged fence via the lang gate', () => {
    const fence: MarkdownCodeBlock = { type: 'code', lang: 'tree', value: FLAT };
    expect(isTreeFence(fence)).toBe(true);
    // The same content in a bare fence is not auto-detected.
    expect(isTreeFence({ type: 'code', value: FLAT })).toBe(false);
  });
});

describe('fence language gate', () => {
  it('allows inert langs incl. tree; rejects real languages', () => {
    for (const lang of [undefined, null, '', 'text', 'txt', 'plain', 'tree', 'ascii']) {
      expect(isEligibleTreeFenceLang(lang)).toBe(true);
    }
    for (const lang of ['js', 'python', 'yaml', 'json', 'bash']) {
      expect(isEligibleTreeFenceLang(lang)).toBe(false);
    }
  });

  it('isTreeFence combines the lang gate with content detection', () => {
    const art = TREE_FIXTURES[0].art;
    const fence = (lang?: string): MarkdownCodeBlock => ({
      type: 'code',
      ...(lang !== undefined ? { lang } : {}),
      value: art,
    });
    expect(isTreeFence(fence())).toBe(true);
    expect(isTreeFence(fence('tree'))).toBe(true);
    expect(isTreeFence(fence('js'))).toBe(false);
    // And it is NOT an ascii-diagram fence.
    expect(isAsciiDiagramFence(fence())).toBe(false);
  });
});
