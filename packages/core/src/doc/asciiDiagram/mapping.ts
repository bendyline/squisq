/**
 * Mapping between the grid-native ASCII diagram model and the diagram
 * canvas / template model (canvas units, the same space as `Block.x`/`y`).
 *
 * Quantization uses plain `round()` per axis — monotonic and local, so a
 * small canvas nudge either changes nothing or moves exactly one cell
 * (cluster-based schemes flap under small moves and churn the art).
 */

import type {
  DiagramEdgeAnchor,
  DiagramTemplateEdge,
  DiagramTemplateNode,
} from '../../schemas/BlockTemplates.js';
import type { Block } from '../../schemas/Doc.js';
import { computeDiagramLayout } from '../templates/diagramLayout.js';
import {
  ASCII_CHAR_H,
  ASCII_CHAR_W,
  type AsciiDiagram,
  type AsciiDiagramEdge,
  type AsciiDiagramNode,
} from './types.js';

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
  const anchors = inferEdgeAnchors(nodes, diagram.edges);
  const edges: DiagramTemplateEdge[] = diagram.edges.map((e, index) => ({
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
    ...(e.directed ? {} : { directed: false }),
    ...anchors[index],
    routing: 'orthogonal',
  }));
  return { nodes, edges };
}

interface EdgeAnchorPair {
  sourceAnchor: DiagramEdgeAnchor;
  targetAnchor: DiagramEdgeAnchor;
}

/**
 * Recover the visual intent carried by orthogonal ASCII art. Aligned fan-outs
 * share a centered source port so their orthogonal routes form one trunk;
 * fan-in ports still spread across the target face to keep arrivals legible.
 */
function inferEdgeAnchors(
  nodes: readonly DiagramTemplateNode[],
  edges: readonly AsciiDiagramEdge[],
): EdgeAnchorPair[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pairs = edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return {
        sourceAnchor: { side: 'right' as const, offset: 0.5 },
        targetAnchor: { side: 'left' as const, offset: 0.5 },
      };
    }
    const sourceW = source.w ?? ASCII_CHAR_W * 12;
    const sourceH = source.h ?? ASCII_CHAR_H * 3;
    const targetW = target.w ?? ASCII_CHAR_W * 12;
    const targetH = target.h ?? ASCII_CHAR_H * 3;
    const dx = target.x + targetW / 2 - (source.x + sourceW / 2);
    const dy = target.y + targetH / 2 - (source.y + sourceH / 2);
    const horizontalDistance = Math.abs(dx) / Math.max(1, (sourceW + targetW) / 2);
    const verticalDistance = Math.abs(dy) / Math.max(1, (sourceH + targetH) / 2);
    if (verticalDistance >= horizontalDistance) {
      return dy >= 0
        ? {
            sourceAnchor: { side: 'bottom' as const, offset: 0.5 },
            targetAnchor: { side: 'top' as const, offset: 0.5 },
          }
        : {
            sourceAnchor: { side: 'top' as const, offset: 0.5 },
            targetAnchor: { side: 'bottom' as const, offset: 0.5 },
          };
    }
    return dx >= 0
      ? {
          sourceAnchor: { side: 'right' as const, offset: 0.5 },
          targetAnchor: { side: 'left' as const, offset: 0.5 },
        }
      : {
          sourceAnchor: { side: 'left' as const, offset: 0.5 },
          targetAnchor: { side: 'right' as const, offset: 0.5 },
        };
  });

  distributeOffsets(pairs, edges, nodes, 'source');
  distributeOffsets(pairs, edges, nodes, 'target');
  coalesceAlignedFanOutAnchors(pairs, edges, nodes);
  return pairs;
}

/**
 * When every target in a fan-out sits wholly on the same side of its source,
 * preserve the bus/trunk topology visible in the ASCII art. Centered matching
 * ports make `connectorPath('orthogonal', ...)` share the initial segment and
 * crossbar instead of drawing a bundle of unrelated elbows.
 */
function coalesceAlignedFanOutAnchors(
  pairs: EdgeAnchorPair[],
  edges: readonly AsciiDiagramEdge[],
  nodes: readonly DiagramTemplateNode[],
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const group = groups.get(edge.source) ?? [];
    group.push(index);
    groups.set(edge.source, group);
  });

  for (const [sourceId, indexes] of groups) {
    if (indexes.length < 2) continue;
    const source = nodeById.get(sourceId);
    const targets = indexes
      .map((index) => nodeById.get(edges[index].target))
      .filter((node): node is DiagramTemplateNode => node !== undefined);
    if (!source || targets.length !== indexes.length) continue;

    const sourceW = source.w ?? ASCII_CHAR_W * 12;
    const sourceH = source.h ?? ASCII_CHAR_H * 3;
    const sourceRight = source.x + sourceW;
    const sourceBottom = source.y + sourceH;
    const targetRight = (target: DiagramTemplateNode) => target.x + (target.w ?? ASCII_CHAR_W * 12);
    const targetBottom = (target: DiagramTemplateNode) => target.y + (target.h ?? ASCII_CHAR_H * 3);

    let sourceSide: DiagramEdgeAnchor['side'] | undefined;
    let targetSide: DiagramEdgeAnchor['side'] | undefined;
    if (targets.every((target) => target.y >= sourceBottom)) {
      sourceSide = 'bottom';
      targetSide = 'top';
    } else if (targets.every((target) => targetBottom(target) <= source.y)) {
      sourceSide = 'top';
      targetSide = 'bottom';
    } else if (targets.every((target) => target.x >= sourceRight)) {
      sourceSide = 'right';
      targetSide = 'left';
    } else if (targets.every((target) => targetRight(target) <= source.x)) {
      sourceSide = 'left';
      targetSide = 'right';
    }
    if (!sourceSide || !targetSide) continue;

    for (const index of indexes) {
      pairs[index] = {
        sourceAnchor: { side: sourceSide, offset: 0.5 },
        targetAnchor: { side: targetSide, offset: 0.5 },
      };
    }
  }
}

function distributeOffsets(
  pairs: EdgeAnchorPair[],
  edges: readonly AsciiDiagramEdge[],
  nodes: readonly DiagramTemplateNode[],
  endpoint: 'source' | 'target',
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, number[]>();
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    const anchor = endpoint === 'source' ? pairs[index].sourceAnchor : pairs[index].targetAnchor;
    const nodeId = endpoint === 'source' ? edge.source : edge.target;
    const key = `${nodeId}:${anchor.side}`;
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  }
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const side =
      endpoint === 'source'
        ? pairs[indexes[0]].sourceAnchor.side
        : pairs[indexes[0]].targetAnchor.side;
    indexes.sort((a, b) => {
      const oppositeA = nodeById.get(endpoint === 'source' ? edges[a].target : edges[a].source);
      const oppositeB = nodeById.get(endpoint === 'source' ? edges[b].target : edges[b].source);
      const axisA = side === 'top' || side === 'bottom' ? (oppositeA?.x ?? 0) : (oppositeA?.y ?? 0);
      const axisB = side === 'top' || side === 'bottom' ? (oppositeB?.x ?? 0) : (oppositeB?.y ?? 0);
      return axisA - axisB || a - b;
    });
    indexes.forEach((edgeIndex, rank) => {
      const anchor =
        endpoint === 'source' ? pairs[edgeIndex].sourceAnchor : pairs[edgeIndex].targetAnchor;
      anchor.offset = (rank + 1) / (indexes.length + 1);
    });
  }
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
