/**
 * The layouts a summary slide can take. A dependency-free leaf so the
 * markdown parser can type a section's `slideLayout=` setting without
 * importing the presentation planner; `transform/presentationPlan.ts`
 * re-exports these as the public names.
 */

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
/**
 * Shows a section's own block — a chart, a table, a diagram — on the last
 * slide of the section before it, instead of on a slide of its own. Its text
 * is still narrated while that slide stays up. Only blocks that draw a picture
 * can be shown this way (`isFeatureBlockTemplate`); any other is shown as
 * authored.
 */
export const FEATURE_PRESENTATION_LAYOUT = 'feature';
/** Every layout a section can prefer: the summary layouts, `authored` and `feature`. */
export const PRESENTATION_BEAT_LAYOUTS = [
  ...PRESENTATION_LAYOUTS,
  AUTHORED_PRESENTATION_LAYOUT,
  FEATURE_PRESENTATION_LAYOUT,
] as const;
export type PresentationBeatLayout = (typeof PRESENTATION_BEAT_LAYOUTS)[number];

/** The most slides a section can be asked to be told in (its heading's `slideCount=`). */
export const PRESENTATION_SECTION_SLIDES = 12;

/** True for a layout a section's summary slides can prefer, `authored` and `feature` included. */
export function isPresentationBeatLayout(value: unknown): value is PresentationBeatLayout {
  return (
    typeof value === 'string' && (PRESENTATION_BEAT_LAYOUTS as readonly string[]).includes(value)
  );
}

/** True for a layout that summarizes a passage (not `authored`, not `feature`). */
export function isSummaryPresentationLayout(value: unknown): value is PresentationLayout {
  return typeof value === 'string' && (PRESENTATION_LAYOUTS as readonly string[]).includes(value);
}
