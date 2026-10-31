/** A bounded presentation is a visual overlay on the canonical spoken script.
 * It lives in frontmatter so undo, copy, DBK, and ordinary Markdown saves carry
 * it atomically. Layout choices never replace the source prose or store seconds.
 */
import { matchNumberHighlight, type NumberHighlightMatch } from '../recommend/numberHighlight.js';

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
/** Whether a summary can fill a layout: enough points for a list, steps or a
 * comparison; a prominent number for a key number; a short headline for a big
 * statement; and, for a quote, a headline found word for word in
 * `passage`, the source text the slide summarizes. An image slide also needs a
 * picture, which callers check. */
export function presentationLayoutFits(
  layout: PresentationLayout,
  headline: string,
  points: readonly string[],
  passage: string,
): boolean {
  switch (layout) {
    case 'list':
    case 'steps':
      return points.length >= 2;
    case 'comparison':
      return points.length === 2;
    case 'definition':
      return points.length >= 1;
    case 'stat':
      return presentationStat(headline, points) !== null;
    case 'emphasis':
      return headline.length <= EMPHASIS_CHARACTERS;
    case 'quote':
      return spaced(passage).includes(spaced(headline));
    default:
      return true;
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
        ['imageSrc', 'media', 'hidden'],
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
      beat.points.length > 4 ||
      !beat.points.every((point) => text(point, 180))
    )
      return null;
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
