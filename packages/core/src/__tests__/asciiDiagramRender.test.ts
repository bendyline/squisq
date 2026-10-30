import { describe, expect, it } from 'vitest';
import {
  asciiDiagramFromTemplateData,
  asciiDiagramToTemplateData,
  parseAsciiDiagram,
  renderAsciiDiagram,
  type AsciiDiagram,
} from '../doc/asciiDiagram/index.js';
import { POSITIVE_FIXTURES } from './fixtures/asciiDiagrams.js';

/** Semantic equality: node ids/labels/containment + edge tuple sets. */
function semanticSnapshot(d: AsciiDiagram): {
  nodes: Array<{ id: string; label: string; containerId?: string }>;
  edges: Array<{ source: string; target: string; label?: string; directed: boolean }>;
} {
  return {
    nodes: [...d.nodes]
      .map((n) => ({
        id: n.id,
        label: n.label,
        ...(n.containerId ? { containerId: n.containerId } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...d.edges]
      .map((e) => ({
        source: e.source,
        target: e.target,
        ...(e.label ? { label: e.label } : {}),
        directed: e.directed,
      }))
      .sort(
        (a, b) =>
          a.source.localeCompare(b.source) ||
          a.target.localeCompare(b.target) ||
          (a.label ?? '').localeCompare(b.label ?? ''),
      ),
  };
}

describe('renderAsciiDiagram — output shape', () => {
  it('renders a simple two-node diagram with box borders and an arrow', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL);
    const art = renderAsciiDiagram(d);
    expect(art).toContain('┌');
    expect(art).toContain('Alpha');
    expect(art).toContain('Beta');
    expect(art).toContain('▼');
    expect(art).toContain('┬'); // junction on the source's bottom border
    expect(art).toContain('┴'); // junction on the target's top border
  });

  it('emits ASCII vocabulary for ascii-style diagrams', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL_ASCII);
    const art = renderAsciiDiagram(d);
    expect(art).toContain('+--');
    expect(art).toContain('v');
    expect(art).not.toMatch(/[┌─│▼]/u);
  });

  it('honours a style override', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL);
    const art = renderAsciiDiagram(d, { style: 'ascii' });
    expect(art).not.toMatch(/[┌─│▼]/u);
  });

  it('grows a box when its label no longer fits', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL);
    d.nodes[0] = { ...d.nodes[0], label: 'A much longer label than before' };
    const art = renderAsciiDiagram(d);
    expect(art).toContain('A much longer label than before');
    const reparsed = parseAsciiDiagram(art);
    expect(reparsed.nodes.map((n) => n.label)).toContain('A much longer label than before');
  });

  it('never shrinks a parsed box (visual stability)', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL);
    const art = renderAsciiDiagram(d);
    const reparsed = parseAsciiDiagram(art);
    for (const node of reparsed.nodes) {
      const original = d.nodes.find((n) => n.id === node.id);
      expect(node.wCols).toBeGreaterThanOrEqual(original?.wCols ?? 0);
      expect(node.hRows).toBeGreaterThanOrEqual(original?.hRows ?? 0);
    }
  });

  it('renders containers with an embedded top-border title around their children', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.NESTED_CONTAINER);
    const art = renderAsciiDiagram(d);
    expect(art).toContain(' Data Pipeline ');
    const reparsed = parseAsciiDiagram(art);
    const children = reparsed.nodes.filter((n) => n.containerId === 'data-pipeline');
    expect(children).toHaveLength(6);
  });

  it('merges a reciprocal directed pair into one double-arrow line', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.BIDIRECTIONAL);
    const art = renderAsciiDiagram(d);
    expect(art).toContain('◄');
    expect(art).toContain('►');
    // One line, not two.
    const arrowRows = art.split('\n').filter((l) => l.includes('◄') || l.includes('►'));
    expect(arrowRows).toHaveLength(1);
  });

  it('writes edge labels into a horizontal segment', () => {
    const d = parseAsciiDiagram(POSITIVE_FIXTURES.EDGE_LABEL);
    const art = renderAsciiDiagram(d);
    expect(art).toContain(' auth ');
  });

  it('returns empty output for an empty diagram', () => {
    expect(renderAsciiDiagram({ nodes: [], edges: [], style: 'unicode', warnings: [] })).toBe('');
  });
});

