import { parseBuildSpec, type BuildSpec } from '../schemas/Build.js';
/** Durable author intent. Generated slides and their source offsets are never saved here. */
import type { Doc } from '../schemas/Doc.js';
import { buildNarrationScript } from '../narration/script.js';
import { isPassageKey, passageKey } from '../doc/sectionPassages.js';
import {
  PRESENTATION_LAYOUTS,
  PRESENTATION_LIMITS,
  isPresentationBeatLayout,
  presentationBeatExtras,
  presentationLayoutFits,
  type PresentationBeatExtras,
  type PresentationBeatLayout,
  type PresentationLayout,
} from './presentationPlan.js';
/**
 * The legacy frontmatter key: the whole design as one JSON value. Still read
 * (and applied) for documents written before summaries moved into the
 * document as `{[summary]}` accessory blocks; never written.
 * @deprecated Read the design with `readPresentationHints`.
 */
export const PRESENTATION_HINTS_KEY = 'squisq-presentation-hints';
export const DYNAMIC_PRESENTATION_STYLE = 'dynamic-slides';
/** Frontmatter: how much of a section each summary slide covers. Omitted at `balanced`. */
export const SUMMARY_DENSITY_KEY = 'squisq-summary-density';
/** Frontmatter: whether summaries may add supporting slides. Omitted at `true`. */
export const SUMMARY_SUPPORTING_SLIDES_KEY = 'squisq-summary-supporting-slides';
/** The accessory block type that holds one slide's summary. */
export const SUMMARY_ACCESSORY_TYPE = 'summary';
/** True for a well-formed `presentationPassageKey`. */
export const isPresentationPassageKey = isPassageKey;
/** A short, stable name for one slide's exact source passage. Saving it rather
 * than the passage keeps the document text out of the hints. */
export const presentationPassageKey = passageKey;
/** One slide's AI wording: a layout, a headline, points, and what the layout
 * draws beyond them (a hub's centre, a matrix's axes). */
export interface PresentationAiSuggestion extends PresentationBeatExtras {
  source: string;
  layout: PresentationLayout;
  headline: string;
  points: string[];
}
/**
 * One slide's design, as a `{[summary]}` accessory block under its section
 * holds it: the heading is the headline, the first list the points.
 */
