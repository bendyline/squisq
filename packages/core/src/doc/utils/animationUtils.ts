/**
 * Animation Utilities
 *
 * Helper functions for mapping Doc animations to CSS classes and styles.
 * Generates the appropriate animation class names and CSS custom properties
 * for duration, delay, and easing.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Animation, AnimationType } from '../../schemas/Doc.js';

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
export function getTransitionClass(type: string, entering: boolean): string {
  const mode = entering ? 'enter' : 'exit';
  return `transition-${type}-${mode}`;
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
