/**
 * nodeCard — synthesize the (rect + label) layer pair for a diagram node.
 *
 * Mirrors the shape `diagramBlock.ts` emits for SSR so the editor and
 * preview render identical pixels. The actual Layer instances are
 * regular ShapeLayer + TextLayer objects — the Scene's RenderLayer
 * draws them with the normal SSR components.
 *
 * Edges are NOT generated here; the DiagramAdapter renders edges as a
 * separate PathLayer pass since they need to be drawn behind the cards.
 */

import type { ShapeLayer, TextLayer, Layer } from '@bendyline/squisq/schemas';

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;

export interface DiagramNodeDescriptor {
  /** Stable id (matches the heading slug / Pandoc `#id`). */
  id: string;
  /** Display label. */
  label: string;
  /** Top-left position in viewport units. */
  x: number;
  /** Top-left position in viewport units. */
  y: number;
  /** Width in viewport units. Defaults to `NODE_WIDTH`. */
  width?: number;
  /** Height in viewport units. Defaults to `NODE_HEIGHT`. */
  height?: number;
  /** Optional override fill color (resolved from a color scheme). */
  fill?: string;
  /** Optional override stroke color. */
  stroke?: string;
  /** Optional shape: 'rect' (default) or 'pill' (fully rounded). */
  shape?: 'rect' | 'pill';
  /**
   * 'container' renders as a background grouping card: translucent fill,
   * muted stroke, label anchored near the top edge instead of centered
   * (children paint over the interior).
   */
  kind?: 'container';
}

/**
 * Build a (card, label) pair of Layer objects for a diagram node. Both
 * layers share an id prefix (`node-card-<id>` / `node-label-<id>`) so
 * the SceneSelection overlay can highlight the card while hit-testing
 * works on the card's bounding rect.
 */
export function nodeCardLayers(node: DiagramNodeDescriptor): [ShapeLayer, TextLayer] {
  const width = node.width ?? NODE_WIDTH;
  const height = node.height ?? NODE_HEIGHT;
  const isContainer = node.kind === 'container';
  const card: ShapeLayer = {
    id: `node-card-${node.id}`,
    type: 'shape',
    position: { x: node.x, y: node.y, width, height },
    content: {
      shape: 'rect',
      fill: node.fill ?? (isContainer ? '#94a3b8' : '#ffffff'),
      ...(isContainer ? { fillOpacity: 0.12 } : {}),
      stroke: node.stroke ?? (isContainer ? '#94a3b8' : '#1e293b'),
      strokeWidth: 2,
      borderRadius: node.shape === 'pill' ? height / 2 : 10,
    },
  };

  // Scale the label font with the node height so resized cards stay
  // legible without the text overflowing. Containers keep a fixed, small
  // title size — their height tracks their children, not their label.
  const fontSize = isContainer ? 16 : Math.max(12, Math.min(48, Math.round(height * 0.34)));

  // Label has no explicit height — that keeps its bounding box
  // unresolvable in `layerBounds`, which in turn keeps it out of the
  // Scene's hit-test. The label rides along visually via `layerFollows`
  // but never wins a pointer-down (the card underneath does), so a
  // drag-on-text moves the card as expected.
  //
  // Container labels anchor near the top edge — the interior belongs to
  // the children painting over it.
  const label: TextLayer = {
    id: `node-label-${node.id}`,
    type: 'text',
    position: {
      x: node.x + width / 2,
      y: isContainer ? node.y + fontSize + 8 : node.y + height / 2,
      width,
      anchor: 'center',
    },
    content: {
      text: isContainer ? (node.label.split('\n')[0] ?? '') : node.label,
      style: {
        fontSize,
        fontWeight: 'bold',
        color: node.stroke ?? (isContainer ? '#64748b' : '#1e293b'),
        textAlign: 'center',
      },
    },
  };

  return [card, label];
}

/**
 * Convenience: derive a node-label id from a node-card id. Used by
 * `layerFollows` to keep labels visually attached to their cards during
 * drag and resize previews.
 */
export function labelLayerIdForCard(cardId: string): string {
  if (!cardId.startsWith('node-card-')) return cardId;
  return `node-label-${cardId.slice('node-card-'.length)}`;
}

/**
 * Convenience: derive a node-card id from a node-label id.
 */
export function cardLayerIdForLabel(labelId: string): string {
  if (!labelId.startsWith('node-label-')) return labelId;
  return `node-card-${labelId.slice('node-label-'.length)}`;
}

/**
 * Implementation of the Scene's `layerFollows` prop for diagram mode —
 * a label layer follows its card layer, so dragging or resizing the
 * card visually moves both.
 */
export function diagramLayerFollows(layerId: string): string | null {
  if (layerId.startsWith('node-label-')) return cardLayerIdForLabel(layerId);
  return null;
}

/**
 * Convert a list of diagram nodes to a flat Layer[] suitable for
 * `<Scene layers={...} />`. Returns cards followed by labels so labels
 * paint over their cards.
 */
export function nodesToCardLayers(nodes: readonly DiagramNodeDescriptor[]): Layer[] {
  const cards: ShapeLayer[] = [];
  const labels: TextLayer[] = [];
  for (const n of nodes) {
    const [c, l] = nodeCardLayers(n);
    cards.push(c);
    labels.push(l);
  }
  return [...cards, ...labels];
}

/**
 * Pull the node id back out of a card layer's synthetic id. Returns null
 * if the layer wasn't produced by `nodeCardLayers`.
 */
export function nodeIdFromCardLayerId(layerId: string): string | null {
  if (layerId.startsWith('node-card-')) return layerId.slice('node-card-'.length);
  if (layerId.startsWith('node-label-')) return layerId.slice('node-label-'.length);
  return null;
}
