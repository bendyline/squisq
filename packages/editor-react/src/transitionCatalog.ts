/**
 * transitionCatalog
 *
 * Editor-facing, curated presentation of the block transition vocabulary.
 *
 * Core's `TRANSITION_TYPES` (packages/core/src/schemas/Transitions.ts) lists
 * ~80 names, including legacy aliases and near-duplicate spellings. This
 * catalog hand-picks the distinct, useful transitions, gives each a friendly
 * label, and groups them for the toolbar's transition flyout — the same
 * "core holds the truth, the editor holds the presentation" split the block
 * `TemplatePicker` uses.
 *
 * Every `value` here MUST be a real `TransitionType`; `transitionCatalog.test.ts`
 * enforces that so a renamed/removed core transition fails the build instead
 * of silently producing an invalid `transition=` annotation. The catalog is
 * intentionally NOT exhaustive — aliases and redundant spellings are omitted.
 */

/**
 * How a transition takes a direction, driving which direction sub-control
 * the picker shows. Mirrors core's `getTransitionVisualClass` dispatch:
 * - `lrud`: left / right / up / down (push, wipe, cover, uncover, reveal, pan)
 * - `axis`: horizontal / vertical (split, blinds)
 * Entries without a model take no `transitionDirection`.
 */
export type DirectionModel = 'lrud' | 'axis';

export interface TransitionCatalogEntry {
  /** Canonical `transition=` value — must be a core `TransitionType`. */
  value: string;
  /** Friendly label shown in the flyout and trigger. */
  label: string;
  /** Direction model, when the transition is directional. */
  direction?: DirectionModel;
}

export interface TransitionGroup {
  title: string;
  entries: TransitionCatalogEntry[];
}

export const TRANSITION_GROUPS: readonly TransitionGroup[] = [
  {
    title: 'Basic',
    entries: [
      { value: 'fade', label: 'Fade' },
      { value: 'dissolve', label: 'Dissolve' },
      { value: 'flash', label: 'Flash' },
      { value: 'morph', label: 'Morph' },
    ],
  },
  {
    title: 'Slide & Push',
    entries: [
      { value: 'push', label: 'Push', direction: 'lrud' },
      { value: 'cover', label: 'Cover', direction: 'lrud' },
      { value: 'uncover', label: 'Uncover', direction: 'lrud' },
      { value: 'pan', label: 'Pan', direction: 'lrud' },
      // Conveyor renders as a fixed-direction slide (no distinct 3D motion),
      // so it lives with the slides rather than "3D & Motion".
      { value: 'conveyor', label: 'Conveyor' },
    ],
  },
  {
    title: 'Reveal & Wipe',
    entries: [
      { value: 'wipe', label: 'Wipe', direction: 'lrud' },
      { value: 'reveal', label: 'Reveal', direction: 'lrud' },
      { value: 'split', label: 'Split', direction: 'axis' },
      // Blinds takes no `direction`: its horizontal/vertical web animations
      // are identical (both map to the generic textured reveal), so a
      // direction control here would be a visual no-op. Split, by contrast,
      // has genuinely distinct horizontal/vertical keyframes.
      { value: 'blinds', label: 'Blinds' },
      { value: 'wedge', label: 'Wedge' },
      { value: 'wheel', label: 'Wheel' },
      { value: 'circle', label: 'Circle' },
      { value: 'diamond', label: 'Diamond' },
      { value: 'checkerboard', label: 'Checkerboard' },
    ],
  },
  {
    title: '3D & Motion',
    entries: [
      { value: 'zoom', label: 'Zoom' },
      { value: 'cube', label: 'Cube' },
      { value: 'flip', label: 'Flip' },
      { value: 'rotate', label: 'Rotate' },
      { value: 'doors', label: 'Doors' },
      { value: 'box', label: 'Box' },
      { value: 'gallery', label: 'Gallery' },
      { value: 'pageCurl', label: 'Page Curl' },
      { value: 'origami', label: 'Origami' },
      { value: 'ferrisWheel', label: 'Ferris Wheel' },
      { value: 'orbit', label: 'Orbit' },
      { value: 'flyThrough', label: 'Fly Through' },
    ],
  },
  {
    title: 'Effects',
    entries: [
      { value: 'ripple', label: 'Ripple' },
      { value: 'honeycomb', label: 'Honeycomb' },
      { value: 'glitter', label: 'Glitter' },
      { value: 'vortex', label: 'Vortex' },
      { value: 'shred', label: 'Shred' },
      { value: 'fracture', label: 'Fracture' },
      { value: 'crush', label: 'Crush' },
      { value: 'prestige', label: 'Prestige' },
      { value: 'curtains', label: 'Curtains' },
      { value: 'drape', label: 'Drape' },
      { value: 'wind', label: 'Wind' },
      { value: 'fallOver', label: 'Fall Over' },
      { value: 'peelOff', label: 'Peel Off' },
      { value: 'airplane', label: 'Airplane' },
    ],
  },
];

/** Flat list of every catalog entry, in group order. */
export const TRANSITION_ENTRIES: readonly TransitionCatalogEntry[] = TRANSITION_GROUPS.flatMap(
  (g) => g.entries,
);

const ENTRY_BY_VALUE = new Map(TRANSITION_ENTRIES.map((e) => [e.value, e]));

/** Direction option lists keyed by model. */
export const DIRECTION_OPTIONS: Record<
  DirectionModel,
  readonly { value: string; label: string }[]
> = {
  lrud: [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
    { value: 'up', label: 'Up' },
    { value: 'down', label: 'Down' },
  ],
  axis: [
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'vertical', label: 'Vertical' },
  ],
};

/** Look up a catalog entry by its `transition=` value. */
export function findTransitionEntry(value: string): TransitionCatalogEntry | undefined {
  return ENTRY_BY_VALUE.get(value);
}

/**
 * Human label for a transition value. Returns 'None' for the empty value and
 * falls back to a camelCase-humanized form for any valid-but-uncurated type
 * (e.g. a hand-typed alias) so the trigger still reads sensibly.
 */
export function transitionLabel(value: string): string {
  if (!value) return 'None';
  const entry = ENTRY_BY_VALUE.get(value);
  if (entry) return entry.label;
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}
