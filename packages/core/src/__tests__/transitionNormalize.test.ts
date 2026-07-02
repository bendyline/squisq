import { describe, it, expect } from 'vitest';
import {
  normalizeTransitionType,
  normalizeTransitionDirection,
  isTransitionType,
  TRANSITION_TYPES,
} from '../schemas/Transitions';

describe('normalizeTransitionType', () => {
  it('returns exact canonical types unchanged', () => {
    expect(normalizeTransitionType('fade')).toBe('fade');
    expect(normalizeTransitionType('checkerboard')).toBe('checkerboard');
    expect(normalizeTransitionType('slideLeft')).toBe('slideLeft');
  });

  it('resolves case / punctuation variants of canonical types', () => {
    // These have NO explicit alias entry — they round-trip through the
    // case-insensitive `NORMALIZED_TRANSITION_TYPES` fallback. This guards the
    // removal of the redundant self-aliases (checkerboard/shape/uncover).
    expect(normalizeTransitionType('Checkerboard')).toBe('checkerboard');
    expect(normalizeTransitionType('CHECKERBOARD')).toBe('checkerboard');
    expect(normalizeTransitionType('Shape')).toBe('shape');
    expect(normalizeTransitionType('Uncover')).toBe('uncover');
    expect(normalizeTransitionType('fly-through')).toBe('flyThrough');
  });

  it('resolves explicit aliases (including plurals)', () => {
    // Aliases only fire for spellings that are NOT themselves canonical types
    // (an exact type returns early). `ferris` IS a canonical type, so its
    // sameness with `ferrisWheel` comes from the visual map, not here.
    expect(normalizeTransitionType('none')).toBe('cut');
    expect(normalizeTransitionType('checkerboards')).toBe('checkerboard');
    expect(normalizeTransitionType('shapes')).toBe('shape');
    expect(normalizeTransitionType('flythru')).toBe('flyThrough');
  });

  it('returns null for unknown values', () => {
    expect(normalizeTransitionType('definitely-not-a-transition')).toBeNull();
    expect(normalizeTransitionType('')).toBeNull();
  });

  it('every canonical type normalizes to itself', () => {
    for (const type of TRANSITION_TYPES) {
      expect(normalizeTransitionType(type), type).toBe(type);
      expect(isTransitionType(type), type).toBe(true);
    }
  });
});

describe('normalizeTransitionDirection', () => {
  it('resolves cardinal directions and shorthands', () => {
    expect(normalizeTransitionDirection('left')).toBe('left');
    expect(normalizeTransitionDirection('R')).toBe('right');
    expect(normalizeTransitionDirection('horizontal')).toBe('horizontal');
    expect(normalizeTransitionDirection('v')).toBe('vertical');
  });

  it('returns null for unknown directions', () => {
    expect(normalizeTransitionDirection('sideways')).toBeNull();
  });
});
