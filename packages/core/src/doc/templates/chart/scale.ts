/**
 * Value-axis scale math: "nice" tick computation (Heckbert's nice-numbers
 * algorithm) and human display formatting for tick/value labels.
 */

/** Round a range to a "nice" number: 1, 2, or 5 × 10^k. */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

export interface NiceTicks {
  ticks: number[];
  niceMin: number;
  niceMax: number;
  step: number;
}

/**
 * Compute evenly spaced "nice" ticks covering [min, max].
 *
 * The returned domain [niceMin, niceMax] always contains the input domain.
 * Degenerate domains (min === max) are padded by one step so a flat series
 * still gets a usable axis. Callers decide zero-inclusion by passing
 * `Math.min(0, dataMin)` / `Math.max(0, dataMax)` (bars, columns, and
 * areas must be zero-based to be honest).
 */
export function niceTicks(min: number, max: number, targetCount = 5): NiceTicks {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 0;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    const pad = lo === 0 ? 1 : niceNum(Math.abs(lo), true);
    lo -= pad;
    hi += pad;
    if (min >= 0 && lo < 0) lo = 0; // don't invent negatives for flat non-negative data
  }

  const count = Math.max(2, targetCount);
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Guard against float drift producing a missing final tick.
  for (let tick = niceMin; tick <= niceMax + step * 1e-6; tick += step) {
    // Snap near-zero float artifacts (e.g. 2.220e-16) back to 0.
    ticks.push(Math.abs(tick) < step * 1e-6 ? 0 : Number(tick.toPrecision(12)));
  }
  return { ticks, niceMin, niceMax, step };
}

/**
 * Format a value for tick/value labels: K/M suffixes for large magnitudes
 * (generalized from comparisonBar's formatter, sign-aware), locale
 * grouping otherwise, optional unit suffix.
 */
export function formatChartValue(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1_000_000) {
    text = `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  } else if (abs >= 1_000) {
    text = `${sign}${trimTrailingZero((abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1))}K`;
  } else {
    text = `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  return unit ? `${text} ${unit}` : text;
}

function trimTrailingZero(text: string): string {
  return text.replace(/\.0$/, '');
}
