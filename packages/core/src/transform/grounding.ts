/**
 * Grounding checks: does what an author put on a slide come from the source
 * it illustrates?
 *
 * An AI author (a deck refiner, a video director) rewords and arranges; it must
 * never add a fact. These pure checks are the gate its output passes before a
 * slide ships, shared so every product holds generated slides to the same
 * standard:
 *
 * - {@link ungroundedNumber}: every number shown is one the source states,
 *   in digits or words (commas ignored, so "1400" matches "1,400" and "10"
 *   matches "ten").
 * - {@link isVerbatimQuote}: a quotation is the source's own words.
 * - {@link isGroundedParaphrase}: a short label or point may trim and reorder,
 *   but its numbers and most of its distinctive words come from the source.
 * - {@link restatesHeadline}: a point that only repeats its headline.
 * - {@link rangeEndOnly}: a number the source gives only as one end of a range
 *   ("3 to 7 miles deep"). Shown as a single value — a count-up, one bar — it
 *   misstates the source, though the number itself appears there.
 *
 * Checks report; callers decide what to drop. None of them can tell whether
 * a slide is good, only whether it is faithful.
 *
 * Related: `doc/templates/authoringGuide.ts` (what authors are told),
 * `transform/conceptReveal.ts` (matching points to the sentences that say them).
 */

/** A number as written: digits with thousands commas and an optional decimal part. */
const NUMBER = /\d[\d,]*(?:\.\d+)?/gu;

/**
 * Lowercased text with typographic quotes and dashes folded and other
 * punctuation spaced out; apostrophes, percent signs and hyphens survive.
 */
export function normalizeGroundingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-')
    .replace(/[^a-z0-9'%\s-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The numbers a value shows, commas dropped: "1,500 to 2,500 feet" → ["1500", "2500"]. */
export function numbersIn(value: string | number): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [String(value)] : [];
  return (value.match(NUMBER) ?? []).map((number) => number.replace(/,/gu, ''));
}

const UNIT_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEEN_WORDS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS_WORDS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_WORD = new RegExp(
  `\\b(?:(${TENS_WORDS.join('|')})(?:[-\\s](${UNIT_WORDS.join('|')}))?|(${[...UNIT_WORDS.slice(1), ...TEEN_WORDS].join('|')}))\\b`,
  'giu',
);

/**
 * Numbers a source spells out, two to ninety-nine ("ten peaks", "twenty-five
 * years"), with where each starts. "One" is left out: it is more often a
 * pronoun than a count.
 */
export function spelledNumbers(source: string): Array<{ value: string; index: number }> {
  return [...source.matchAll(NUMBER_WORD)].map((match) => {
    const [, tens, unit, small] = match;
    const value = small
      ? [...UNIT_WORDS, ...TEEN_WORDS].indexOf(small.toLowerCase()) + 1
      : (TENS_WORDS.indexOf(tens!.toLowerCase()) + 2) * 10 +
        (unit ? UNIT_WORDS.indexOf(unit.toLowerCase()) + 1 : 0);
    return { value: String(value), index: match.index };
  });
}

/** Every number a source states, in digits or spelled out, for repeated lookups. */
export function sourceNumbers(source: string): Set<string> {
  return new Set([...numbersIn(source), ...spelledNumbers(source).map(({ value }) => value)]);
}

/**
 * The first number among `values` that the source does not state, or
 * `undefined` when every one is grounded.
 */
export function ungroundedNumber(
  values: string | number | ReadonlyArray<string | number>,
  source: string | ReadonlySet<string>,
): string | undefined {
  const stated = typeof source === 'string' ? sourceNumbers(source) : source;
  const list = Array.isArray(values) ? values : [values as string | number];
  for (const value of list) {
    const missing = numbersIn(value).find((number) => !stated.has(number));
    if (missing !== undefined) return missing;
  }
  return undefined;
}

/** Sentences of a text, split after ., ! or ? and at line breaks. */
export function groundingSentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/gu) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

export interface VerbatimQuoteOptions {
  /** The source's sentences, when the caller splits them its own way. */
  sentences?: readonly string[];
  /** Share of the quote's words one sentence must hold (default 0.9). */
  minShare?: number;
}

/**
 * Whether `quote` is the source's own words: a span of the source once both
 * are normalized, or a sentence of it holding nearly all of the quote's words
 * (a dropped comma or a trimmed clause still passes; a paraphrase does not).
 */
export function isVerbatimQuote(
  quote: string,
  source: string,
  options: VerbatimQuoteOptions = {},
): boolean {
  const q = normalizeGroundingText(quote);
  if (!q) return false;
  if (normalizeGroundingText(source).includes(q)) return true;
  const words = q.split(' ').filter((word) => word.length > 1);
  if (words.length === 0) return false;
  const minShare = options.minShare ?? 0.9;
  for (const sentence of options.sentences ?? groundingSentences(source)) {
    const present = new Set(normalizeGroundingText(sentence).split(' '));
    const hits = words.filter((word) => present.has(word)).length;
    if (hits / words.length >= minShare) return true;
  }
  return false;
}

