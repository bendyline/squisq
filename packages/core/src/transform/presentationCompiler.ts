/** Compiles visual beats against the current take, leaving prose and media intact.
 * Seconds come from resolved narration bookmarks (or explicit reading estimates
 * without narration), never from generated display wording or model output.
 */
import { createPresentationPlan } from './presentationPlanner.js';
import {
  defaultPresentationHints,
  parsePresentationHints,
  PRESENTATION_HINTS_KEY,
  usesDynamicPresentation,
} from './presentationHints.js';
import type { Block, Doc } from '../schemas/Doc.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';
import { buildNarrationScript } from '../narration/script.js';
import { flattenRenderableBlocks, getPinnedBlockMeta } from '../doc/markdownToDoc.js';
import { extractDocImages } from './blockAnalyzer.js';
import { collectPresentationMedia, presentationMediaNode } from './presentationMedia.js';
import type { MarkdownBlockNode } from '../markdown/types.js';
import type { MediaClip } from '../schemas/Media.js';
import { isContainerTemplate } from '../doc/templates/templateNames.js';
import { conceptBuildStepTexts } from '../doc/templates/conceptBlocks.js';
import {
  conceptRevealTiming,
  conceptTemplate,
  matchPointsToSentences,
  type ConceptTemplate,
} from './conceptReveal.js';
import { wordTimeAt } from '../timing/wordTiming.js';
import {
  AUTHORED_PRESENTATION_LAYOUT,
  PRESENTATION_KEY,
  parsePresentationPlan,
  presentationStat,
  type PresentationBeat,
  type PresentationLayout,
  type PresentationPlan,
} from './presentationPlan.js';

