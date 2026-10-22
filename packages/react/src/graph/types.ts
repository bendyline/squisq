import type { CSSProperties } from 'react';
import type { LayoutResult } from '@bendyline/squisq-graph';

/**
 * A named color role. Hosts map each to their palette through
 * `--squisq-graph-tone-<tone>`; `neutral` is the plain node.
 */
export type GraphTone =
  'neutral' | 'accent' | 'positive' | 'notice' | 'warning' | 'danger' | 'muted';

/** How one laid-out node is drawn. Matched to `LayoutResult.nodes` by id. */
export interface GraphViewNode {
  id: string;
  label: string;
  /** A smaller second line (a folder, a count). Size the node with `graphNodeSize` to fit it. */
  detail?: string;
  /** A short chip at the right edge, such as a count of findings. */
  badge?: string;
  tone?: GraphTone;
  /** An explicit fill, for color lenses; wins over the tone's. */
  fill?: string;
  /** Show a toggle: a collapsed group that can open, or an open container that can close. */
  expandable?: boolean;
  expanded?: boolean;
  /** Tooltip; defaults to the label. */
  title?: string;
  className?: string;
}

/** How one routed edge is drawn. Matched to `LayoutResult.edges` by id. */
export interface GraphViewEdge {
  id: string;
  /** Line weight; width grows with its logarithm. Default 1. */
  weight?: number;
  dashed?: boolean;
  /** Arrowheads at both ends. */
  bidirectional?: boolean;
  tone?: GraphTone;
  /** Tooltip. */
  title?: string;
  className?: string;
}

export interface DiagramViewerProps {
  /** Positions and routes from `@bendyline/squisq-graph`. */
  layout: LayoutResult;
  /** Presentation per node id; a node without one shows its id. */
  nodes?: readonly GraphViewNode[];
  edges?: readonly GraphViewEdge[];
  /** Controlled selection (node ids). */
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Double-click or Enter on a node. */
  onNodeActivate?: (id: string) => void;
  /** A toggle was clicked, or Space pressed on an expandable node; `expanded` is the state asked for. */
  onContainerToggle?: (id: string, expanded: boolean) => void;
  onEdgeClick?: (id: string) => void;
  onHoverChange?: (id: string | null) => void;
  /** Keep these nodes (and the edges between them) bright and dim the rest, e.g. search hits. */
  highlightIds?: readonly string[];
  /** Hovering a node dims everything but it, its neighbors and its edges. Default true. */
  hoverNeighbors?: boolean;
  /**
   * What the mouse wheel does: zoom (default), or scroll the page unless
   * Ctrl/⌘ is held — for a diagram embedded in a scrolling document.
   */
  wheel?: 'zoom' | 'scroll-unless-modifier';
  /** Corner radius of edge bends. Default 6. */
  cornerRadius?: number;
  /** Screen padding when fitting, and the largest scale a fit may reach. Defaults 24 and 1.5. */
  fitPadding?: number;
  maxFitScale?: number;
  /** Show the zoom and fit buttons. Default true. */
  controls?: boolean;
  /** Name of the diagram for assistive technology. */
  ariaLabel: string;
  /** What to announce when a node is selected; defaults to its label. */
  describeNode?: (id: string) => string;
  /** Size to assume before the element is measured (tests, server rendering). */
  initialSize?: { width: number; height: number };
  className?: string;
  style?: CSSProperties;
}

export interface DiagramViewerHandle {
  /** Fit the whole drawing. */
  fit(): void;
  /** Fit these nodes. */
  focus(ids: readonly string[]): void;
  /** Pan just enough to show this node, keeping the zoom. */
  reveal(id: string): void;
  /**
   * Hold this node at its screen position through the next layout, when one
   * arrives within a few seconds. The viewer does this itself when a toggle
   * opens or closes a node; call it before changing the graph some other way.
   */
  keepInPlace(id: string): void;
  zoomBy(factor: number): void;
}
