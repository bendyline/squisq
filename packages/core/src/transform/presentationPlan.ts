/** A bounded presentation is a visual overlay on the canonical spoken script.
 * It lives in frontmatter so undo, copy, DBK, and ordinary Markdown saves carry
 * it atomically. Layout choices never replace the source prose or store seconds.
 */
import { matchNumberHighlight, type NumberHighlightMatch } from '../recommend/numberHighlight.js';
import {
  conceptItemCount,
  conceptItemsProblem,
  conceptTemplate,
} from '../doc/templates/conceptSpecs.js';

export const PRESENTATION_KEY = 'squisq-presentation';
/** The layouts a summary (a headline and up to four points) can fill. */
export const PRESENTATION_LAYOUTS = [
  'title',
  'divider',
  'statement',
  'emphasis',
  'quote',
  'stat',
  'definition',
  'list',
  'comparison',
  'steps',
  'image',
  'cards',
  'process',
  'cycle',
  'layers',
  'stats',
  'pyramid',
  'funnel',
  'hub',
  'venn',
  'matrix',
] as const;
export type PresentationLayout = (typeof PRESENTATION_LAYOUTS)[number];
/** Shows a section's own block, with the template its author chose, instead of
 * a summary. A section shown this way is one slide for its whole narration. */
export const AUTHORED_PRESENTATION_LAYOUT = 'authored';
export type PresentationBeatLayout = PresentationLayout | typeof AUTHORED_PRESENTATION_LAYOUT;
/** The longest headline a big statement shows; longer ones need a smaller layout. */
const EMPHASIS_CHARACTERS = 60;
const spaced = (text: string) => text.replace(/\s+/gu, ' ').trim();
/** The prominent number a key-number slide shows, and the line that states it. */
export function presentationStat(
  headline: string,
  points: readonly string[],
): { match: NumberHighlightMatch; line: string; index: number } | null {
  for (const [index, line] of [headline, ...points].entries()) {
    const match = matchNumberHighlight(line);
    if (match) return { match, line, index: index - 1 };
  }
  return null;
}
/** Whether a summary can fill a layout: the items a drawn layout takes
 * (`conceptItemsProblem`: three stages for a cycle, a figure in every key
 * number, four ideas for a matrix…); enough points for a list, steps or a
 * comparison; a prominent number for a key number; a short headline for a big
 * statement; and, for a quote, a headline found word for word in `passage`,
 * the source text the slide summarizes. An image slide also needs a picture,
 * which callers check. */
export function presentationLayoutFits(
  layout: PresentationLayout,
  headline: string,
  points: readonly string[],
  passage: string,
): boolean {
  return presentationLayoutProblem(layout, headline, points, passage) === undefined;
}
/** Why a summary cannot fill a layout, as a sentence its author can act on
 * (a person reading a designer's help, a model reading a correction), or
 * `undefined` when it can. */
export function presentationLayoutProblem(
  layout: PresentationLayout,
  headline: string,
  points: readonly string[],
  passage: string,
): string | undefined {
  // A layout that draws its points takes what its template takes.
  const concept = conceptTemplate(layout);
  if (concept) return conceptItemsProblem(concept, points, { max: PRESENTATION_LIMITS.points });
  switch (layout) {
    case 'list':
    case 'steps':
      return points.length >= 2
        ? undefined
        : `${layout} takes at least 2 points and this has ${points.length}`;
    case 'comparison':
      return points.length === 2
        ? undefined
        : `comparison takes exactly 2 points and this has ${points.length}`;
    case 'definition':
      return points.length >= 1 ? undefined : 'definition takes a point that defines its headline';
    case 'stat':
      return presentationStat(headline, points) !== null
        ? undefined
        : 'stat shows a prominent figure, such as 40% or $3 million, and neither the headline nor a point states one';
    case 'emphasis':
      return headline.length <= EMPHASIS_CHARACTERS
        ? undefined
        : `emphasis takes a headline of at most ${EMPHASIS_CHARACTERS} characters`;
    case 'quote':
      return spaced(passage).includes(spaced(headline))
        ? undefined
        : 'quote takes a headline copied word for word from the passage';
    default:
      return undefined;
  }
}
/** What a slide must have for a layout to apply, as a designer's help says it
 * ("at least 2 points", "exactly 4 points"), or `undefined` when any slide
 * will do. It states what `presentationLayoutProblem` checks, so a picker's
 * help and the plan agree. `points` names a slide's points in the host's own
 * word ("highlights"). */