export function compilePresentationPlan(doc: Doc, plan: PresentationPlan): Doc {
  const checked = parsePresentationPlan(plan);
  if (!checked) throw new Error('The saved presentation is invalid. Make the presentation again.');
  const script = buildNarrationScript(doc);
  if (script.sourceText !== checked.sourceText)
    throw new Error('The document text has changed. Make the presentation again to match it.');
  const narration = doc.presentationNarration;
  const hasNarration = (doc.documentMedia ?? []).some(
    (clip) => clip.anchor === 'document' && clip.src,
  );
  if (hasNarration && !narration)
    throw new Error(
      'Narration timings are unavailable. Restore the timing file or generate narration again.',
    );
  if (narration && narration.sourceText !== checked.sourceText)
    throw new Error(
      'The narration no longer matches the document. Record or generate narration again before presenting.',
    );
  if (
    narration &&
    flattenRenderableBlocks(doc.blocks).some((block) => {
      const pin = getPinnedBlockMeta(block);
      return pin.duration !== undefined || pin.startTime !== undefined;
    })
  )
    throw new Error(
      'Remove manually pinned slide times before fitting a presentation to narration.',
    );
  const images = new Set(extractDocImages(doc.blocks).map((image) => image.src));
  if (checked.beats.some((beat) => beat.imageSrc && !images.has(beat.imageSrc)))
    throw new Error(
      'A presentation image is no longer in the document. Make the presentation again.',
    );
  const media = new Map(
    [
      ...collectPresentationMedia(
        doc,
        script.blocks.map((block) => block.blockId),
      ).values(),
    ]
      .flat()
      .map((item) => [item.ref, item]),
  );
  if (checked.beats.some((beat) => beat.media?.some((ref) => !media.has(ref))))
    throw new Error(
      'A presentation table, picture, video or diagram is no longer in the document. Make the presentation again.',
    );
  const duration = narration
    ? narration.startTime + narration.duration
    : Math.max(4, script.tokens.length / 2.5);
  const bookmarks = (narration?.bookmarks ?? [])
    .filter(
      (word) =>
        Number.isFinite(word.time) &&
        word.time >= 0 &&
        word.time <= duration &&
        Number.isInteger(word.charOffset) &&
        word.charOffset >= 0 &&
        word.charOffset < script.sourceText.length,
    )
    .sort((a, b) => a.charOffset - b.charOffset);
  // Slides the presenter showed while recording start where they were shown.
  // Between two marks (a slide the plan added since), time runs with the text.
  const marks = (narration?.slides ?? []).filter(
    (mark) =>
      Number.isFinite(mark.time) &&
      mark.time >= 0 &&
      mark.time <= duration &&
      Number.isInteger(mark.charOffset) &&
      mark.charOffset >= 0 &&
      mark.charOffset < script.sourceText.length,
  );
  const tokensBefore = (offset: number) =>
    script.tokens.filter((token) => token.charOffset < offset).length;
  const markedTime = (offset: number): number | undefined => {
    if (!narration || !marks.length) return undefined;
    const exact = marks.find((mark) => mark.charOffset === offset);
    if (exact) return exact.time;
    if (bookmarks.length) return undefined;
    const anchors = [
      { charOffset: 0, time: narration.startTime },
      ...[...marks].sort((a, b) => a.charOffset - b.charOffset),
      { charOffset: script.sourceText.length, time: duration },
    ];
    const after = anchors.findIndex((anchor) => anchor.charOffset > offset);
    const from = anchors[Math.max(0, after - 1)]!;
    const to = anchors[after] ?? from;
    const span = tokensBefore(to.charOffset) - tokensBefore(from.charOffset);
    const share = span > 0 ? (tokensBefore(offset) - tokensBefore(from.charOffset)) / span : 0;
    return from.time + share * Math.max(0, to.time - from.time);
  };
  /** When the narration reaches a script offset. */
  const timeAt = (offset: number): number => {
    const marked = markedTime(offset);
    if (marked !== undefined) return marked;
    // Match the first spoken token in this span; clipped-away spans collapse.
    if (narration && bookmarks.length) return wordTimeAt(bookmarks, offset, 'next') ?? duration;
    return (
      (narration?.startTime ?? 0) +
      (tokensBefore(offset) / Math.max(1, script.tokens.length)) * (narration?.duration ?? duration)
    );
  };
  let previous = 0;
  const starts = checked.beats.map((beat, index) => {
    if (!index) return 0;
    previous = Math.min(duration, Math.max(previous, timeAt(beat.sourceStart)));
    return previous;
  });
  const authoredBlocks = flattenRenderableBlocks(doc.blocks);
  const buildHints = parsePresentationHints(doc.frontmatter?.[PRESENTATION_HINTS_KEY]);
  const sourceOf = (beat: PresentationBeat) =>
    script.blocks.find(
      (block) => beat.sourceStart >= block.charStart && beat.sourceStart < block.charEnd,
    );
  // A section's timed clips (music beds, cut-ins) start on its first slide and
  // stop where the section ends, as they did on the section itself.
  const sectionEnds = new Map<string, number>();
  checked.beats.forEach((beat, index) => {
    const section = sourceOf(beat)?.blockId;
    if (section) sectionEnds.set(section, starts[index + 1] ?? duration);
  });
  // A hidden slide is left out of the deck. The narration still speaks its
  // passage, so the shown slide before it stays on screen (at the very start,
  // the first shown slide opens the deck instead).
  const shown = checked.beats.flatMap((beat, index) => (beat.hidden ? [] : [index]));
  if (!shown.length) throw new Error('Every slide is hidden. Show at least one slide.');
  const windows = shown
    .map((index, position) => ({
      index,
      start: position ? starts[index]! : 0,
      end: position + 1 < shown.length ? starts[shown[position + 1]!]! : duration,
    }))
    .filter((window) => window.end > window.start);
  /** The shown slide on screen at `time`. */
  const onScreen = (time: number) =>
    windows.reduce((found, window) => (window.start <= time ? window : found), windows[0]!);
  // A section's clips go on whichever slide is on screen when the section begins.
  const clipsPlaced = new Set<string>();
  const sectionClips = new Map<number, MediaClip[]>();
  checked.beats.forEach((beat, index) => {
    const start = starts[index]!;
    const end = starts[index + 1] ?? duration;
    const source = sourceOf(beat);
    if (end <= start || !source || clipsPlaced.has(source.blockId) || !windows.length) return;
    clipsPlaced.add(source.blockId);
    const sectionEnd = sectionEnds.get(source.blockId) ?? end;
    const host = onScreen(start);
    const shift = (clip: MediaClip) =>
      start === host.start ? clip : { ...clip, startAt: clip.startAt + start - host.start };
    const clips = (
      authoredBlocks.find((block) => block.id === source.blockId)?.media ?? []
    ).flatMap((clip) => {
      if (clip.spillover) return [shift(clip)];
      const room = sectionEnd - start - clip.startAt;
      if (room <= 0) return [];
      const clipStart = clip.clipStart ?? 0;
      return [
        shift({
          ...clip,
          spillover: true,
          clipEnd: Math.min(clip.clipEnd ?? Infinity, clipStart + room),
        }),
      ];
    });
    sectionClips.set(host.index, [...(sectionClips.get(host.index) ?? []), ...clips]);
  });
  const mediaStarts = new Map<string, number>();
  const blocks: Block[] = [];
  for (const { index, start, end } of windows) {
    const beat = checked.beats[index]!;
    const source = sourceOf(beat);
    const build =
      buildHints?.blocks.find((hint) => hint.blockId === source?.blockId)?.build ??
      authoredBlocks.find((block) => block.id === source?.blockId)?.build;
    const contents = (beat.media ?? []).flatMap((ref): MarkdownBlockNode[] => {
      const first = mediaStarts.get(ref) ?? start;
      mediaStarts.set(ref, first);
      const node = presentationMediaNode(media.get(ref)!, start - first);
      return node ? [node] : [];
    });
    const authored = authoredBlocks.find((block) => block.id === source?.blockId);
    const clips = sectionClips.get(index) ?? [];
    const base = {
      ...(build ? { build } : {}),
      ...(contents.length ? { contents } : {}),
      ...(clips.length ? { media: clips } : {}),
      id: beat.id,
      duration: end - start,
      startTime: start,
      audioSegment: 0,
      sourceStartTime: start,
      sourceDuration: end - start,
      timelineLocked: true,
      sourceBlockId: source?.blockId,
      sourceCharOffset: beat.sourceStart,
      transition: { type: 'fade' as const, duration: Math.min(0.3, (end - start) / 5) },
    };
    if (beat.layout === AUTHORED_PRESENTATION_LAYOUT) {
      if (!authored) throw new Error('A section shown as authored is no longer in the document.');
      // Nested sections get their own slides; only a container template (a
      // diagram or drawing) draws its children itself.
      const { children, media: _media, ...own } = authored;
      blocks.push({
        ...own,
        ...base,
        ...(children && isContainerTemplate(authored.template) ? { children } : {}),
        transition: authored.transition ?? base.transition,
      });
      continue;
    }
    const table =
      beat.layout !== 'image' && (beat.media ?? []).some((ref) => media.get(ref)!.kind === 'table');
    const block: TemplateBlock = table
      ? tableFeatureBlock(beat, beat.layout, base, contents)
      : visualBlock(beat, beat.layout, base, index);
    const concept = conceptTemplate(block.template);
    // A summary that carries its section's features: the materializer lays
    // its tables and pictures out beside the words, not as decoration.
    blocks.push({
      ...block,
      ...(contents.length ? { summaryMode: 'brief' } : {}),
      // A concept slide reveals its ideas one at a time, each as the narration
      // reaches the sentence it summarizes (`conceptReveal`).
      ...(concept && !build
        ? conceptReveal(concept, beat, start, end, script.sourceText, timeAt)
        : {}),
    } as unknown as Block);
  }
  return {
    ...doc,
    blocks,
    duration,
    presentationApplied: true,
    // The plan supplies its own opening. Preserve an explicit author override.
    frontmatter: { 'squisq-cover-slide': false, ...doc.frontmatter },
    audio: doc.audio.segments.some((segment) => segment.src)
      ? doc.audio
      : { segments: [{ src: '', name: 'presentation-clock', startTime: 0, duration }] },
  };
}
/**
 * A concept slide's build: each idea appears when the narration reaches the
 * sentence of the slide's passage it shares the most words with. Ideas that
 * cannot be placed in order (reworded beyond recognition) fall back to
 * reveals spread evenly over the slide.
 */
