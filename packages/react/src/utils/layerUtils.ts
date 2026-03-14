/**
 * Shared utilities for layer components.
 *
 * Resolves position values and anchor offsets used by all layer types.
 */

/**
 * Resolve a position value (number or percentage string) to pixels.
 */
export function resolveValue(value: number | string, dimension: number): number {
  if (typeof value === 'number') {
    return value;
  }
  if (value.endsWith('%')) {
    const percent = parseFloat(value);
    return (percent / 100) * dimension;
  }
  return parseFloat(value);
}

/**
 * Get offset based on anchor point.
 */
export function getAnchorOffset(
  anchor: string | undefined,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (anchor) {
    case 'center':
      return { x: -width / 2, y: -height / 2 };
    case 'top-right':
      return { x: -width, y: 0 };
    case 'bottom-left':
      return { x: 0, y: -height };
    case 'bottom-right':
      return { x: -width, y: -height };
    case 'top-left':
    default:
      return { x: 0, y: 0 };
  }
}
