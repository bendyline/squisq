/**
 * Text measurement without the DOM. A layout is computed before anything is
 * drawn, often in a worker, so node sizes come from a character-width table
 * for a typical UI sans-serif. The viewer truncates labels with the same
 * table, which is what keeps a label inside the box it was sized for.
 */

const NARROW = new Set("iIl|.,:;'!`1tfjr ()[]");
const WIDE = new Set('mwMW@%');

/** Approximate rendered width of `text` at `fontSize`, in the same units. */
export function estimateTextWidth(text: string, fontSize = 12): number {
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.3;
    else if (WIDE.has(ch)) em += 0.85;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else if (ch >= '0' && ch <= '9') em += 0.56;
    else if (ch.charCodeAt(0) > 0x2e7f) em += 1;
    else em += 0.54;
  }
  return em * fontSize;
}

/** `text` cut with an ellipsis so it fits `maxWidth`; unchanged when it already fits. */
export function truncateToWidth(text: string, maxWidth: number, fontSize = 12): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const chars = Array.from(text);
  const ellipsis = estimateTextWidth('…', fontSize);
  let width = 0;
  let cut = 0;
  for (; cut < chars.length; cut++) {
    const w = estimateTextWidth(chars[cut]!, fontSize);
    if (width + w + ellipsis > maxWidth) break;
    width += w;
  }
  return cut === 0 ? '…' : `${chars.slice(0, cut).join('').trimEnd()}…`;
}

/** The type sizes and insets the viewer draws nodes with. */
export const GRAPH_NODE_METRICS = {
  labelSize: 12,
  detailSize: 10,
  badgeSize: 10,
  paddingX: 10,
  /** Height of a node with a label only, and with a label plus a detail line. */
  height: 28,
  heightWithDetail: 40,
  /** Width of a badge per character beyond its padding, and the room for a toggle chevron. */
  badgePadding: 10,
  toggleWidth: 16,
} as const;

export interface GraphNodeSizeInput {
  label: string;
  detail?: string;
  badge?: string;
  expandable?: boolean;
}

export interface GraphNodeSizeOptions {
  minWidth?: number;
  maxWidth?: number;
}

/**
 * The box a node needs for its label, detail, badge and toggle, clamped to
 * `minWidth`–`maxWidth` (default 64–280). Feed the result to the layout as
 * the node's size; the viewer truncates whatever the clamp cut off.
 */
export function graphNodeSize(
  node: GraphNodeSizeInput,
  options: GraphNodeSizeOptions = {},
): { width: number; height: number } {
  const m = GRAPH_NODE_METRICS;
  const text = Math.max(
    estimateTextWidth(node.label, m.labelSize),
    node.detail ? estimateTextWidth(node.detail, m.detailSize) : 0,
  );
  const badge = node.badge ? estimateTextWidth(node.badge, m.badgeSize) + m.badgePadding + 6 : 0;
  const toggle = node.expandable ? m.toggleWidth : 0;
  const width = Math.ceil(m.paddingX * 2 + text + badge + toggle);
  return {
    width: Math.min(options.maxWidth ?? 280, Math.max(options.minWidth ?? 64, width)),
    height: node.detail ? m.heightWithDetail : m.height,
  };
}
