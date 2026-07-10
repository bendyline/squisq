/**
 * Public types for the ASCII diagram codec.
 *
 * Coordinates are grid-native: `col`/`row` count character cells from the
 * top-left of the art (0-based), `wCols`/`hRows` include the borders. The
 * mapping helpers in `mapping.ts` convert to/from diagram canvas units
 * via {@link ASCII_CHAR_W} / {@link ASCII_CHAR_H}.
 */

export interface AsciiDiagramNode {
  /**
   * Stable id: slug of the first label line, deduplicated with `-2`/`-3`
   * suffixes in reading order. Identical art always re-parses to
   * identical ids (editor selection and edges resolve by id).
   */
  id: string;
  /** Interior text lines joined with `\n` (trimmed, blank lines dropped). May be `''`. */
  label: string;
  /** Left column of the box (0-based, includes the border). */
  col: number;
  /** Top row of the box (0-based, includes the border). */
  row: number;
  /** Full box width in columns, borders included. */
  wCols: number;
  /** Full box height in rows, borders included. */
  hRows: number;
  /** Id of the box that strictly contains this one, when nested. */
  containerId?: string;
}

export interface AsciiDiagramEdge {
  source: string;
  target: string;
  /** Edge label parsed from an embedded horizontal run (`──label──▶`). */
  label?: string;
  /** False when the line carried no arrowhead. */
  directed: boolean;
}

export interface AsciiDiagram {
  /** Nodes in reading order (row, then col). Containers are ordinary nodes with children pointing at them. */
  nodes: AsciiDiagramNode[];
  /** Deduplicated edges, sorted by (source, target, label). */
  edges: AsciiDiagramEdge[];
  /** Character vocabulary detected in the source; render emits the same style. */
  style: 'unicode' | 'ascii';
  /** Non-fatal parse notes (loose text, dropped labels, ambiguous buses, …). */
  warnings: string[];
}

export interface AsciiDiagramDetection {
  isDiagram: boolean;
  /** Present when `isDiagram` — avoids a second parse in callers. */
  diagram?: AsciiDiagram;
  /** Machine-greppable accept/reject reasons, e.g. `too-few-boxes(1)`, `loose-ratio(0.41)`. */
  reasons: string[];
}

/**
 * Canvas pixels per grid column/row. Sized so a typical 12-col × 3-row
 * ASCII box maps close to the native 180×64 diagram card, and a 60–100
 * column diagram fits the 1600×900 diagram viewport.
 */
export const ASCII_CHAR_W = 14;
export const ASCII_CHAR_H = 28;
