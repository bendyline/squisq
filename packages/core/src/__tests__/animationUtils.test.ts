import { describe, it, expect } from 'vitest';
import {
  getAnimationStyle,
  getDefaultAnimationDuration,
  getTransitionClass,
  getAnimationProgress,
  wordRevealDelay,
} from '../doc/utils/animationUtils';
import { TRANSITION_TYPES } from '../schemas/Transitions';

describe('getAnimationStyle', () => {
  it('returns empty for undefined animation', () => {
    const result = getAnimationStyle(undefined);
    expect(result.className).toBe('');
    expect(result.style).toEqual({});
  });

  it('returns empty for type "none"', () => {
    const result = getAnimationStyle({ type: 'none' });
    expect(result.className).toBe('');
  });

  it('returns correct class for fadeIn', () => {
    const result = getAnimationStyle({ type: 'fadeIn' });
    expect(result.className).toBe('anim-fadeIn');
  });

  it('returns correct class for slowZoom with pan', () => {
    const result = getAnimationStyle({ type: 'slowZoom', panDirection: 'left' });
    expect(result.className).toBe('anim-slowZoom-panLeft');
  });

  it('includes CSS custom properties for duration and delay', () => {
    const result = getAnimationStyle({ type: 'fadeIn', duration: 2, delay: 0.5 });
    expect(result.style['--anim-duration']).toBe('2s');
    expect(result.style['--anim-delay']).toBe('0.5s');
  });
});

describe('getDefaultAnimationDuration', () => {
  it('returns 8 for slowZoom', () => {
    expect(getDefaultAnimationDuration('slowZoom')).toBe(8);
  });

  it('returns 1 for fadeIn', () => {
    expect(getDefaultAnimationDuration('fadeIn')).toBe(1);
  });

  it('returns 0.5 for zoomIn', () => {
    expect(getDefaultAnimationDuration('zoomIn')).toBe(0.5);
  });
});

describe('getTransitionClass', () => {
  it('returns enter class', () => {
    expect(getTransitionClass('fade', true)).toBe('transition-fade-enter');
  });

  it('returns exit class', () => {
    expect(getTransitionClass('dissolve', false)).toBe('transition-dissolve-exit');
  });

  it('returns no class for cut', () => {
    expect(getTransitionClass('cut', true)).toBe('');
  });

  it('maps PowerPoint-style transitions to supported visual classes', () => {
    for (const type of TRANSITION_TYPES) {
      if (type === 'cut') continue;
      expect(getTransitionClass(type, true), type).toMatch(/^transition-.+-enter$/);
      expect(getTransitionClass(type, false), type).toMatch(/^transition-.+-exit$/);
    }
  });

  it('keeps the PowerPoint transition vocabulary visually expressive', () => {
    const families = new Set(
      TRANSITION_TYPES.flatMap((type) => {
        const className = getTransitionClass(type, true);
        const match = /^transition-(.+)-enter$/.exec(className);
        return match ? [match[1]] : [];
      }),
    );

    expect(families.size).toBeGreaterThanOrEqual(50);
  });

  it('maps aliases to stable visual families', () => {
    expect(getTransitionClass('randomBars', true)).toBe('transition-randomBarsVertical-enter');
    expect(getTransitionClass('flyThrough', true)).toBe('transition-flyThrough-enter');
    expect(getTransitionClass('flythrough', true)).toBe('transition-flyThrough-enter');
    expect(getTransitionClass('cube', true)).toBe('transition-cube-enter');
    expect(getTransitionClass('ferris', true)).toBe('transition-ferrisWheel-enter');
  });

  it('honors transition directions for directional families', () => {
    expect(getTransitionClass('wipe', true, 'right')).toBe('transition-wipeRight-enter');
    expect(getTransitionClass('push', false, 'up')).toBe('transition-pushUp-exit');
    expect(getTransitionClass('split', true, 'vertical')).toBe('transition-splitVertical-enter');
    expect(getTransitionClass('blinds', false, 'vertical')).toBe('transition-blindsVertical-exit');
  });
});