export interface PresentationSlideHint extends PresentationBeatExtras {
  /**
   * `presentationPassageKey` of the passage the slide is made from. Absent:
   * the section's opening slide, whatever its passage — so your wording
   * stays when the section's text changes.
   */
  passage?: string;
  /** Suggested by AI. Without it the wording is the author's, and wins over AI. */
  origin?: 'ai';
  /** Left out of the deck. */
  hidden?: true;
  /** The headline; absent shows the automatic one. */
  headline?: string;
  /** The points; absent shows the automatic ones, `[]` none at all. */
  points?: string[];
  /** The layout this slide takes when it fits. */
  layout?: PresentationLayout;
  /**
   * A hidden slide's heading when nothing else is set: what the slide said
   * when it was hidden, so the block reads sensibly. Never shown.
   */
  label?: string;
}
export interface PresentationBlockHint {
  /** @deprecated Legacy JSON only; a section's builds are its heading's `build=` setting. */
  build?: BuildSpec;
  blockId: string;
  /** A summary layout to prefer, or `authored` to show the section's own block. */
  layout?: PresentationBeatLayout;
  inbetweens?: boolean;
  /** Each designed slide of this section: its `{[summary]}` blocks. */
  slides?: PresentationSlideHint[];
  /** Slides left out of the deck, by `presentationPassageKey` of their passage.
   * Changing a passage, or how the section is split, shows its slide again.
   * @deprecated Legacy JSON only; `slides` holds hidden slides. */
  hidden?: string[];
  /** Optional AI-authored display text, keyed to the exact passage it summarizes.
   * @deprecated Legacy JSON only; `slides` holds AI suggestions. */
  ai?: PresentationAiSuggestion[];
  /** Explicit user wording, applied only while this section's source still matches.
   * @deprecated Legacy JSON only; a keyless entry in `slides` holds it. */
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
    if (value.length > PRESENTATION_LIMITS.serializedCharacters) return null;
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
    // Every section with a hint has a slide, so a deck's limits bound its design.
    value.blocks.length > PRESENTATION_LIMITS.beats
  )
    return null;
  const ids = new Set<string>();
  const blocks: PresentationBlockHint[] = [];
  for (const entry of value.blocks) {
    if (
      !record(entry) ||
      !exact(
        entry,
        ['blockId'],
        ['layout', 'inbetweens', 'wording', 'ai', 'build', 'hidden', 'slides'],
      ) ||
      !text(entry.blockId, 1024) ||
      ids.has(entry.blockId) ||
      (entry.layout !== undefined && !isPresentationBeatLayout(entry.layout)) ||
      (entry.inbetweens !== undefined && typeof entry.inbetweens !== 'boolean') ||
      (entry.hidden !== undefined &&
        (!Array.isArray(entry.hidden) ||
          !entry.hidden.length ||
          entry.hidden.length > PRESENTATION_LIMITS.beats ||
          new Set(entry.hidden).size !== entry.hidden.length ||
          !entry.hidden.every(isPresentationPassageKey)))
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
      if (!Array.isArray(entry.ai) || entry.ai.length > PRESENTATION_LIMITS.beats) return null;
      hint.ai = [];
      for (const item of entry.ai) {
        if (
          !record(item) ||
          !exact(item, ['source', 'layout', 'headline', 'points'], ['center', 'xAxis', 'yAxis']) ||
          !text(item.source, 4000) ||
          !PRESENTATION_LAYOUTS.includes(item.layout as PresentationLayout) ||
          !text(item.headline, 110) ||
          !Array.isArray(item.points) ||
          item.points.length > PRESENTATION_LIMITS.points ||
          !item.points.every((point) => text(point, 180)) ||
          // An extra is saved only on the layout that draws it, as it will be set.
          (['center', 'xAxis', 'yAxis'] as const).some(
            (key) =>
              key in item && item[key] !== presentationBeatExtras(String(item.layout), item)[key],
          ) ||
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
          ...presentationBeatExtras(String(item.layout), item),
        });
      }
    }
    if (entry.slides !== undefined) {
      const slides = parseSlideHints(entry.slides);
      if (!slides) return null;
      if (slides.length) hint.slides = slides;
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
            wording.points.length > PRESENTATION_LIMITS.points ||
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
const SLIDE_HINT_KEYS = [
  'passage',
  'origin',
  'hidden',
  'headline',
  'points',
  'layout',
  'label',
  'center',
  'xAxis',
  'yAxis',
];
/** A section's slide designs, or null when any is malformed. */
function parseSlideHints(input: unknown): PresentationSlideHint[] | null {
  if (!Array.isArray(input) || input.length > PRESENTATION_LIMITS.beats) return null;
  const seen = new Set<string>();
  const slides: PresentationSlideHint[] = [];
  for (const item of input) {
    if (!record(item) || !exact(item, [], SLIDE_HINT_KEYS)) return null;
    const identity = item.passage === undefined ? '' : item.passage;
    if (
      (item.passage !== undefined && !isPresentationPassageKey(item.passage)) ||
      seen.has(String(identity)) ||
      (item.origin !== undefined && item.origin !== 'ai') ||
      (item.hidden !== undefined && item.hidden !== true) ||
      (item.headline !== undefined && !text(item.headline, PRESENTATION_LIMITS.headline)) ||
      (item.label !== undefined && !text(item.label, 1024)) ||
      (item.points !== undefined &&
        (!Array.isArray(item.points) ||
          item.points.length > PRESENTATION_LIMITS.points ||
          !item.points.every((point) => text(point, PRESENTATION_LIMITS.point)))) ||
      (item.layout !== undefined &&
        !PRESENTATION_LAYOUTS.includes(item.layout as PresentationLayout)) ||
      (['center', 'xAxis', 'yAxis'] as const).some(
        (key) =>
          key in item && item[key] !== presentationBeatExtras(String(item.layout), item)[key],
      )
    )
      return null;
    seen.add(String(identity));
    slides.push({
      ...(item.passage !== undefined ? { passage: item.passage as string } : {}),
      ...(item.origin ? { origin: 'ai' as const } : {}),
      ...(item.hidden ? { hidden: true as const } : {}),
      ...(item.headline !== undefined ? { headline: item.headline as string } : {}),
      ...(item.points !== undefined ? { points: [...(item.points as string[])] } : {}),
      ...(item.layout !== undefined ? { layout: item.layout as PresentationLayout } : {}),
      ...(item.layout !== undefined ? presentationBeatExtras(String(item.layout), item) : {}),
      ...(item.label !== undefined ? { label: item.label as string } : {}),
    });
  }
  return slides;
}
/**
 * The same design in one canonical form — defaults and empty sections
 * dropped, sections by id, each section's opening slide first and the rest
 * by passage key — so two designs that say the same thing compare equal
 * however they were read or built.
 */
export function canonicalPresentationHints(hints: PresentationHints): PresentationHints {
  const blocks = hints.blocks
    .map((block) => {
      const out: PresentationBlockHint = { blockId: block.blockId };
      if (block.layout !== undefined) out.layout = block.layout;
      if (block.inbetweens !== undefined) out.inbetweens = block.inbetweens;
      const slides = (block.slides ?? [])
        .map(canonicalSlide)
        .sort((a, b) => (a.passage ?? '').localeCompare(b.passage ?? ''));
      if (slides.length) out.slides = slides;
      if (block.build !== undefined) out.build = block.build;
      if (block.hidden?.length) out.hidden = [...block.hidden].sort();
      if (block.ai?.length) out.ai = block.ai;
      if (block.wording) out.wording = block.wording;
      return out;
    })
    .filter((block) => Object.keys(block).length > 1)
    .sort((a, b) => a.blockId.localeCompare(b.blockId));
  return { version: 1, density: hints.density, inbetweens: hints.inbetweens, blocks };
}
function canonicalSlide(slide: PresentationSlideHint): PresentationSlideHint {
  return {
    ...(slide.passage !== undefined ? { passage: slide.passage } : {}),
    ...(slide.origin ? { origin: slide.origin } : {}),
    ...(slide.hidden ? { hidden: true as const } : {}),
    ...(slide.headline !== undefined ? { headline: slide.headline } : {}),
    ...(slide.points !== undefined ? { points: [...slide.points] } : {}),
    ...(slide.layout !== undefined ? { layout: slide.layout } : {}),
    ...(slide.layout !== undefined ? presentationBeatExtras(slide.layout, slide) : {}),
    ...(slide.label !== undefined ? { label: slide.label } : {}),
  };
}
/** Whether two designs say the same thing (see `canonicalPresentationHints`). */
export function presentationHintsEqual(a: PresentationHints, b: PresentationHints): boolean {
  return (
    JSON.stringify(canonicalPresentationHints(a)) === JSON.stringify(canonicalPresentationHints(b))
  );
}
/** Whether a slide design changes anything but whether it is hidden. */
export function slideHintHasWording(slide: PresentationSlideHint): boolean {
  return (
    slide.origin !== undefined ||
    slide.headline !== undefined ||
    slide.points !== undefined ||
    slide.layout !== undefined
  );
}
/**
 * The design with one section's settings changed (`undefined` clears one).
 * The section's slide designs are kept.
 */
export function withBlockHint(
  hints: PresentationHints,
  blockId: string,
  patch: { layout?: PresentationBeatLayout; inbetweens?: boolean },
): PresentationHints {
  return updateBlock(hints, blockId, (block) => {
    const next: PresentationBlockHint = { ...block };
    if ('layout' in patch) {
      if (patch.layout === undefined) delete next.layout;
      else next.layout = patch.layout;
    }
    if ('inbetweens' in patch) {
      if (patch.inbetweens === undefined) delete next.inbetweens;
      else next.inbetweens = patch.inbetweens;
    }
    return next;
  });
}
/**
 * The design with one slide's design replaced (`null` removes it). `passage`
 * is the slide's `presentationPassageKey`, or undefined for the section's
 * opening slide.
 */
export function withSlideHint(
  hints: PresentationHints,
  blockId: string,
  passage: string | undefined,
  slide: Omit<PresentationSlideHint, 'passage'> | null,
): PresentationHints {
  return updateBlock(hints, blockId, (block) => {
    const others = (block.slides ?? []).filter((item) => item.passage !== passage);
    const slides = slide
      ? [...others, canonicalSlide({ ...slide, ...(passage !== undefined ? { passage } : {}) })]
      : others;
    const next: PresentationBlockHint = { ...block };
    if (slides.length) next.slides = slides;
    else delete next.slides;
    return next;
  });
}
function updateBlock(
  hints: PresentationHints,
  blockId: string,
  change: (block: PresentationBlockHint) => PresentationBlockHint,
): PresentationHints {
  const current = hints.blocks.find((block) => block.blockId === blockId) ?? { blockId };
  const next = change(current);
  const blocks = hints.blocks.filter((block) => block.blockId !== blockId);
  if (Object.keys(next).length > 1) blocks.push(next);
  return { ...hints, blocks };
}
/** @deprecated Legacy JSON. The designer writes `{[summary]}` blocks (`writePresentationHints`). */
export function serializePresentationHints(hints: PresentationHints): string {
  const parsed = parsePresentationHints(hints);
  if (!parsed) throw new Error('The slide hints are invalid.');
  const json = JSON.stringify(parsed);
  if (json.length > PRESENTATION_LIMITS.serializedCharacters)
    throw new Error('The slide hints are too large.');
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
