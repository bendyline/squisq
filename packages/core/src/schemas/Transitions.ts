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

export type TransitionDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'in'
  | 'out'
  | 'horizontal'
  | 'vertical';

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
  checkerboard: 'checkerboard',
  checkerboards: 'checkerboard',
  shape: 'shape',
  shapes: 'shape',
  uncover: 'uncover',
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

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}
