/**
 * "Did you mean …?" suggestions for mistyped CLI enum values.
 *
 * Listing every valid id is necessary but not sufficient: `-f docx,pfd` is a
 * transposition, and the useful part of the error is naming `pdf` directly.
 */

/**
 * Damerau-Levenshtein (optimal string alignment) distance.
 *
 * Counts an adjacent transposition as ONE edit, not two. This matters: `pfd`
 * for `pdf` is the single most common way to mistype a format id, and plain
 * Levenshtein scores it 2 — far enough to be dismissed as unrelated.
 */
function editDistance(a: string, b: string): number {
  // Full matrix: the transposition rule needs the row before last.
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        rows[i][j - 1] + 1, // insertion
        rows[i - 1][j] + 1, // deletion
        rows[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1); // transposition
      }
      rows[i][j] = value;
    }
  }
  return rows[a.length][b.length];
}

/**
 * Closest candidate to `value`, or null when nothing is near enough to be a
 * plausible typo (guards against suggesting "pdf" for a wholly bogus input).
 */
export function suggestId(value: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(value, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // Allow one edit for short ids, two for longer ones.
  const threshold = value.length <= 4 ? 1 : 2;
  return best !== null && bestDistance <= threshold ? best : null;
}
