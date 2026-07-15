import { describe, expect, it } from 'vitest';
import {
  parseTree,
  renderTree,
  treeFromTemplateData,
  treeToTemplateData,
  type Tree,
  type TreeNode,
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
    const t = parseTree(['p/', '└── a.ts   # note'].join('\n'));
    expect(renderTree(t)).toContain('a.ts  # note');
  });

  // A comment is delimited by a GAP (≥2 spaces) before the marker. One space
  // reads as part of the label, which is what lets a label legitimately
  // contain `#`/`//`/`<--` and survive a round-trip.
  it('treats a single-spaced marker as label text, not a comment', () => {
    const t = parseTree(['p/', '└── a.ts # note'].join('\n'));
    expect(semantic(t)).toEqual(['0:p/', '1:a.ts # note']);
    expect(renderTree(t)).toContain('└── a.ts # note');
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

  // Structural-fixpoint violation: a label containing a comment marker was
  // silently split into label + comment by parse(render(t)).
  describe('labels containing comment markers survive', () => {
    const roundTrip = (label: string, comment?: string): TreeNode => {
      const tree = treeFromTemplateData([
        { id: 'n', label, children: [], ...(comment ? { comment } : {}) },
      ]);
      return parseTree(renderTree(tree)).roots[0];
    };

    for (const label of [
      'release # notes',
      'a // b',
      'x <-- y',
      'C# bindings',
      'https://example.com/a',
    ]) {
      it(`preserves ${JSON.stringify(label)}`, () => {
        const node = roundTrip(label);
        expect(node.label).toBe(label);
        expect(node.comment).toBeUndefined();
      });
    }

    it('still round-trips a real label + comment pair', () => {
      const node = roundTrip('main.go', 'entrypoint');
      expect(node.label).toBe('main.go');
      expect(node.comment).toBe('entrypoint');
    });

    it('round-trips a marker-bearing label that ALSO has a comment', () => {
      const node = roundTrip('release # notes', 'generated');
      expect(node.label).toBe('release # notes');
      expect(node.comment).toBe('generated');
    });

    it('stays byte-stable after one normalization cycle', () => {
      const tree = treeFromTemplateData([
        { id: 'n', label: 'release # notes', children: [], comment: 'generated' },
      ]);
      const r1 = renderTree(tree);
      expect(renderTree(parseTree(r1))).toBe(r1);
    });

    it('collapses whitespace runs so a label can never forge the delimiter', () => {
      // A gap inside a label would re-parse as a comment; normalization at
      // the render boundary makes the emitted delimiter the only gap present.
      const node = roundTrip('release  # notes');
      expect(node.label).toBe('release # notes');
      expect(node.comment).toBeUndefined();
    });
  });

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