export function presentationLayoutNeeds(
  layout: PresentationLayout,
  wording: { points?: string } = {},
): string | undefined {
  const points = wording.points ?? 'points';
  const concept = conceptTemplate(layout);
  if (concept) {
    const count = `${conceptItemCount(concept, { max: PRESENTATION_LIMITS.points })} ${points}`;
    if (concept === 'stats') return `${count}, each stating a figure`;
    if (concept === 'venn') return `${count}, one of them labelled "Both:"`;
    return count;
  }
  switch (layout) {
    case 'list':
    case 'steps':
      return `at least 2 ${points}`;
    case 'comparison':
      return `exactly 2 ${points}`;
    case 'stat':
      return 'a prominent figure, such as 40% or $3 million';
    case 'emphasis':
      return `a headline of ${EMPHASIS_CHARACTERS} characters or fewer`;
    case 'quote':
      return 'a sentence of 110 characters or fewer to quote';
    case 'image':
      return 'a picture';
    default:
      return undefined;
  }
}
export interface PresentationBeat {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  layout: PresentationBeatLayout;
  headline: string;
  points: string[];
  imageSrc?: string;
  /** The section's videos and diagrams shown beside this slide's text (`presentationMedia`). */
  media?: string[];
  /** Left out of the deck; the slide shown before it stays on screen instead. */
  hidden?: true;
  /** A hub only: the one to three words its ideas share, written inside it. */
  center?: string;
  /** A matrix only: what grows from left to right, named along the foot. */
  xAxis?: string;
  /** A matrix only: what grows from bottom to top, named up the side. */
  yAxis?: string;
}
/** What a layout draws beyond its headline and points. */
export type PresentationBeatExtras = Pick<PresentationBeat, 'center' | 'xAxis' | 'yAxis'>;
const BEAT_EXTRAS = ['center', 'xAxis', 'yAxis'] as const;
/** The extras each layout draws: a hub's centre, a matrix's axes. */
const LAYOUT_EXTRAS: Readonly<Record<string, readonly (typeof BEAT_EXTRAS)[number][]>> = {
  hub: ['center'],
  matrix: ['xAxis', 'yAxis'],
};
/** The extras of `source` that `layout` draws, trimmed; ones it does not draw,
 * empty ones and ones too long to set are left out. Read loosely, so a model's
 * reply and a saved beat pass through the same door. */
