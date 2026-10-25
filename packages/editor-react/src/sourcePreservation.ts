/**
 * Write-view source preservation — "re-serialize what the user edited, keep
 * every other byte".
 *
 * The Write view serializes the WHOLE Tiptap document on every change. The
 * bridge's Markdown is a normalized dialect: setext headings become ATX,
 * `__bold__` becomes `**bold**`, tables lose their padding, and constructs the
 * editor does not model at all (reference definitions, a `> [!NOTE]` alert
 * beside another quote, `1)` lists…) come back different. Saving that output
 * after a one-word edit rewrote the entire file, and damaged content the user
 * never touched.
 *
 * Instead, the normalized output is diffed against the normalized form of the
 * document as it was loaded, and every stretch the user did not change is
 * written back with its ORIGINAL bytes:
 *
 *   original source (S)  --load-->  editor  --serialize-->  normalized baseline (N)
 *                                   (edit)  --serialize-->  edited (M)
 *
 * S and N are aligned once per load (patience diff: lines unique in both are
 * anchors, equal neighbours extend them). That tiles both into regions — a
 * stretch of S and the stretch of N it became. Each save diffs N against M the
 * same way; a region whose normalized lines all survive, contiguously, is
 * CLEAN and emits its original S text; everything else emits M's text. An
 * unedited document therefore round-trips byte for byte, and an edit only
 * normalizes the lines around it.
 *
 * Splicing original and normalized text is only safe while both agree on
 * where code fences (and other literal blocks) open and close: an original
 * `~~~` closer after a normalized ```` ``` ```` opener would swallow the rest
 * of the document into a code block. Every assembled result is checked line
 * by line against the literal-block structure of the text each line came
 * from, and falls back to the fully normalized output when they disagree.
 *
 * Pure string logic (no Tiptap, no DOM) so it stays Node-testable.
 */

/** A stretch of the original source and the normalized lines it became. */
interface Region {
  readonly sStart: number;
  readonly sEnd: number;
  readonly nStart: number;
  readonly nEnd: number;
}

export interface SourceBaseline {
  /** The source as loaded, exactly. */
  readonly original: string;
  /** The editor's serialization of that source before any edit. */
  readonly normalized: string;
  readonly originalLines: readonly string[];
  readonly normalizedLines: readonly string[];
  /** Regions tiling both line arrays, in document order. */
  readonly regions: readonly Region[];
  /** Literal-block role of each original line (see `literalRoles`). */
  readonly originalRoles: readonly LiteralRole[];
  /** Line ending to give normalized lines spliced into a CRLF document. */
  readonly lineEnding: '\n' | '\r\n';
}

/**
 * Pair up equal lines of `a` and `b`, in order: equal prefix and suffix runs,
 * then lines that occur exactly once in both ranges (patience diff anchors,
 * kept in increasing order on both sides), recursing between anchors. Lines
 * with no confident partner stay unpaired. Returns `aToB[i]` = the paired
 * index in `b`, or -1.
 */
function pairLines(a: readonly string[], b: readonly string[]): Int32Array {
  const aToB = new Int32Array(a.length).fill(-1);
  // Explicit work stack: recursion depth is unbounded on long documents.
  const work: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (work.length > 0) {
    let [aLo, aHi, bLo, bHi] = work.pop()!;
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) aToB[aLo++] = bLo++;
    while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) aToB[--aHi] = --bHi;
    if (aLo >= aHi || bLo >= bHi) continue;

    const countA = new Map<string, number>();
    const indexA = new Map<string, number>();
    for (let i = aLo; i < aHi; i++) {
      const line = a[i]!;
      // Blank lines are everywhere; they never anchor.
      if (line.trim() === '') continue;
      countA.set(line, (countA.get(line) ?? 0) + 1);
      indexA.set(line, i);
    }
    const countB = new Map<string, number>();
    for (let j = bLo; j < bHi; j++) {
      const line = b[j]!;
      if (countA.has(line)) countB.set(line, (countB.get(line) ?? 0) + 1);
    }
    // Candidate anchors in `b` order; keep the longest run increasing in `a`.
    const candidates: Array<[number, number]> = [];
    for (let j = bLo; j < bHi; j++) {
      const line = b[j]!;
      if (countB.get(line) === 1 && countA.get(line) === 1) {
        candidates.push([indexA.get(line)!, j]);
      }
    }
    const anchors = longestIncreasingByA(candidates);
    if (anchors.length === 0) continue;

    let prevA = aLo;
    let prevB = bLo;
    for (const [i, j] of anchors) {
      aToB[i] = j;
      work.push([prevA, i, prevB, j]);
      prevA = i + 1;
      prevB = j + 1;
    }
    work.push([prevA, aHi, prevB, bHi]);
  }
  return aToB;
}

