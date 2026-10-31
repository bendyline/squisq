import { parseBuildSpec, type BuildSpec } from '../schemas/Build.js';
/** Durable author intent. Generated slides and their source offsets are never saved here. */
import type { Doc } from '../schemas/Doc.js';
import { buildNarrationScript } from '../narration/script.js';
import { hashString } from '../random/SeededRandom.js';
import {
  AUTHORED_PRESENTATION_LAYOUT,
  PRESENTATION_LAYOUTS,
  presentationLayoutFits,
  type PresentationBeatLayout,
  type PresentationLayout,
} from './presentationPlan.js';
export const PRESENTATION_HINTS_KEY = 'squisq-presentation-hints';
export const DYNAMIC_PRESENTATION_STYLE = 'dynamic-slides';
/** A short, stable name for one slide's exact source passage. Saving it rather
 * than the passage keeps the document text out of the hints. */
export function presentationPassageKey(passage: string): string {
  return `${hashString(passage).toString(36)}-${passage.length.toString(36)}`;
}
export interface PresentationBlockHint {
  build?: BuildSpec;
  blockId: string;
  /** A summary layout to prefer, or `authored` to show the section's own block. */
  layout?: PresentationBeatLayout;
  inbetweens?: boolean;
  /** Slides left out of the deck, by `presentationPassageKey` of their passage.
   * Changing a passage, or how the section is split, shows its slide again. */
  hidden?: string[];
  /** Optional AI-authored display text, keyed to the exact passage it summarizes. */
  ai?: Array<{ source: string; layout: PresentationLayout; headline: string; points: string[] }>;
  /** Explicit user wording, applied only while this section's source still matches. */
  wording?: { source: string; headline?: string; points?: string[] };
}
export interface PresentationHints {
  version: 1;
  /** How much of a section each slide covers; `section` is one slide per section,
   * with no supporting slides. */
  density: 'concise' | 'balanced' | 'detailed' | 'section';
  inbetweens: boolean;
  blocks: PresentationBlockHint[];
}
export function defaultPresentationHints(): PresentationHints {
  return { version: 1, density: 'balanced', inbetweens: true, blocks: [] };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= max &&
    [...value].every((char) => char.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(char))
  );
}
export function parsePresentationHints(input: unknown): PresentationHints | null {
  let value = input;
  if (typeof value === 'string') {
    if (value.length > 160000) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    !record(value) ||
    !exact(value, ['version', 'density', 'inbetweens', 'blocks']) ||
    value.version !== 1 ||
    !['concise', 'balanced', 'detailed', 'section'].includes(String(value.density)) ||
    typeof value.inbetweens !== 'boolean' ||
    !Array.isArray(value.blocks) ||
    value.blocks.length > 80
  )
    return null;
  const ids = new Set<string>();
  const blocks: PresentationBlockHint[] = [];
  for (const entry of value.blocks) {
    if (
      !record(entry) ||
      !exact(entry, ['blockId'], ['layout', 'inbetweens', 'wording', 'ai', 'build', 'hidden']) ||
      !text(entry.blockId, 1024) ||
      ids.has(entry.blockId) ||
      (entry.layout !== undefined &&
        entry.layout !== AUTHORED_PRESENTATION_LAYOUT &&
        !PRESENTATION_LAYOUTS.includes(entry.layout as PresentationLayout)) ||
      (entry.inbetweens !== undefined && typeof entry.inbetweens !== 'boolean') ||
      (entry.hidden !== undefined &&
        (!Array.isArray(entry.hidden) ||
          !entry.hidden.length ||
          entry.hidden.length > 80 ||
          new Set(entry.hidden).size !== entry.hidden.length ||
          !entry.hidden.every(
            (key) => typeof key === 'string' && /^[0-9a-z]{1,7}-[0-9a-z]{1,4}$/u.test(key),
          )))
    )
      return null;
    const hint: PresentationBlockHint = { blockId: entry.blockId };
    if (entry.build !== undefined) {
      const build = parseBuildSpec(entry.build);
      if (!build) return null;
      hint.build = build;
    }
    if (entry.layout !== undefined) hint.layout = entry.layout as PresentationBeatLayout;
    if (entry.inbetweens !== undefined) hint.inbetweens = entry.inbetweens as boolean;
    if (entry.hidden !== undefined) hint.hidden = [...(entry.hidden as string[])];
    if (entry.ai !== undefined) {
      if (!Array.isArray(entry.ai) || entry.ai.length > 80) return null;
      hint.ai = [];
      for (const item of entry.ai) {
        if (
          !record(item) ||
          !exact(item, ['source', 'layout', 'headline', 'points']) ||
          !text(item.source, 4000) ||
          !PRESENTATION_LAYOUTS.includes(item.layout as PresentationLayout) ||
          !text(item.headline, 110) ||
          !Array.isArray(item.points) ||
          item.points.length > 4 ||
          !item.points.every((point) => text(point, 180)) ||
          !presentationLayoutFits(
            item.layout as PresentationLayout,
            item.headline,
            item.points as string[],
            item.source,
          )
        )
          return null;
        hint.ai.push({
          source: item.source,
          layout: item.layout as PresentationLayout,
          headline: item.headline,
          points: [...item.points] as string[],
        });
      }
    }
    if (entry.wording !== undefined) {
      const wording = entry.wording;
      if (
        !record(wording) ||
        !exact(wording, ['source'], ['headline', 'points']) ||
        !text(wording.source, 40000) ||
        (wording.headline === undefined && wording.points === undefined) ||
        (wording.headline !== undefined && !text(wording.headline, 110)) ||
        (wording.points !== undefined &&
          (!Array.isArray(wording.points) ||
            wording.points.length > 4 ||
            !wording.points.every((point) => text(point, 180))))
      )
        return null;
      hint.wording = {
        source: wording.source,
        ...(wording.headline !== undefined ? { headline: wording.headline as string } : {}),
        ...(wording.points !== undefined ? { points: [...wording.points] as string[] } : {}),
      };
    }
    ids.add(entry.blockId);
    blocks.push(hint);
  }
  return {
    version: 1,
    density: value.density as PresentationHints['density'],
    inbetweens: value.inbetweens,
    blocks,
  };
}
export function serializePresentationHints(hints: PresentationHints): string {
  const parsed = parsePresentationHints(hints);
  if (!parsed) throw new Error('The slide hints are invalid.');
  const json = JSON.stringify(parsed);
  if (json.length > 160000) throw new Error('The slide hints are too large.');
  return json;
}
export function presentationSections(doc: Doc) {
  const script = buildNarrationScript(doc);
  return script.blocks.map((block) => ({
    blockId: block.blockId,
    heading: block.heading,
    sourceStart: block.charStart,
    sourceEnd: block.charEnd,
    text: script.sourceText.slice(block.charStart, block.charEnd),
  }));
}
export function usesDynamicPresentation(doc: Doc): boolean {
  const fm = doc.frontmatter ?? {};
  const style = Object.prototype.hasOwnProperty.call(fm, 'squisq-transform')
    ? fm['squisq-transform']
    : fm['transform-style'];
  return (
    typeof style === 'string' &&
    style.trim().toLowerCase().replace(/\s+/g, '-') === DYNAMIC_PRESENTATION_STYLE
  );
}
