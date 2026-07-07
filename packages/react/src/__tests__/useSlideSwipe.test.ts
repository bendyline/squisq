import { describe, it, expect } from 'vitest';
import { decideSwipe, type SwipeDecisionInput } from '../hooks/useSlideSwipe';

/** A slow drag: long duration so velocity stays well under the flick threshold. */
function slow(overrides: Partial<SwipeDecisionInput>): SwipeDecisionInput {
  return {
    dx: 0,
    width: 1000,
    elapsedMs: 1000,
    canNext: true,
    canPrev: true,
    ...overrides,
  };
}

describe('decideSwipe', () => {
  describe('distance threshold (30% of width)', () => {
    it('snaps back when the drag is below the threshold', () => {
      // 100px of 1000px = 10% < 30%, and slow enough not to be a flick.
      expect(decideSwipe(slow({ dx: -100 }))).toBe('snap');
      expect(decideSwipe(slow({ dx: 100 }))).toBe('snap');
    });

    it('advances to the next slide when dragged left past the threshold', () => {
      expect(decideSwipe(slow({ dx: -350 }))).toBe('next');
    });

    it('goes to the previous slide when dragged right past the threshold', () => {
      expect(decideSwipe(slow({ dx: 350 }))).toBe('prev');
    });

    it('commits exactly at the threshold', () => {
      expect(decideSwipe(slow({ dx: -300 }))).toBe('next');
    });
  });

  describe('flick (fast, short drag)', () => {
    it('commits on a quick flick even below the distance threshold', () => {
      // 100px in 100ms = 1.0 px/ms >= 0.5, distance 100 >= 12.
      expect(decideSwipe(slow({ dx: -100, elapsedMs: 100 }))).toBe('next');
      expect(decideSwipe(slow({ dx: 100, elapsedMs: 100 }))).toBe('prev');
    });

    it('ignores a fast micro-jitter shorter than the minimum flick distance', () => {
      // 8px in 5ms = 1.6 px/ms (fast) but distance 8 < 12 → treat as a click.
      expect(decideSwipe(slow({ dx: -8, elapsedMs: 5 }))).toBe('snap');
    });
  });

  describe('deck boundaries', () => {
    it('snaps back instead of advancing when there is no next slide', () => {
      expect(decideSwipe(slow({ dx: -350, canNext: false }))).toBe('snap');
      // A flick past the last slide is also refused.
      expect(decideSwipe(slow({ dx: -100, elapsedMs: 100, canNext: false }))).toBe('snap');
    });

    it('snaps back instead of rewinding when there is no previous slide', () => {
      expect(decideSwipe(slow({ dx: 350, canPrev: false }))).toBe('snap');
      expect(decideSwipe(slow({ dx: 100, elapsedMs: 100, canPrev: false }))).toBe('snap');
    });
  });

  describe('degenerate inputs', () => {
    it('snaps back on a zero-distance release', () => {
      expect(decideSwipe(slow({ dx: 0 }))).toBe('snap');
    });

    it('never commits by distance when the container has no measurable width', () => {
      // width 0 → distance threshold is Infinity; only a flick can commit.
      // 500px over 2000ms = 0.25 px/ms, safely below the flick velocity.
      expect(decideSwipe(slow({ dx: -500, width: 0, elapsedMs: 2000 }))).toBe('snap');
      expect(decideSwipe(slow({ dx: -500, width: 0, elapsedMs: 100 }))).toBe('next');
    });

    it('does not divide by zero on an instantaneous release', () => {
      // elapsedMs 0 → velocity treated as 0; falls back to the distance rule.
      expect(decideSwipe(slow({ dx: -350, elapsedMs: 0 }))).toBe('next');
      expect(decideSwipe(slow({ dx: -100, elapsedMs: 0 }))).toBe('snap');
    });
  });
});
