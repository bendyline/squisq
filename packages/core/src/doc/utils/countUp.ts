/**
 * Count-up formatting
 *
 * Pure helpers behind the `countUp` animation: parse the number out of a
 * statistic such as `"$1.2M"`, `"73%"` or `"12,000 km"`, then format the
 * value the layer should show at a given block time. Both the player and the
 * offline renderer call `formatCountUp(text, animation, blockTime)`, so the
 * digits on screen are a pure function of time — no interval, no state.
 *
 * Related files:
 * - `schemas/Doc.ts` — `Animation.count`
 * - `react/src/layers/TextLayer.tsx` — renders the formatted text
 * - `doc/templates/statHighlight.ts`, `comparisonBar.ts` — opt in
 */

import type { Animation, CountUpSpec } from '../../schemas/Doc.js';

/** A statistic split into the parts that stay fixed and the number that animates. */
export interface ParsedStat {
  prefix: string;
  value: number;
  /** Decimal places written in the source text. */
  decimals: number;
  /** Whether the source used thousands separators. */
  grouping: boolean;
  suffix: string;
}

const STAT_PATTERN = /^([^\d]*?)([-−]?\d[\d,]*(?:\.\d+)?)(.*)$/s;

/**
 * Parse the first number in a statistic. Returns `null` for text without a
 * number (`"Unknown"`) or with a number a count-up would misrepresent
 * (years such as `1889` are left alone: counting to a date is nonsense).
 */
export function parseStatNumber(text: string): ParsedStat | null {
  const match = STAT_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, prefix, numeric, suffix] = match;
  const normalized = numeric.replace(/,/g, '').replace('−', '-');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const decimals = normalized.includes('.') ? normalized.split('.')[1].length : 0;
  const bare = /^-?\d{4}$/.test(normalized);
  const looksLikeYear =
    bare && Math.abs(value) >= 1000 && Math.abs(value) <= 2999 && !/^[$€£¥]/.test(prefix);
  if (looksLikeYear && !/^[%KMB]/i.test(suffix.trim())) return null;
  return { prefix, value, decimals, grouping: numeric.includes(','), suffix };
}

/** Build the `count` spec for a statistic, or `null` when it cannot count up. */
export function countUpSpecFor(text: string): CountUpSpec | null {
  const parsed = parseStatNumber(text);
  if (!parsed) return null;
  return {
    from: 0,
    to: parsed.value,
    decimals: parsed.decimals,
    grouping: parsed.grouping,
    prefix: parsed.prefix,
    suffix: parsed.suffix,
  };
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Format a number with fixed decimals and optional thousands separators. */
export function formatCountValue(value: number, decimals: number, grouping: boolean): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * The text a `countUp` layer shows at `blockTime` seconds into its block.
 * Before the animation's delay the layer shows the starting value; after
 * `delay + duration` it shows the authored text verbatim, so the final frame
 * is always exactly what the author wrote.
 */
export function formatCountUp(text: string, animation: Animation, blockTime: number): string {
  const count = animation.count ?? countUpSpecFor(text);
  if (!count) return text;
  const delay = animation.delay ?? 0;
  const duration = animation.duration ?? 1.5;
  const progress = duration <= 0 ? 1 : Math.min(1, Math.max(0, (blockTime - delay) / duration));
  if (progress >= 1) return animation.count ? formatFinal(count) : text;
  const from = count.from ?? 0;
  const value = from + (count.to - from) * easeOutCubic(progress);
  return `${count.prefix ?? ''}${formatCountValue(value, count.decimals ?? 0, count.grouping ?? false)}${count.suffix ?? ''}`;
}

function formatFinal(count: CountUpSpec): string {
  return `${count.prefix ?? ''}${formatCountValue(count.to, count.decimals ?? 0, count.grouping ?? false)}${count.suffix ?? ''}`;
}