/** Longest subsequence of `pairs` (already increasing in b) increasing in a. */
function longestIncreasingByA(pairs: ReadonlyArray<[number, number]>): Array<[number, number]> {
  if (pairs.length === 0) return [];
  // Patience sorting: tails[k] = index into pairs of the smallest tail of an
  // increasing run of length k + 1.
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++) {
    const value = pairs[p]![0];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![0] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[p] = tails[lo - 1]!;
    tails[lo] = p;
  }
  const result: Array<[number, number]> = [];
  for (let p = tails[tails.length - 1]!; p >= 0; p = previous[p]!) result.push(pairs[p]!);
  return result.reverse();
}

/** Compare lines without their carriage return, so CRLF sources still align. */
function lineKeys(lines: readonly string[]): string[] {
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** More than half of the line breaks are CRLF. */
function detectLineEnding(text: string): '\n' | '\r\n' {
  const breaks = text.split('\n').length - 1;
  if (breaks === 0) return '\n';
  const crlf = text.split('\r\n').length - 1;
  return crlf * 2 > breaks ? '\r\n' : '\n';
}

/** Runs of non-blank lines in [start, end); blank lines inside literal blocks don't split. */
function blocksIn(
  lines: readonly string[],
  roles: readonly LiteralRole[],
  start: number,
  end: number,
): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let blockStart = -1;
  for (let i = start; i < end; i++) {
    const separator = lines[i]!.trim() === '' && roles[i] === 'out';
    if (separator) {
      if (blockStart >= 0) blocks.push([blockStart, i]);
      blockStart = -1;
    } else if (blockStart < 0) {
      blockStart = i;
    }
  }
  if (blockStart >= 0) blocks.push([blockStart, end]);
  return blocks;
}

