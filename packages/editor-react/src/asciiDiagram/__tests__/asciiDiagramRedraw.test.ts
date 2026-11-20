/**
 * `redrawAsciiDiagram` keeps an edit by letting the layout give way: the
 * boxes as placed when that art reads back, else spread apart, else
 * arranged — always starting where the user's diagram starts.
 */

import { describe, expect, it } from 'vitest';
import {
  asciiDiagramMeaning,
  parseAsciiDiagram,
  renderAsciiDiagram,
  type AsciiDiagram,
} from '@bendyline/squisq/doc';
import { addEdgeOp, renameNodeOp, translateDiagramOp } from '../asciiDiagramOps';
import { redrawAsciiDiagram } from '../asciiDiagramRedraw';

const FAN = [
  '              +-----------------+',
  '              |  Your document  |',
  '              +--------+--------+',
  '                       |',
  '    +-----------+------+-----+------------+',
  '    |           |            |            |',
  '    v           v            v            v',
  '+-------+  +--------+  +----------+  +---------+',
  '|  PDF  |  |  Word  |  |  Slides  |  |  Video  |',
  '+-------+  +--------+  +----------+  +---------+',
].join('\n');
const fan = translateDiagramOp(parseAsciiDiagram(FAN), 8, 2);

const topLeft = (d: AsciiDiagram) => ({
  col: Math.min(...d.nodes.map((n) => n.col)),
  row: Math.min(...d.nodes.map((n) => n.row)),
});

function expectFaithful(art: string | null, edited: AsciiDiagram): AsciiDiagram {
  expect(art).not.toBeNull();
  const back = parseAsciiDiagram(art as string);
  expect(asciiDiagramMeaning(back)).toBe(asciiDiagramMeaning(edited));
  return back;
}

describe('redrawAsciiDiagram', () => {
  it('draws the boxes where they are when that art reads back', () => {
    const edited = renameNodeOp(fan, 'video', 'Videos');
    expect(redrawAsciiDiagram(edited)).toBe(renderAsciiDiagram(edited));
  });

  it('spreads the boxes apart when a widened label crowds the routes', () => {
    const edited = renameNodeOp(fan, 'word', 'Videosnhun');
    const art = redrawAsciiDiagram(edited);
    expect(art).not.toBe(renderAsciiDiagram(edited));
    const back = expectFaithful(art, edited);
    expect(topLeft(back)).toEqual(topLeft(parseAsciiDiagram(renderAsciiDiagram(edited))));
  });

  it('arranges the boxes, anchored where the diagram starts, when spreading is not enough', () => {
    const edited = addEdgeOp(fan, 'video', 'pdf');
    const back = expectFaithful(redrawAsciiDiagram(edited), edited);
    expect(topLeft(back).col).toBe(topLeft(edited).col);
  });

  it('draws an empty diagram as nothing', () => {
    const empty: AsciiDiagram = { nodes: [], edges: [], style: 'ascii', warnings: [] };
    expect(redrawAsciiDiagram(empty)).toBe('');
  });
});
