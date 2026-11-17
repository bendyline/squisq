/**
 * Smallest shared scale the fit pass may shrink a slide's text to. Past it the
 * text is too small to read, and the slide keeps its authored size instead.
 */
export const MIN_SHRUNK_TEXT_SCALE = 0.75;

/**
 * The largest scale below 1, and no smaller than `minimum`, at which `fits`
 * holds. Returns 1 when even `minimum` does not fit: shrinking that cannot
 * cure the overflow would only make the text harder to read.
 */
export function largestShrunkTextScale(
  fits: (scale: number) => boolean,
  minimum = MIN_SHRUNK_TEXT_SCALE,
): number {
  if (minimum >= 1 || !fits(minimum)) return 1;
  let low = minimum;
  let high = 1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = (low + high) / 2;
    if (fits(candidate)) low = candidate;
    else high = candidate;
  }
  return Math.max(minimum, Math.floor(low * 100) / 100);
}

/** Find one common scale for all text on a slide. */
export function largestFittingTextScale(fits: (scale: number) => boolean, maximum = 2): number {
  if (maximum <= 1 || !fits(1)) return 1;
  if (fits(maximum)) return maximum;

  let low = 1;
  let high = maximum;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = (low + high) / 2;
    if (fits(candidate)) low = candidate;
    else high = candidate;
  }
  return Math.max(1, Math.floor(low * 100) / 100);
}
