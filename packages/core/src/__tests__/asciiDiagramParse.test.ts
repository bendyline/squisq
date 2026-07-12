import { describe, expect, it } from 'vitest';
import { parseAsciiDiagram } from '../doc/asciiDiagram/index.js';
import {
  BIDIRECTIONAL,
  CONTAINER_EMBEDDED_TITLE,
  DUPLICATE_LABELS,
  EDGE_LABEL,
  EDGE_LABEL_SPACED,
  FAN_OUT_BUS,
  FAN_OUT_COLUMNS,
  MULTILINE_LABELS,
  NESTED_CONTAINER,
  PARALLEL_DUPES,
  ROUNDED_AND_DOUBLE,
  SECTIONED_CARD,
  SINGLE_BOX,
  STACKED_SHARED_BORDER_ASCII,
  TWO_BOX_HORIZONTAL_ASCII,
  TWO_BOX_HORIZONTAL_UNICODE,
  TWO_BOX_VERTICAL,
  TWO_BOX_VERTICAL_ASCII,
  UNDIRECTED,
} from './fixtures/asciiDiagrams.js';

describe('parseAsciiDiagram — boxes and labels', () => {
  it('parses two unicode boxes with a vertical arrow', () => {
    const d = parseAsciiDiagram(TWO_BOX_VERTICAL);
    expect(d.nodes.map((n) => n.id)).toEqual(['alpha', 'beta']);
    expect(d.nodes[0].label).toBe('Alpha');
    expect(d.style).toBe('unicode');
    expect(d.edges).toEqual([{ source: 'alpha', target: 'beta', directed: true }]);
  });

  it('parses the identical ASCII art with the same semantics', () => {
    const d = parseAsciiDiagram(TWO_BOX_VERTICAL_ASCII);
    expect(d.nodes.map((n) => n.id)).toEqual(['alpha', 'beta']);
    expect(d.style).toBe('ascii');
    expect(d.edges).toEqual([{ source: 'alpha', target: 'beta', directed: true }]);
  });

  it('records grid geometry (col/row/wCols/hRows)', () => {
    const d = parseAsciiDiagram(TWO_BOX_VERTICAL);
    expect(d.nodes[0]).toMatchObject({ col: 0, row: 0, wCols: 10, hRows: 3 });
    expect(d.nodes[1]).toMatchObject({ col: 0, row: 5, wCols: 10, hRows: 3 });
  });

  it('keeps multi-line labels verbatim (trimmed, newline-joined)', () => {
    const d = parseAsciiDiagram(MULTILINE_LABELS);
    const kernel = d.nodes.find((n) => n.id === 'molen-kernel');
    expect(kernel?.label).toBe('molen-kernel\nheadless sim\nno DOM');
  });

  it('splits ├──┤ sectioned cards into stacked sibling nodes', () => {
    const d = parseAsciiDiagram(SECTIONED_CARD);
    expect(d.nodes.map((n) => n.id)).toEqual(['header', 'body']);
    expect(d.edges).toHaveLength(0);
  });

  it('parses ASCII stacked shared-border boxes as siblings, without overlap warnings', () => {
    const d = parseAsciiDiagram(STACKED_SHARED_BORDER_ASCII);
    expect(d.nodes.map((n) => n.id)).toEqual(['upper', 'lower']);
    expect(d.nodes.every((n) => n.containerId === undefined)).toBe(true);
    expect(d.warnings).not.toContain('overlapping-boxes');
  });

  it('deduplicates ids for repeated labels in reading order', () => {
    const d = parseAsciiDiagram(DUPLICATE_LABELS);
    expect(d.nodes.map((n) => n.id)).toEqual(['cache', 'cache-2']);
    // Stable across re-parses of identical text.
    expect(parseAsciiDiagram(DUPLICATE_LABELS).nodes.map((n) => n.id)).toEqual([
      'cache',
      'cache-2',
    ]);
  });

  it('parses rounded and double-line corners', () => {
    const d = parseAsciiDiagram(ROUNDED_AND_DOUBLE);
    expect(d.nodes.map((n) => n.id)).toEqual(['round', 'double']);
  });

  it('parses a single box with no edges', () => {
    const d = parseAsciiDiagram(SINGLE_BOX);
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toHaveLength(0);
  });

  it('never throws on garbage / empty input', () => {
    expect(parseAsciiDiagram('').nodes).toHaveLength(0);
    expect(parseAsciiDiagram('hello world').nodes).toHaveLength(0);
    expect(parseAsciiDiagram('┌──\n│').nodes).toHaveLength(0);
  });

  it('handles CRLF and tab input', () => {
    const crlf = TWO_BOX_VERTICAL.replace(/\n/g, '\r\n');
    expect(parseAsciiDiagram(crlf).nodes.map((n) => n.id)).toEqual(['alpha', 'beta']);
    const tabbed = `\t${SINGLE_BOX.split('\n').join('\n\t')}`;
    const d = parseAsciiDiagram(tabbed);
    expect(d.nodes).toHaveLength(1);
    expect(d.warnings).toContain('tabs-expanded');
  });

  it('does not spawn phantom edges from label text containing | and -', () => {
    const art = [
      '┌─────────────┐     ┌─────────────┐',
      '│ a | b - c   │     │ other box   │',
      '└─────────────┘     └─────────────┘',
    ].join('\n');
    const d = parseAsciiDiagram(art);
    expect(d.nodes).toHaveLength(2);
    expect(d.edges).toHaveLength(0);
  });
});