/** Words too common to show where a phrase came from. */
const COMMON = new Set(
  'about after also because been before being both could does each from have into just like more most much only other over same should some such than that their them then there these they this those through very what when where which while will with would your ours'.split(
    ' ',
  ),
);

/**
 * Distinctive words of a text — four letters or longer and not a common
 * word — by their first four letters, so "writing" matches "write" and a
 * possessive matches its noun.
 */
export function distinctiveStems(text: string): string[] {
  return (
    (
      text
        .toLowerCase()
        .replace(/[‘’]/gu, "'")
        .replace(/[“”]/gu, '"')
        // Hyphens join a compound; en and em dashes separate words ("grew—slowly").
        .replace(/[‐‑]/gu, '-')
        .replace(/[‒–—―]/gu, ' ')
        .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []
    )
      .filter((word) => word.length >= 4 && !COMMON.has(word))
      .map((word) => word.slice(0, 4))
  );
}

export interface ParaphraseOptions {
  /** Share of the text's distinctive words the source must use (default ⅔). */
  minShare?: number;
}

/**
 * Whether a short paraphrase (a label, a point, a list item) is grounded:
 * every number it shows is stated in the source, and at least `minShare` of
 * its distinctive words come from the source. A text with no distinctive
 * words ("Then", "By 1900") passes on its numbers alone.
 */
export function isGroundedParaphrase(
  text: string,
  source: string,
  options: ParaphraseOptions = {},
): boolean {
  if (ungroundedNumber(text, source) !== undefined) return false;
  const stems = new Set(distinctiveStems(source));
  const words = distinctiveStems(text);
  const minShare = options.minShare ?? 2 / 3;
  return words.filter((word) => stems.has(word)).length >= Math.ceil(words.length * minShare);
}

/**
 * Whether a point mostly repeats its headline (most of its words are the
 * headline's) or merely continues it (it holds every word of a headline of
 * three or more), so it adds nothing to the slide.
 */
export function restatesHeadline(point: string, headline: string): boolean {
  const title = distinctiveStems(headline);
  const words = distinctiveStems(point);
  const shared = words.filter((word) => title.includes(word)).length;
  return (
    (words.length > 0 && shared >= words.length * 0.6) ||
    (title.length >= 3 && title.every((word) => words.includes(word)))
  );
}

/** A range a source states, such as "3 to 7", "1,500–2,500" or "between 10 and 12". */
export interface StatedRange {
  /** The lower end as written, commas dropped. */
  low: string;
  /** The upper end as written, commas dropped. */
  high: string;
  /** The range as it appears in the source. */
  text: string;
  /** Where it starts in the source. */
  index: number;
}

const RANGE =
  /(?:\bbetween\s+(\d[\d,]*(?:\.\d+)?)\s+and\s+(\d[\d,]*(?:\.\d+)?))|(?:(\d[\d,]*(?:\.\d+)?)\s*(?:[-–—]|\bto\b)\s*(\d[\d,]*(?:\.\d+)?))/giu;

/** Every range the source states, in order. */
export function statedRanges(source: string): StatedRange[] {
  return [...source.matchAll(RANGE)].map((match) => ({
    low: (match[1] ?? match[3]!).replace(/,/gu, ''),
    high: (match[2] ?? match[4]!).replace(/,/gu, ''),
    text: match[0],
    index: match.index,
  }));
}

/**
 * When every place the source states `value` is one end of a range, the
 * first such range; otherwise `undefined`. Use it on numbers a slide shows
 * as one value — a count-up, a single bar, a comparison — where "3 to 7 miles
 * deep" drawn as 7 says something the source does not. Dates are ranges of
 * a different kind ("1939–1945" names two years); don't check them here.
 */
export function rangeEndOnly(value: string | number, source: string): StatedRange | undefined {
  const [number] = numbersIn(value);
  if (number === undefined) return undefined;
  const ranges = statedRanges(source);
  if (ranges.length === 0) return undefined;
  // Spelled out ("ten peaks"), the number is stated on its own.
  if (spelledNumbers(source).some((spelled) => spelled.value === number)) return undefined;
  let first: StatedRange | undefined;
  for (const match of source.matchAll(NUMBER)) {
    if (match[0].replace(/,/gu, '') !== number) continue;
    const range = ranges.find(
      (candidate) =>
        match.index >= candidate.index && match.index < candidate.index + candidate.text.length,
    );
    if (!range) return undefined;
    first ??= range;
  }
  return first;
}
