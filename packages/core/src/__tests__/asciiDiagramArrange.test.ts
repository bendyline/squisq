import { describe, expect, it } from 'vitest';
import {
  arrangeAsciiDiagram,
  parseAsciiDiagram,
  renderAsciiDiagram,
  type AsciiDiagram,
} from '../doc/asciiDiagram/index.js';
import { POSITIVE_FIXTURES } from './fixtures/asciiDiagrams.js';

/** What the art means, independent of where its boxes sit. */
function meaning(d: AsciiDiagram) {
  const labelOf = new Map(d.nodes.map((n) => [n.id, n.label]));
  return {
    nodes: d.nodes
      .map((n) => `${n.label}|${n.containerId ? labelOf.get(n.containerId) : ''}`)
      .sort(),
    edges: d.edges
      .map((e) => {
        const ends = [labelOf.get(e.source)!, labelOf.get(e.target)!];
        // An undirected line has no source or target to preserve.
        if (!e.directed) ends.sort();
        return `${ends.join('>')}|${e.label ?? ''}|${e.directed}`;
      })
      .sort(),
  };
}

const CHAIN = `
┌──────┐     ┌──────┐
│ Load │────▶│ Save │
└──────┘     └──────┘

      ┌───────┐
      │ Parse │
      └───────┘
`;

describe('arrangeAsciiDiagram', () => {
  for (const [name, art] of Object.entries(POSITIVE_FIXTURES)) {
    for (const direction of ['right', 'down'] as const) {
      it(`${name} (${direction}) keeps its meaning through render and re-parse`, () => {
        const parsed = parseAsciiDiagram(art);
        const arranged = arrangeAsciiDiagram(parsed, { direction });
        const reparsed = parseAsciiDiagram(renderAsciiDiagram(arranged));
        expect(meaning(reparsed)).toEqual(meaning(parsed));
      });
    }
  }

  it('lines a chain up along the flow', () => {
    const d: AsciiDiagram = {
      nodes: ['Load', 'Parse', 'Check', 'Save'].map((label, i) => ({
        id: label.toLowerCase(),
        label,
        col: 0,
        row: i * 6,
        wCols: label.length + 4,
        hRows: 3,
      })),
      edges: [
        { source: 'load', target: 'parse', directed: true },
        { source: 'parse', target: 'check', directed: true },
        { source: 'check', target: 'save', directed: true },
      ],
      style: 'unicode',
      warnings: [],
    };
    const right = arrangeAsciiDiagram(d, { direction: 'right' });
    const at = (id: string) => right.nodes.find((n) => n.id === id)!;
    expect(at('load').col).toBeLessThan(at('parse').col);
    expect(at('parse').col).toBeLessThan(at('check').col);
    expect(at('check').col).toBeLessThan(at('save').col);
    expect(new Set(right.nodes.map((n) => n.row)).size).toBe(1);

    const down = arrangeAsciiDiagram(d);
    const below = (id: string) => down.nodes.find((n) => n.id === id)!;
    expect(below('load').row).toBeLessThan(below('parse').row);
    expect(below('check').row).toBeLessThan(below('save').row);
  });

  it('puts the source before the target when a box was drawn out of order', () => {
    const arranged = arrangeAsciiDiagram(parseAsciiDiagram(CHAIN));
    const at = (label: string) => arranged.nodes.find((n) => n.label === label)!;
    expect(at('Load').row + at('Load').hRows).toBeLessThanOrEqual(at('Save').row);
    expect(arranged.nodes.map((n) => [n.row, n.col])).toEqual(
      [...arranged.nodes].sort((a, b) => a.row - b.row || a.col - b.col).map((n) => [n.row, n.col]),
    );
  });

  it('is stable: arranging an arranged diagram changes nothing', () => {
    for (const art of Object.values(POSITIVE_FIXTURES)) {
      const once = renderAsciiDiagram(arrangeAsciiDiagram(parseAsciiDiagram(art)));
      const twice = renderAsciiDiagram(arrangeAsciiDiagram(parseAsciiDiagram(once)));
      expect(twice).toBe(once);
    }
  });

  it('falls back to the flow the renderer can draw rather than lose an edge', () => {
    // Left to right, a three-way fan stacks targets above and below the
    // source's rows, which the renderer would join top to bottom instead.
    const parsed = parseAsciiDiagram(POSITIVE_FIXTURES.RAIL_FAN_OUT);
    const arranged = arrangeAsciiDiagram(parsed, { direction: 'right' });
    expect(meaning(parseAsciiDiagram(renderAsciiDiagram(arranged)))).toEqual(meaning(parsed));
  });

  it('leaves an empty diagram alone', () => {
    const empty: AsciiDiagram = { nodes: [], edges: [], style: 'unicode', warnings: [] };
    expect(arrangeAsciiDiagram(empty)).toBe(empty);
  });
});
