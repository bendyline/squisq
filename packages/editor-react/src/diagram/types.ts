/** Data shapes consumed by `DiagramCanvas` / `buildDiagramScene`. */

export interface DiagramNode {
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

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** False → no end arrowhead. Undefined keeps the diagram default (arrow). */
  directed?: boolean;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  warnings: string[];
}
