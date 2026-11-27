/** Uses the same narrated-segment extractor/template selection as Qualla.
 * Canonical source passages provide the anchors; the visual suggestions are
 * deliberately separate from the text that the person hears.
 */
import {
  PRESENTATION_DENSITIES,
  PRESENTATION_DENSITY_LABELS,
  defaultPresentationHints,
  parsePresentationHints,
  presentationDensityDistills,
  presentationPassageKey,
  slideHintHasWording,
  type PresentationBlockHint,
  type PresentationHints,
  type PresentationSlideHint,
} from './presentationHints.js';
import {
  divideSection,
  keyPointText,
  keySentences,
  sectionSlideCount,
  type SlideStart,
} from './keyPoints.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import type { Doc } from '../schemas/Doc.js';
import { matchNumberHighlight } from '../recommend/numberHighlight.js';
import { buildNarrationScript } from '../narration/script.js';
import { extractPlainText } from '../markdown/utils.js';
import { transformNarratedSegment } from './narratedSegment.js';
import { conceptTemplate } from './conceptReveal.js';
import { shapeIsStated } from '../recommend/listShape.js';
import { flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { realChildren } from '../doc/accessoryBlocks.js';
import { isFeatureBlockTemplate, resolveTemplateName } from '../doc/templates/templateNames.js';
import {
  collectPresentationMedia,
  type PresentationBlockMediaItem,
  type PresentationMediaItem,
  type PresentationNodeMediaItem,
} from './presentationMedia.js';
import {
  AUTHORED_PRESENTATION_LAYOUT,
  FEATURE_PRESENTATION_LAYOUT,
  PRESENTATION_LIMITS,
  isSummaryPresentationLayout,
  presentationBeatIsSlide,
  presentationBeatIsWorded,
  presentationBeatExtras,
  presentationLayoutFits,
  type PresentationBeat,
  type PresentationLayout,
  type PresentationPlan,
} from './presentationPlan.js';

const SENTENCE_END = /[.!?][”"')\]]?$/u;
/**
 * A word whose full stop does not end a sentence: an initial ("John F.
 * Kennedy"), a title ("Dr."), or a common abbreviation ("U.S.", "e.g.").
 * Splitting there cut a headline or a point off mid-name.
 */
const ABBREVIATION =
  /(?:^|[\s(“"‘'])(?:\p{Lu}|(?:\p{Lu}\.)+\p{Lu}|Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|Ft|Gen|Col|Lt|Capt|Sgt|Cmdr|Adm|Gov|Sen|Rep|Rev|Hon|vs|etc|e\.g|i\.e|cf|ca|approx|est|No|Fig|Inc|Ltd|Co|Corp)\.$/u;
/** What can open a new sentence; "(like video, etc.) on top" continues one. */
const SENTENCE_START = /^[\p{Lu}\p{N}"“‘'([]/u;
/** A sentence that opens with an ordering word reads as one step of a sequence. */
const SEQUENCE_CUE =
  /^(?:(?:first|second|third|fourth)(?:ly)?|then|next|after\b|afterwards|at that point|eventually|finally|lastly)\b|^\d+[.)]\s/iu;
/** The ordinal word a numbered stage no longer needs ("First, …", "Then …"). */
const ORDINAL_OPENER =
  /^(?:(?:first|second|third|fourth)(?:ly)?|then|next|after that|afterwards|finally|lastly),?\s+/iu;
/** A stage's words: its sentence without the ordinal its number now shows. */
function stagePoint(sentence: string, word: (text: string) => string = pointText): string {
  const rest = sentence.replace(ORDINAL_OPENER, '');
  return word(rest === sentence ? sentence : `${rest[0]!.toUpperCase()}${rest.slice(1)}`);
}
/** A sentence that defines its subject: "Antibodies are proteins produced by…". */
const DEFINES =
  /^(?:the |an? )?((?:[\p{Lu}][\p{L}'’-]*|[\p{Ll}][\p{L}'’-]*)(?: [\p{L}'’()-]+){0,3}?) (?:is|are|was|were) (?:an? |the )?(.{12,})$/u;
const PRONOUN =
  /^(?:it|its|this|that|these|those|there|they|their|he|his|she|her|we|our|you|your|i|my|which|one|each|some|to|so|but|and|or|what|why|how|when|where|who|whose|whatever|while|although|though|if|because|since|as|every|all|most|many|any|no|both|even|only|just)$/iu;
/** A subject that is a clause of its own ("History shows that vaccines"), not a term. */
const CLAUSE = /\s(?:that|which|who|whose)\s/iu;
/** A card's text: a defining sentence labelled by its subject, otherwise the sentence. */
function labelledPoint(
  sentence: string,
  word: (text: string) => string = (text) => clip(text, Infinity, 160),
): string {
  const match = sentence.replace(/\s+/gu, ' ').trim().match(DEFINES);
  // "Armstrong was commander, Aldrin was the pilot, and Collins was…" names
  // three things, not one: a label for the first would mislabel the rest.
  const clauses = match && /[,;]\s+(?:and\s+)?[^,;]*?\s(?:is|are|was|were)\s/u.test(match[2]!);
  if (
    match &&
    !clauses &&
    !PRONOUN.test(match[1]!.split(' ')[0]!) &&
    !CLAUSE.test(match[1]!) &&
    // What it is said to be would read as a second label ("a contract: a plain…").
    !/:\s/u.test(match[2]!)
  ) {
    const label = match[1]!;
    // "The lesson is that structure matters" reads "The lesson: structure matters".
    return word(
      `${label[0]!.toUpperCase()}${label.slice(1)}: ${match[2]!.replace(/^that\s+/iu, '')}`,
    );
  }
  return word(sentence);
}
interface Sentence {
  text: string;
  start: number;
  end: number;
}
/** Shorten display text at a word boundary, marking the cut. */
function clip(text: string, words: number, characters: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  const parts = clean.split(' ');
  let result = parts.length > words ? parts.slice(0, words).join(' ') : clean;
  if (result.length > characters - 1) {
    const cut = result.slice(0, characters - 1);
    const space = cut.lastIndexOf(' ');
    result = space > characters / 2 ? cut.slice(0, space) : cut;
  }
  return result === clean ? clean : result.replace(/[\s,;:–—-]+$/u, '') + '…';
}
const headlineText = (text: string) => clip(text, 12, 110);
const pointText = (text: string) => clip(text, Infinity, 180);
const captionText = (text: string) => clip(text, 18, 110);
/** A slide that shows a table, picture, video or diagram keeps its words
 * short so the feature has the room: two points of about a line each. */
const FEATURE_POINTS = 2;
const FEATURE_POINT_CHARACTERS = 100;
/** Templates whose child headings are shapes someone placed on the slide. An
 * ASCII `diagram` is not one: its fence is a feature of the section around it. */
const HAND_DRAWN_TEMPLATES: ReadonlySet<string> = new Set(['drawing', 'layout']);
/** A feature slide's point: the sentence, cut at a clause break when it runs long. */
function featurePointText(text: string): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean.length <= FEATURE_POINT_CHARACTERS) return clean;
  const head = clean.slice(0, FEATURE_POINT_CHARACTERS);
  const clause = Math.max(
    ...[',', ';', ':', ' –', ' —', ' - '].map((mark) => head.lastIndexOf(mark)),
  );
  return clause > FEATURE_POINT_CHARACTERS * 0.4
    ? clean.slice(0, clause).replace(/[\s,;:–—-]+$/u, '') + '…'
    : clip(clean, Infinity, FEATURE_POINT_CHARACTERS);
}
/** Sentences (and lines) of one span, with their offsets in the script. */
function sentencesIn(sourceText: string, start: number, end: number): Sentence[] {
  const passage = sourceText.slice(start, end);
  const sentences: Sentence[] = [];
  let cursor = 0;
  const add = (to: number) => {
    const raw = passage.slice(cursor, to);
    const text = raw.trim();
    if (!text) return;
    const from = start + cursor + raw.indexOf(text);
    sentences.push({ text, start: from, end: from + text.length });
  };
  for (const match of passage.matchAll(/(?<=[.!?][”"')\]]?)\s+(?=[\p{Lu}\p{N}"“‘'([])|\n+/gu)) {
    // "President John F. Kennedy" does not end at the initial.
    if (!match[0].includes('\n') && ABBREVIATION.test(passage.slice(cursor, match.index))) continue;
    add(match.index);
    cursor = match.index + match[0].length;
  }
  add(passage.length);
  return sentences;
}
/** The longest sentence a key-number slide shows beside its figure. */
const STAT_SENTENCE_CHARACTERS = 120;
/** How many slides pass before another key number, so figures stay an event. */
const STAT_SPACING = 3;
/** A calendar year, which is a date and not a quantity worth counting up to. */
const YEAR = /^(?:1\d{3}|20\d{2})$/u;
/**
 * The figure a sentence turns on, when it has one worth a slide of its own:
 * a percentage, an amount of money, a count in the thousands or more, a
 * multiple. Years and bare small numbers are not.
 */
function strikingFigure(sentence: string): string | undefined {
  if (sentence.length > STAT_SENTENCE_CHARACTERS) return undefined;
  // "If it improves quality by, say, 20%" supposes a figure; it does not report one.
  if (/\b(?:say|suppose|imagine|hypothetically)\b,?\s/iu.test(sentence)) return undefined;
  const value = matchNumberHighlight(sentence)?.value.trim();
  if (!value || YEAR.test(value)) return undefined;
  // "The 9B's failures" names a thing (a model, a part) by its size.
  if (sentence.includes(`${value}'s`) || sentence.includes(`${value}’s`)) return undefined;
  return /[%‰$€£¥×,]|\d\s?(?:[xKMB]|million|billion|thousand|percent|times)\b/iu.test(value) ||
    /\d{4,}/u.test(value)
    ? value
    : undefined;
}
/** The most a deck's title slide says before its passage's points take over. */
const OPENING_TITLE_WORDS = 45;
/** The least of an opening passage that is worth a slide of points after its title. */
const OPENING_REST_WORDS = 70;
/** The longest sentence that stands alone as a big statement. */
const EMPHASIS_SENTENCE_CHARACTERS = 60;
const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/[\s….!?,;:]+$/u, '')
    .trim();
/** Whether a body sentence only repeats what a sentence-derived headline already shows. */
function repeats(sentence: string, headline: string): boolean {
  const body = comparable(sentence);
  const head = comparable(headline);
  return body === head || head.includes(body) || (head.length >= 24 && body.startsWith(head));
}
/** Word spans of one passage, preferring complete sentences so slides do not
 * open or close mid-sentence; a long sentence may stretch a slide a little. */
function chunkWords(words: RegExpMatchArray[], limit: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  const ends = (count: number) =>
    SENTENCE_END.test(words[count - 1]![0]) &&
    (count >= words.length ||
      (SENTENCE_START.test(words[count]![0]) && !ABBREVIATION.test(words[count - 1]![0])));
  let first = 0;
  while (first < words.length) {
    let last = Math.min(first + limit, words.length);
    if (last < words.length) {
      let cut = 0;
      for (let cursor = last; cursor > first + 18 && !cut; cursor--) if (ends(cursor)) cut = cursor;
      const reach = Math.min(words.length, first + Math.ceil(limit * 1.5));
      for (let cursor = last + 1; cursor <= reach && !cut; cursor++) if (ends(cursor)) cut = cursor;
      if (cut) last = cut;
      // A short tail is not a slide of its own. When everything left fits a
      // stretched slide, the passage stays whole: a cycle keeps the sentence
      // that closes it, and a matrix its fourth panel.
      if (words.length - last < limit / 2 && words.length - first <= Math.ceil(limit * 1.5))
        last = words.length;
    }
    chunks.push([first, last]);
    first = last;
  }
  return chunks;
}
/** Word spans of one passage that never begin or end inside a feature's own
 * words (`feature`): a table's cells stay with the slide before them, or the
 * slide after when they open the passage, and that slide shows the table. */
function chunkPassage(
  words: RegExpMatchArray[],
  limit: number,
  feature: (word: RegExpMatchArray) => boolean,
): Array<[number, number]> {
  const prose = words.flatMap((word, index) => (feature(word) ? [] : [index]));
  if (!prose.length) return words.length ? [[0, words.length]] : [];
  const chunks = chunkWords(
    prose.map((index) => words[index]!),
    limit,
  ).map(([first, last]): [number, number] => [prose[first]!, prose[last - 1]! + 1]);
  chunks[0]![0] = 0;
  chunks.forEach((chunk, index) => {
    chunk[1] = chunks[index + 1]?.[0] ?? words.length;
  });
  return chunks;
}
/** Where a section's tables and diagrams are spoken in the script. Slides show
 * those features themselves, so their words never become summary text. */
function featureSpans(
  sourceText: string,
  from: number,
  to: number,
  items: readonly PresentationMediaItem[],
  /** Records where each feature found is spoken, by its ref. */
  spoken?: Map<string, number>,
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = from;
  for (const item of items) {
    // A picture has no words, and a carried block's words are its own passage.
    if (item.kind === 'image' || item.kind === 'block') continue;
    const text = extractPlainText(item.node).trim();
    const at = text ? sourceText.indexOf(text, cursor) : -1;
    if (at < 0 || at + text.length > to) continue;
    spans.push([at, at + text.length]);
    spoken?.set(item.ref, at);
    cursor = at + text.length;
  }
  return spans;
}
/** A list in a section's body, and each of its items, as spoken in the script. */
interface ListSpan {
  start: number;
  end: number;
  ordered: boolean;
  items: Array<[number, number]>;
}
/** Where a section's lists are spoken. An author's list is its own key points. */
function listSpans(
  sourceText: string,
  from: number,
  to: number,
  contents: readonly MarkdownBlockNode[] | undefined,
): ListSpan[] {
  const lists: ListSpan[] = [];
  let cursor = from;
  for (const node of contents ?? []) {
    const text = extractPlainText(node).trim();
    const at = text ? sourceText.indexOf(text, cursor) : -1;
    if (at < 0 || at + text.length > to) continue;
    if (node.type === 'list') {
      const items: Array<[number, number]> = [];
      let inner = at;
      for (const item of node.children) {
        const itemText = extractPlainText(item).trim();
        const itemAt = itemText ? sourceText.indexOf(itemText, inner) : -1;
        if (itemAt < 0 || itemAt + itemText.length > at + text.length) continue;
        items.push([itemAt, itemAt + itemText.length]);
        inner = itemAt + itemText.length;
      }
      if (items.length)
        lists.push({ start: at, end: at + text.length, ordered: !!node.ordered, items });
    }
    cursor = at + text.length;
  }
  return lists;
}
function field(block: unknown, key: string): string | undefined {
  if (!block || typeof block !== 'object') return undefined;
  const value = (block as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
export function createPresentationPlan(
  doc: Doc,
  hints: PresentationHints = defaultPresentationHints(),
): PresentationPlan {
  return createPresentationPlanReport(doc, hints).plan;
}

/** Why a section asked to be shown on the slide before it has a slide of its own. */
export type PresentationRollupProblem =
  /** Its block does not draw a picture (`isFeatureBlockTemplate`). */
  | 'not-eligible'
  /** No section comes before it. */
  | 'no-section-before'
  /** The section before it is shown as authored, which carries nothing. */
  | 'section-before-authored'
  /** Every slide of the section before it is hidden. */
  | 'section-before-hidden'
  /** The last slide of the section before it already carries four things. */
  | 'no-room';

/** A section asked to be shown on the slide of the section before it (`slideLayout=feature`). */
export interface PresentationRollup {
  /** The section's block. */
  blockId: string;
  /** Its beat: `feature`, or `authored` when it has a slide of its own. */
  beatId?: string;
  /** The section before it, whose slide carries it (or would). */
  ownerId?: string;
  /** The beat that carries it. */
  carrierBeatId?: string;
  /** Why it has a slide of its own instead. */
  problem?: PresentationRollupProblem;
}

export interface PresentationPlanReport {
  plan: PresentationPlan;
  /** Every section asked to be shown on the slide before it, in document order. */
  rollups: PresentationRollup[];
}

/**
 * The deck for these hints, and where each section asked to be shown on the
 * slide before it ended up. A section that cannot be carried has a slide of
 * its own, exactly as `slideLayout=authored` would give it, and says why.
 */
export function createPresentationPlanReport(
  doc: Doc,
  hints: PresentationHints = defaultPresentationHints(),
): PresentationPlanReport {
  const report = planPresentation(doc, hints);
  if (report.plan.beats.length > PRESENTATION_LIMITS.beats)
    throw new Error(tooManySlides(doc, hints, report.plan.beats.length));
  return report;
}
/**
 * How many slides each summary length makes of this document, the rest of the
 * design as it is: what a designer shows beside each choice. A count can pass
 * the most a presentation holds (`PRESENTATION_LIMITS.beats`); choosing that
 * length then says so. Empty when the document cannot be planned at all.
 */
export function presentationSlideCounts(
  doc: Doc,
  hints: PresentationHints = defaultPresentationHints(),
): Partial<Record<PresentationHints['density'], number>> {
  const counts: Partial<Record<PresentationHints['density'], number>> = {};
  for (const density of PRESENTATION_DENSITIES) {
    try {
      counts[density] = planPresentation(doc, { ...hints, density }).plan.beats.filter(
        presentationBeatIsSlide,
      ).length;
    } catch {
      // No text, or too much of it: no length makes a deck.
      return {};
    }
  }
  return counts;
}
/**
 * Why a deck has more slides than a presentation holds, and what to do: a
 * shorter summary length, named only when it would fit, or else splitting the
 * document.
 */
function tooManySlides(doc: Doc, hints: PresentationHints, slides: number): string {
  const limit = PRESENTATION_LIMITS.beats;
  if (hints.density === 'section')
    return `This document makes ${slides} slides, one per section, and a presentation holds at most ${limit}. Split it into shorter documents.`;
  const name = (density: PresentationHints['density']) =>
    `“${PRESENTATION_DENSITY_LABELS[density].label}”`;
  // The lengths shorter than this one, the nearest first.
  const shorter = PRESENTATION_DENSITIES.slice(
    0,
    PRESENTATION_DENSITIES.indexOf(hints.density),
  ).reverse();
  const fits = shorter
    .filter((density) => planPresentation(doc, { ...hints, density }).plan.beats.length <= limit)
    .map(name);
  const choice =
    fits.length > 2
      ? `${fits.slice(0, -1).join(', ')}, or ${fits[fits.length - 1]}`
      : fits.join(' or ');
  return `At ${name(hints.density)} this document makes ${slides} slides, and a presentation holds at most ${limit}. ${
    choice
      ? `Choose ${choice} for a shorter summary, or split the document.`
      : 'Split it into shorter documents.'
  }`;
}
/**
 * The author's wording for a section's opening slide: its keyless summary —
 * which stays when the section's text changes — or, from a legacy design,
 * wording saved while the section still reads `sectionText`.
 */
function openingWording(
  hint: PresentationBlockHint | undefined,
  sectionText: string,
): { headline?: string; points?: string[] } | undefined {
  const keyless = hint?.slides?.find((slide) => slide.passage === undefined && !slide.origin);
  if (keyless && (keyless.headline !== undefined || keyless.points !== undefined))
    return {
      ...(keyless.headline !== undefined ? { headline: keyless.headline } : {}),
      ...(keyless.points !== undefined ? { points: keyless.points } : {}),
    };
  return hint?.wording?.source === sectionText ? hint.wording : undefined;
}
/**
 * The deck for these hints, however many slides it makes. A section that
 * asked to be shown on the slide before it but cannot be carried there is
 * planned again as authored, until every remaining one is carried.
 */
function planPresentation(doc: Doc, hints: PresentationHints): PresentationPlanReport {
  const refused = new Map<string, PresentationRollupProblem>();
  for (;;) {
    const attempt = planOnce(doc, hints, refused);
    if (!attempt.refusals.size) return { plan: attempt.plan, rollups: attempt.rollups };
    for (const [blockId, problem] of attempt.refusals) refused.set(blockId, problem);
  }
}

interface PlanAttempt {
  plan: PresentationPlan;
  rollups: PresentationRollup[];
  /** Sections this attempt could not carry; planned again as authored. */
  refusals: Map<string, PresentationRollupProblem>;
}

function planOnce(
  doc: Doc,
  hints: PresentationHints,
  refused: ReadonlyMap<string, PresentationRollupProblem>,
): PlanAttempt {
  if (!parsePresentationHints(hints)) throw new Error('The slide hints are invalid.');
  const script = buildNarrationScript(doc);
  if (!script.sourceText.trim()) throw new Error('Add some text before making a presentation.');
  if (script.sourceText.length > PRESENTATION_LIMITS.sourceCharacters)
    throw new Error(
      'This document is too long for one presentation. Split it into shorter documents.',
    );
  // A section whose body is a list already drawn as what it is a picture of
  // (a process, a cycle, key numbers: an author's tag, or a list whose shape
  // is clear) keeps that drawing. Dealt into summary cards it would lose the
  // very structure the list states, so it is shown as authored unless the
  // deck's designer chose a layout for it.
  //
  // So does a section someone drew: a drawing or a layout, shapes placed on
  // the slide, which is what Illustrate inserts. Only its heading is narrated,
  // so summarized it was an empty section break and its picture was in no
  // slide at all.
  const drawnLists = new Set(
    flattenRenderableBlocks(doc.blocks)
      .filter(
        (block) =>
          (!!conceptTemplate(block.template ?? '') &&
            block.contents?.length === 1 &&
            block.contents[0]!.type === 'list') ||
          (!block.autoTemplate &&
            HAND_DRAWN_TEMPLATES.has(resolveTemplateName(block.template ?? '')) &&
            realChildren(block).length > 0),
      )
      .map((block) => block.id),
  );
  // Sections shown on the slide of the section before them: a block that
  // draws a picture, after a section that makes slides of its own. Decided
  // before anything else, since it decides which section owns what.
  const blocksById = new Map(flattenRenderableBlocks(doc.blocks).map((block) => [block.id, block]));
  const hintOf = (blockId: string) => hints.blocks.find((item) => item.blockId === blockId);
  const rollupOwners = new Map<string, string>();
  const rollups: PresentationRollup[] = [];
  let previous: { blockId: string; authored: boolean } | undefined;
  for (const block of script.blocks) {
    const hint = hintOf(block.blockId);
    if (hint?.layout === FEATURE_PRESENTATION_LAYOUT) {
      const problem: PresentationRollupProblem | undefined =
        refused.get(block.blockId) ??
        (!isFeatureBlockTemplate(blocksById.get(block.blockId)?.template)
          ? 'not-eligible'
          : !previous
            ? 'no-section-before'
            : previous.authored
              ? 'section-before-authored'
              : undefined);
      if (!problem) {
        rollupOwners.set(block.blockId, previous!.blockId);
        rollups.push({ blockId: block.blockId, ownerId: previous!.blockId });
        continue;
      }
      // It has a slide of its own, as authored.
      rollups.push({
        blockId: block.blockId,
        ...(previous ? { ownerId: previous.blockId } : {}),
        problem,
      });
      previous = { blockId: block.blockId, authored: true };
      continue;
    }
    const source = script.sourceText.slice(block.charStart, block.charEnd);
    previous = {
      blockId: block.blockId,
      authored:
        hint?.layout === AUTHORED_PRESENTATION_LAYOUT ||
        (hint?.layout === undefined &&
          !openingWording(hint, source) &&
          drawnLists.has(block.blockId)),
    };
  }
  // A section's features (tables, pictures, videos and diagrams) accompany its
  // slides; each picture is shown once, in the narrated section that contains
  // it (or the nearest narrated section before it).
  const sectionMedia = collectPresentationMedia(
    doc,
    script.blocks.map((block) => block.blockId),
    new Set(rollupOwners.keys()),
  );
  const refusals = new Map<string, PresentationRollupProblem>();
  const beats: PresentationBeat[] = [];
  /** Where the deck last showed a key number or a big statement. */
  let lastStat = -Infinity;
  let lastEmphasis = -Infinity;
  const supportingOpeners = new Set<string>();
  /** Sections told in a few slides, and where each of their tables is spoken. */
  const countedSections = new Set<string>();
  const spokenFeatures = new Map<string, number>();
  /** The whole sentence each slide would show as a quote. */
  const quotes = new Map<string, string>();
  // One slide per section covers the whole passage and adds no supporting slides.
  const perSection = hints.density === 'section';
  const wordLimit = {
    concise: 28,
    balanced: 42,
    detailed: 64,
    keypoints: Infinity,
    section: Infinity,
  }[hints.density];
  for (const block of script.blocks) {
    const source = script.sourceText.slice(block.charStart, block.charEnd);
    const words = [...source.matchAll(/\S+/gu)];
    const hint = hints.blocks.find((item) => item.blockId === block.blockId);
    const wording = openingWording(hint, source);
    const inbetweens = !perSection && (hint?.inbetweens ?? hints.inbetweens);
    const heading = block.heading?.trim();
    const headingEnd = block.charStart + (heading?.length ?? 0);
    // A section shown on the slide before it is one beat for its whole
    // narration, never a slide: the slide carrying it stays up meanwhile.
    if (rollupOwners.has(block.blockId)) {
      if (!words.length) continue;
      const start = block.charStart + words[0]!.index;
      const last = words[words.length - 1]!;
      const end = block.charStart + last.index + last[0].length;
      beats.push({
        id: `beat-${beats.length + 1}`,
        sourceStart: start,
        sourceEnd: end,
        layout: FEATURE_PRESENTATION_LAYOUT,
        headline: headlineText(heading || sentencesIn(script.sourceText, start, end)[0]!.text),
        points: [],
      });
      continue;
    }
    // An authored section is one slide for its whole narration: its own block,
    // never summarized, split, or given the section's media a second time.
    // (So is a section asked to be shown on the slide before it that cannot be.)
    if (
      hint?.layout === AUTHORED_PRESENTATION_LAYOUT ||
      hint?.layout === FEATURE_PRESENTATION_LAYOUT ||
      (hint?.layout === undefined && !wording && drawnLists.has(block.blockId))
    ) {
      if (!words.length) continue;
      const start = block.charStart + words[0]!.index;
      const last = words[words.length - 1]!;
      const end = block.charStart + last.index + last[0].length;
      beats.push({
        id: `beat-${beats.length + 1}`,
        sourceStart: start,
        sourceEnd: end,
        layout: AUTHORED_PRESENTATION_LAYOUT,
        headline: headlineText(heading || sentencesIn(script.sourceText, start, end)[0]!.text),
        points: [],
      });
      continue;
    }
    const preferred = isSummaryPresentationLayout(hint?.layout) ? hint.layout : undefined;
    const media = sectionMedia.get(block.blockId) ?? [];
    const spans = featureSpans(
      script.sourceText,
      block.charStart,
      block.charEnd,
      media,
      spokenFeatures,
    );
    const inFeature = (from: number, to: number) => spans.some(([s, e]) => from < e && to > s);
    const featureWord = (word: RegExpMatchArray) =>
      inFeature(block.charStart + word.index!, block.charStart + word.index! + word[0].length);
    // A section told in a few slides, or in a number its author chose, is cut
    // evenly; each slide then stands for a long passage, and shows the points
    // chosen from it rather than its sentences.
    const counted = hint?.count !== undefined || hints.density === 'keypoints';
    const distilled = counted || presentationDensityDistills(hints.density);
    const lists = distilled
      ? listSpans(
          script.sourceText,
          block.charStart,
          block.charEnd,
          blocksById.get(block.blockId)?.contents,
        )
      : [];
    const listAt = (offset: number) =>
      lists.find((list) => offset >= list.start && offset < list.end);
    const sectionSentences = distilled
      ? sentencesIn(script.sourceText, block.charStart, block.charEnd).filter(
          (sentence) => !inFeature(sentence.start, sentence.end),
        )
      : [];
    const keyContext = { heading, section: sectionSentences, sourceText: script.sourceText };
    let chunks: Array<[number, number]>;
    if (counted) {
      countedSections.add(block.blockId);
      // Prose words before each word: a table's cells are not counted.
      const position: number[] = [];
      let proseWords = 0;
      for (const word of words) {
        position.push(proseWords);
        if (!featureWord(word)) proseWords++;
      }
      const wordAt = new Map(words.map((word, at) => [block.charStart + word.index!, at]));
      const firstBody = sectionSentences.find((sentence) => sentence.start >= headingEnd);
      const starts: SlideStart[] = [];
      for (const sentence of sectionSentences) {
        const word = wordAt.get(sentence.start);
        // Never the heading alone, and never between a list and what introduces it.
        if (!word || (heading && sentence === firstBody)) continue;
        const list = listAt(sentence.start);
        // A short list stays on one slide; a long one may be cut between items.
        if (
          list &&
          (list.items.length <= PRESENTATION_LIMITS.points ||
            list.items[0]![0] === sentence.start ||
            !list.items.some(([itemStart]) => itemStart === sentence.start))
        )
          continue;
        const before = script.sourceText.slice(block.charStart, sentence.start);
        starts.push({
          word,
          position: position[word]!,
          paragraph: !list && /\n\s*$/u.test(before),
        });
      }
      const proseCharacters =
        source.length - spans.reduce((total, [from, to]) => total + (to - from), 0);
      chunks = divideSection(
        words.length,
        proseWords,
        starts,
        hint?.count ?? sectionSlideCount(proseWords, proseCharacters),
      );
      // A deck opens on its title. When the opening slide would stand for a
      // long passage, the title shows as that passage begins (its first
      // sentence beneath it) and the passage's points follow on a slide of
      // their own, instead of going unshown behind the title for a minute.
      // (A section whose author chose its number of slides has that many.)
      const opening = chunks[0];
      if (opening && hint?.count === undefined && beats.length === 0) {
        const within = starts.filter((start) => start.word > opening[0] && start.word < opening[1]);
        // What the title slide keeps: the heading and one sentence (the
        // first place a slide may begin is the second body sentence).
        const second = heading ? within[0] : within[1];
        const rest = second ? position[opening[1] - 1]! + 1 - second.position : 0;
        if (
          second &&
          second.position <= OPENING_TITLE_WORDS &&
          rest >= OPENING_REST_WORDS &&
          within.length >= 3
        )
          chunks.splice(0, 1, [opening[0], second.word], [second.word, opening[1]]);
      }
    } else {
      chunks = chunkPassage(words, wordLimit, featureWord);
      // A sequence ("First… Then… After…") stays on one slide, so it can show as
      // a process, unless that would make the slide twice as long as the rest.
      for (let k = chunks.length - 1; k > 0; k--) {
        const opening = script.sourceText.slice(block.charStart + words[chunks[k]![0]]!.index!);
        if (SEQUENCE_CUE.test(opening) && chunks[k]![1] - chunks[k - 1]![0] <= wordLimit * 2) {
          chunks[k - 1]![1] = chunks[k]![1];
          chunks.splice(k, 1);
        }
      }
    }
    // A section's images go on its closing slides, never on the deck's opening title.
    const images = media.filter((item): item is PresentationNodeMediaItem => item.kind === 'image');
    const opensDeck = beats.length === 0;
    for (const [chunk, [first, last]] of chunks.entries()) {
      const fromEnd = chunks.length - 1 - chunk;
      const picture = opensDeck && chunk === 0 ? undefined : images[fromEnd];
      const start = block.charStart + words[first]!.index;
      const end = block.charStart + words[last - 1]!.index + words[last - 1]![0].length;
      const passage = script.sourceText.slice(start, end);
      // The passage without the cells and diagram source its features show.
      let prose = '';
      let cursor = start;
      for (const [s, e] of spans) {
        if (e <= cursor || s >= end) continue;
        prose += script.sourceText.slice(cursor, Math.max(cursor, s)) + '\n';
        cursor = Math.min(end, e);
      }
      prose = (prose + script.sourceText.slice(cursor, end)).trim() || passage;
      const index = beats.length;
      const sentences = sentencesIn(script.sourceText, start, end).filter(
        (sentence) => !inFeature(sentence.start, sentence.end),
      );
      const body = sentences.filter((sentence) => sentence.start >= headingEnd);
      // The section heading titles each of its slides, so every body sentence
      // can be shown. Without a heading the headline comes from the passage,
      // and the sentence it was taken from is not repeated underneath it.
      let headline: string;
      let shown: Sentence[];
      if (heading) {
        headline = headlineText(heading);
        shown = body.filter((sentence) => comparable(sentence.text) !== comparable(heading));
      } else {
        const suggested = transformNarratedSegment(
          {
            articleId: doc.articleId,
            segmentId: `presentation-${index}`,
            title: '',
            text: prose,
            duration: Math.max(4, (last - first) / 2.5),
            audioSrc: '',
            includeTitleBlock: false,
          },
          { slidesPerMinute: 4, minConfidence: 0.25, style: 'documentary' },
        ).doc.blocks[0];
        headline = headlineText(
          field(suggested, 'fact') ??
            field(suggested, 'description') ??
            field(suggested, 'quote') ??
            sentences[0]?.text ??
            prose,
        );
        if (!headline) headline = headlineText(prose);
        shown = body.filter((sentence) => !repeats(sentence.text, headline));
      }
      // A slide that stands for a long passage shows the points chosen from
      // it: the items of a list its author wrote, or else the sentences that
      // carry it. One that follows the text shows its opening sentences.
      const word = distilled ? (text: string) => keyPointText(text) : pointText;
      const listed = distilled
        ? lists.flatMap((list) =>
            list.items.flatMap(([itemStart, itemEnd]) => {
              const opening = shown.find(
                (sentence) => sentence.start >= itemStart && sentence.start < itemEnd,
              );
              return opening ? [{ sentence: opening, ordered: list.ordered }] : [];
            }),
          )
        : [];
      const pointsOf = (from: Sentence[], count: number): Sentence[] =>
        distilled ? keySentences(from, count, keyContext) : from.slice(0, count);
      let picks: Sentence[];
      if (listed.length >= 2) {
        const items = listed.slice(0, PRESENTATION_LIMITS.points).map((item) => item.sentence);
        // A short list leaves room for what the prose around it says.
        const around =
          items.length < 3
            ? keySentences(
                shown.filter((sentence) => !listAt(sentence.start)),
                3 - items.length,
                keyContext,
              )
            : [];
        picks = [...items, ...around].sort((a, b) => a.start - b.start);
      } else picks = pointsOf(shown, distilled && shown.length >= 8 ? 4 : 3);
      // A steps diagram shows only the sentences that open with an ordering
      // word (or the items of a numbered list); any introduction before them
      // stays with the text layouts.
      const cued = shown.filter((sentence) => SEQUENCE_CUE.test(sentence.text));
      const numbered =
        listed.length >= 2 && listed.every((item) => item.ordered)
          ? listed.map((item) => item.sentence)
          : undefined;
      const steps = numbered ?? cued;
      // In a long passage two ordering words can be chance; three are a sequence.
      const sequence =
        !!numbered ||
        (distilled
          ? cued.length >= 3 || (cued.length === 2 && shown.length <= 5)
          : cued.length >= 2);
      const textPoints = picks.map((item) => word(item.text));
      const stepPoints = sequence
        ? steps.slice(0, 4).map((item) => stagePoint(item.text, word))
        : textPoints;
      // Cards show up to four of the passage's sentences, a defined term
      // ("Antibodies are proteins…") set as its card's label.
      const cardPoints = distilled
        ? picks.map((item) => labelledPoint(item.text, word))
        : shown.slice(0, 4).map((item) => labelledPoint(item.text));
      // A slide that shows its passage's points keeps them: a picture takes a
      // slide of its own only as a supporting slide, and otherwise sits
      // beside the words. (One slide per section never adds a slide, so there
      // a section with a picture is that picture.)
      const image =
        picture &&
        (!counted ||
          preferred === 'image' ||
          (inbetweens && body.length >= 2 && last - first >= 24))
          ? picture
          : undefined;
      const custom = chunk === 0 ? wording : undefined;
      if (custom?.headline) headline = custom.headline;
      const pointsFor = (layout: PresentationLayout): string[] =>
        custom?.points ??
        (['steps', 'process', 'cycle'].includes(layout)
          ? stepPoints
          : layout === 'cards'
            ? cardPoints
            : layout === 'stat' && statPoints
              ? statPoints
              : layout === 'emphasis' && takeaway
                ? []
                : textPoints);
      // A quote shows one of the passage's own sentences, whole.
      const quote = custom?.headline
        ? undefined
        : body.find((sentence) => sentence.text.length <= 110)?.text;
      const headlineFor = (layout: PresentationLayout) =>
        layout === 'quote' && quote
          ? quote
          : layout === 'emphasis' && takeaway
            ? headlineText(takeaway)
            : headline;
      // Several ideas become cards; an ordered passage a process, or a cycle
      // when it says the sequence comes round again.
      let layout: PresentationLayout =
        index === 0 ? 'title' : textPoints.length >= 2 ? 'cards' : 'statement';
      // Whether the passage says so is the same reading a list's shape gets.
      if (sequence)
        layout =
          steps.length >= 3 &&
          shapeIsStated('cycle', { heading, passage: prose, items: stepPoints })
            ? 'cycle'
            : 'steps';
      else if (textPoints.length === 2 && /\b(versus|whereas|compared|instead)\b/iu.test(prose))
        layout = 'comparison';
      // A sentence that turns on a figure shows it as a key number: the
      // figure large, the sentence beside it. The heading must not carry a
      // number of its own, since the slide shows the first figure it finds.
      // (Of a long passage, only a figure among its chosen points: one in
      // passing is not what the slide is about.)
      const figureFrom = distilled ? picks : shown;
      const figureLine =
        !sequence && !custom && index > 0 && index - lastStat >= STAT_SPACING
          ? figureFrom.find((sentence) => strikingFigure(sentence.text))
          : undefined;
      const statPoints = figureLine
        ? [
            word(figureLine.text),
            ...figureFrom
              .filter((sentence) => sentence !== figureLine && !strikingFigure(sentence.text))
              .slice(0, 1)
              .map((item) => word(item.text)),
          ]
        : undefined;
      if (
        statPoints &&
        !matchNumberHighlight(headline) &&
        presentationLayoutFits('stat', headline, statPoints, passage)
      )
        layout = 'stat';
      // One short sentence left to itself, later in a section, is a takeaway:
      // it sets as a big statement rather than small under the heading again.
      const takeaway =
        layout === 'statement' &&
        !!heading &&
        chunk > 0 &&
        index - lastEmphasis >= 2 &&
        shown.length === 1 &&
        shown[0]!.text.length <= EMPHASIS_SENTENCE_CHARACTERS
          ? shown[0]!.text
          : undefined;
      if (takeaway) layout = 'emphasis';
      if (image) layout = 'image';
      if (
        preferred &&
        (preferred === 'image'
          ? !!image
          : presentationLayoutFits(
              preferred,
              headlineFor(preferred),
              pointsFor(preferred),
              passage,
            ))
      )
        layout = preferred;
      const beat: PresentationBeat = {
        id: `beat-${index + 1}`,
        sourceStart: start,
        sourceEnd: end,
        layout,
        headline: headlineFor(layout),
        points: pointsFor(layout),
        ...(layout === 'image' && image?.src ? { imageSrc: image.src } : {}),
      };
      if (quote) quotes.set(beat.id, quote);
      if (beat.layout === 'stat') lastStat = index;
      if (beat.layout === 'emphasis') lastEmphasis = index;
      // An optional supporting visual shares the passage's narration span and
      // takes over at a spoken sentence start, so each slide shows different
      // material: an introduction before its steps diagram, or the opening
      // sentences before the image that illustrates the rest.
      let split: number | undefined;
      if (inbetweens && !custom?.points && layout === 'steps' && sequence) {
        if (shown.some((sentence) => sentence.end <= steps[0]!.start)) split = steps[0]!.start;
      } else if (inbetweens && layout === 'image' && body.length >= 2 && last - first >= 24) {
        const middle = block.charStart + words[first + Math.floor((last - first) / 2)]!.index;
        split = body
          .slice(1)
          .map((sentence) => sentence.start)
          .reduce((best, candidate) =>
            Math.abs(candidate - middle) < Math.abs(best - middle) ? candidate : best,
          );
      }
      if (split === undefined) {
        beats.push(beat);
        continue;
      }
      const before = shown.filter((sentence) => sentence.end <= split);
      const after = shown.filter((sentence) => sentence.start >= split);
      // An image's caption is the next sentence when it fits whole; a cut-off
      // sentence reads badly under a picture, so the section title stands in.
      const caption =
        after[0] && after[0].text.length <= 110
          ? after[0].text
          : (heading ?? (after[0] ? captionText(after[0].text) : headline));
      const { imageSrc: _image, ...textBeat } = beat;
      supportingOpeners.add(`beat-${beats.length + 1}`);
      beats.push({
        ...textBeat,
        id: `beat-${beats.length + 1}`,
        layout: 'statement',
        sourceEnd: split,
        points: pointsOf(before, 3).map((item) => word(item.text)),
      });
      beats.push({
        ...beat,
        id: `beat-${beats.length + 1}`,
        sourceStart: split,
        ...(layout === 'image'
          ? {
              headline: caption,
              points: pointsOf(
                after.filter((sentence) => !repeats(sentence.text, caption)),
                3,
              ).map((item) => word(item.text)),
            }
          : {}),
      });
    }
  }
  // Each section's opening slide: where its keyless summary (your wording,
  // whatever the passage now says) applies.
  const openings = new Set<string>();
  for (const block of script.blocks) {
    const first = beats.find(
      (beat) => beat.sourceStart >= block.charStart && beat.sourceStart < block.charEnd,
    );
    if (first) openings.add(first.id);
  }
  // A hidden slide stays in the plan so the designer can show it again; the
  // deck leaves it out, so it carries none of the section's visuals.
  for (const block of script.blocks) {
    const hint = hints.blocks.find((item) => item.blockId === block.blockId);
    const legacy = hint?.hidden;
    const hidden = hint?.slides?.filter((slide) => slide.hidden);
    if (!legacy?.length && !hidden?.length) continue;
    for (const beat of beats) {
      if (beat.sourceStart < block.charStart || beat.sourceStart >= block.charEnd) continue;
      // A section shown on another slide has no slide to hide.
      if (beat.layout === FEATURE_PRESENTATION_LAYOUT) continue;
      const key = presentationPassageKey(script.sourceText.slice(beat.sourceStart, beat.sourceEnd));
      if (
        legacy?.includes(key) ||
        hidden?.some(
          (slide) =>
            slide.passage === key || (slide.passage === undefined && openings.has(beat.id)),
        )
      )
        beat.hidden = true;
    }
  }
  const closing = beats[beats.length - 1];
  if (
    beats.length > 2 &&
    closing?.layout === 'statement' &&
    !hints.blocks.some(
      (hint) =>
        hint.layout &&
        script.blocks.some(
          (block) =>
            block.blockId === hint.blockId &&
            closing.sourceStart >= block.charStart &&
            closing.sourceStart < block.charEnd,
        ),
    )
  )
    closing.layout = 'title';
  const sectionOf = (beat: PresentationBeat) =>
    script.blocks.find(
      (block) => beat.sourceStart >= block.charStart && beat.sourceStart < block.charEnd,
    );
  const hintFor = (beat: PresentationBeat) =>
    hints.blocks.find((item) => item.blockId === sectionOf(beat)?.blockId);
  /** Slides whose points the author typed (never shortened) or an AI suggested. */
  const worded = new Set<string>();
  const suggested = new Set<string>();
  let origin: PresentationPlan['origin'] = 'automatic';
  for (const beat of beats) {
    // Only summaries are worded: not a section shown as authored or on another slide.
    if (!isSummaryPresentationLayout(beat.layout)) continue;
    const section = sectionOf(beat);
    const hint = hintFor(beat);
    const passage = script.sourceText.slice(beat.sourceStart, beat.sourceEnd);
    // This slide's summaries: the one keyed to its exact passage, and on a
    // section's opening slide the keyless one.
    const key = presentationPassageKey(passage);
    const keyed = hint?.slides?.find((slide) => slide.passage === key);
    const keyless = openings.has(beat.id)
      ? hint?.slides?.find((slide) => slide.passage === undefined)
      : undefined;
    const cached =
      [keyed, keyless].find((slide) => slide?.origin === 'ai') ??
      hint?.ai?.find((item) => item.source === passage);
    if (cached && (cached.layout !== 'image' || beat.imageSrc)) {
      if (cached.headline !== undefined) beat.headline = cached.headline;
      if (cached.points !== undefined) beat.points = [...cached.points];
      if (cached.layout) {
        beat.layout = cached.layout;
        Object.assign(beat, presentationBeatExtras(cached.layout, cached));
      }
      suggested.add(beat.id);
      origin = 'ai';
    }
    // A deliberate author choice takes precedence over an AI suggestion; a
    // quote then shows the passage's own sentence, not the AI's wording.
    const preferred = isSummaryPresentationLayout(hint?.layout) ? hint.layout : undefined;
    if (preferred && !supportingOpeners.has(beat.id)) {
      const headline = (preferred === 'quote' && quotes.get(beat.id)) || beat.headline;
      if (
        preferred === 'image'
          ? !!beat.imageSrc
          : presentationLayoutFits(preferred, headline, beat.points, passage)
      ) {
        beat.layout = preferred;
        beat.headline = headline;
      }
    }
    // The author's wording wins over AI: the section's opening wording (its
    // keyless summary, or legacy wording while the text still matches), then
    // wording for this exact slide.
    const manual = [keyless, keyed].filter(
      (slide): slide is PresentationSlideHint =>
        !!slide && !slide.origin && slideHintHasWording(slide),
    );
    const legacyOpening =
      !manual.some((slide) => slide.passage === undefined) &&
      section &&
      beat.sourceStart === section.charStart &&
      hint?.wording?.source === script.sourceText.slice(section.charStart, section.charEnd)
        ? hint.wording
        : undefined;
    for (const wording of [...(legacyOpening ? [legacyOpening] : []), ...manual]) {
      if (wording.headline !== undefined) beat.headline = wording.headline;
      if (wording.points !== undefined) {
        beat.points = [...wording.points];
        worded.add(beat.id);
      }
      const layout = 'layout' in wording ? wording.layout : undefined;
      if (layout && (layout !== 'image' || beat.imageSrc)) {
        beat.layout = layout;
        Object.assign(beat, presentationBeatExtras(layout, wording));
      }
    }
    // Custom wording can leave a layout without what it shows (two sides of a
    // comparison, a number, the passage's exact words); say it plainly instead.
    if (
      beat.layout !== 'image' &&
      !presentationLayoutFits(beat.layout, beat.headline, beat.points, passage)
    )
      beat.layout = 'statement';
    if (beat.layout !== 'image') delete beat.imageSrc;
  }
  // A section's features accompany its slides in source order. The slides are
  // shared out so every feature is shown, whatever layout the section prefers;
  // one that can resume stays on screen across consecutive slides, and the
  // deck's opener and image slides keep their own visual whenever the section
  // has other slides. A picture rides along only where no slide shows it
  // full-bleed (a hidden image slide's picture stays hidden with it).
  //
  // A block shown on the slide before it rides on the last shown slide of the
  // section before it — that slide stays up while the block's own text is
  // narrated. A picture slide there becomes a text slide, its picture riding
  // with the block on that slide alone; the section's other slides are left
  // as they are.
  const carriers = new Map<string, PresentationBeat>();
  /** The picture each carrier showed full-bleed before it carried a block. */
  const displaced = new Map<string, string>();
  for (const [blockId, ownerId] of rollupOwners) {
    if (carriers.has(ownerId)) continue;
    const owner = script.blocks.find((block) => block.blockId === ownerId)!;
    const target = [...beats]
      .reverse()
      .find(
        (beat) =>
          beat.sourceStart >= owner.charStart &&
          beat.sourceStart < owner.charEnd &&
          presentationBeatIsWorded(beat),
      );
    if (!target) {
      refusals.set(blockId, 'section-before-hidden');
      continue;
    }
    if (target.layout === 'image') {
      if (target.imageSrc) displaced.set(ownerId, target.imageSrc);
      delete target.imageSrc;
      const passage = script.sourceText.slice(target.sourceStart, target.sourceEnd);
      target.layout = presentationLayoutFits('cards', target.headline, target.points, passage)
        ? 'cards'
        : 'statement';
    }
    carriers.set(ownerId, target);
  }
  const fullBleed = new Set(beats.flatMap((beat) => (beat.imageSrc ? [beat.imageSrc] : [])));
  for (const block of script.blocks) {
    const items = (sectionMedia.get(block.blockId) ?? []).filter(
      (item) =>
        item.kind !== 'block' &&
        (item.kind !== 'image' ||
          (!fullBleed.has(item.src!) && displaced.get(block.blockId) !== item.src)),
    );
    if (!items.length) continue;
    const own = beats.filter(
      (beat) =>
        beat.sourceStart >= block.charStart &&
        beat.sourceStart < block.charEnd &&
        presentationBeatIsWorded(beat),
    );
    if (!own.length) continue;
    const open = own.filter((beat) => beat !== beats[0] && beat.layout !== 'image');
    const slots = open.length ? open : own;
    const carry = (beat: PresentationBeat, ref: string): boolean => {
      if (beat.media?.includes(ref)) return true;
      if ((beat.media?.length ?? 0) >= PRESENTATION_LIMITS.mediaPerBeat) return false;
      beat.media = [...(beat.media ?? []), ref];
      return true;
    };
    // A section told in a few slides shows each thing once, so its other
    // slides keep the room for their points: a table on the slide whose
    // passage speaks of it, a picture on the closing slides. (Slides that
    // follow the text are short, so there a table stays up across them.)
    let shared = items;
    if (countedSections.has(block.blockId)) {
      shared = [];
      let pictures = 0;
      for (const item of items) {
        const at = spokenFeatures.get(item.ref);
        const slot =
          at !== undefined
            ? ([...slots].reverse().find((beat) => beat.sourceStart <= at) ?? slots[0]!)
            : item.kind === 'image'
              ? slots[Math.max(0, slots.length - 1 - pictures++)]!
              : undefined;
        if (!slot || !carry(slot, item.ref)) shared.push(item);
      }
    }
    const shown = new Set<string>();
    slots.forEach((beat, slot) => {
      if (!shared.length) return;
      const from = Math.floor((slot * shared.length) / slots.length);
      const to = Math.max(from + 1, Math.floor(((slot + 1) * shared.length) / slots.length));
      for (const item of shared.slice(from, to)) {
        if (!item.continuous && shown.has(item.ref)) continue;
        if (carry(beat, item.ref)) shown.add(item.ref);
      }
    });
  }
  // Then each carrier takes its blocks, first, as long as there is room.
  for (const [ownerId, target] of carriers) {
    const blocks = (sectionMedia.get(ownerId) ?? []).filter(
      (item): item is PresentationBlockMediaItem =>
        item.kind === 'block' && rollupOwners.get(item.block.id) === ownerId,
    );
    const picture = (sectionMedia.get(ownerId) ?? []).find(
      (item) => item.kind === 'image' && item.src === displaced.get(ownerId),
    );
    const existing = [...(picture ? [picture.ref] : []), ...(target.media ?? [])];
    const room = Math.max(0, PRESENTATION_LIMITS.mediaPerBeat - existing.length);
    for (const overflow of blocks.slice(room)) refusals.set(overflow.block.id, 'no-room');
    const fitting = blocks.slice(0, room);
    const carried = [...fitting.map((item) => item.ref), ...existing];
    if (carried.length) target.media = carried;
    for (const item of fitting) {
      const rollup = rollups.find((entry) => entry.blockId === item.block.id);
      if (rollup) rollup.carrierBeatId = target.id;
    }
  }
  const mediaKinds = new Map(
    [...sectionMedia.values()].flatMap((items) => items.map((item) => [item.ref, item.kind])),
  );
  for (const beat of beats) {
    if (!beat.media) continue;
    // The points of a drawn layout are the parts of one picture, not words
    // beside a feature: a process cut to two stages is a different process,
    // and a timeline cut to two dates ends early (2026-11-12). A table takes
    // the slide's width, so beside one every layout is words above it.
    const drawn =
      !!conceptTemplate(beat.layout) &&
      !beat.media.some((ref) => mediaKinds.get(ref) === 'table' || mediaKinds.get(ref) === 'block');
    // A feature needs the room, so the words beside it are fewer and shorter;
    // points the author typed stand as written.
    if (!worded.has(beat.id) && !drawn) {
      const points = beat.points.slice(0, FEATURE_POINTS);
      beat.points = suggested.has(beat.id) ? points : points.map(featurePointText);
    }
    // A steps diagram leaves a feature only a small inset, while the text
    // layouts pair them side by side; an explicit section choice stands.
    if (beat.layout === 'steps' && hintFor(beat)?.layout !== 'steps') beat.layout = 'list';
    const passage = script.sourceText.slice(beat.sourceStart, beat.sourceEnd);
    if (
      !presentationLayoutFits(
        beat.layout as PresentationLayout,
        beat.headline,
        beat.points,
        passage,
      )
    )
      beat.layout = 'statement';
  }
  // A hub's centre and a matrix's axes belong to those layouts only; a slide
  // that ended up as something else (a section preference, too few points
  // beside a feature) does not carry them.
  for (const beat of beats) {
    const extras = presentationBeatExtras(beat.layout, beat);
    delete beat.center;
    delete beat.xAxis;
    delete beat.yAxis;
    Object.assign(beat, extras);
  }
  for (const rollup of rollups) {
    const section = script.blocks.find((block) => block.blockId === rollup.blockId);
    const beat =
      section &&
      beats.find(
        (item) => item.sourceStart >= section.charStart && item.sourceStart < section.charEnd,
      );
    if (beat) rollup.beatId = beat.id;
  }
  return {
    plan: { version: 1, sourceText: script.sourceText, origin, beats },
    rollups,
    refusals,
  };
}
