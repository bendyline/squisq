/**
 * Normalize numeric position fields on a Layer[] to `%`-strings
 * relative to the designer canvas.
 *
 * Why: the designer drags layers around in pixel coordinates (that's
 * how pointer events work), but saved templates need to be
 * resolution-independent so the same definition renders correctly
 * across the landscape / portrait / square viewport presets. On Save
 * we run this normalizer to convert pixel positions to percentages.
 *
 * Width / height are converted against their own dimension (width
 * against canvas width, height against canvas height) — not "always
 * against width" like SVG `viewBox`-style coordinates.
 *
 * Already-`%`-valued fields are preserved verbatim. Anchor fields and
 * non-position content fields are untouched. Layers without an
 * explicit `position` are passed through unchanged.
 */

import type { Layer, Position } from '@bendyline/squisq/schemas';

export interface Canvas {
  width: number;
  height: number;
}

/**
 * Return a new Layer[] where each numeric position field has been
 * converted to a `%`-string relative to `canvas`. Pure function;
 * doesn't mutate the input.
 */
export function normalizePositions(layers: readonly Layer[], canvas: Canvas): Layer[] {
  return layers.map((layer) => normalizeLayer(layer, canvas));
}

function normalizeLayer<L extends Layer>(layer: L, canvas: Canvas): L {
  if (!layer.position) return layer;
  const pos: Position = { ...layer.position };
  if (pos.x !== undefined) pos.x = toPercent(pos.x, canvas.width);
  if (pos.y !== undefined) pos.y = toPercent(pos.y, canvas.height);
  if (pos.width !== undefined) pos.width = toPercent(pos.width, canvas.width);
  if (pos.height !== undefined) pos.height = toPercent(pos.height, canvas.height);
  // `anchor` (top-left / center / etc.) is preserved verbatim.
  return { ...layer, position: pos } as L;
}

/**
 * Convert a single position value to a `%`-string. Already-string
 * `%` values pass through; non-numeric strings (e.g. hand-written
 * pixel expressions) are returned unchanged so we don't corrupt
 * intentional author markup.
 */
function toPercent(value: number | string, base: number): string {
  if (typeof value === 'string') {
    if (value.endsWith('%')) return value;
    // Try to parse as a number ("180" → 180px → percent).
    const n = parseFloat(value);
    if (Number.isFinite(n) && String(n) === value) {
      return formatPercent((n / base) * 100);
    }
    return value;
  }
  if (!Number.isFinite(value) || base <= 0) return String(value);
  return formatPercent((value / base) * 100);
}

/** Format a percentage with up to two decimal places, trailing zeros trimmed. */
function formatPercent(pct: number): string {
  // Round to 0.01% precision — enough for visually faithful round-trip
  // without bloating the saved layout JSON.
  const rounded = Math.round(pct * 100) / 100;
  // Drop trailing zeros: 50.00 → "50%", 50.10 → "50.1%".
  const str = rounded.toString();
  return `${str}%`;
}
