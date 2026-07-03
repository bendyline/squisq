/**
 * Animation Utilities
 *
 * Helper functions for mapping Doc animations to CSS classes and styles.
 * Generates the appropriate animation class names and CSS custom properties
 * for duration, delay, and easing.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type {
  Animation,
  AnimationType,
  TransitionDirection,
  TransitionType,
} from '../../schemas/Doc.js';

interface AnimationResult {
  /** CSS class name to apply */
  className: string;
  /** Inline styles for CSS custom properties */
  style: Record<string, string>;
}

/**
 * Get CSS class and styles for an animation.
 */
export function getAnimationStyle(
  animation: Animation | undefined,
  _currentTime: number = 0,
): AnimationResult {
  if (!animation || animation.type === 'none') {
    return { className: '', style: {} };
  }

  const className = getAnimationClassName(animation);
  const style = getAnimationCSSVars(animation);

  return { className, style };
}

/**
 * Map animation type to CSS class name.
 */
function getAnimationClassName(animation: Animation): string {
  const { type, direction, panDirection } = animation;

  switch (type) {
    case 'fadeIn':
      return 'anim-fadeIn';
    case 'fadeOut':
      return 'anim-fadeOut';
    case 'slowZoom':
      // Slow zoom (Ken Burns style) has variants based on direction and pan
      if (panDirection === 'left') return 'anim-slowZoom-panLeft';
      if (panDirection === 'right') return 'anim-slowZoom-panRight';
      if (direction === 'out') return 'anim-slowZoom-out';
      return 'anim-slowZoom-in';
    case 'zoomIn':
      return 'anim-zoomIn';
    case 'zoomOut':
      return 'anim-zoomOut';
    case 'panLeft':
      return 'anim-panLeft';
    case 'panRight':
      return 'anim-panRight';
    case 'typewriter':
      return 'anim-typewriter';
    default:
      return '';
  }
}

/**
 * Generate CSS custom properties for animation timing.
 */
function getAnimationCSSVars(animation: Animation): Record<string, string> {
  const vars: Record<string, string> = {};

  if (animation.duration !== undefined) {
    vars['--anim-duration'] = `${animation.duration}s`;
  }

  if (animation.delay !== undefined) {
    vars['--anim-delay'] = `${animation.delay}s`;
  }

  if (animation.easing) {
    vars['--anim-easing'] = animation.easing;
  }

  return vars;
}

/**
 * Get default duration for an animation type.
 */
export function getDefaultAnimationDuration(type: AnimationType): number {
  switch (type) {
    case 'slowZoom':
    case 'panLeft':
    case 'panRight':
      return 8; // Long, slow animations
    case 'typewriter':
      return 3;
    case 'fadeIn':
    case 'fadeOut':
      return 1;
    case 'zoomIn':
    case 'zoomOut':
      return 0.5;
    default:
      return 1;
  }
}

/**
 * Get transition class for slide entry/exit.
 */
export function getTransitionClass(
  type: TransitionType,
  entering: boolean,
  direction?: TransitionDirection,
): string {
  if (type === 'cut') return '';
  const mode = entering ? 'enter' : 'exit';
  return `transition-${getTransitionVisualClass(type, direction)}-${mode}`;
}

type TransitionVisualClass =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'pushLeft'
  | 'pushRight'
  | 'pushUp'
  | 'pushDown'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'splitHorizontal'
  | 'splitVertical'
  | 'revealLeft'
  | 'revealRight'
  | 'revealUp'
  | 'revealDown'
  | 'random'
  | 'randomBarsHorizontal'
  | 'randomBarsVertical'
  | 'shapeCircle'
  | 'shapeDiamond'
  | 'shapePlus'
  | 'uncoverLeft'
  | 'uncoverRight'
  | 'uncoverUp'
  | 'uncoverDown'
  | 'coverLeft'
  | 'coverRight'
  | 'coverUp'
  | 'coverDown'
  | 'zoom'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown'
  | 'flash'
  | 'newsflash'
  | 'fallOver'
  | 'drape'
  | 'curtains'
  | 'wind'
  | 'prestige'
  | 'fracture'
  | 'crush'
  | 'peelOff'
  | 'pageCurl'
  | 'pageCurlDouble'
  | 'pageCurlSingle'
  | 'airplane'
  | 'origami'
  | 'checkerboard'
  | 'blindsHorizontal'
  | 'blindsVertical'
  | 'clock'
  | 'ripple'
  | 'honeycomb'
  | 'glitter'
  | 'vortex'
  | 'shred'
  | 'switch'
  | 'flip'
  | 'gallery'
  | 'cube'
  | 'doors'
  | 'box'
  | 'ferrisWheel'
  | 'conveyor'
  | 'rotate'
  | 'window'
  | 'orbit'
  | 'flyThrough'
  | 'morph'
  | 'combHorizontal'
  | 'combVertical'
  | 'pullLeft'
  | 'pullRight'
  | 'pullUp'
  | 'pullDown'
  | 'stripsLeft'
  | 'stripsRight'
  | 'stripsUp'
  | 'stripsDown'
  | 'wedge'
  | 'wheel'
  | 'wheelReverse'
  | 'prism'
  | 'warp'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown';