describe('parseAsciiDiagram — edges', () => {
  it('parses --> as a directed horizontal edge', () => {
    const d = parseAsciiDiagram(TWO_BOX_HORIZONTAL_ASCII);
    expect(d.edges).toEqual([{ source: 'input', target: 'output', directed: true }]);
  });

  it('parses ────► as a directed horizontal edge', () => {
    const d = parseAsciiDiagram(TWO_BOX_HORIZONTAL_UNICODE);
    expect(d.edges).toEqual([{ source: 'input', target: 'output', directed: true }]);
  });

  it('parses a plain line as undirected with topmost-leftmost source', () => {
    const d = parseAsciiDiagram(UNDIRECTED);
    expect(d.edges).toEqual([{ source: 'left', target: 'right', directed: false }]);
  });

  it('parses ◄──► as two directed edges', () => {
    const d = parseAsciiDiagram(BIDIRECTIONAL);
    expect(d.edges).toEqual([
      { source: 'peer', target: 'peer-2', directed: true },
      { source: 'peer-2', target: 'peer', directed: true },
    ]);
  });

  it('parses separate arrow columns from one wide box as distinct edges', () => {
    const d = parseAsciiDiagram(FAN_OUT_COLUMNS);
    expect(d.edges).toEqual([
      { source: 'source', target: 'one', directed: true },
      { source: 'source', target: 'two', directed: true },
    ]);
  });

  it('parses a ┌──┴──┐ bus split as a fan-out from the junction-attached box', () => {
    const d = parseAsciiDiagram(FAN_OUT_BUS);
    expect(d.edges).toEqual([
      { source: 'source', target: 'one', directed: true },
      { source: 'source', target: 'two', directed: true },
    ]);
  });

  it('dedupes parallel identical lines to one edge with a warning', () => {
    const d = parseAsciiDiagram(PARALLEL_DUPES);
    expect(d.edges).toEqual([{ source: 'wide-a', target: 'wide-b', directed: true }]);
    expect(d.warnings).toContain('parallel-edges-merged');
  });

  it('captures an embedded horizontal edge label', () => {
    const d = parseAsciiDiagram(EDGE_LABEL);
    expect(d.edges).toEqual([
      { source: 'client', target: 'server', label: 'auth', directed: true },
    ]);
  });

  it('captures an embedded label with internal spaces', () => {
    const d = parseAsciiDiagram(EDGE_LABEL_SPACED);
    expect(d.edges).toEqual([
      { source: 'client', target: 'server', label: 'auth flow', directed: true },
    ]);
  });
});

describe('parseAsciiDiagram — containers', () => {
  it('parses the nested AI-style container fixture', () => {
    const d = parseAsciiDiagram(NESTED_CONTAINER);
    const container = d.nodes.find((n) => n.id === 'data-pipeline');
    expect(container).toBeDefined();
    expect(container?.containerId).toBeUndefined();
    const children = d.nodes.filter((n) => n.containerId === 'data-pipeline');
    expect(children.map((n) => n.id).sort()).toEqual([
      'enrich',
      'export',
      'gold',
      'ingest',
      'raw',
      'silver',
    ]);
    expect(d.edges).toEqual([
      { source: 'enrich', target: 'silver', directed: true },
      { source: 'export', target: 'gold', directed: true },
      { source: 'ingest', target: 'raw', directed: true },
    ]);
  });

  it('reads a title embedded in the container top border', () => {
    const d = parseAsciiDiagram(CONTAINER_EMBEDDED_TITLE);
    const container = d.nodes.find((n) => n.id === 'cluster');
    expect(container?.label).toBe('Cluster');
    const worker = d.nodes.find((n) => n.id === 'worker');
    expect(worker?.containerId).toBe('cluster');
  });
});

describe('parseAsciiDiagram — hand-drawn robustness', () => {
  it('treats an arrowhead embedded in the top border as a stem, not a title', () => {
    // An incoming edge often lands in the border (`┌───▼───┐`). The arrowhead
    // must not be captured as the box label, and the box must still close.
    const art = ['┌───▼───┐', '│ Alpha │', '└───────┘', '┌───────┐', '│ Beta  │', '└───────┘'].join(
      '\n',
    );
    const d = parseAsciiDiagram(art);
    expect(d.nodes.map((n) => n.label.split('\n')[0])).toEqual(['Alpha', 'Beta']);
  });

  it('traces a box whose side border overflowed on one interior row', () => {
    // A label wider than its box leaves a gap where the `│` should be. The
    // four corners + solid top/bottom borders still anchor the box.
    const art = [
      '┌──────────┐',
      '│ Alpha    │',
      '│ a wide overflowing note',
      '│ tail     │',
      '└──────────┘',
      '┌──────────┐',
      '│ Beta     │',
      '└──────────┘',
    ].join('\n');
    const d = parseAsciiDiagram(art);
    expect(d.nodes.map((n) => n.label.split('\n')[0])).toEqual(['Alpha', 'Beta']);
  });
});
