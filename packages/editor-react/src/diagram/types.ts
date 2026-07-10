/**
 * Data shapes consumed by `DiagramCanvas` / `buildDiagramScene`.
 *
 * The `RF` prefix is a React Flow legacy — the canvas is rendered by the
 * in-house Scene engine now, but the flat node/edge shape was kept when
 * the renderer was swapped.
 */

export interface DiagramRFNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string };
  type?: string;
  /** Per-node width override in canvas units. */
  width?: number;
  /** Per-node height override in canvas units. */
  height?: number;
  /** Render as a background container card (top-anchored label, muted fill). */
  kind?: 'container';
}

export interface DiagramRFEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** False → no end arrowhead. Undefined keeps the diagram default (arrow). */
  directed?: boolean;
}

export interface DiagramData {
  nodes: DiagramRFNode[];
  edges: DiagramRFEdge[];
  warnings: string[];
}
