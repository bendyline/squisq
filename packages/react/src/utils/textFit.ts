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
