/**
 * Key points — what a summary slide shows of a long passage.
 *
 * A slide that follows the text closely can show the sentences it is made
 * from: there are only two or three. A slide that stands for a whole section,
 * or a third of one, cannot. The narration tells the section; the slide shows
 * what an audience should keep. This module makes that choice without a model:
 *
 * - {@link sectionSlideCount}: how many slides a section of a given length is
 *   told in (one to three, more only for a very long section);
 * - {@link divideSection}: where those slides begin — at a sentence, at a
 *   paragraph when one is near, never inside a list or a table;
 * - {@link keySentences}: the sentences of a passage that carry it, chosen by
 *   what they say rather than where they come;
 * - {@link keyPointText}: one of them as a point short enough to read at a
 *   glance.
 *
 * The scoring is deliberately plain (the words a section keeps returning to,
 * where a sentence stands, how it opens), so the same passage always gives the
 * same points and a person can see why. A model can then reword them
 * (`presentationAuthor.ts`); it is asked about the same slides.
 *
 * Related: `presentationPlanner.ts`, which calls all of this.
 */

import { PRESENTATION_SECTION_SLIDES } from '../schemas/PresentationLayouts.js';

/** One sentence (or line) of the narration script. */
export interface KeySentence {
  text: string;
  /** Offsets in the script. */
  start: number;
  end: number;
}

/** A sentence up to this long is shown whole as a key point. */
export const KEY_POINT_CHARACTERS = 140;
/** A longer one is cut to about this, at a clause when one is near. */
const KEY_POINT_CUT_CHARACTERS = 110;

/** A section this short is told in one slide. */
const ONE_SLIDE_WORDS = 130;
/** …and one this short in two. */
const TWO_SLIDE_WORDS = 330;
/** Past three slides, a section gets another for each of these many words. */
const WORDS_PER_SLIDE = 220;
/** The most of the script one slide stands for, so a model can be shown its passage whole. */
const SLIDE_CHARACTERS = 2200;

/**
 * How many slides tell a section of this many words: one for a short section,
 * two for a medium one, three for a long one. Only a section far longer than
 * that gets more, so no slide stays up for minutes.
 */
export function sectionSlideCount(words: number, characters = 0): number {
  const byWords =
    words <= ONE_SLIDE_WORDS
      ? 1
      : words <= TWO_SLIDE_WORDS
        ? 2
        : Math.max(3, Math.ceil(words / WORDS_PER_SLIDE));
  return Math.min(
    PRESENTATION_SECTION_SLIDES,
    Math.max(byWords, Math.ceil(characters / SLIDE_CHARACTERS)),
  );
}

/** A place a slide may begin: a sentence's first word. */
export interface SlideStart {
  /** Index of the word that opens the sentence. */
  word: number;
  /** Prose words before it (a table's cells are not counted). */
  position: number;
  /** It opens a paragraph. */
  paragraph: boolean;
}

/**
 * Cut `words` words into `count` slides of about equal length, each beginning
 * at one of `starts` — at a paragraph when one is within two fifths of a
 * slide's length of the even cut, since a paragraph is one idea and a slide
 * that begins mid-paragraph splits it. Returns word spans `[first, last)`; fewer
 * than `count` when the passage has too few places to begin a slide.
 */
export function divideSection(
  words: number,
  proseWords: number,
  starts: readonly SlideStart[],
  count: number,
): Array<[number, number]> {
  for (let parts = Math.max(1, Math.min(count, starts.length + 1)); parts > 1; parts--) {
    const size = proseWords / parts;
    // A slide is never a sliver: a dozen words at least, more when slides are long.
    const least = Math.max(12, Math.min(40, size * 0.4));
    const cuts: SlideStart[] = [];
    let previous = 0;
    for (let cut = 1; cut < parts; cut++) {
      const ideal = cut * size;
      // What comes after must leave each remaining slide its dozen words too.
      const latest = proseWords - least * (parts - cut);
      let best: SlideStart | undefined;
      let bestCost = Infinity;
      for (const start of starts) {
        if (start.position < previous + least || start.position > latest) continue;
        const cost = Math.abs(start.position - ideal) - (start.paragraph ? size * 0.4 : 0);
        if (cost < bestCost) {
          best = start;
          bestCost = cost;
        }
      }
      if (!best) break;
      cuts.push(best);
      previous = best.position;
    }
    if (cuts.length !== parts - 1) continue;
    const edges = [0, ...cuts.map((cut) => cut.word), words];
    return edges.slice(0, -1).map((edge, index): [number, number] => [edge, edges[index + 1]!]);
  }
  return words ? [[0, words]] : [];
}