/** A block's letters and digits: what normalization (markup, padding, escapes) leaves alone. */
function blockText(lines: readonly string[], [start, end]: [number, number]): string {
  return lines
    .slice(start, end)
    .join('\n')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Split an unanchored gap into finer regions. A gap is everything normalization
 * reformatted between two anchors — often several blocks (a setext heading, a
 * `*` list, a padded table header). Blocks are paired from both ends while
 * their letters and digits match, so an edit to one of them leaves the others
 * clean; whatever does not pair stays one coarse region.
 */
function refineGap(
  regions: Region[],
  s: { lines: readonly string[]; roles: readonly LiteralRole[] },
  n: { lines: readonly string[]; roles: readonly LiteralRole[] },
  sStart: number,
  sEnd: number,
  nStart: number,
  nEnd: number,
): void {
  const sBlocks = blocksIn(s.lines, s.roles, sStart, sEnd);
  const nBlocks = blocksIn(n.lines, n.roles, nStart, nEnd);
  const same = (a: [number, number], b: [number, number]): boolean => {
    const text = blockText(s.lines, a);
    return text !== '' && text === blockText(n.lines, b);
  };
  let head = 0;
  while (head < sBlocks.length && head < nBlocks.length && same(sBlocks[head]!, nBlocks[head]!)) {
    head++;
  }
  let tail = 0;
  while (
    tail < sBlocks.length - head &&
    tail < nBlocks.length - head &&
    same(sBlocks[sBlocks.length - 1 - tail]!, nBlocks[nBlocks.length - 1 - tail]!)
  ) {
    tail++;
  }

  let sAt = sStart;
  let nAt = nStart;
  const push = (sTo: number, nTo: number): void => {
    if (sTo > sAt || nTo > nAt) regions.push({ sStart: sAt, sEnd: sTo, nStart: nAt, nEnd: nTo });
    sAt = sTo;
    nAt = nTo;
  };
  const pairs: Array<[[number, number], [number, number]]> = [];
  for (let k = 0; k < head; k++) pairs.push([sBlocks[k]!, nBlocks[k]!]);
  const middleS = head < sBlocks.length - tail ? sBlocks[head]![0] : null;
  const middleN = head < nBlocks.length - tail ? nBlocks[head]![0] : null;
  for (const [sBlock, nBlock] of pairs) {
    push(sBlock[0], nBlock[0]); // separator before the block
    push(sBlock[1], nBlock[1]); // the block
  }
  if (middleS !== null || middleN !== null) {
    // Unpaired middle blocks (and the separators around them) stay together.
    const sTo = tail > 0 ? sBlocks[sBlocks.length - tail]![0] : sEnd;
    const nTo = tail > 0 ? nBlocks[nBlocks.length - tail]![0] : nEnd;
    push(sTo, nTo);
  }
  for (let k = tail; k > 0; k--) {
    const sBlock = sBlocks[sBlocks.length - k]!;
    const nBlock = nBlocks[nBlocks.length - k]!;
    push(sBlock[0], nBlock[0]);
    push(sBlock[1], nBlock[1]);
  }
  push(sEnd, nEnd);
}

/**
 * Align the source as loaded with the editor's serialization of it. Call once
 * per load; `preserveSource` then reuses the alignment on every save.
 */
export function createSourceBaseline(original: string, normalized: string): SourceBaseline {
  const originalLines = original.split('\n');
  const normalizedLines = normalized.split('\n');
  const originalRoles = literalRoles(originalLines);
  const sides = {
    s: { lines: originalLines, roles: originalRoles },
    n: { lines: normalizedLines, roles: literalRoles(normalizedLines) },
  };
  const sToN = pairLines(lineKeys(originalLines), lineKeys(normalizedLines));

  const regions: Region[] = [];
  let s = 0;
  let n = 0;
  const pushGap = (sEnd: number, nEnd: number): void => {
    if (sEnd > s || nEnd > n) refineGap(regions, sides.s, sides.n, s, sEnd, n, nEnd);
  };
  for (let i = 0; i < originalLines.length; i++) {
    const j = sToN[i]!;
    if (j < 0) continue;
    pushGap(i, j);
    regions.push({ sStart: i, sEnd: i + 1, nStart: j, nEnd: j + 1 });
    s = i + 1;
    n = j + 1;
  }
  pushGap(originalLines.length, normalizedLines.length);

  return {
    original,
    normalized,
    originalLines,
    normalizedLines,
    regions,
    originalRoles,
    lineEnding: detectLineEnding(original),
  };
}

/** How a line sits relative to the literal blocks Markdown never re-parses. */
type LiteralRole = 'out' | 'open' | 'in' | 'close';

/**
 * Classify each line against the multi-line literal blocks whose delimiters
 * must stay paired: fenced code (``` or ~~~, CommonMark length rules),
 * `$$` display math, and HTML comments.
 */
function literalRoles(lines: readonly string[]): LiteralRole[] {
  const roles: LiteralRole[] = [];
  let fence: { char: string; length: number } | null = null;
  let math = false;
  let comment = false;
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        fence = null;
        roles.push('close');
      } else {
        roles.push('in');
      }
      continue;
    }
    if (math) {
      if (line.trim() === '$$') {
        math = false;
        roles.push('close');
      } else {
        roles.push('in');
      }
      continue;
    }
    if (comment) {
      if (line.includes('-->')) {
        comment = false;
        roles.push('close');
      } else {
        roles.push('in');
      }
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // A backtick fence's info string may not contain a backtick.
    if (open && !(open[1]![0] === '`' && open[2]!.includes('`'))) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      roles.push('open');
      continue;
    }
    if (line.trim() === '$$') {
      math = true;
      roles.push('open');
      continue;
    }
    const commentStart = line.indexOf('<!--');
    if (commentStart >= 0 && !line.includes('-->', commentStart + 4)) {
      comment = true;
      roles.push('open');
      continue;
    }
    roles.push('out');
  }
  return roles;
}

/**
 * Re-serialize only what changed: return `edited` (the editor's normalized
 * serialization after an edit) with every region the edit did not touch put
 * back to its original bytes. Returns `edited` unchanged when nothing can be
 * preserved safely.
 */
