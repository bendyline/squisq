import { describe, expect, it } from 'vitest';
import { parseAsciiDiagram, type AsciiDiagram } from '@bendyline/squisq/doc';
import {
  addEdgeOp,
  addNodeOp,
  moveNodeOp,
  removeEdgeOp,
  removeNodeOp,
  renameNodeOp,
  resizeNodeOp,
  sanitizeAsciiLabel,
} from '../asciiDiagramOps';

const TWO_BOX = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    │',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

const NESTED = [
  '┌─── Cluster ────┐',
  '│  ┌──────────┐  │',
  '│  │ Worker   │  │',
  '│  └──────────┘  │',
  '└────────────────┘',
].join('\n');

const ROW = [
  '┌─────┐ ┌───────┐ ┌───────┐ ┌───────┐',
  '│  A  │ │   B   │ │   C   │ │   D   │',
  '└─────┘ └───────┘ └───────┘ └───────┘',
].join('\n');

const TIGHT_ROW = [
  '┌───────┐ ┌─────────┐ ┌────────────┐',
  '│ Pages │ │Documents│ │ Slideshows │',
  '└───────┘ └─────────┘ └────────────┘',
].join('\n');

function base(): AsciiDiagram {
  return parseAsciiDiagram(TWO_BOX);
}

describe('sanitizeAsciiLabel', () => {
  it('strips structural glyphs, backticks, and newlines', () => {
    expect(sanitizeAsciiLabel('a │ b ── c ▼ `d`\ne')).toBe('a b c d e');
  });
});

describe('asciiDiagramOps', () => {
  it('moveNodeOp translates a node without mutating the input', () => {
    const d = base();
    const next = moveNodeOp(d, 'beta', 20, 10);
    expect(next.nodes.find((n) => n.id === 'beta')).toMatchObject({ col: 20, row: 10 });
    expect(d.nodes.find((n) => n.id === 'beta')).toMatchObject({ col: 0, row: 5 });
  });

  it('moveNodeOp on a container translates the whole subtree', () => {
    const d = parseAsciiDiagram(NESTED);
    const worker = d.nodes.find((n) => n.id === 'worker');
    const next = moveNodeOp(d, 'cluster', 10, 8);
    const movedWorker = next.nodes.find((n) => n.id === 'worker');
    expect(movedWorker?.col).toBe((worker?.col ?? 0) + 10);
    expect(movedWorker?.row).toBe((worker?.row ?? 0) + 8);
  });

  it('resizeNodeOp clamps to the label minimum', () => {
    const next = resizeNodeOp(base(), 'alpha', 1, 1);
    const alpha = next.nodes.find((n) => n.id === 'alpha');
    expect(alpha?.wCols).toBeGreaterThanOrEqual('Alpha'.length + 4);
    expect(alpha?.hRows).toBeGreaterThanOrEqual(3);
  });

  it('addEdgeOp adds directed edges and dedupes', () => {
    const d = base();
    const withEdge = addEdgeOp(d, 'beta', 'alpha', 'back');
    expect(withEdge.edges).toHaveLength(2);
    expect(addEdgeOp(withEdge, 'beta', 'alpha', 'back').edges).toHaveLength(2);
    // Self-edges and unknown endpoints are no-ops.
    expect(addEdgeOp(d, 'alpha', 'alpha')).toBe(d);
    expect(addEdgeOp(d, 'alpha', 'ghost')).toBe(d);
  });

  it('removeEdgeOp removes the first (source, target) match', () => {
    const next = removeEdgeOp(base(), 'alpha', 'beta');
    expect(next.edges).toHaveLength(0);
  });

  it('renameNodeOp sanitizes and updates the label', () => {
    const next = renameNodeOp(base(), 'alpha', 'Gate │ way');
    expect(next.nodes.find((n) => n.id === 'alpha')?.label).toBe('Gate way');
  });

  it('renameNodeOp shifts crowded right-hand siblings so the wider box keeps its gap', () => {
    const d = parseAsciiDiagram(ROW);
    const next = renameNodeOp(d, 'b', 'Bravo and more');
    const col = (id: string) => next.nodes.find((n) => n.id === id)?.col;
    // `Bravo and more` renders 18 wide from col 8 → right edge 25, plus one gap.
    expect(col('a')).toBe(0);
    expect(col('c')).toBe(27);
    expect(col('d')).toBe(d.nodes[3].col + (27 - d.nodes[2].col));
  });

  it('renameNodeOp leaves the layout alone when the wider box still fits', () => {
    const d = parseAsciiDiagram(ROW);
    const next = renameNodeOp(d, 'd', 'Delta and more');
    expect(next.nodes.map((n) => n.col)).toEqual(d.nodes.map((n) => n.col));
  });

  it('renameNodeOp measures crowding from the drawn edge of a tight box', () => {
    // `│Documents│` is drawn 11 wide but renders 13 (label + 4); growing it
    // must also cover that pre-existing overhang into Slideshows.
    const d = parseAsciiDiagram(TIGHT_ROW);
    const next = renameNodeOp(d, 'documents', 'Documentsaa');
    const slideshows = next.nodes.find((n) => n.id === 'slideshows');
    expect(slideshows?.col).toBe(10 + 'Documentsaa'.length + 4 + 1);
  });

  it('addNodeOp picks a fresh label and inherits containment', () => {
    const nested = parseAsciiDiagram(NESTED);
    const cluster = nested.nodes.find((n) => n.id === 'cluster');
    const inside = addNodeOp(nested, {
      col: (cluster?.col ?? 0) + 2,
      row: (cluster?.row ?? 0) + 1,
    });
    const added = inside.diagram.nodes[inside.diagram.nodes.length - 1];
    expect(added.label).toBe('Node 1');
    expect(added.containerId).toBe('cluster');

    const outside = addNodeOp(nested, { col: 100, row: 100 });
    const addedOutside = outside.diagram.nodes[outside.diagram.nodes.length - 1];
    expect(addedOutside.containerId).toBeUndefined();
  });

  it('removeNodeOp drops incident edges and promotes children', () => {
    const d = base();
    const next = removeNodeOp(d, 'beta');
    expect(next.nodes.map((n) => n.id)).toEqual(['alpha']);
    expect(next.edges).toHaveLength(0);

    const nested = parseAsciiDiagram(NESTED);
    const promoted = removeNodeOp(nested, 'cluster');
    expect(promoted.nodes.map((n) => n.id)).toEqual(['worker']);
    expect(promoted.nodes[0].containerId).toBeUndefined();
  });
});
