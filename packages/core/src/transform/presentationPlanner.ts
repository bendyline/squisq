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
import type { TransformImage } from './types.js';
import { buildNarrationScript } from '../narration/script.js';
import { flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { extractDocImages } from './blockAnalyzer.js';
import { transformNarratedSegment } from './narratedSegment.js';
import { collectPresentationMedia } from './presentationMedia.js';
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
  /^(?:(?:first|second|third|fourth)(?:ly)?|then|next|after that|afterwards|finally|lastly)\b|^\d+[.)]\s/iu;
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
/** Each document image is shown once, in the narrated section that contains it
 * (or the nearest narrated section before it). */
function imagesBySection(doc: Doc, sectionIds: string[]): Map<string, TransformImage[]> {
  const flat = flattenRenderableBlocks(doc.blocks);
  // Children follow their parent in the flattened order, so claim images
  // children-first; a container template keeps the images of its nested parts.
  const own = new Map<string, TransformImage[]>();
  const seen = new Set<string>();
  for (const block of [...flat].reverse()) {
    const images = extractDocImages([block]).filter((image) => !seen.has(image.src));
    for (const image of images) seen.add(image.src);
    own.set(block.id, images);
  }
  const sections = new Set(sectionIds);
  const result = new Map<string, TransformImage[]>();
  let owner = sectionIds[0];
  for (const block of flat) {
    if (sections.has(block.id)) owner = block.id;
    if (!owner) continue;
    result.set(owner, [...(result.get(owner) ?? []), ...(own.get(block.id) ?? [])]);
  }
  return result;
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
  const sectionImages = imagesBySection(
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
    const chunks = chunkWords(words, wordLimit);
    // A section's images go on its closing slides, never on the deck's opening title.
    const images = sectionImages.get(block.blockId) ?? [];
    const opensDeck = beats.length === 0;
    for (const [chunk, [first, last]] of chunks.entries()) {
      const fromEnd = chunks.length - 1 - chunk;
      const image = opensDeck && chunk === 0 ? undefined : images[fromEnd];
      const start = block.charStart + words[first]!.index;
      const end = block.charStart + words[last - 1]!.index + words[last - 1]![0].length;
      const passage = script.sourceText.slice(start, end);
      const index = beats.length;
      const sentences = sentencesIn(script.sourceText, start, end);
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
            text: passage,
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
            passage,
        );
        if (!headline) headline = headlineText(passage);
        shown = body.filter((sentence) => !repeats(sentence.text, headline));
      }
      // A steps diagram shows only the sentences that open with an ordering
      // word; any introduction before them stays with the text layouts.
      const steps = shown.filter((sentence) => SEQUENCE_CUE.test(sentence.text));
      const sequence = steps.length >= 2;
      const textPoints = shown.slice(0, 3).map((item) => pointText(item.text));
      const stepPoints = sequence
        ? steps.slice(0, 3).map((item) => pointText(item.text))
        : textPoints;
      const custom = chunk === 0 ? wording : undefined;
      if (custom?.headline) headline = custom.headline;
      const pointsFor = (layout: PresentationLayout) =>
        custom?.points ?? (layout === 'steps' ? stepPoints : textPoints);
      // A quote shows one of the passage's own sentences, whole.
      const quote = custom?.headline
        ? undefined
        : body.find((sentence) => sentence.text.length <= 110)?.text;
      const headlineFor = (layout: PresentationLayout) =>
        layout === 'quote' && quote ? quote : headline;
      let layout: PresentationLayout =
        index === 0 ? 'title' : textPoints.length >= 2 && index % 3 === 1 ? 'list' : 'statement';
      if (sequence) layout = 'steps';
      else if (textPoints.length === 2 && /\b(versus|whereas|compared|instead)\b/iu.test(passage))
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
        ...(layout === 'image' && image ? { imageSrc: image.src } : {}),
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
  // A section's videos and diagrams accompany its slides in source order. The
  // slides are shared out so every visual is shown; one that can resume stays
  // on screen across consecutive slides, and the deck's opener and image
  // slides keep their own visual whenever the section has other slides.
  const sectionMedia = collectPresentationMedia(
    doc,
    script.blocks.map((block) => block.blockId),
  );
  for (const block of script.blocks) {
    const items = sectionMedia.get(block.blockId);
    if (!items?.length) continue;
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
  let origin: PresentationPlan['origin'] = 'automatic';
  for (const beat of beats) {
    if (beat.layout === AUTHORED_PRESENTATION_LAYOUT) continue;
    const section = script.blocks.find(
      (block) => beat.sourceStart >= block.charStart && beat.sourceStart < block.charEnd,
    );
    const hint = hints.blocks.find((item) => item.blockId === section?.blockId);
    const passage = script.sourceText.slice(beat.sourceStart, beat.sourceEnd);
    const cached = hint?.ai?.find((item) => item.source === passage);
    if (cached && (cached.layout !== 'image' || beat.imageSrc)) {
      beat.headline = cached.headline;
      beat.points = [...cached.points];
      beat.layout = cached.layout;
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
    }
    // A steps diagram leaves a video or diagram only a small inset, while the
    // text layouts pair them side by side; an explicit section choice stands.
    if (beat.media && beat.layout === 'steps' && preferred !== 'steps') beat.layout = 'list';
    // Custom wording can leave a layout without what it shows (two sides of a
    // comparison, a number, the passage's exact words); say it plainly instead.
    if (
      beat.layout !== 'image' &&
      !presentationLayoutFits(beat.layout, beat.headline, beat.points, passage)
    )
      beat.layout = 'statement';
    if (beat.layout !== 'image') delete beat.imageSrc;
  }
  return { version: 1, sourceText: script.sourceText, origin, beats };
}
