/**
 * Pure scroll math for the teleprompter surface.
 *
 * The surface renders the whole script into one absolutely-positioned
 * column and translates it so the active word sits at the eye-line
 * (~35% from the top). These helpers are DOM-free except for the
 * measurement entry point, which only reads layout.
 */

export interface TokenLineMap {
  /** Top offset (px, within the scroll column) of each token span. */
  tokenTops: number[];
  /** Height of each token's line box (px). */
  tokenHeights: number[];
}

/** Fraction of the viewport height where the active line is held. */
export const EYE_LINE_FRACTION = 0.35;

/** Absolute speed limit for the smooth scroll (px/s). */
export const MAX_SCROLL_PX_PER_SEC = 2600;

/**
 * Measure the top offset of every `[data-token-idx]` span inside the
 * scroll column. Layout read only — call on mount, resize, and font-size
 * changes, not per frame.
 */
export function measureTokenLines(scrollColumn: HTMLElement): TokenLineMap {
  const spans = scrollColumn.querySelectorAll<HTMLElement>('[data-token-idx]');
  const tokenTops = new Array<number>(spans.length);
  const tokenHeights = new Array<number>(spans.length);
  const columnRect = scrollColumn.getBoundingClientRect();
  spans.forEach((span) => {
    const idx = Number(span.dataset.tokenIdx);
    if (!Number.isFinite(idx)) return;
    const rect = span.getBoundingClientRect();
    tokenTops[idx] = rect.top - columnRect.top;
    tokenHeights[idx] = rect.height;
  });
  return { tokenTops, tokenHeights };
}

/**
 * The translateY offset (px) that puts the (fractional) word position on
 * the eye-line. Interpolates between the current and next token tops so
 * the column glides instead of stepping line by line.
 */
export function targetOffsetFor(
  wordPos: number,
  lines: TokenLineMap,
  viewportHeightPx: number,
  eyeLine: number = EYE_LINE_FRACTION,
): number {
  const count = lines.tokenTops.length;
  if (count === 0) return 0;
  const clamped = Math.min(Math.max(wordPos, 0), count - 1);
  const idx = Math.floor(clamped);
  const frac = clamped - idx;
  const top = lines.tokenTops[idx] ?? 0;
  const nextTop = lines.tokenTops[Math.min(idx + 1, count - 1)] ?? top;
  const y = top + (nextTop - top) * frac;
  const lineHeight = lines.tokenHeights[idx] ?? 0;
  return Math.max(0, y + lineHeight / 2 - viewportHeightPx * eyeLine);
}

/**
 * Advance the current scroll offset toward the target: exponential
 * approach (critically-damped feel) with an absolute speed clamp so a
 * hard resync glides rather than teleporting.
 */
export function stepScroll(
  currentPx: number,
  targetPx: number,
  dtMs: number,
  maxPxPerSec: number = MAX_SCROLL_PX_PER_SEC,
): number {
  const dt = Math.min(Math.max(dtMs, 0), 250) / 1000;
  if (dt === 0) return currentPx;
  const blend = 1 - Math.exp(-dt / 0.18);
  let next = currentPx + (targetPx - currentPx) * blend;
  const maxStep = maxPxPerSec * dt;
  if (next - currentPx > maxStep) next = currentPx + maxStep;
  else if (currentPx - next > maxStep) next = currentPx - maxStep;
  return Math.abs(next - targetPx) < 0.25 ? targetPx : next;
}
