const EDGE_PADDING_PX = 8;

export function clampTooltipLeft(
  anchorX: number,
  tooltipWidth: number,
  viewportWidth: number,
  edgePadding = EDGE_PADDING_PX,
): number {
  const minLeft = edgePadding;
  const maxLeft = Math.max(minLeft, viewportWidth - edgePadding - tooltipWidth);
  const centeredLeft = anchorX - tooltipWidth / 2;
  return Math.min(maxLeft, Math.max(minLeft, centeredLeft));
}