export function presentationBeatExtras(layout: string, source: unknown): PresentationBeatExtras {
  const extras: PresentationBeatExtras = {};
  if (!record(source)) return extras;
  for (const key of LAYOUT_EXTRAS[layout] ?? []) {
    const value = source[key];
    const clean = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
    if (clean && text(clean, PRESENTATION_LIMITS.extraCharacters)) extras[key] = clean;
  }
  return extras;
}
export interface PresentationPlan {
  version: 1;
  sourceText: string;
  origin: 'automatic' | 'ai';
  beats: PresentationBeat[];
}
export const PRESENTATION_LIMITS = {
  sourceCharacters: 40_000,
  beats: 80,
  serializedCharacters: 160_000,
  mediaPerBeat: 4,
  /** The most points a summary slide holds. */
  points: 4,
  /** The longest a hub's centre or a matrix's axis name may be. */
  extraCharacters: 40,
} as const;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(
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
    value.trim().length > 0 &&
    value.length <= max &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  );
}
export function parsePresentationPlan(input: unknown): PresentationPlan | null {
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
    !keys(value, ['version', 'sourceText', 'origin', 'beats']) ||
    value.version !== 1 ||
    !text(value.sourceText, PRESENTATION_LIMITS.sourceCharacters) ||
    typeof value.origin !== 'string' ||
    !['automatic', 'ai'].includes(value.origin) ||
    !Array.isArray(value.beats) ||
    !value.beats.length ||
    value.beats.length > PRESENTATION_LIMITS.beats
  )
    return null;
  const beats: PresentationBeat[] = [];
  const ids = new Set<string>();
  let end = 0;
  for (const beat of value.beats) {
    if (
      !record(beat) ||
      !keys(
        beat,
        ['id', 'sourceStart', 'sourceEnd', 'layout', 'headline', 'points'],
        ['imageSrc', 'media', 'hidden', ...BEAT_EXTRAS],
      ) ||
      ('hidden' in beat && beat.hidden !== true) ||
      !text(beat.id, 80) ||
      ids.has(beat.id) ||
      !Number.isInteger(beat.sourceStart) ||
      !Number.isInteger(beat.sourceEnd) ||
      typeof beat.sourceStart !== 'number' ||
      typeof beat.sourceEnd !== 'number' ||
      beat.sourceStart < end ||
      beat.sourceEnd <= beat.sourceStart ||
      beat.sourceEnd > value.sourceText.length ||
      value.sourceText.slice(end, beat.sourceStart).trim() ||
      !text(beat.headline, 110) ||
      !Array.isArray(beat.points) ||
      beat.points.length > PRESENTATION_LIMITS.points ||
      !beat.points.every((point) => text(point, 180))
    )
      return null;
    // An extra is saved only on the layout that draws it, as it will be set.
    const extras = presentationBeatExtras(String(beat.layout), beat);
    if (BEAT_EXTRAS.some((key) => key in beat && beat[key] !== extras[key])) return null;
    if (beat.layout === AUTHORED_PRESENTATION_LAYOUT) {
      // The section's block carries its own words, pictures and media.
      if (beat.points.length || 'media' in beat) return null;
    } else if (
      !PRESENTATION_LAYOUTS.includes(beat.layout as PresentationLayout) ||
      !presentationLayoutFits(
        beat.layout as PresentationLayout,
        beat.headline,
        beat.points as string[],
        value.sourceText.slice(beat.sourceStart, beat.sourceEnd),
      )
    )
      return null;
    if (beat.layout === 'image' ? !text(beat.imageSrc, 2048) : 'imageSrc' in beat) return null;
    if (
      'media' in beat &&
      (!Array.isArray(beat.media) ||
        !beat.media.length ||
        beat.media.length > PRESENTATION_LIMITS.mediaPerBeat ||
        new Set(beat.media).size !== beat.media.length ||
        !beat.media.every((ref) => text(ref, 1100)))
    )
      return null;
    ids.add(beat.id);
    end = beat.sourceEnd;
    beats.push({
      id: beat.id,
      sourceStart: beat.sourceStart,
      sourceEnd: beat.sourceEnd,
      layout: beat.layout as PresentationBeatLayout,
      headline: beat.headline,
      points: [...beat.points] as string[],
      ...(beat.layout === 'image' ? { imageSrc: beat.imageSrc as string } : {}),
      ...('media' in beat ? { media: [...(beat.media as string[])] } : {}),
      ...(beat.hidden === true ? { hidden: true as const } : {}),
      ...extras,
    });
  }
  if (value.sourceText.slice(end).trim()) return null;
  return {
    version: 1,
    sourceText: value.sourceText,
    origin: value.origin as PresentationPlan['origin'],
    beats,
  };
}
export function serializePresentationPlan(plan: PresentationPlan): string {
  const parsed = parsePresentationPlan(plan);
  if (!parsed) throw new Error('The presentation plan is invalid.');
  const result = JSON.stringify(parsed);
  if (result.length > PRESENTATION_LIMITS.serializedCharacters)
    throw new Error('The presentation plan is too large.');
  return result;
}
