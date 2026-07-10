/**
 * Mapping between the grid-native ASCII diagram model and the diagram
 * canvas / template model (canvas units, the same space as `Block.x`/`y`).
 *
 * Quantization uses plain `round()` per axis — monotonic and local, so a
 * small canvas nudge either changes nothing or moves exactly one cell
 * (cluster-based schemes flap under small moves and churn the art).
 */

import type { DiagramTemplateEdge, DiagramTemplateNode } from '../../schemas/BlockTemplates.js';
import type { Block } from '../../schemas/Doc.js';
import { computeDiagramLayout } from '../templates/diagramLayout.js';
import { ASCII_CHAR_H, ASCII_CHAR_W, type AsciiDiagram, type AsciiDiagramNode } from './types.js';

export function asciiCellToCanvas(col: number, row: number): { x: number; y: number } {
  return { x: col * ASCII_CHAR_W, y: row * ASCII_CHAR_H };
}

export function canvasToAsciiCell(x: number, y: number): { col: number; row: number } {
  return {
    col: Math.max(0, Math.round(x / ASCII_CHAR_W)),
    row: Math.max(0, Math.round(y / ASCII_CHAR_H)),
  };
}

/** Grid model → template/canvas model (`templateData.nodes`/`edges`). */
export function asciiDiagramToTemplateData(diagram: AsciiDiagram): {
  nodes: DiagramTemplateNode[];
  edges: DiagramTemplateEdge[];
} {
  const nodes: DiagramTemplateNode[] = diagram.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    ...asciiCellToCanvas(n.col, n.row),
    w: n.wCols * ASCII_CHAR_W,
    h: n.hRows * ASCII_CHAR_H,
    ...(n.containerId ? { container: n.containerId } : {}),
  }));
  const edges: DiagramTemplateEdge[] = diagram.edges.map((e) => ({
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
    ...(e.directed ? {} : { directed: false }),
  }));
  return { nodes, edges };
}

/** Template/canvas model → grid model, quantizing positions and sizes. */
export function asciiDiagramFromTemplateData(
  nodes: readonly DiagramTemplateNode[],
  edges: readonly DiagramTemplateEdge[],
  options: { style?: 'unicode' | 'ascii' } = {},
): AsciiDiagram {
  const ids = new Set(nodes.map((n) => n.id));
  const outNodes: AsciiDiagramNode[] = nodes.map((n) => {
    const { col, row } = canvasToAsciiCell(n.x, n.y);
    const labelLines = n.label.length > 0 ? n.label.split('\n') : [];
    const innerW = labelLines.reduce((w, l) => Math.max(w, l.length), 0);
    const wCols =
      typeof n.w === 'number' ? Math.max(3, Math.round(n.w / ASCII_CHAR_W)) : innerW + 4;
    const hRows =
      typeof n.h === 'number' ? Math.max(3, Math.round(n.h / ASCII_CHAR_H)) : labelLines.length + 2;
    return {
      id: n.id,
      label: n.label,
      col,
      row,
      wCols: Math.max(wCols, 3),
      hRows: Math.max(hRows, 3),
      ...(n.container && ids.has(n.container) && n.container !== n.id
        ? { containerId: n.container }
        : {}),
    };
  });
  return {
    nodes: outNodes,
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        ...(e.label ? { label: e.label } : {}),
        directed: e.directed !== false,
      })),
    style: options.style ?? 'unicode',
    warnings: [],
  };
}

/**
 * Legacy heading-based diagram children → ASCII diagram model. Used to
 * migrate `### Node {#id x= y= connectsTo=}` sections to ASCII fences;
 * positions run through the shared `computeDiagramLayout` so unpinned
 * children get the same grid placement as the legacy renderer.
 */
export function asciiDiagramFromBlocks(
  children: readonly Block[],
  options: { style?: 'unicode' | 'ascii' } = {},
): AsciiDiagram {
  const layout = computeDiagramLayout(children);
  const nodes: DiagramTemplateNode[] = layout.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    x: n.x,
    y: n.y,
  }));
  const edges: DiagramTemplateEdge[] = layout.edges.map((e) => ({
    source: e.source,
    target: e.target,
    ...(e.type ? { label: e.type } : {}),
  }));
  const diagram = asciiDiagramFromTemplateData(nodes, edges, options);
  diagram.warnings.push(...layout.warnings);
  return diagram;
}
