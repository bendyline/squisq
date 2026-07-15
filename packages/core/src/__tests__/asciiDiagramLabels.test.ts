import { describe, expect, it } from 'vitest';
import {
  parseAsciiDiagram,
  renderAsciiDiagram,
  type AsciiDiagram,
  type AsciiDiagramEdge,
  type AsciiDiagramNode,
} from '../doc/asciiDiagram/index.js';

/**
 * Label fixpoint contract.
 *
 * The renderer writes authored label text into the same grid the parser
 * reads structure out of, so a label can inject characters the parser mis-
 * reads as art (or shift the columns out from under a border). Every case
 * here is a way that used to silently destroy a node, an edge, or a whole
 * diagram on a round-trip through `parse(render(d))` — which is exactly what
 * `templateData` / `markdownToDoc` do, with no verify-before-commit to catch
 * it.
 *
 * The two invariants under test, for every label:
 *   1. Semantic fixpoint  — `parse(render(d))` preserves nodes/edges/labels.
 *   2. Byte idempotence   — `render(parse(render(d))) === render(d)`.
 */

const mk = (nodes: AsciiDiagramNode[], edges: AsciiDiagramEdge[] = []): AsciiDiagram => ({
  nodes,
  edges,
  style: 'unicode',
  warnings: [],
});

/** Node ids the renderer/parser agree on, keyed by position rather than slug. */
function labelsByPosition(d: AsciiDiagram): string[] {
  return [...d.nodes].sort((a, b) => a.row - b.row || a.col - b.col).map((n) => n.label);
}

function semantic(d: AsciiDiagram): { nodes: string[]; edges: string[] } {
  return {
    nodes: d.nodes.map((n) => `${n.id}|${n.label}|${n.containerId ?? ''}`).sort(),
    edges: d.edges.map((e) => `${e.source}|${e.target}|${e.directed}|${e.label ?? ''}`).sort(),
  };
}

/**
 * Assert the codec's two fixpoint invariants hold from `d` onward. Returns
 * the canonical (parsed) form so callers can assert on content.
 */
function expectFixpoint(d: AsciiDiagram): AsciiDiagram {
  const art = renderAsciiDiagram(d);
  const parsed = parseAsciiDiagram(art);
  // Cycle 2 must be identical, byte for byte, to cycle 1.
  const art2 = renderAsciiDiagram(parsed);
  expect(art2).toBe(art);
  const parsed2 = parseAsciiDiagram(art2);
  expect(semantic(parsed2)).toEqual(semantic(parsed));
  return parsed;
}

// ---------------------------------------------------------------------------
// The four reported defects, verbatim
// ---------------------------------------------------------------------------