function conceptReveal(
  template: ConceptTemplate,
  beat: PresentationBeat,
  start: number,
  end: number,
  sourceText: string,
  timeAt: (offset: number) => number,
): Pick<Block, 'build' | 'buildTiming'> {
  const steps = conceptBuildStepTexts(template, beat.points);
  const offsets = matchPointsToSentences(
    beat.points.slice(0, steps.length),
    sourceText,
    beat.sourceStart,
    beat.sourceEnd,
  );
  return conceptRevealTiming(template, beat.points, offsets?.map(timeAt), start, end);
}
/**
 * A slide that features a table. A table needs the slide's full width and
 * most of its height, so whatever the layout, its headline and points sit in
 * a band sized to them above the table (`bottomFeature`); points that make a
 * list stay bulleted.
 */
function tableFeatureBlock(
  beat: PresentationBeat,
  layout: PresentationLayout,
  base: { id: string; duration: number; audioSegment: number },
  features: MarkdownBlockNode[],
): TemplateBlock {
  const paragraph = (text: string) => ({
    type: 'paragraph' as const,
    children: [{ type: 'text' as const, value: text }],
  });
  const words: MarkdownBlockNode[] =
    ['list', 'steps', 'comparison'].includes(layout) && beat.points.length > 1
      ? [
          {
            type: 'list',
            ordered: false,
            children: beat.points.map((point) => ({
              type: 'listItem' as const,
              children: [paragraph(point)],
            })),
          },
        ]
      : beat.points.map(paragraph);
  const block: TemplateBlock = { ...base, template: 'bottomFeature', title: beat.headline };
  // The words and the features are the slide's body (`contentBlock`).
  return Object.assign(block, { contents: [...words, ...features] });
}
function visualBlock(
  beat: PresentationBeat,
  layout: PresentationLayout,
  base: { id: string; duration: number; audioSegment: number },
  index: number,
): TemplateBlock {
  const colorScheme = ['blue', 'green', 'orange'][index % 3]!;
  switch (layout) {
    case 'title':
      return { ...base, template: 'title', title: beat.headline, subtitle: beat.points[0] ?? '' };
    case 'divider':
      return { ...base, template: 'sectionHeader', title: beat.headline, colorScheme };
    case 'emphasis':
      // One untitled idea: a display statement in the deck's headline face.
      return { ...base, template: 'cards', items: [beat.headline] };
    case 'quote':
      return { ...base, template: 'fullBleedQuote', text: beat.headline, colorScheme };
    case 'stat': {
      // The plan only holds key-number slides that state a prominent number.
      const { match, line, index: at } = presentationStat(beat.headline, beat.points)!;
      // The headline heads the slide in the deck's lockup; the figure sits
      // beside the point that states it, or the points that follow a headline
      // that states it.
      const others = beat.points.filter((_, i) => i !== at);
      const [description, detail] = at < 0 ? others : [line, others[0]];
      return {
        ...base,
        template: 'statHighlight',
        headline: beat.headline,
        stat: match.value,
        description: description ?? '',
        ...(detail ? { detail } : {}),
      };
    }
    case 'definition':
      // The term is the headline and its definition reads as one lead
      // paragraph under it: points that define one term are one thought.
      return {
        ...base,
        template: 'cards',
        title: beat.headline,
        items: beat.points.length
          ? [beat.points.map((point) => point.trim().replace(/([^.!?])$/u, '$1.')).join(' ')]
          : [],
      };
    case 'statement':
      // A statement shares the deck's lockup: its sentences set as a lead
      // paragraph (one) or cards (several) under the headline.
      return beat.points.length
        ? { ...base, template: 'cards', title: beat.headline, items: beat.points }
        : { ...base, template: 'factCard', fact: beat.headline, explanation: '' };
    case 'list':
      // Summary points are not a sequence, so a list sets as cards, in the deck's lockup.
      return { ...base, template: 'cards', title: beat.headline, items: beat.points };
    case 'comparison':
      // A comparison's two sides stand against each other across a "vs" mark.
      return {
        ...base,
        template: 'cards',
        title: beat.headline,
        items: beat.points,
        ...(beat.points.length === 2 ? { versus: true } : {}),
      };
    case 'image':
      return {
        ...base,
        template: 'imageWithCaption',
        imageSrc: beat.imageSrc!,
        imageAlt: beat.headline,
        caption: beat.headline,
        captionPosition: 'bottom',
        ambientMotion: 'zoomIn',
      };
    case 'steps':
    case 'process':
      return { ...base, template: 'process', title: beat.headline, items: beat.points };
    case 'cards':
      return { ...base, template: 'cards', title: beat.headline, items: beat.points };
    case 'cycle':
      return { ...base, template: 'cycle', title: beat.headline, items: beat.points };
    case 'layers':
      return { ...base, template: 'layers', title: beat.headline, items: beat.points };
  }
}
export function applySavedPresentation(doc: Doc): Doc {
  if (doc.presentationApplied) return doc;
  const dynamic = usesDynamicPresentation(doc);
  if (!dynamic && !Object.prototype.hasOwnProperty.call(doc.frontmatter ?? {}, PRESENTATION_KEY))
    return doc;
  try {
    const rawHints = doc.frontmatter?.[PRESENTATION_HINTS_KEY];
    const hints =
      rawHints === undefined ? defaultPresentationHints() : parsePresentationHints(rawHints);
    if (dynamic && !hints)
      throw new Error('The slide hints are invalid. Review the summarization settings.');
    const plan = dynamic
      ? createPresentationPlan(doc, hints!)
      : parsePresentationPlan(doc.frontmatter?.[PRESENTATION_KEY]);
    if (!plan) throw new Error('The saved presentation is invalid. Make the presentation again.');
    return compilePresentationPlan(doc, plan);
  } catch (error: unknown) {
    return {
      ...doc,
      diagnostics: [
        ...(doc.diagnostics ?? []),
        {
          severity: 'error',
          code: 'presentation-invalid',
          message: error instanceof Error ? error.message : 'The presentation could not be loaded.',
        },
      ],
    };
  }
}
