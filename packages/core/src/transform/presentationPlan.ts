/** A bounded presentation is a visual overlay on the canonical spoken script.
 * It lives in frontmatter so undo, copy, DBK, and ordinary Markdown saves carry
 * it atomically. Layout choices never replace the source prose or store seconds.
 */
export const PRESENTATION_KEY = 'squisq-presentation';
export const PRESENTATION_LAYOUTS = [
  'title',
  'statement',
  'list',
  'comparison',
  'steps',
  'image',
] as const;
export type PresentationLayout = (typeof PRESENTATION_LAYOUTS)[number];
export interface PresentationBeat {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  layout: PresentationLayout;
  headline: string;
  points: string[];
  imageSrc?: string;
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
        ['imageSrc'],
      ) ||
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
      !PRESENTATION_LAYOUTS.includes(beat.layout as PresentationLayout) ||
      !text(beat.headline, 110) ||
      !Array.isArray(beat.points) ||
      beat.points.length > 4 ||
      !beat.points.every((point) => text(point, 180))
    )
      return null;
    if (['comparison', 'steps', 'list'].includes(String(beat.layout)) && beat.points.length < 2)
      return null;
    if (beat.layout === 'comparison' && beat.points.length !== 2) return null;
    if (beat.layout === 'image' ? !text(beat.imageSrc, 2048) : 'imageSrc' in beat) return null;
    ids.add(beat.id);
    end = beat.sourceEnd;
    beats.push({
      id: beat.id,
      sourceStart: beat.sourceStart,
      sourceEnd: beat.sourceEnd,
      layout: beat.layout as PresentationLayout,
      headline: beat.headline,
      points: [...beat.points] as string[],
      ...(beat.layout === 'image' ? { imageSrc: beat.imageSrc as string } : {}),
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
