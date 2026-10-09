/** Uses the same narrated-segment extractor/template selection as Qualla.
 * Canonical source passages provide the anchors; the visual suggestions are
 * deliberately separate from the text that the person hears.
 */
import type { Doc } from '../schemas/Doc.js';
import { buildNarrationScript } from '../narration/script.js';
import { extractDocImages } from './blockAnalyzer.js';
import { transformNarratedSegment } from './narratedSegment.js';
import {
  PRESENTATION_LIMITS,
  type PresentationBeat,
  type PresentationPlan,
} from './presentationPlan.js';

function clip(text: string, words = 12): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const parts = clean.split(' ');
  return (parts.length > words ? parts.slice(0, words).join(' ') + '…' : clean).slice(
    0,
    words === 12 ? 110 : 180,
  );
}
function field(block: unknown, key: string): string | undefined {
  if (!block || typeof block !== 'object') return undefined;
  const value = (block as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
export function createPresentationPlan(doc: Doc): PresentationPlan {
  const script = buildNarrationScript(doc);
  if (!script.sourceText.trim()) throw new Error('Add some text before making a presentation.');
  if (script.sourceText.length > PRESENTATION_LIMITS.sourceCharacters)
    throw new Error(
      'This document is too long for one presentation. Split it into shorter documents.',
    );
  const images = extractDocImages(doc.blocks);
  const beats: PresentationBeat[] = [];
  for (const block of script.blocks) {
    const source = script.sourceText.slice(block.charStart, block.charEnd);
    const words = [...source.matchAll(/\S+/gu)];
    let first = 0;
    while (first < words.length) {
      let last = Math.min(first + 42, words.length);
      // Prefer complete sentences without making a very long paragraph one slide.
      if (last < words.length) {
        for (let cursor = last; cursor > first + 18; cursor--) {
          if (/[.!?][”"')\]]?$/u.test(words[cursor - 1]![0])) {
            last = cursor;
            break;
          }
        }
      }
      const start = block.charStart + words[first]!.index;
      const end = block.charStart + words[last - 1]!.index + words[last - 1]![0].length;
      const passage = script.sourceText.slice(start, end);
      const index = beats.length;
      const suggested = transformNarratedSegment(
        {
          articleId: doc.articleId,
          segmentId: `presentation-${index}`,
          title: block.heading ?? '',
          text: passage,
          duration: Math.max(4, (last - first) / 2.5),
          audioSrc: '',
          includeTitleBlock: false,
        },
        { slidesPerMinute: 4, minConfidence: 0.25, style: 'documentary' },
      ).doc.blocks[0];
      const sentences = passage
        .split(/(?<=[.!?])\s+|\n+/u)
        .map((part) => part.trim())
        .filter(Boolean);
      const bodySentences = sentences.filter((part) => part !== block.heading);
      const points = (bodySentences.length ? bodySentences : sentences)
        .slice(0, 3)
        .map((part) => clip(part, 22));
      let headline = clip(
        first === 0 && block.heading
          ? block.heading
          : (field(suggested, 'fact') ??
              field(suggested, 'description') ??
              field(suggested, 'quote') ??
              sentences[0] ??
              passage),
      );
      if (!headline) headline = clip(passage);
      let layout: PresentationBeat['layout'] =
        index === 0 ? 'title' : points.length >= 2 && index % 3 === 1 ? 'list' : 'statement';
      if (points.length >= 2 && /\b(first|then|finally|steps?|next)\b/iu.test(passage))
        layout = 'steps';
      if (points.length === 2 && /\b(versus|whereas|compared|instead)\b/iu.test(passage))
        layout = 'comparison';
      const image =
        images.length && index > 0 && index % 3 === 2
          ? images[Math.floor(index / 3) % images.length]
          : undefined;
      if (image) layout = 'image';
      beats.push({
        id: `beat-${index + 1}`,
        sourceStart: start,
        sourceEnd: end,
        layout,
        headline,
        points,
        ...(image ? { imageSrc: image.src } : {}),
      });
      first = last;
    }
  }
  if (beats.length > PRESENTATION_LIMITS.beats)
    throw new Error(
      'This document has too many sections for one presentation. Split it into shorter documents.',
    );
  const closing = beats[beats.length - 1];
  if (beats.length > 2 && closing?.layout === 'statement') closing.layout = 'title';
  return { version: 1, sourceText: script.sourceText, origin: 'automatic', beats };
}
