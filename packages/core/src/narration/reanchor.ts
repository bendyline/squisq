/**
 * Re-anchor a take's character offsets after the document text changed.
 *
 * A take's word and slide offsets point into the text it was recorded
 * against. Small edits made since — a title added, a typo fixed, a sentence
 * reworded — leave nearly every word where the voice says it, so a word-level
 * diff carries the unchanged words' offsets over and edited words simply lose
 * theirs. A take that no longer narrates most of the text is not re-anchored:
 * its timings would describe a different document.
 *
 * Words are the narration script's own `\S+` tokens and compare exactly, so a
 * re-anchored offset lands on the same token start the current script uses.
 * Pure and deterministic, like the rest of the narration engine.
 */

/** Share of each text's words that must line up with the other's, in order. */
const MIN_SHARED_WORDS = 0.9;
/**
 * Most word insertions plus deletions the diff explores. Bounds its time and
 * memory (∝ edits²), since previews re-resolve narration on every edit.
 */
const MAX_WORD_EDITS = 500;

interface Word {
  text: string;
  start: number;
  end: number;
}

function words(text: string): Word[] {
  const found: Word[] = [];
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    found.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/**
 * Index pairs of one longest common subsequence (Myers' O((N+M)·D) diff), or
 * null when the sequences differ by more than `maxEdits` insertions plus
 * deletions.
 */
function sharedWords(
  a: readonly string[],
  b: readonly string[],
  maxEdits: number,
): Array<[number, number]> | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const mid = max + 1;
  // v[mid + k]: furthest x reached on diagonal k = x - y.
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    // Diagonals -d-1..d+1 as they stood before this round, for the walk back.
    trace.push(v.slice(mid - d - 1, mid + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[mid + k - 1]! < v[mid + k + 1]!)
          ? v[mid + k + 1]!
          : v[mid + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[mid + k] = x;
      if (x >= n && y >= m) return walkBack(trace, n, m);
    }
  }
  return null;
}

function walkBack(trace: readonly Int32Array[], n: number, m: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const row = trace[d]!;
    const at = (k: number) => row[k + d + 1]!;
    const k = x - y;
    const previous = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previous);
    const previousY = previousX - previous;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  return pairs.reverse();
}

/**
 * Map offsets in `recorded` (the text a take narrates) onto `current` (the
 * document's narration script now). The returned function gives the current
 * offset for a recorded one, or undefined when that word is gone. Null when
 * the take no longer narrates the current text closely enough to keep its
 * timings.
 */
export function reanchorNarrationText(
  recorded: string,
  current: string,
): ((offset: number) => number | undefined) | null {
  if (recorded === current) return (offset) => offset;
  const from = words(recorded);
  const to = words(current);
  if (!from.length || !to.length) return null;
  // Lining up 90% of each side leaves at most 10% of both in edits.
  const budget = Math.min(
    MAX_WORD_EDITS,
    Math.ceil((1 - MIN_SHARED_WORDS) * (from.length + to.length)),
  );
  const fromText = from.map((word) => word.text);
  const toText = to.map((word) => word.text);
  // The shared head and tail need no diff; most edits are local.
  let head = 0;
  while (head < from.length && head < to.length && fromText[head] === toText[head]) head++;
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    fromText[from.length - 1 - tail] === toText[to.length - 1 - tail]
  )
    tail++;
  const middle = sharedWords(
    fromText.slice(head, from.length - tail),
    toText.slice(head, to.length - tail),
    budget,
  );
  if (!middle) return null;
  const shared = head + middle.length + tail;
  if (shared < MIN_SHARED_WORDS * from.length || shared < MIN_SHARED_WORDS * to.length) return null;

  const target = new Int32Array(from.length).fill(-1);
  for (let i = 0; i < head; i++) target[i] = i;
  for (const [i, j] of middle) target[head + i] = head + j;
  for (let i = 1; i <= tail; i++) target[from.length - i] = to.length - i;

  return (offset) => {
    // The word holding `offset`, or the first word after it.
    let low = 0;
    let high = from.length;
    while (low < high) {
      const probe = (low + high) >> 1;
      if (from[probe]!.end <= offset) low = probe + 1;
      else high = probe;
    }
    const j = low < from.length ? target[low]! : -1;
    if (j < 0) return undefined;
    return to[j]!.start + Math.max(0, offset - from[low]!.start);
  };
}
