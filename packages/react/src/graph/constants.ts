/** Above this many nodes, `DiagramViewer` draws only what is near the screen. */
export const GRAPH_VIEW_CULL_AT = 600;

/** Layer render counts, for tests that prove interaction does not re-render the drawing. */
export const graphViewRenderCounts = { containers: 0, edges: 0, nodes: 0 };
