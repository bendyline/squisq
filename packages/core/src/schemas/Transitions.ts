/**
 * Shared transition vocabulary for block-to-block slide changes.
 *
 * The canonical names are based on PowerPoint / PresentationML transition
 * names where possible, with a few legacy renderer aliases kept so older
 * Squisq documents continue to work.
 */

export const DEFAULT_TRANSITION_DURATION_SECONDS = 0.7;

export const TRANSITION_TYPES = [
  // Existing / common transitions
  'cut',
  'fade',
  'dissolve',
  'push',
  'wipe',
  'split',
  'reveal',
  'randomBars',
  'shape',
  'uncover',
  'cover',
  'zoom',
  'pan',

  // PowerPoint subtle / exciting transitions
  'flash',
  'fallOver',
  'drape',
  'curtains',
  'wind',
  'prestige',
  'fracture',
  'crush',
  'peelOff',
  'pageCurl',
  'airplane',
  'origami',
  'checkerboard',
  'blinds',
  'clock',
  'ripple',
  'honeycomb',
  'glitter',
  'vortex',
  'shred',
  'switch',
  'flip',
  'gallery',
  'cube',
  'doors',
  'box',
  'ferrisWheel',
  'conveyor',
  'rotate',
  'window',
  'orbit',
  'flyThrough',
  'morph',

  // PresentationML/Open XML precise names and legacy aliases
  'checker',
  'circle',
  'comb',
  'diamond',
  'newsflash',
  'plus',
  'pull',
  'random',
  'randomBar',
  'strips',
  'wedge',
  'wheel',
  'prism',
  'warp',
  'ferris',
  'flythrough',
  'wheelReverse',
  'pageCurlDouble',
  'pageCurlSingle',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
] as const;

export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TRANSITION_DIRECTIONS = [
  'left',
  'right',
  'up',
  'down',
  'in',
  'out',
  'horizontal',
  'vertical',
] as const;

export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/**
 * Transition between blocks.
 *
 * A block's transition is the lead-in from the previous block. The same
 * transition drives the entering block and the previous block's exit.
 */
export interface Transition {
  /** Transition type */
  type: TransitionType;
  /** Duration in seconds. Defaults to DEFAULT_TRANSITION_DURATION_SECONDS. */
  duration?: number;
  /** Optional direction/variant for directional transitions. */
  direction?: TransitionDirection;
}

const TRANSITION_TYPE_SET = new Set<string>(TRANSITION_TYPES);

const TRANSITION_TYPE_ALIASES: Record<string, TransitionType> = {
  none: 'cut',
  randombars: 'randomBars',
  randombar: 'randomBar',
  // Self-referential spellings (`checkerboard`, `shape`, `uncover`) are
  // intentionally absent: an exact valid type returns early from
  // `normalizeTransitionType`, and any case variant resolves through
  // `NORMALIZED_TRANSITION_TYPES`. Only the *plural* aliases need an entry.
  checkerboards: 'checkerboard',
  shapes: 'shape',
  ferris: 'ferrisWheel',
  ferriswheel: 'ferrisWheel',
  flythrough: 'flyThrough',
  flythru: 'flyThrough',
  pagecurl: 'pageCurl',
  pagecurldouble: 'pageCurlDouble',
  pagecurlsingle: 'pageCurlSingle',
  wheelreverse: 'wheelReverse',
  slideleft: 'slideLeft',
  slideright: 'slideRight',
  slideup: 'slideUp',
  slidedown: 'slideDown',
};

const NORMALIZED_TRANSITION_TYPES = new Map<string, TransitionType>(
  TRANSITION_TYPES.map((type) => [normalizeToken(type), type]),
);

export function isTransitionType(value: string): value is TransitionType {
  return TRANSITION_TYPE_SET.has(value);
}

export function normalizeTransitionType(value: string): TransitionType | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isTransitionType(trimmed)) return trimmed;
  const normalized = normalizeToken(trimmed);
  return TRANSITION_TYPE_ALIASES[normalized] ?? NORMALIZED_TRANSITION_TYPES.get(normalized) ?? null;
}

export function normalizeTransitionDirection(value: string): TransitionDirection | null {
  const normalized = normalizeToken(value);
  switch (normalized) {
    case 'left':
    case 'l':
      return 'left';
    case 'right':
    case 'r':
      return 'right';
    case 'up':
    case 'u':
      return 'up';
    case 'down':
    case 'd':
      return 'down';
    case 'in':
      return 'in';
    case 'out':
      return 'out';
    case 'horizontal':
    case 'horz':
    case 'h':
      return 'horizontal';
    case 'vertical':
    case 'vert':
    case 'v':
      return 'vertical';
    default:
      return null;
  }
}

export function resolveTransitionDuration(
  transition: Transition | undefined,
  fallback: number = DEFAULT_TRANSITION_DURATION_SECONDS,
): number {
  const duration = transition?.duration;
  return duration != null && Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

/**
 * Resolve the effective transition for a block: the authored value wins
 * (markdown frontmatter and transform styles both write `block.transition`
 * upstream), then the theme's `renderStyle.defaultTransition`, then
 * `undefined` (the player's built-in default).
 *
 * Block 0 never gets a theme default — an entrance transition on the first
 * block would dim the opening frames of every exported video.
 *
 * The theme parameter is structural (not `Theme`) to avoid a schema import
 * cycle; pass any resolved theme.
 */
export function resolveBlockTransition(
  block: { transition?: Transition },
  theme: { renderStyle: { defaultTransition?: Transition } },
  blockIndex: number,
): Transition | undefined {
  if (block.transition) return block.transition;
  if (blockIndex === 0) return undefined;
  return theme.renderStyle.defaultTransition;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}