describe('regression: reported defects', () => {
  it('D1 — an astral-plane char (emoji) in a label keeps every box', () => {
    // The renderer measured/indexed labels in UTF-16 code units while the
    // parser grids by code point, so a surrogate pair shifted every column
    // after it and the box borders desynced: BOTH boxes were lost and the
    // whole diagram came back empty.
    const d = mk(
      [
        { id: 'a', label: '🎉 party', col: 0, row: 0, wCols: 12, hRows: 3 },
        { id: 'b', label: 'Beta', col: 0, row: 5, wCols: 12, hRows: 3 },
      ],
      [{ source: 'a', target: 'b', directed: true }],
    );
    const parsed = expectFixpoint(d);
    expect(labelsByPosition(parsed)).toEqual(['🎉 party', 'Beta']);
    expect(parsed.edges).toHaveLength(1);
  });

  it('D2 — a directed labeled edge survives at gap === label.length + 4', () => {
    // The arrowhead overwrote the single trailing line char that the `+ 4`
    // invariant reserved, so the re-parse bridge could not glue the run back
    // together: the edge split into two one-attachment fragments and both
    // were dropped as `dangling-edge`.
    const d = mk(
      [
        { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
        { id: 'b', label: 'B', col: 14, row: 0, wCols: 5, hRows: 3 }, // gap === 9
      ],
      [{ source: 'a', target: 'b', label: 'label', directed: true }],
    );
    const parsed = expectFixpoint(d);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]).toMatchObject({ source: 'a', target: 'b', directed: true });
  });

  it('D3 — an edge label containing `|` keeps the edge AND the label verbatim', () => {
    const d = mk(
      [
        { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
        { id: 'b', label: 'B', col: 30, row: 0, wCols: 5, hRows: 3 },
      ],
      [{ source: 'a', target: 'b', label: 'stdin | out', directed: true }],
    );
    const parsed = expectFixpoint(d);
    expect(parsed.edges).toEqual([
      { source: 'a', target: 'b', label: 'stdin | out', directed: true },
    ]);
  });

  it('D4 — a container title containing `-` keeps the container and its children', () => {
    // `-` is a flat border char, so `┌── co-op ──┐` split into two title runs
    // and the box was never traced: the container vanished and its children
    // re-parented to the root.
    const d = mk([
      { id: 'co-op', label: 'co-op', col: 0, row: 0, wCols: 20, hRows: 8 },
      { id: 'a', label: 'A', col: 2, row: 2, wCols: 5, hRows: 3, containerId: 'co-op' },
      { id: 'b', label: 'B', col: 10, row: 2, wCols: 5, hRows: 3, containerId: 'co-op' },
    ]);
    const parsed = expectFixpoint(d);
    const container = parsed.nodes.find((n) => n.label === 'co-op');
    expect(container).toBeDefined();
    expect(parsed.nodes.filter((n) => n.containerId === container?.id).map((n) => n.label)).toEqual(
      ['A', 'B'],
    );
  });

  it('D4 — hyphenated container titles round-trip (real-world spellings)', () => {
    for (const title of ['co-op', 'read-only', 'v1-beta', 'A + B', 'x─y', 'a│b']) {
      const d = mk([
        { id: 'c', label: title, col: 0, row: 0, wCols: 24, hRows: 7 },
        { id: 'a', label: 'A', col: 2, row: 2, wCols: 5, hRows: 3, containerId: 'c' },
      ]);
      const parsed = expectFixpoint(d);
      expect(parsed.nodes.map((n) => n.label)).toContain(title);
      expect(parsed.nodes.filter((n) => n.containerId !== undefined)).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Property-style sweeps
// ---------------------------------------------------------------------------

/**
 * Labels that each attack a different part of the grid contract: surrogate
 * pairs and wide chars (cell measurement), ASCII/Unicode drawing chars
 * (structure vs. text), and the degenerate lengths.
 */
const ADVERSARIAL: Array<[name: string, label: string]> = [
  ['plain', 'Alpha'],
  ['emoji (astral plane)', '🎉 party'],
  ['emoji only', '🚀'],
  ['CJK (wide)', '日本語'],
  ['ascii pipe', 'stdin | out'],
  ['ascii hyphen', 'read-only'],
  ['ascii plus', 'A + B'],
  ['unicode horizontal', 'a ─ b'],
  ['unicode vertical', 'a │ b'],
  ['box corner', 'a ┐ b'],
  ['mixed drawing', 'a-b|c+d'],
  ['leading/trailing spaces', '  padded  '],
  ['long', 'a very long label indeed for one node'],
];

/** Render-time normalization: per-line trim, blank lines dropped. */
const normalizedNodeLabel = (label: string): string =>
  label
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');

describe('adversarial node labels', () => {
  for (const [name, label] of ADVERSARIAL) {
    it(`node label round-trips: ${name}`, () => {
      const d = mk(
        [
          { id: 'a', label, col: 0, row: 0, wCols: 5, hRows: 3 },
          { id: 'b', label: 'Beta', col: 0, row: 6, wCols: 5, hRows: 3 },
        ],
        [{ source: 'a', target: 'b', directed: true }],
      );
      const parsed = expectFixpoint(d);
      expect(labelsByPosition(parsed)).toEqual([normalizedNodeLabel(label), 'Beta']);
      expect(parsed.edges).toHaveLength(1);
    });
  }

  it('an empty label keeps the box (and stays empty)', () => {
    const d = mk([
      { id: 'a', label: '', col: 0, row: 0, wCols: 5, hRows: 3 },
      { id: 'b', label: 'Beta', col: 0, row: 6, wCols: 5, hRows: 3 },
    ]);
    const parsed = expectFixpoint(d);
    expect(parsed.nodes).toHaveLength(2);
    expect(labelsByPosition(parsed)).toEqual(['', 'Beta']);
  });

  it('a multi-line label round-trips and drops blank lines', () => {
    const d = mk([
      { id: 'a', label: 'first line\n\n  second-line  ', col: 0, row: 0, wCols: 5, hRows: 3 },
      { id: 'b', label: 'Beta', col: 0, row: 8, wCols: 5, hRows: 3 },
    ]);
    const parsed = expectFixpoint(d);
    expect(labelsByPosition(parsed)[0]).toBe('first line\nsecond-line');
  });

  it('a label made only of dashes is not swallowed as a divider rule', () => {
    const d = mk([
      { id: 'a', label: '----', col: 0, row: 0, wCols: 5, hRows: 3 },
      { id: 'b', label: 'Beta', col: 0, row: 6, wCols: 5, hRows: 3 },
    ]);
    const parsed = expectFixpoint(d);
    expect(labelsByPosition(parsed)).toEqual(['----', 'Beta']);
  });
});

describe('adversarial container titles', () => {
  for (const [name, label] of ADVERSARIAL) {
    it(`container title round-trips: ${name}`, () => {
      const d = mk([
        { id: 'c', label, col: 0, row: 0, wCols: 24, hRows: 7 },
        { id: 'a', label: 'A', col: 2, row: 2, wCols: 5, hRows: 3, containerId: 'c' },
        { id: 'b', label: 'B', col: 10, row: 2, wCols: 5, hRows: 3, containerId: 'c' },
      ]);
      const parsed = expectFixpoint(d);
      const expected = normalizedNodeLabel(label);
      const container = parsed.nodes.find((n) => n.containerId === undefined);
      expect(container?.label).toBe(expected);
      // Children stay inside: a dropped container silently re-parents them.
      expect(parsed.nodes.filter((n) => n.containerId === container?.id)).toHaveLength(2);
    });
  }

  it('an untitled container still keeps its children', () => {
    const d = mk([
      { id: 'c', label: '', col: 0, row: 0, wCols: 24, hRows: 7 },
      { id: 'a', label: 'A', col: 2, row: 2, wCols: 5, hRows: 3, containerId: 'c' },
    ]);
    const parsed = expectFixpoint(d);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes.filter((n) => n.containerId !== undefined)).toHaveLength(1);
  });
});

describe('adversarial edge labels', () => {
  // Wide enough that every label below fits the `label + 4` embed budget.
  const spread = (label: string): AsciiDiagram =>
    mk(
      [
        { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
        { id: 'b', label: 'B', col: 5 + label.length + 8, row: 0, wCols: 5, hRows: 3 },
      ],
      [{ source: 'a', target: 'b', label, directed: true }],
    );

  for (const [name, label] of ADVERSARIAL) {
    it(`edge label round-trips: ${name}`, () => {
      const parsed = expectFixpoint(spread(label));
      expect(parsed.edges).toHaveLength(1);
      expect(parsed.edges[0].label).toBe(label.replace(/\s+/gu, ' ').trim());
    });
  }

  it('an empty edge label leaves the edge unlabelled', () => {
    const parsed = expectFixpoint(spread(''));
    expect(parsed.edges).toEqual([{ source: 'a', target: 'b', directed: true }]);
  });

  it('two edges pointing into the same gap stay independent and directed', () => {
    // The label-vs-structure test must treat an ARROWHEAD as structure
    // unconditionally. A horizontal arrowhead has no vertical continuation,
    // so gating it on continuity (as the vertical-rule case requires) made
    // `──────►  ◄────────` read as label text: the bridge ran straight
    // through and the two independent directed edges silently merged into
    // ONE undirected edge labelled `►  ◄`.
    const art = [
      '┌───┐                  ┌───┐',
      '│ A │──────►  ◄────────│ B │',
      '└───┘                  └───┘',
    ].join('\n');

    const parsed = parseAsciiDiagram(art);

    expect(parsed).not.toBeNull();
    // Two arrowheads facing away from each other are not one edge.
    expect(parsed!.edges.every((e) => e.label === undefined)).toBe(true);
    expect(parsed!.edges.some((e) => e.directed === false)).toBe(false);
  });

  it('a `|` in an edge label is still read as text, not structure', () => {
    // The counterpart of the case above: a vertical rule with nothing above
    // or below it is label text, and must NOT be mistaken for structure.
    const parsed = expectFixpoint(spread('stdin | out'));
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].label).toBe('stdin | out');
  });

  it('a bidirectional labeled edge keeps both arrowheads, the label, and both edges', () => {
    const d = mk(
      [
        { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
        { id: 'b', label: 'B', col: 24, row: 0, wCols: 5, hRows: 3 },
      ],
      [
        { source: 'a', target: 'b', label: 'sync', directed: true },
        { source: 'b', target: 'a', label: 'sync', directed: true },
      ],
    );
    const parsed = expectFixpoint(d);
    expect(parsed.edges).toHaveLength(2);
    for (const e of parsed.edges) expect(e.label).toBe('sync');
  });
});

describe('directed edges across a range of node gaps and label lengths', () => {
  // Defect 2 failed at exactly one gap (label.length + 4). Sweeping the whole
  // neighbourhood — for several label lengths, directed and bidirectional —
  // is what makes the arrow-reservation fix a contract rather than a patch.
  for (const label of ['x', 'lbl', 'label', 'a longer label']) {
    for (let gap = 2; gap <= label.length + 10; gap++) {
      it(`gap ${gap}, label "${label}" (${label.length}) keeps the edge`, () => {
        const d = mk(
          [
            { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
            { id: 'b', label: 'B', col: 5 + gap, row: 0, wCols: 5, hRows: 3 },
          ],
          [{ source: 'a', target: 'b', label, directed: true }],
        );
        const parsed = expectFixpoint(d);
        expect(parsed.edges).toHaveLength(1);
        expect(parsed.edges[0]).toMatchObject({ source: 'a', target: 'b', directed: true });
        // Once the label is embedded at all, it must survive intact — a
        // half-written label is worse than none.
        if (parsed.edges[0].label !== undefined) expect(parsed.edges[0].label).toBe(label);
      });
    }
  }

  it('an edge label too wide for the parser to bridge keeps the edge', () => {
    // Found while sweeping D2: past the bridge scanner's budget the run split
    // and the EDGE vanished (and the art was not byte-stable). Refusing to
    // embed a label the parser cannot read back trades the label for the edge.
    for (const len of [39, 41, 60, 120]) {
      const label = 'x'.repeat(len);
      const d = mk(
        [
          { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
          { id: 'b', label: 'B', col: 5 + len + 12, row: 0, wCols: 5, hRows: 3 },
        ],
        [{ source: 'a', target: 'b', label, directed: true }],
      );
      const parsed = expectFixpoint(d);
      expect(parsed.edges).toHaveLength(1);
      expect(parsed.edges[0]).toMatchObject({ source: 'a', target: 'b', directed: true });
    }
  });

  it('the label embeds as soon as the gap affords it, arrowheads included', () => {
    // ` label ` (7) + one surviving line char on each side (2) + the
    // arrowhead's own cell (1) === 10.
    const at = (gap: number): string | undefined => {
      const d = mk(
        [
          { id: 'a', label: 'A', col: 0, row: 0, wCols: 5, hRows: 3 },
          { id: 'b', label: 'B', col: 5 + gap, row: 0, wCols: 5, hRows: 3 },
        ],
        [{ source: 'a', target: 'b', label: 'label', directed: true }],
      );
      return parseAsciiDiagram(renderAsciiDiagram(d)).edges[0]?.label;
    };
    expect(at(9)).toBeUndefined();
    expect(at(10)).toBe('label');
  });
});
