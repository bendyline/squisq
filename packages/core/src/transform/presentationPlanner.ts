/** Uses the same narrated-segment extractor/template selection as Qualla.
 * Canonical source passages provide the anchors; the visual suggestions are
 * deliberately separate from the text that the person hears.
 */
import {
  defaultPresentationHints,
  parsePresentationHints,
  presentationPassageKey,
  type PresentationHints,
} from './presentationHints.js';
import type { Doc } from '../schemas/Doc.js';
import { buildNarrationScript } from '../narration/script.js';
import { extractPlainText } from '../markdown/utils.js';
import { transformNarratedSegment } from './narratedSegment.js';
import { collectPresentationMedia, type PresentationMediaItem } from './presentationMedia.js';
import {
  AUTHORED_PRESENTATION_LAYOUT,
  PRESENTATION_LIMITS,
  presentationLayoutFits,
  type PresentationBeat,
  type PresentationLayout,
  type PresentationPlan,
} from './presentationPlan.js';

const SENTENCE_END = /[.!?][”"')\]]?$/u;
/** What can open a new sentence; "(like video, etc.) on top" continues one. */
const SENTENCE_START = /^[\p{Lu}\p{N}"“‘'([]/u;
/** A sentence that opens with an ordering word reads as one step of a sequence. */
const SEQUENCE_CUE =
  /^(?:(?:first|second|third|fourth)(?:ly)?|then|next|after\b|afterwards|at that point|eventually|finally|lastly)\b|^\d+[.)]\s/iu;
/** The ordinal word a numbered stage no longer needs ("First, …", "Then …"). */
const ORDINAL_OPENER =
  /^(?:(?:first|second|third|fourth)(?:ly)?|then|next|after that|afterwards|finally|lastly),?\s+/iu;
/** A stage's words: its sentence without the ordinal its number now shows. */
function stagePoint(sentence: string): string {
  const rest = sentence.replace(ORDINAL_OPENER, '');
  return pointText(rest === sentence ? sentence : `${rest[0]!.toUpperCase()}${rest.slice(1)}`);
}
/** A passage that says its sequence comes round again. */
const CYCLE_CUE = /\b(?:cycles?|cyclical|repeats?|over and over|again and again|loop)\b/iu;
/** A sentence that defines its subject: "Antibodies are proteins produced by…". */
const DEFINES =
  /^(?:the |an? )?((?:[\p{Lu}][\p{L}'’-]*|[\p{Ll}][\p{L}'’-]*)(?: [\p{L}'’()-]+){0,3}?) (?:is|are|was|were) (?:an? |the )?(.{12,})$/u;
const PRONOUN =
  /^(?:it|its|this|that|these|those|there|they|their|he|his|she|her|we|our|you|your|i|my|which|one|each|some|to|so|but|and|or)$/iu;
/** A card's text: a defining sentence labelled by its subject, otherwise the sentence. */
function labelledPoint(sentence: string): string {
  const match = sentence.replace(/\s+/gu, ' ').trim().match(DEFINES);
  if (match && !PRONOUN.test(match[1]!.split(' ')[0]!)) {
    const label = match[1]!;
    return clip(`${label[0]!.toUpperCase()}${label.slice(1)}: ${match[2]!}`, Infinity, 160);
  }
  return clip(sentence, Infinity, 160);
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
    add(match.index);
    cursor = match.index + match[0].length;
  }
  add(passage.length);
  return sentences;
}
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
    (count >= words.length || SENTENCE_START.test(words[count]![0]));
  let first = 0;
  while (first < words.length) {
    let last = Math.min(first + limit, words.length);
    if (last < words.length) {
      let cut = 0;
      for (let cursor = last; cursor > first + 18 && !cut; cursor--) if (ends(cursor)) cut = cursor;
      const reach = Math.min(words.length, first + Math.ceil(limit * 1.5));
      for (let cursor = last + 1; cursor <= reach && !cut; cursor++) if (ends(cursor)) cut = cursor;
      if (cut) last = cut;
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
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = from;
  for (const item of items) {
    if (item.kind === 'image') continue;
    const text = extractPlainText(item.node).trim();
    const at = text ? sourceText.indexOf(text, cursor) : -1;
    if (at < 0 || at + text.length > to) continue;
    spans.push([at, at + text.length]);
    cursor = at + text.length;
  }
  return spans;
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
  if (!parsePresentationHints(hints)) throw new Error('The slide hints are invalid.');
  const script = buildNarrationScript(doc);
  if (!script.sourceText.trim()) throw new Error('Add some text before making a presentation.');
  if (script.sourceText.length > PRESENTATION_LIMITS.sourceCharacters)
    throw new Error(
      'This document is too long for one presentation. Split it into shorter documents.',
    );
  // A section's features (tables, pictures, videos and diagrams) accompany its
  // slides; each picture is shown once, in the narrated section that contains
  // it (or the nearest narrated section before it).
  const sectionMedia = collectPresentationMedia(
    doc,
    script.blocks.map((block) => block.blockId),
  );
  const beats: PresentationBeat[] = [];
  const supportingOpeners = new Set<string>();
  /** The whole sentence each slide would show as a quote. */
  const quotes = new Map<string, string>();
  // One slide per section covers the whole passage and adds no supporting slides.
  const perSection = hints.density === 'section';
  const wordLimit = { concise: 28, balanced: 42, detailed: 64, section: Infinity }[hints.density];
  for (const block of script.blocks) {
    const source = script.sourceText.slice(block.charStart, block.charEnd);
    const words = [...source.matchAll(/\S+/gu)];
    const hint = hints.blocks.find((item) => item.blockId === block.blockId);
    const wording = hint?.wording?.source === source ? hint.wording : undefined;
    const inbetweens = !perSection && (hint?.inbetweens ?? hints.inbetweens);
    const heading = block.heading?.trim();
    const headingEnd = block.charStart + (heading?.length ?? 0);
    // An authored section is one slide for its whole narration: its own block,
    // never summarized, split, or given the section's media a second time.
    if (hint?.layout === AUTHORED_PRESENTATION_LAYOUT) {
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
    const preferred: PresentationLayout | undefined = hint?.layout;
    const media = sectionMedia.get(block.blockId) ?? [];
    const spans = featureSpans(script.sourceText, block.charStart, block.charEnd, media);
    const inFeature = (from: number, to: number) => spans.some(([s, e]) => from < e && to > s);
    const chunks = chunkPassage(words, wordLimit, (word) =>
      inFeature(block.charStart + word.index!, block.charStart + word.index! + word[0].length),
    );
    // A sequence ("First… Then… After…") stays on one slide, so it can show as
    // a process, unless that would make the slide twice as long as the rest.
    for (let k = chunks.length - 1; k > 0; k--) {
      const opening = script.sourceText.slice(block.charStart + words[chunks[k]![0]]!.index!);
      if (SEQUENCE_CUE.test(opening) && chunks[k]![1] - chunks[k - 1]![0] <= wordLimit * 2) {
        chunks[k - 1]![1] = chunks[k]![1];
        chunks.splice(k, 1);
      }
    }
    // A section's images go on its closing slides, never on the deck's opening title.
    const images = media.filter((item) => item.kind === 'image');
    const opensDeck = beats.length === 0;
    for (const [chunk, [first, last]] of chunks.entries()) {
      const fromEnd = chunks.length - 1 - chunk;
      const image = opensDeck && chunk === 0 ? undefined : images[fromEnd];
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
      // A steps diagram shows only the sentences that open with an ordering
      // word; any introduction before them stays with the text layouts.
      const steps = shown.filter((sentence) => SEQUENCE_CUE.test(sentence.text));
      const sequence = steps.length >= 2;
      const textPoints = shown.slice(0, 3).map((item) => pointText(item.text));
      const stepPoints = sequence
        ? steps.slice(0, 4).map((item) => stagePoint(item.text))
        : textPoints;
      // Cards show up to four of the passage's sentences, a defined term
      // ("Antibodies are proteins…") set as its card's label.
      const cardPoints = shown.slice(0, 4).map((item) => labelledPoint(item.text));
      const custom = chunk === 0 ? wording : undefined;
      if (custom?.headline) headline = custom.headline;
      const pointsFor = (layout: PresentationLayout) =>
        custom?.points ??
        (['steps', 'process', 'cycle'].includes(layout)
          ? stepPoints
          : layout === 'cards'
            ? cardPoints
            : textPoints);
      // A quote shows one of the passage's own sentences, whole.
      const quote = custom?.headline
        ? undefined
        : body.find((sentence) => sentence.text.length <= 110)?.text;
      const headlineFor = (layout: PresentationLayout) =>
        layout === 'quote' && quote ? quote : headline;
      // Several ideas become cards; an ordered passage a process, or a cycle
      // when it says the sequence comes round again.
      let layout: PresentationLayout =
        index === 0 ? 'title' : textPoints.length >= 2 ? 'cards' : 'statement';
      if (sequence) layout = steps.length >= 3 && CYCLE_CUE.test(prose) ? 'cycle' : 'steps';
      else if (textPoints.length === 2 && /\b(versus|whereas|compared|instead)\b/iu.test(prose))
        layout = 'comparison';
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
        points: before.slice(0, 3).map((item) => pointText(item.text)),
      });
      beats.push({
        ...beat,
        id: `beat-${beats.length + 1}`,
        sourceStart: split,
        ...(layout === 'image'
          ? {
              headline: caption,
              points: after
                .filter((sentence) => !repeats(sentence.text, caption))
                .slice(0, 3)
                .map((item) => pointText(item.text)),
            }
          : {}),
      });
    }
  }
  if (beats.length > PRESENTATION_LIMITS.beats)
    throw new Error(
      'This document has too many sections for one presentation. Split it into shorter documents.',
    );
  // A hidden slide stays in the plan so the designer can show it again; the
  // deck leaves it out, so it carries none of the section's visuals.
  for (const block of script.blocks) {
    const hidden = hints.blocks.find((item) => item.blockId === block.blockId)?.hidden;
    if (!hidden) continue;
    for (const beat of beats)
      if (
        beat.sourceStart >= block.charStart &&
        beat.sourceStart < block.charEnd &&
        hidden.includes(
          presentationPassageKey(script.sourceText.slice(beat.sourceStart, beat.sourceEnd)),
        )
      )
        beat.hidden = true;
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
    if (beat.layout === AUTHORED_PRESENTATION_LAYOUT) continue;
    const section = sectionOf(beat);
    const hint = hintFor(beat);
    const passage = script.sourceText.slice(beat.sourceStart, beat.sourceEnd);
    const cached = hint?.ai?.find((item) => item.source === passage);
    if (cached && (cached.layout !== 'image' || beat.imageSrc)) {
      beat.headline = cached.headline;
      beat.points = [...cached.points];
      beat.layout = cached.layout;
      suggested.add(beat.id);
      origin = 'ai';
    }
    // A deliberate author choice takes precedence over an AI suggestion; a
    // quote then shows the passage's own sentence, not the AI's wording.
    const preferred = hint?.layout === AUTHORED_PRESENTATION_LAYOUT ? undefined : hint?.layout;
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
    if (
      section &&
      beat.sourceStart === section.charStart &&
      hint?.wording?.source === script.sourceText.slice(section.charStart, section.charEnd)
    ) {
      beat.headline = hint.wording.headline ?? beat.headline;
      beat.points = hint.wording.points ?? beat.points;
      if (hint.wording.points) worded.add(beat.id);
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
  const fullBleed = new Set(beats.flatMap((beat) => (beat.imageSrc ? [beat.imageSrc] : [])));
  for (const block of script.blocks) {
    const items = (sectionMedia.get(block.blockId) ?? []).filter(
      (item) => item.kind !== 'image' || !fullBleed.has(item.src!),
    );
    if (!items.length) continue;
    const own = beats.filter(
      (beat) =>
        beat.sourceStart >= block.charStart &&
        beat.sourceStart < block.charEnd &&
        beat.layout !== AUTHORED_PRESENTATION_LAYOUT &&
        !beat.hidden,
    );
    if (!own.length) continue;
    const open = own.filter((beat) => beat !== beats[0] && beat.layout !== 'image');
    const slots = open.length ? open : own;
    const shown = new Set<string>();
    slots.forEach((beat, slot) => {
      const from = Math.floor((slot * items.length) / slots.length);
      const to = Math.max(from + 1, Math.floor(((slot + 1) * items.length) / slots.length));
      const refs = items
        .slice(from, to)
        .filter((item) => item.continuous || !shown.has(item.ref))
        .slice(0, PRESENTATION_LIMITS.mediaPerBeat)
        .map((item) => item.ref);
      for (const ref of refs) shown.add(ref);
      if (refs.length) beat.media = refs;
    });
  }
  for (const beat of beats) {
    if (!beat.media) continue;
    // A feature needs the room, so the words beside it are fewer and shorter;
    // points the author typed stand as written.
    if (!worded.has(beat.id)) {
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
  return { version: 1, sourceText: script.sourceText, origin, beats };
}