describe('renderAsciiDiagram — room for routes', () => {
  const box = (id: string, col: number, row: number, wCols = id.length + 4) => ({
    id,
    label: id,
    col,
    row,
    wCols,
    hRows: 3,
  });
  const fan = (hub: ReturnType<typeof box>, kids: Array<ReturnType<typeof box>>, into = false) =>
    ({
      nodes: [hub, ...kids],
      edges: kids.map((k) => ({
        source: into ? k.id : hub.id,
        target: into ? hub.id : k.id,
        directed: true,
      })),
      style: 'unicode',
      warnings: [],
    }) as AsciiDiagram;
  // An arrowhead with line on both sides means two routes share a jog row.
  const sharedJog = /─[▼▲]─/;
  const rows = (art: string) => art.split('\n').length;

  it('inserts rows when same-way branches outnumber the free rows', () => {
    // Hub at the left end, four children: four jogs heading right, two free rows.
    const kids = ['b', 'c', 'd', 'e'].map((id, i) => box(id, i * 7, 5));
    const d = fan(box('a', 0, 0, 5), kids);
    const art = renderAsciiDiagram(d);
    expect(art).not.toMatch(sharedJog);
    expect(rows(art)).toBeGreaterThan(8);
    expect(semanticSnapshot(parseAsciiDiagram(art))).toEqual(semanticSnapshot(d));
  });

  it('gives a fan-in staircase rows clear of both the arrowheads and the sources', () => {
    const kids = ['b', 'c', 'd'].map((id, i) => box(id, i * 8, 5));
    const d = fan(box('hub', 0, 0, 9), kids, true);
    const art = renderAsciiDiagram(d);
    expect(art).not.toMatch(sharedJog);
    expect(semanticSnapshot(parseAsciiDiagram(art))).toEqual(semanticSnapshot(d));
  });

  it('inserts a row for a jog that has only one free row', () => {
    const d = fan(box('alpha', 0, 0), [box('beta', 12, 4)]);
    const art = renderAsciiDiagram(d);
    expect(semanticSnapshot(parseAsciiDiagram(art))).toEqual(semanticSnapshot(d));
    expect(renderAsciiDiagram(parseAsciiDiagram(art))).toBe(art);
  });

  it('leaves routes that already fit untouched', () => {
    const art = renderAsciiDiagram(parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL));
    expect(rows(art)).toBe(rows(POSITIVE_FIXTURES.TWO_BOX_VERTICAL));
  });
});

describe('renderAsciiDiagram ↔ parseAsciiDiagram fixpoint', () => {
  for (const [name, fixture] of Object.entries(POSITIVE_FIXTURES)) {
    it(`semantic fixpoint + byte idempotence: ${name}`, () => {
      const d1 = parseAsciiDiagram(fixture);
      const t1 = renderAsciiDiagram(d1);
      const d2 = parseAsciiDiagram(t1);
      expect(semanticSnapshot(d2)).toEqual(semanticSnapshot(d1));
      const t2 = renderAsciiDiagram(d2);
      expect(t2).toBe(t1);
      // Three full cycles stay byte-stable.
      const d3 = parseAsciiDiagram(t2);
      const t3 = renderAsciiDiagram(d3);
      expect(t3).toBe(t1);
    });
  }

  it('anti-churn: nudging one node by one column only changes locally', () => {
    const d1 = parseAsciiDiagram(POSITIVE_FIXTURES.TWO_BOX_VERTICAL);
    const t1 = renderAsciiDiagram(d1);
    const d2 = parseAsciiDiagram(t1);
    d2.nodes[1] = { ...d2.nodes[1], col: d2.nodes[1].col + 1 };
    const t2 = renderAsciiDiagram(d2);
    const d3 = parseAsciiDiagram(t2);
    expect(semanticSnapshot(d3)).toEqual(semanticSnapshot(d1));
    // Byte-stable after the nudge normalizes.
    expect(renderAsciiDiagram(d3)).toBe(t2);
  });
});

describe('templateData mapping round-trip', () => {
  for (const [name, fixture] of Object.entries(POSITIVE_FIXTURES)) {
    it(`grid → canvas → grid preserves semantics: ${name}`, () => {
      const d1 = parseAsciiDiagram(fixture);
      const { nodes, edges } = asciiDiagramToTemplateData(d1);
      const d2 = asciiDiagramFromTemplateData(nodes, edges, { style: d1.style });
      expect(semanticSnapshot(d2)).toEqual(semanticSnapshot(d1));
      // Positions survive exactly (the mapping is scale + round).
      for (const node of d2.nodes) {
        const original = d1.nodes.find((n) => n.id === node.id);
        expect({ col: node.col, row: node.row }).toEqual({
          col: original?.col,
          row: original?.row,
        });
      }
    });
  }
});
