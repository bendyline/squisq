import { describe, expect, it } from 'vitest';
import { parseTree, renderTree, type Tree, type TreeNode } from '@bendyline/squisq/doc';
import {
  addItemOp,
  indentItemOp,
  moveItemOp,
  moveItemDownOp,
  moveItemUpOp,
  outdentItemOp,
  removeItemOp,
  renameItemOp,
  sanitizeTreeLabel,
  toggleDirOp,
} from '../treeOps';

function tree(art: string): Tree {
  return parseTree(art);
}
function flat(t: Tree): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode[], d: number) => {
    for (const n of ns) {
      out.push(`${d}:${n.label}`);
      walk(n.children, d + 1);
    }
  };
  walk(t.roots, 0);
  return out;
}

const BASE = ['root/', '├── a', '├── b/', '│   └── b1', '└── c'].join('\n');

describe('sanitizeTreeLabel', () => {
  it('strips connector glyphs and newlines', () => {
    expect(sanitizeTreeLabel('a ├── b │ c\nd')).toBe('a b c d');
  });
});

describe('treeOps', () => {
  it('renameItemOp renames without mutating the input', () => {
    const t = tree(BASE);
    const next = renameItemOp(t, 'a', 'alpha');
    expect(flat(next)).toContain('1:alpha');
    expect(flat(t)).toContain('1:a'); // original untouched
  });

  it('addItemOp adds a child and a sibling', () => {
    const child = addItemOp(tree(BASE), 'a', 'child', 'a1');
    const aNode = child.roots[0].children.find((n) => n.label === 'a');
    expect(aNode?.children.map((c) => c.label)).toEqual(['a1']);

    const sib = addItemOp(tree(BASE), 'a', 'siblingAfter', 'a2');
    expect(sib.roots[0].children.map((c) => c.label)).toEqual(['a', 'a2', 'b/', 'c']);
  });

  it('addItemOp with isDir adds a trailing-slash folder with a folder default name', () => {
    // Explicit label gets a slash.
    const named = addItemOp(tree(BASE), 'a', 'siblingAfter', 'assets', true);
    const assets = named.roots[0].children.find((n) => n.label === 'assets/');
    expect(assets?.isDir).toBe(true);

    // Default name is a fresh `folderN/`.
    const auto = addItemOp(tree(BASE), 'a', 'siblingAfter', undefined, true);
    const folder = auto.roots[0].children.find((n) => n.label.startsWith('folder'));
    expect(folder?.label).toBe('folder1/');
    expect(folder?.isDir).toBe(true);
  });

  it('removeItemOp drops a node and its subtree', () => {
    const next = removeItemOp(tree(BASE), 'b');
    expect(flat(next)).toEqual(['0:root/', '1:a', '1:c']);
  });

  it('indentItemOp re-parents under the preceding sibling', () => {
    const next = indentItemOp(tree(BASE), 'c'); // c indents under b/
    expect(flat(next)).toEqual(['0:root/', '1:a', '1:b/', '2:b1', '2:c']);
  });

  it('indentItemOp is a no-op for the first sibling', () => {
    const t = tree(BASE);
    expect(indentItemOp(t, 'a')).toBe(t);
  });

  it('outdentItemOp promotes a node to a sibling of its parent (subtree carried)', () => {
    const next = outdentItemOp(tree(BASE), 'b1'); // b1 outdents next to b/
    expect(flat(next)).toEqual(['0:root/', '1:a', '1:b/', '1:b1', '1:c']);
  });

  it('outdentItemOp is a no-op for a root', () => {
    const t = tree(BASE);
    expect(outdentItemOp(t, 'root')).toBe(t);
  });

  it('moveItemOp reorders siblings before or after a target', () => {
    expect(flat(moveItemOp(tree(BASE), 'c', 'a', 'before'))).toEqual([
      '0:root/',
      '1:c',
      '1:a',
      '1:b/',
      '2:b1',
    ]);
    expect(flat(moveItemOp(tree(BASE), 'b', 'c', 'after'))).toEqual([
      '0:root/',
      '1:a',
      '1:c',
      '1:b/',
      '2:b1',
    ]);
  });

  it('moveItemOp reparents nodes and carries their subtrees', () => {
    expect(flat(moveItemOp(tree(BASE), 'c', 'a', 'child'))).toEqual([
      '0:root/',
      '1:a',
      '2:c',
      '1:b/',
      '2:b1',
    ]);
    expect(flat(moveItemOp(tree(BASE), 'b', 'a', 'child'))).toEqual([
      '0:root/',
      '1:a',
      '2:b/',
      '3:b1',
      '1:c',
    ]);
  });

  it('moveItemOp can outdent relative to a shallower target', () => {
    expect(flat(moveItemOp(tree(BASE), 'b1', 'b', 'before'))).toEqual([
      '0:root/',
      '1:a',
      '1:b1',
      '1:b/',
      '1:c',
    ]);
  });

  it('moveItemOp rejects self-drops and drops into the source subtree', () => {
    const t = tree(BASE);
    expect(moveItemOp(t, 'b', 'b', 'child')).toBe(t);
    expect(moveItemOp(t, 'b', 'b1', 'child')).toBe(t);
  });

  it('moveItemUp / moveItemDown reorder siblings within bounds', () => {
    expect(flat(moveItemDownOp(tree(BASE), 'a'))).toEqual([
      '0:root/',
      '1:b/',
      '2:b1',
      '1:a',
      '1:c',
    ]);
    const t = tree(BASE);
    expect(moveItemUpOp(t, 'a')).toBe(t); // already first
  });

  it('toggleDirOp toggles the trailing slash', () => {
    const on = toggleDirOp(tree(BASE), 'a'); // a → a/
    expect(on.roots[0].children[0].label).toBe('a/');
    const off = toggleDirOp(on, 'a'); // a/ → a
    expect(off.roots[0].children.find((n) => n.label === 'a')).toBeDefined();
  });

  it('every op keeps the tree renderable + byte-stable', () => {
    for (const op of [
      (t: Tree) => renameItemOp(t, 'a', 'alpha'),
      (t: Tree) => addItemOp(t, 'b', 'child', 'b2'),
      (t: Tree) => indentItemOp(t, 'c'),
      (t: Tree) => outdentItemOp(t, 'b1'),
      (t: Tree) => moveItemOp(t, 'c', 'a', 'child'),
      (t: Tree) => moveItemDownOp(t, 'a'),
    ]) {
      const next = op(tree(BASE));
      const r1 = renderTree(next);
      expect(renderTree(parseTree(r1))).toBe(r1);
    }
  });
});
