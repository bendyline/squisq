import { describe, expect, it } from 'vitest';
import {
  parseTree,
  renderTree,
  treeFromTemplateData,
  treeToTemplateData,
  type Tree,
} from '../doc/treeview/index.js';
import { TREE_FIXTURES } from './fixtures/treeviewFixtures.js';

function semantic(t: Tree): string[] {
  const out: string[] = [];
  const walk = (nodes: Tree['roots'], depth: number): void => {
    for (const n of nodes) {
      out.push(`${depth}:${n.label}${n.comment ? ` #${n.comment}` : ''}`);
      walk(n.children, depth + 1);
    }
  };
  walk(t.roots, 0);
  return out;
}

describe('renderTree — output', () => {
  it('renders a clean Unicode tree with connectors', () => {
    const t = parseTree(['a/', '├── b', '└── c/', '    └── d'].join('\n'));
    expect(renderTree(t)).toBe(['a/', '├── b', '└── c/', '    └── d'].join('\n'));
  });

  it('renders ASCII vocabulary for ascii-style trees', () => {
    const t = parseTree(['a/', '|-- b', '`-- c'].join('\n'));
    const out = renderTree(t);
    expect(out).toContain('|-- b');
    expect(out).toContain('`-- c');
    expect(out).not.toMatch(/[├└│─]/u);
  });

  it('honours a style override', () => {
    const t = parseTree(['a/', '├── b', '└── c'].join('\n'));
    expect(renderTree(t, { style: 'ascii' })).toContain('|-- b');
  });

  it('renders trailing comments', () => {
    const t = parseTree(['p/', '└── a.ts # note'].join('\n'));
    expect(renderTree(t)).toContain('a.ts  # note');
  });

  it('roots carry no connector; children do', () => {
    const t = parseTree(['root/', '└── only'].join('\n'));
    const lines = renderTree(t).split('\n');
    expect(lines[0]).toBe('root/');
    expect(lines[1]).toBe('└── only');
  });
});

describe('renderTree ↔ parseTree fixpoint', () => {
  for (const fx of TREE_FIXTURES) {
    it(`fixpoint + byte-idempotence: ${fx.name}`, () => {
      const d1 = parseTree(fx.art);
      const t1 = renderTree(d1);
      const d2 = parseTree(t1);
      expect(semantic(d2)).toEqual(semantic(d1));
      const t2 = renderTree(d2);
      const t3 = renderTree(parseTree(t2));
      expect(t2).toBe(t1);
      expect(t3).toBe(t1);
    });
  }

  it('anti-churn: a structural edit only changes locally, then is stable', () => {
    const t = parseTree(['a/', '├── b', '└── c'].join('\n'));
    // Rename one node (structure-only edit) via the template-data round-trip.
    const { items } = treeToTemplateData(t);
    items[0].children[0].label = 'renamed';
    const edited = treeFromTemplateData(items);
    const r1 = renderTree(edited);
    expect(r1).toContain('renamed');
    expect(renderTree(parseTree(r1))).toBe(r1);
  });
});

describe('templateData mapping round-trip', () => {
  for (const fx of TREE_FIXTURES) {
    it(`grid → items → grid preserves semantics: ${fx.name}`, () => {
      const t = parseTree(fx.art);
      const back = treeFromTemplateData(treeToTemplateData(t).items, { style: t.style });
      expect(semantic(back)).toEqual(semantic(t));
      // And renders identically.
      expect(renderTree(back)).toBe(renderTree(t));
    });
  }
});
