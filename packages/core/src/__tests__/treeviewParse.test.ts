import { describe, expect, it } from 'vitest';
import { parseTree, type TreeNode } from '../doc/treeview/index.js';

/** Flatten to "depth:label[ #comment]" lines, depth-first. */
function flat(nodes: readonly TreeNode[], depth = 0, out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(`${depth}:${n.label}${n.comment ? ` #${n.comment}` : ''}`);
    flat(n.children, depth + 1, out);
  }
  return out;
}

describe('parseTree — renditions', () => {
  it('parses a Unicode file tree', () => {
    const art = [
      'src/',
      '├── index.ts',
      '├── components/',
      '│   ├── App.tsx',
      '│   └── Button.tsx',
      '└── utils/',
      '    └── math.ts',
    ].join('\n');
    expect(flat(parseTree(art).roots)).toEqual([
      '0:src/',
      '1:index.ts',
      '1:components/',
      '2:App.tsx',
      '2:Button.tsx',
      '1:utils/',
      '2:math.ts',
    ]);
  });

  it('parses ASCII `|-- ` / `` `-- `` style with identical semantics', () => {
    const art = ['src/', '|-- a.ts', '|-- sub/', '|   `-- b.ts', '`-- c.ts'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:src/', '1:a.ts', '1:sub/', '2:b.ts', '1:c.ts']);
    expect(parseTree(art).style).toBe('ascii');
  });

  it('parses `+-- ` style', () => {
    const art = ['root', '+-- a', '|   +-- a1', '+-- b'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:root', '1:a', '2:a1', '1:b']);
  });

  it('parses pure 2-space indentation', () => {
    const art = ['src/', '  a.ts', '  sub/', '    b.ts'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:src/', '1:a.ts', '1:sub/', '2:b.ts']);
  });

  it('parses 4-space indentation', () => {
    const art = ['src/', '    a.ts', '    sub/', '        b.ts'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:src/', '1:a.ts', '1:sub/', '2:b.ts']);
  });

  it('parses bullet-indented lists', () => {
    const art = ['- src/', '  - a.ts', '  - sub/', '    - b.ts'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:src/', '1:a.ts', '1:sub/', '2:b.ts']);
  });

  it('captures trailing comments (# and <--)', () => {
    const art = ['p/', '├── a.ts   # first', '└── b.ts   <-- second'].join('\n');
    const roots = parseTree(art).roots;
    expect(flat(roots)).toEqual(['0:p/', '1:a.ts #first', '1:b.ts #second']);
  });

  it('marks directories (trailing slash or has children)', () => {
    const art = ['top', '├── leaf.txt', '└── branch', '    └── deep.txt'].join('\n');
    const roots = parseTree(art).roots;
    expect(roots[0].isDir).toBe(true); // has children
    const leaf = roots[0].children.find((n) => n.id === 'leaf-txt');
    expect(leaf?.isDir).toBe(false);
    const branch = roots[0].children.find((n) => n.id === 'branch');
    expect(branch?.isDir).toBe(true); // has children
  });

  it('parses a forest (multiple roots)', () => {
    const art = ['a/', '└── a1', 'b/', '└── b1'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:a/', '1:a1', '0:b/', '1:b1']);
  });

  it('assigns stable, deduplicated ids', () => {
    const art = ['root/', '├── index.ts', '└── sub/', '    └── index.ts'].join('\n');
    const roots = parseTree(art).roots;
    const ids: string[] = [];
    const walk = (ns: TreeNode[]) => ns.forEach((n) => (ids.push(n.id), walk(n.children)));
    walk(roots);
    expect(ids).toEqual(['root', 'index-ts', 'sub', 'index-ts-2']);
    // Stable across re-parses.
    const ids2: string[] = [];
    const walk2 = (ns: TreeNode[]) => ns.forEach((n) => (ids2.push(n.id), walk2(n.children)));
    walk2(parseTree(art).roots);
    expect(ids2).toEqual(ids);
  });

  it('tolerates ragged dedents (clamp to nearest shallower level)', () => {
    const art = ['a/', '    b/', '        c', '   d'].join('\n'); // d dedents to an in-between column
    const roots = parseTree(art).roots;
    // d clamps under a/ (the nearest shallower node).
    expect(flat(roots)).toEqual(['0:a/', '1:b/', '2:c', '1:d']);
  });

  it('skips rails-only spacer lines', () => {
    const art = ['a/', '├── b', '│', '└── c'].join('\n');
    expect(flat(parseTree(art).roots)).toEqual(['0:a/', '1:b', '1:c']);
  });

  it('never throws on garbage / empty', () => {
    expect(parseTree('').roots).toEqual([]);
    expect(() => parseTree('|||\n---')).not.toThrow();
    expect(parseTree('single line').roots.length).toBe(1);
  });

  it('handles CRLF input', () => {
    const art = 'a/\r\n├── b\r\n└── c';
    expect(flat(parseTree(art).roots)).toEqual(['0:a/', '1:b', '1:c']);
  });
});