describe('getAnimationProgress', () => {
  it('returns 0 before delay', () => {
    const progress = getAnimationProgress({ type: 'fadeIn', delay: 1, duration: 2 }, 0.5, 5);
    expect(progress).toBe(0);
  });

  it('returns 1 after completion', () => {
    const progress = getAnimationProgress({ type: 'fadeIn', delay: 0, duration: 2 }, 3, 5);
    expect(progress).toBe(1);
  });

  it('returns 0.5 at midpoint', () => {
    const progress = getAnimationProgress({ type: 'fadeIn', delay: 0, duration: 2 }, 1, 5);
    expect(progress).toBeCloseTo(0.5);
  });
});

describe('motion vocabulary classes and vars', () => {
  it('maps the new animation types to their classes', () => {
    expect(getAnimationStyle({ type: 'fadeInUp' }).className).toBe('anim-fadeInUp');
    expect(getAnimationStyle({ type: 'slideIn' }).className).toBe('anim-slideIn-left');
    expect(getAnimationStyle({ type: 'slideIn', origin: 'bottom' }).className).toBe(
      'anim-slideIn-bottom',
    );
    expect(getAnimationStyle({ type: 'grow' }).className).toBe('anim-grow');
    expect(getAnimationStyle({ type: 'grow', origin: 'left' }).className).toBe('anim-grow-x');
    expect(getAnimationStyle({ type: 'grow', origin: 'bottom' }).className).toBe('anim-grow-y');
    expect(getAnimationStyle({ type: 'drawOn' }).className).toBe('anim-drawOn');
    expect(getAnimationStyle({ type: 'reveal' }).className).toBe('anim-reveal-left');
    expect(getAnimationStyle({ type: 'reveal', shape: 'iris' }).className).toBe('anim-reveal-iris');
    expect(getAnimationStyle({ type: 'wordReveal' }).className).toBe('anim-wordReveal');
    expect(getAnimationStyle({ type: 'countUp' }).className).toBe('anim-countUp');
    expect(getAnimationStyle({ type: 'drift' }).className).toBe('anim-drift');
    expect(getAnimationStyle({ type: 'tween' }).className).toBe('anim-tween');
  });

  it('emits the transform origin for grow and reveal', () => {
    expect(getAnimationStyle({ type: 'grow', origin: 'left' }).style['--anim-origin']).toBe(
      'left center',
    );
    expect(getAnimationStyle({ type: 'grow', origin: 'bottom' }).style['--anim-origin']).toBe(
      'center bottom',
    );
    expect(getAnimationStyle({ type: 'grow' }).style['--anim-origin']).toBe('center center');
    expect(getAnimationStyle({ type: 'fadeIn' }).style['--anim-origin']).toBeUndefined();
  });

  it('emits tween endpoints as CSS variables', () => {
    const style = getAnimationStyle({
      type: 'tween',
      fromState: { scale: 1.2, x: 10, opacity: 0 },
      toState: { rotate: 5 },
    }).style;
    expect(style['--tween-from-transform']).toBe('translate(10px, 0px) scale(1.2)');
    expect(style['--tween-from-opacity']).toBe('0');
    expect(style['--tween-to-transform']).toBe('rotate(5deg)');
    expect(style['--tween-to-opacity']).toBe('1');
  });

  it('spaces word reveals by stagger or explicit times', () => {
    expect(wordRevealDelay({ type: 'wordReveal', delay: 0.5, stagger: 0.1 }, 3)).toBeCloseTo(0.8);
    expect(wordRevealDelay({ type: 'wordReveal' }, 2)).toBeCloseTo(0.16);
    const timed = { type: 'wordReveal' as const, wordTimes: [1, 1.5, 2.5] };
    expect(wordRevealDelay(timed, 1)).toBe(1.5);
    expect(wordRevealDelay(timed, 4)).toBeCloseTo(4.5);
    expect(getAnimationStyle({ type: 'wordReveal', stagger: 0.2 }).style['--anim-stagger']).toBe(
      '0.2s',
    );
  });

  it('has default durations for the new types', () => {
    expect(getDefaultAnimationDuration('grow')).toBe(1);
    expect(getDefaultAnimationDuration('countUp')).toBe(1.5);
    expect(getDefaultAnimationDuration('drift')).toBe(12);
  });
});