export function preserveSource(baseline: SourceBaseline, edited: string): string {
  // Nothing normalizes away, so there is nothing to preserve.
  if (baseline.original === baseline.normalized) return edited;
  // No edit relative to the load: the original, byte for byte.
  if (edited === baseline.normalized) return baseline.original;

  const editedLines = edited.split('\n');
  const nToM = pairLines(lineKeys(baseline.normalizedLines), lineKeys(editedLines));

  // A region is clean when all of its normalized lines survive, in one
  // contiguous run of the edited text. `mStart`/`mEnd` locate that run.
  const { regions } = baseline;
  const clean: boolean[] = new Array<boolean>(regions.length);
  const mStart = new Int32Array(regions.length);
  const mEnd = new Int32Array(regions.length);
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r]!;
    if (region.nEnd === region.nStart) {
      clean[r] = false; // decided below, from its neighbours
      continue;
    }
    let ok = true;
    const first = nToM[region.nStart]!;
    for (let k = region.nStart; k < region.nEnd && ok; k++) {
      ok = nToM[k] === first + (k - region.nStart) && first >= 0;
    }
    clean[r] = ok;
    mStart[r] = first;
    mEnd[r] = first + (region.nEnd - region.nStart);
  }
  // A separator (blank lines only, on both sides) keeps its original form
  // only between two clean regions. Beside an edit, the original's spacing no
  // longer applies: a soft-wrapped paragraph has NO blank line where the
  // editor has one per line, and joining its last kept line straight onto the
  // next block turned `text` + `---` into a setext heading. Take the editor's.
  const isBlank = (lines: readonly string[], start: number, end: number): boolean => {
    for (let k = start; k < end; k++) if (lines[k]!.trim() !== '') return false;
    return true;
  };
  const separatorIsSafe = regions.map((region, r) => {
    if (region.nEnd === region.nStart) return true;
    if (!isBlank(baseline.normalizedLines, region.nStart, region.nEnd)) return true;
    if (!isBlank(baseline.originalLines, region.sStart, region.sEnd)) return true;
    const neighbourClean = (k: number): boolean =>
      k < 0 || k >= regions.length || regions[k]!.nEnd === regions[k]!.nStart || clean[k]!;
    return neighbourClean(r - 1) && neighbourClean(r + 1);
  });
  for (let r = 0; r < regions.length; r++) if (!separatorIsSafe[r]) clean[r] = false;

  // Original text with no normalized counterpart was normalized away: the
  // editor never showed it, so no edit can have removed it on purpose. Keep it
  // beside a clean neighbour: after the one before it, else before the one
  // after it. With both neighbours gone (their section was deleted) it goes too.
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r]!;
    if (region.nEnd !== region.nStart) continue;
    const before = r - 1;
    const after = r + 1;
    let position = -1;
    if (before < 0) position = 0;
    else if (clean[before]) position = mEnd[before]!;
    else if (after >= regions.length) position = editedLines.length;
    else if (clean[after]) position = mStart[after]!;
    clean[r] = position >= 0;
    mStart[r] = mEnd[r] = position;
  }

  // Assemble: clean regions emit original lines; every edited line outside a
  // clean region is emitted in order, where it falls.
  const out: string[] = [];
  // Lines that may need a CR in a CRLF document: every edited line, and the
  // original's final fragment when an edit now follows it.
  const needsLineEnding: boolean[] = [];
  const sourceRole: LiteralRole[] = [];
  const lastOriginal = baseline.originalLines.length - 1;
  const editedRoles = literalRoles(editedLines);
  let cursor = 0;
  const emitEdited = (end: number): void => {
    for (; cursor < end; cursor++) {
      out.push(editedLines[cursor]!);
      needsLineEnding.push(true);
      sourceRole.push(editedRoles[cursor]!);
    }
  };
  for (let r = 0; r < regions.length; r++) {
    if (!clean[r]) continue;
    const region = regions[r]!;
    if (mStart[r]! < cursor) return edited; // out of order: never splice
    emitEdited(mStart[r]!);
    for (let k = region.sStart; k < region.sEnd; k++) {
      out.push(baseline.originalLines[k]!);
      needsLineEnding.push(k === lastOriginal);
      sourceRole.push(baseline.originalRoles[k]!);
    }
    cursor = mEnd[r]!;
  }
  emitEdited(editedLines.length);

  // Every line must keep the literal-block role it had in the text it came
  // from; a spliced opener/closer mismatch would swallow or expose code.
  const assembledRoles = literalRoles(out);
  for (let k = 0; k < out.length; k++) {
    if (assembledRoles[k] !== sourceRole[k]) return edited;
  }

  if (baseline.lineEnding === '\r\n') {
    // Normalized lines spliced into a CRLF document take its line ending;
    // the final fragment (after the last break) never carries one.
    for (let k = 0; k < out.length - 1; k++) {
      if (needsLineEnding[k] && !out[k]!.endsWith('\r')) out[k] += '\r';
    }
  }
  return out.join('\n');
}