/** Words too common to say what a sentence is about (compared by their first five letters). */
const COMMON = new Set(
  (
    'about above after again against also although always among another around because been before ' +
    'being below between both cannot could does doing done down during each either else even ever ' +
    'every from further have having here however into itself just like made make many might more ' +
    'most much must never often only onto other others ought over rather really same shall should ' +
    'since some something still such than that their theirs them then there these they thing things ' +
    'this those though through thus together under until upon very want well were what when where ' +
    'whether which while will with within without would your yours'
  )
    .split(' ')
    .map((word) => word.slice(0, 5)),
);

/** The words that say what a sentence is about, by their opening letters. */
export function keyTerms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [])
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 5))
    .filter((word) => !COMMON.has(word));
}

/** A sentence that says it is the point. */
const SAYS_SO =
  /\b(?:key|crucial|essential|important(?:ly)?|main(?:ly)?|primar(?:y|ily)|in short|in summary|overall|ultimately|as a result|the result|this means|which means|therefore|turns? out|the lesson|takeaway|conclusion|we (?:found|learned|believe|recommend)|the (?:point|goal|idea|difference|problem|reason|answer|upside|downside|tradeoff|trade-off) (?:is|was)|what (?:does|did)(?:n't| not)? (?:help|work|matter))\b/iu;
/** A sentence that only illustrates the one before it. */
const ILLUSTRATES =
  /^(?:for (?:example|instance|an example)|e\.g\.|say,|consider\b|imagine\b|suppose\b|let'?s\b|let us\b|as an example|to illustrate|take\b[^.]{0,30}\bfor example)|\bfor (?:example|instance)\b/iu;
/** An opening that leans on the sentence before it. */
const LEANS =
  /^(?:this|that|these|those|it|its|they|their|them|he|she|his|her|such|here|there|both|neither|either|one other|another)\b/iu;
/** A sentence that only introduces what follows it. */
const INTRODUCES = /[:：]\s*$/u;
/** A question, which a slide's points answer rather than ask. */
const ASKS = /[?？]\s*["”’')\]]?$/u;
/** A sentence that opens as an example of the one before it. */
const OPENS_AS_EXAMPLE =
  /^(?:for (?:an? )?(?:example|instance)|e\.g\.|as an example|to illustrate)\b/iu;
/**
 * Whether a sentence reads on its own, as a headline must: it neither leans
 * on the sentence before it ("That trade…") nor opens as an example of it.
 */
export function standsAlone(text: string): boolean {
  const trimmed = text.trim();
  return !LEANS.test(trimmed) && !OPENS_AS_EXAMPLE.test(trimmed);
}
/** Whether a sentence serves another one rather than making a point of its own. */
function isAside(text: string): boolean {
  return INTRODUCES.test(text) || ASKS.test(text) || OPENS_AS_EXAMPLE.test(text.trim());
}
/** How a task list's items are spoken ("[checked] · Tests pass"); a point shows the item alone. */
const TASK_MARK = /^\[(?:checked|unchecked|x| |…)\]\s*·?\s*/iu;

export interface KeySentenceContext {
  /** The heading over the passage: a sentence about its subject is on topic. */
  heading?: string;
  /** Every sentence of the section, which says which words it keeps returning to. */
  section?: readonly KeySentence[];
  /** The script, to tell where a paragraph begins. */
  sourceText?: string;
}

/** Whether `sentence` opens a line of the script (a paragraph, a list item). */
function opensLine(sentence: KeySentence, sourceText: string | undefined): boolean {
  if (!sourceText) return false;
  for (let at = sentence.start - 1; at >= 0; at--) {
    const character = sourceText[at]!;
    if (character === '\n') return true;
    if (character.trim()) return false;
  }
  return true;
}

/** How alike two sentences are, by the words that say what they are about. */
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * The `count` sentences of `candidates` that carry the passage, in the order
 * they are spoken. A sentence counts for the words it shares with the rest of
 * its section and with its heading, for opening the passage or a paragraph,
 * for saying it is the point, and for stating a figure; it counts less when it
 * only introduces a list, illustrates the sentence before it, asks a question,
 * leans on "this" or "they", or runs long. Sentences that say the same thing
 * are not both chosen, and a paragraph with nothing chosen is preferred to a
 * second sentence from one that has.
 */
export function keySentences<T extends KeySentence>(
  candidates: readonly T[],
  count: number,
  context: KeySentenceContext = {},
): T[] {
  if (count <= 0 || !candidates.length) return [];
  // What only introduces a list, illustrates the sentence before it, or asks a
  // question is not a point of its own, unless it is all there is.
  const usable = candidates.filter((sentence) => !isAside(sentence.text));
  const pool = usable.length ? usable : [...candidates];
  if (pool.length <= count) return pool;

  const frequency = new Map<string, number>();
  const all = context.section ?? candidates;
  for (const sentence of all)
    for (const term of new Set(keyTerms(sentence.text)))
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
  // A word in a third of the section's sentences is what the section is
  // about, not what one sentence adds: it counts once, however often it comes.
  const everywhere = Math.max(3, all.length / 3);
  const topic = new Set(keyTerms(context.heading ?? ''));

  // Each line of the script is a paragraph (or a list item).
  let paragraph = -1;
  const scored = pool.map((sentence, index) => {
    const opens = index === 0 || opensLine(sentence, context.sourceText);
    if (opens) paragraph++;
    const terms = new Set(keyTerms(sentence.text));
    const words = sentence.text.split(/\s+/u).length;
    // The words it shares with the rest of the section, so that one long
    // sentence does not win by length alone.
    let central = 0;
    let onTopic = 0;
    for (const term of terms) {
      const seen = frequency.get(term) ?? 1;
      central += seen > everywhere ? 1 : Math.min(3, seen - 1);
      if (topic.has(term)) onTopic++;
    }
    // Shared words weigh about as much as where a sentence stands and how it
    // opens: on their own they pick whichever sentences repeat the subject.
    let score = (central / Math.sqrt(Math.max(4, terms.size))) * 0.5;
    score += Math.min(2, onTopic) * 0.5;
    if (index === 0) score += 1;
    else if (opens) score += 0.8;
    if (SAYS_SO.test(sentence.text)) score += 1.2;
    if (/\d/u.test(sentence.text)) score += 0.3;
    if (ILLUSTRATES.test(sentence.text)) score -= 1.2;
    if (LEANS.test(sentence.text)) score -= 0.6;
    if (words < 5) score -= 1.2;
    if (words > 30) score -= 0.4 + (words - 30) * 0.03;
    return { sentence, index, paragraph, terms, score };
  });

  const chosen: typeof scored = [];
  const remaining = new Set(scored);
  while (chosen.length < count && remaining.size) {
    const covered = new Set(chosen.map((item) => item.paragraph));
    let best: (typeof scored)[number] | undefined;
    let bestScore = -Infinity;
    for (const item of remaining) {
      const alike = Math.max(0, ...chosen.map((other) => overlap(item.terms, other.terms)));
      // One that all but repeats a chosen sentence is the last resort.
      const score =
        item.score -
        alike * 2 -
        (alike >= 0.75 ? 100 : 0) -
        (covered.has(item.paragraph) ? 0.7 : 0);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
    remaining.delete(best);
  }
  return chosen.sort((a, b) => a.index - b.index).map((item) => item.sentence);
}

/** A word that joins a sentence to the one before it, which a point does not need. */
const CONNECTIVE =
  /^(?:however|but|and|so|yet|still|also|thus|hence|therefore|moreover|furthermore|additionally|nevertheless|nonetheless|indeed|instead|meanwhile|basically|essentially|ultimately|importantly|notably|of course|in fact|in short|in other words|in addition|as a result|as such|that said|to be clear|put simply|after all|even so|at the same time|on the other hand)(?:,\s*|\s+(?=[\p{L}\p{N}"“‘']))/iu;

const capitalized = (text: string) => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text);

/**
 * A sentence as a point to read at a glance: without the word that joined it
 * to the sentence before ("However, …"), and, when it still runs past
 * `limit`, without its asides in brackets and then cut at a clause, marked
 * with an ellipsis. A sentence that fits is shown whole.
 */
export function keyPointText(text: string, limit: number = KEY_POINT_CHARACTERS): string {
  let clean = text.replace(/\s+/gu, ' ').trim().replace(TASK_MARK, '');
  const opened = clean.replace(CONNECTIVE, '');
  // "So what?" keeps its "so": only a sentence with something left loses the join.
  if (opened !== clean && opened.split(' ').length >= 4) clean = capitalized(opened);
  if (clean.length <= limit) return clean;
  const bare = clean
    .replace(/\s*\([^()]{0,200}\)/gu, '')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();
  if (bare.length < clean.length && bare.split(' ').length >= 4) clean = bare;
  if (clean.length <= limit) return clean;
  // Cut where a clause ends, when what comes before it says something on its
  // own: "We believe, with the right supports, …" cut at its first comma does not.
  const cut = Math.min(limit, KEY_POINT_CUT_CHARACTERS);
  const head = clean.slice(0, cut);
  const clause = Math.max(
    ...[',', ';', ':', ' –', ' —', ' - '].map((mark) => head.lastIndexOf(mark)),
  );
  const whole = clause > 0 ? clean.slice(0, clause).replace(/[\s,;:–—-]+$/u, '') : '';
  if (clause > cut * 0.6 && whole.split(' ').length >= 8) return `${whole}…`;
  const space = head.slice(0, cut - 1).lastIndexOf(' ');
  return (
    (space > cut / 2 ? head.slice(0, space) : head.slice(0, cut - 1)).replace(/[\s,;:–—-]+$/u, '') +
    '…'
  );
}
