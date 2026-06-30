import { describe, it, expect } from 'vitest';
import {
  getAnimationStyle,
  getDefaultAnimationDuration,
  getTransitionClass,
  getAnimationProgress,
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
