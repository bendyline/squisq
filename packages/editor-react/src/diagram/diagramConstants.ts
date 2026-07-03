/**
 * Shared diagram constants — kept out of `DiagramCanvas.tsx` so that file can
 * export only its component (which keeps React Fast Refresh working).
 */

import { SelectTool, ConnectTool } from '../scene';

/**
 * Viewport size for the diagram canvas — a wide-ish surface in author
 * units. The Scene's fit-on-mount centers the diagram inside whatever
 * container the canvas is rendered into. Exported so the host can place
 * new nodes at the viewport center.
 */
export const DIAGRAM_VIEWPORT = { width: 1600, height: 900 };

/** The diagram's tool vocabulary — surfaced in the shared block toolbar. */
export const DIAGRAM_TOOLS = [SelectTool, ConnectTool];