const TRANSITION_VISUAL_CLASS_BY_TYPE: Record<TransitionType, TransitionVisualClass> = {
  airplane: 'airplane',
  blinds: 'blindsHorizontal',
  box: 'box',
  checker: 'checkerboard',
  checkerboard: 'checkerboard',
  circle: 'shapeCircle',
  clock: 'clock',
  comb: 'combHorizontal',
  conveyor: 'conveyor',
  cover: 'coverLeft',
  crush: 'crush',
  cube: 'cube',
  curtains: 'curtains',
  cut: 'cut',
  diamond: 'shapeDiamond',
  dissolve: 'dissolve',
  doors: 'doors',
  drape: 'drape',
  fade: 'fade',
  fallOver: 'fallOver',
  ferris: 'ferrisWheel',
  ferrisWheel: 'ferrisWheel',
  flash: 'flash',
  flip: 'flip',
  flyThrough: 'flyThrough',
  flythrough: 'flyThrough',
  fracture: 'fracture',
  gallery: 'gallery',
  glitter: 'glitter',
  honeycomb: 'honeycomb',
  morph: 'morph',
  newsflash: 'newsflash',
  orbit: 'orbit',
  origami: 'origami',
  pageCurl: 'pageCurl',
  pageCurlDouble: 'pageCurlDouble',
  pageCurlSingle: 'pageCurlSingle',
  pan: 'panLeft',
  peelOff: 'peelOff',
  plus: 'shapePlus',
  prestige: 'prestige',
  prism: 'prism',
  pull: 'pullLeft',
  push: 'pushLeft',
  random: 'random',
  randomBar: 'randomBarsHorizontal',
  randomBars: 'randomBarsVertical',
  reveal: 'revealLeft',
  ripple: 'ripple',
  rotate: 'rotate',
  shape: 'shapeCircle',
  shred: 'shred',
  slideDown: 'slideDown',
  slideLeft: 'slideLeft',
  slideRight: 'slideRight',
  slideUp: 'slideUp',
  split: 'splitHorizontal',
  strips: 'stripsLeft',
  switch: 'switch',
  uncover: 'uncoverLeft',
  vortex: 'vortex',
  warp: 'warp',
  wedge: 'wedge',
  wheel: 'wheel',
  wheelReverse: 'wheelReverse',
  wind: 'wind',
  window: 'window',
  wipe: 'wipeLeft',
  zoom: 'zoom',
};

function getTransitionVisualClass(
  type: TransitionType,
  direction?: TransitionDirection,
): TransitionVisualClass {
  switch (type) {
    case 'randomBars':
    case 'randomBar':
      return axisClass('randomBars', direction, type === 'randomBar' ? 'Horizontal' : 'Vertical');
    case 'comb':
      return axisClass('comb', direction, 'Horizontal');
    case 'blinds':
      return axisClass('blinds', direction, 'Horizontal');
    case 'split':
      return axisClass('split', direction, 'Horizontal');
    case 'push':
      return directionalClass('push', direction, 'Left');
    case 'wipe':
      return directionalClass('wipe', direction, 'Left');
    case 'cover':
      return directionalClass('cover', direction, 'Left');
    case 'uncover':
      return directionalClass('uncover', direction, 'Left');
    case 'pull':
      return directionalClass('pull', direction, 'Left');
    case 'reveal':
      return directionalClass('reveal', direction, 'Left');
    case 'strips':
      return directionalClass('strips', direction, 'Left');
    case 'pan':
      return directionalClass('pan', direction, 'Left');
    default:
      return TRANSITION_VISUAL_CLASS_BY_TYPE[type];
  }
}

function directionalClass(
  prefix: 'cover' | 'pan' | 'pull' | 'push' | 'reveal' | 'strips' | 'uncover' | 'wipe',
  direction: TransitionDirection | undefined,
  fallback: 'Left' | 'Right' | 'Up' | 'Down',
): TransitionVisualClass {
  const suffix = directionSuffix(direction, fallback);
  return `${prefix}${suffix}` as TransitionVisualClass;
}

function axisClass(
  prefix: 'blinds' | 'comb' | 'randomBars' | 'split',
  direction: TransitionDirection | undefined,
  fallback: 'Horizontal' | 'Vertical',
): TransitionVisualClass {
  const suffix = axisSuffix(direction, fallback);
  return `${prefix}${suffix}` as TransitionVisualClass;
}

function directionSuffix(
  direction: TransitionDirection | undefined,
  fallback: 'Left' | 'Right' | 'Up' | 'Down',
): 'Left' | 'Right' | 'Up' | 'Down' {
  switch (direction) {
    case 'right':
      return 'Right';
    case 'up':
      return 'Up';
    case 'down':
      return 'Down';
    case 'left':
    default:
      return fallback;
  }
}

function axisSuffix(
  direction: TransitionDirection | undefined,
  fallback: 'Horizontal' | 'Vertical',
): 'Horizontal' | 'Vertical' {
  switch (direction) {
    case 'vertical':
    case 'up':
    case 'down':
      return 'Vertical';
    case 'horizontal':
    case 'left':
    case 'right':
      return 'Horizontal';
    default:
      return fallback;
  }
}

/**
 * Calculate animation progress (0-1) based on current time.
 */
export function getAnimationProgress(
  animation: Animation,
  currentTime: number,
  slideDuration: number,
): number {
  const delay = animation.delay || 0;
  const duration = animation.duration || slideDuration;

  if (currentTime < delay) return 0;
  if (currentTime >= delay + duration) return 1;

  return (currentTime - delay) / duration;
}
