/**
 * Redraw an edited ASCII diagram as art that reads back as the same diagram.
 *
 * The renderer draws every edge with at most one jog and no obstacle
 * avoidance, so some layouts it cannot draw faithfully: a route crosses a
 * box, or two routes touch and merge. Writing that art would corrupt the
 * fence, and refusing the edit throws away what the user just did (a typed
 * label, a new connection). So the edit is kept and the LAYOUT gives way:
 * the edited diagram is tried as positioned, then with its boxes spread
 * further apart, then auto-arranged — the first layout whose art re-parses
 * to the same boxes, labels, containment and connections wins.
 */

import {
  arrangeAsciiDiagram,
  asciiDiagramMeaning,
  ASCII_DIAGRAM_SPREAD_FACTORS,
  parseAsciiDiagram,
  renderAsciiDiagram,
  spreadAsciiDiagram,
  type AsciiDiagram,
} from '@bendyline/squisq/doc';
import { translateDiagramOp } from './asciiDiagramOps';

function topLeft(d: AsciiDiagram): { col: number; row: number } {
  return {
    col: Math.min(...d.nodes.map((n) => n.col)),
    row: Math.min(...d.nodes.map((n) => n.row)),
  };
}

/** Move an alternative layout so it starts where the user's diagram does. */
function anchorTo(layout: AsciiDiagram, diagram: AsciiDiagram): AsciiDiagram {
  const want = topLeft(diagram);
  const have = topLeft(layout);
  return translateDiagramOp(layout, want.col - have.col, want.row - have.row);
}

function* candidateLayouts(diagram: AsciiDiagram): Generator<AsciiDiagram> {
  yield diagram;
  for (const factor of ASCII_DIAGRAM_SPREAD_FACTORS) yield spreadAsciiDiagram(diagram, factor);
  // Arrange returns its input unchanged when no arrangement reads back.
  const arranged = arrangeAsciiDiagram(diagram);
  if (arranged !== diagram) yield anchorTo(arranged, diagram);
}

/**
 * Art for `diagram`, or null when no layout can draw it.
 *
 * Preference order: the first layout that keeps everything; then the first
 * that keeps everything but an edge label (the renderer drops a label it has
 * no room to embed, by design); then the diagram as positioned when it keeps
 * the box and connection counts — the check edits passed before layouts were
 * retried, so nothing that used to apply is refused now.
 */
export function redrawAsciiDiagram(diagram: AsciiDiagram): string | null {
  if (diagram.nodes.length === 0) return renderAsciiDiagram(diagram);
  const exact = asciiDiagramMeaning(diagram);
  const tried: Array<{ art: string; back: AsciiDiagram }> = [];
  for (const layout of candidateLayouts(diagram)) {
    const art = renderAsciiDiagram(layout);
    const back = parseAsciiDiagram(art);
    if (asciiDiagramMeaning(back) === exact) return art;
    tried.push({ art, back });
  }
  const loose = asciiDiagramMeaning(diagram, { edgeLabels: false });
  const keepsAllButLabels = tried.find(
    ({ back }) => asciiDiagramMeaning(back, { edgeLabels: false }) === loose,
  );
  if (keepsAllButLabels) return keepsAllButLabels.art;
  const [asPositioned] = tried;
  if (
    asPositioned.back.nodes.length === diagram.nodes.length &&
    asPositioned.back.edges.length === diagram.edges.length
  ) {
    return asPositioned.art;
  }
  return null;
}
