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
import {
  PRESENTATION_KEY,
  parsePresentationPlan,
  type PresentationBeat,
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
      'The narration no longer matches the document. Generate narration again before presenting.',
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
  let previous = 0;
  const starts = checked.beats.map((beat, index) => {
    if (!index) return 0;
    let time: number;
    if (narration && bookmarks.length) {
      // Match the first spoken token in this span; clipped-away spans collapse.
      time = bookmarks.find((word) => word.charOffset >= beat.sourceStart)?.time ?? duration;
    } else {
      const before = script.tokens.filter((token) => token.charOffset < beat.sourceStart).length;
      time =
        (narration?.startTime ?? 0) +
        (before / Math.max(1, script.tokens.length)) * (narration?.duration ?? duration);
    }
    previous = Math.min(duration, Math.max(previous, time));
    return previous;
  });
  const blocks: Block[] = [];
  checked.beats.forEach((beat, index) => {
    const start = starts[index]!;
    const end = starts[index + 1] ?? duration;
    if (end <= start) return;
    const source = script.blocks.find(
      (block) => beat.sourceStart >= block.charStart && beat.sourceStart < block.charEnd,
    );
    const base = {
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
    const block: TemplateBlock = visualBlock(beat, base, index);
    blocks.push(block as unknown as Block);
  });
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
function visualBlock(
  beat: PresentationBeat,
  base: { id: string; duration: number; audioSegment: number },
  index: number,
): TemplateBlock {
  const colorScheme = ['blue', 'green', 'orange'][index % 3]!;
  switch (beat.layout) {
    case 'title':
      return { ...base, template: 'title', title: beat.headline, subtitle: beat.points[0] ?? '' };
    case 'statement':
      return {
        ...base,
        template: 'factCard',
        fact: beat.headline,
        explanation: beat.points.join('\n\n'),
      };
    case 'list':
      return { ...base, template: 'list', title: beat.headline, items: beat.points, colorScheme };
    case 'comparison':
      return {
        ...base,
        template: 'twoColumn',
        header: beat.headline,
        left: { label: beat.points[0]! },
        right: { label: beat.points[1]! },
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
      return {
        ...base,
        template: 'diagram',
        background: 'surface',
        title: beat.headline,
        colorScheme,
        nodes: beat.points.map((point, i) => ({
          id: `step-${i}`,
          label: point,
          x: i * 320,
          y: 0,
          w: 260,
          h: 180,
        })),
        edges: beat.points
          .slice(1)
          .map((_, i) => ({ source: `step-${i}`, target: `step-${i + 1}`, directed: true })),
      };
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
