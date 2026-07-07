/**
 * Shared "did-you-mean" edit-distance helpers.
 *
 * A leaf module (no imports) so both `doc/validate.ts` and
 * `doc/templates/inputDescriptors.ts` can share one implementation without
 * risking an import cycle through `templates/index.ts`.
 */

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Nearest candidate name by edit distance, or `undefined` when nothing is
 * plausibly close. "Close" means distance ≤ `maxDistance` (default 2) OR
 * ≤ 40% of the input length — the shared threshold both call sites use.
 *
 * @param options.map - Optional post-processor applied to the winning
 *   candidate (e.g. `resolveTemplateName` to canonicalize an alias hit).
 * @param options.maxDistance - Absolute distance floor for "close" (default 2).
 */
export function nearestName(
  input: string,
  candidates: Iterable<string>,
  options?: { map?: (best: string) => string; maxDistance?: number },
): string | undefined {
  const maxDistance = options?.maxDistance ?? 2;
  let best: string | undefined;
  let bestDist = Infinity;
  const lower = input.toLowerCase();
  for (const candidate of candidates) {
    const dist = levenshtein(lower, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  if (best && (bestDist <= maxDistance || bestDist <= Math.ceil(input.length * 0.4))) {
    return options?.map ? options.map(best) : best;
  }
  return undefined;
}
