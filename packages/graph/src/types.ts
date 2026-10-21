/**
 * Public contract for squisq-graph: a graph in, positions and routes out.
 *
 * Coordinates are in whatever unit the caller sizes nodes in — pixels for a
 * canvas, character cells for an ASCII diagram. `x`/`y` are top-left corners,
 * absolute (not relative to a container), with y growing downward.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNodeInput {
  /** Unique within the graph. */
  id: string;
  /** Box size. For a container, the minimum size (its label, say); the layout grows it to fit. */
  width: number;
  height: number;
  /** Id of the container node that holds this node. Any node another node names is a container. */
  parent?: string;
}

export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
  /** Heavier edges are kept shorter and straighter. Default 1. */
  weight?: number;
}

export interface LayoutGraph {
  /** Model order matters: ties are always broken by input order, so a stable input lays out stably. */
  nodes: readonly LayoutNodeInput[];
  edges: readonly LayoutEdgeInput[];
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutOptions {
  /** Which way dependencies flow: sources on the left (`right`) or on top (`down`). Default `right`. */
  direction?: 'right' | 'down';
  /** Gap between neighboring nodes in one layer. Default 20. */
  nodeSpacing?: number;
  /** Minimum gap between two layers; widened when a gap needs more routing tracks. Default 48. */
  layerSpacing?: number;
  /** Gap between parallel edge segments, and the thickness reserved for an edge passing a layer. Default 8. */
  edgeSpacing?: number;
  /** Gap between unconnected parts of the graph. Default 40. */
  componentSpacing?: number;
  /** Space inside a container around its contents, in the output frame (top holds the label). */
  containerPadding?: Partial<Padding>;
  /** Width-to-height target when packing unconnected parts side by side. Default 1.6. */
  aspectRatio?: number;
  /** Ordering passes; more find fewer crossings on dense graphs. Default 24. */
  orderingSweeps?: number;
  /** Placement passes; more straighten long edges further. Default 12. */
  placementSweeps?: number;
  /**
   * How edges crossing a container's border share ports. `neighbor`: one port
   * per outside neighbor, so each trunk leaving a container names where it
   * goes. `container`: one port per side, so the contents of a container show
   * a single line per node toward the way out. Default `neighbor`.
   */
  portSharing?: 'neighbor' | 'container';
  /**
   * Round every coordinate to a whole number. For grids such as character
   * cells, where sizes and spacings are whole numbers too. Default false.
   */
  integerCoordinates?: boolean;
}

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True for a node that holds other nodes. */
  container: boolean;
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
  /**
   * The route from the source's boundary to the target's, axis-aligned
   * segments only (consecutive points share an x or a y). At least two points.
   */
  points: Point[];
  /** True when the edge runs against the flow (it closes a cycle). */
  reversed: boolean;
}

export interface LayoutStats {
  /** Edge crossings between adjacent layers, summed over every container. */
  crossings: number;
  /** Edges drawn against the flow to break cycles. */
  reversedEdges: number;
  /** Bend points inserted to carry long edges past intermediate layers. */
  dummyNodes: number;
  /** Edges dropped: unknown endpoints, self-loops, or a container linked to its own contents. */
  droppedEdges: number;
}

export interface LayoutResult {
  /** Every input node, in input order. */
  nodes: LaidOutNode[];
  /** Every kept edge, in input order. */
  edges: LaidOutEdge[];
  /** Size of the whole drawing; everything lies within `[0, width] × [0, height]`. */
  width: number;
  height: number;
  stats: LayoutStats;
}
