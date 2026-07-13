import { describe, expect, it } from 'vitest';
import {
  detectTree,
  parseTree,
  renderTree,
  treeFromTemplateData,
  treeToTemplateData,
  type Tree,
} from '../doc/treeview/index.js';
import { TREE_FIXTURES } from './fixtures/treeviewFixtures.js';

/**
 * Battle test: a broad corpus of AI-style trees (project scaffolds,
 * monorepos, dependency trees, category/decision outlines, forests) each
 * asserting detect + parse-accuracy + fixpoint + byte-stability + mapping
 * round-trip. Peer to asciiDiagramBattle.test.ts.
 */

function flat(t: Tree): string[] {
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

describe('tree battle — every fixture', () => {
  for (const fx of TREE_FIXTURES) {
    describe(`${fx.category}: ${fx.name}`, () => {
      const t = parseTree(fx.art);

      it('detects as a tree', () => {
        expect(detectTree(fx.art).isTree).toBe(true);
      });

      it('parses the intended hierarchy', () => {
        expect(flat(t)).toEqual(fx.expect);
      });

      it('render→parse preserves the semantic (fixpoint)', () => {
        expect(flat(parseTree(renderTree(t)))).toEqual(flat(t));
      });

      it('render→parse→render is byte-stable across three cycles', () => {
        const t1 = renderTree(t);
        const t2 = renderTree(parseTree(t1));
        const t3 = renderTree(parseTree(t2));
        expect(t2).toBe(t1);
        expect(t3).toBe(t1);
      });

      it('templateData round-trips', () => {
        const back = treeFromTemplateData(treeToTemplateData(t).items, { style: t.style });
        expect(flat(back)).toEqual(flat(t));
      });
    });
  }
});

describe('tree battle — coverage sanity', () => {
  it('covers every intended category', () => {
    const categories = new Set(TREE_FIXTURES.map((f) => f.category));
    for (const c of ['scaffold', 'style', 'comments', 'outline', 'shape']) {
      expect(categories.has(c)).toBe(true);
    }
  });

  it('fixture names are unique', () => {
    const names = TREE_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
