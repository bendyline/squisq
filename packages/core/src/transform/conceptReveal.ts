/**
 * Concept reveals: a concept slide (`cards`, `process`, `cycle`, `layers`)
 * that shows its ideas one at a time, each as the narration reaches it.
 *
 * Two steps, so any host with narration can use them: find where in the
 * script each idea is spoken ({@link matchPointsToSentences}), then turn
 * those moments into the slide's build ({@link conceptRevealTiming}). The
 * presentation compiler does both from a plan; a host with its own script
 * format (a video director's beats) can time ideas by phrase instead and use
 * only the second step.
 *
 * The build's `sourceText` guard is named from the same step texts the
 * template draws (`conceptBuildStepTexts`), so the renderer accepts the
 * timing without drawing the block first; ideas the narration cannot place
 * reveal evenly over the slide instead.
 *
 * Related: `doc/templates/conceptBlocks.ts`, `doc/builds.ts`
 * (`resolveBuildTimeline`), `transform/presentationCompiler.ts`.
 */

import { buildSourceText } from '../doc/builds.js';
import { conceptBuildStepTexts } from '../doc/templates/conceptBlocks.js';
import type { Block } from '../schemas/Doc.js';
import type { BuildSpec } from '../schemas/Build.js';

export const CONCEPT_TEMPLATES = ['cards', 'process', 'cycle', 'layers'] as const;
export type ConceptTemplate = (typeof CONCEPT_TEMPLATES)[number];

/** The concept template a name denotes, or `undefined`. */
export function conceptTemplate(template: string): ConceptTemplate | undefined {
  return CONCEPT_TEMPLATES.find((name) => name === template);
}

/** Distinctive words, compared by their opening letters so "multiply" matches "multiplying". */
function stems(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [])
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 5));
}

/**
 * Where in `sourceText[start, end)` each point is spoken: the offset of the
 * sentence it shares the most words with (at least two). Points must land
 * in order (two may share a sentence); `undefined` when one cannot be placed
 * or would land before the point ahead of it.
 */
export function matchPointsToSentences(
  points: readonly string[],
  sourceText: string,
  start: number,
  end: number,
): number[] | undefined {
  const passage = sourceText.slice(start, end);
  const sentences = [...passage.matchAll(/[^.!?\n]+[.!?]*/gu)].map((match) => ({
    offset: start + match.index,
    words: new Set(stems(match[0])),
  }));
  let last = -1;
  const offsets: number[] = [];
  for (const point of points) {
    const words = stems(point);
    let best: { offset: number; shared: number } | undefined;
    for (const sentence of sentences) {
      const shared = words.filter((word) => sentence.words.has(word)).length;
      if (shared > (best?.shared ?? 1)) best = { offset: sentence.offset, shared };
    }
    if (!best || best.offset < last) return undefined;
    offsets.push((last = best.offset));
  }
  return offsets;
}

/** How a concept slide reveals its ideas unless its author says otherwise. */
export function conceptBuildSpec(): BuildSpec {
  return { mode: 'items', effect: 'fadeInUp', previous: 'keep' };
}

/**
 * A concept slide's build: its ideas appear at `itemTimes` (seconds on the
 * same clock as `start` and `end`, the slide's span). Each reveal waits for a
 * short lead into the slide and lands before its end; the first idea lands
 * as the headline settles even when its words come later, so the slide never
 * sits on its headline alone. Without one time per idea, the build reveals
 * the ideas evenly.
 */
export function conceptRevealTiming(
  template: ConceptTemplate,
  items: readonly string[],
  itemTimes: readonly number[] | undefined,
  start: number,
  end: number,
): Pick<Block, 'build' | 'buildTiming'> {
  const build = conceptBuildSpec();
  const steps = conceptBuildStepTexts(template, items);
  if (!itemTimes || itemTimes.length !== steps.length) return { build };
  const lead = Math.min(0.5, (end - start) / 8);
  const starts = itemTimes.map((time) =>
    Math.min(Math.max(0, end - start - 0.1), Math.max(lead, time - start)),
  );
  starts[0] = Math.min(starts[0]!, Math.max(lead, Math.min(1, (end - start) / 6)));
  return {
    build,
    buildTiming: {
      sourceText: buildSourceText(steps.map((text, index) => ({ id: `build-${index}`, text }))),
      starts,
    },
  };
}
