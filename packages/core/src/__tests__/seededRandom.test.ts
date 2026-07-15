import { describe, expect, it } from 'vitest';
import { SeededRandom, hashString } from '../random/index.js';

describe('SeededRandom', () => {
  it('produces deterministic output from the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
  });

  it('produces different output from different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRandom(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(max) returns values in [0, max)', () => {
    const rng = new SeededRandom(99);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextIntRange(min, max) stays in range', () => {
    const rng = new SeededRandom(77);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextIntRange(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it('pick returns undefined for empty array', () => {
    const rng = new SeededRandom(1);
    expect(rng.pick([])).toBeUndefined();
  });

  it('pick returns an element from the array', () => {
    const rng = new SeededRandom(1);
    const items = ['a', 'b', 'c'];
    const picked = rng.pick(items);
    expect(items).toContain(picked);
  });

  it('pickRequired throws on empty array', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.pickRequired([])).toThrow('Cannot pick from empty array');
  });

  it('pickMultiple returns correct count', () => {
    const rng = new SeededRandom(42);
    const result = rng.pickMultiple([1, 2, 3, 4, 5], 3);
    expect(result).toHaveLength(3);
    // All elements should be unique
    expect(new Set(result).size).toBe(3);
  });

  it('pickMultiple returns all if count >= length', () => {
    const rng = new SeededRandom(42);
    const result = rng.pickMultiple([1, 2, 3], 5);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });

  it('shuffle is deterministic', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    expect(a.shuffle([1, 2, 3, 4, 5])).toEqual(b.shuffle([1, 2, 3, 4, 5]));
  });

  it('shuffled does not modify original', () => {
    const rng = new SeededRandom(42);
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    rng.shuffled(original);
    expect(original).toEqual(copy);
  });

  it('pickWeighted respects weights', () => {
    // Heavily weight 'a' — over many picks it should dominate
    const rng = new SeededRandom(42);
    const items = [
      { item: 'a', weight: 100 },
      { item: 'b', weight: 1 },
    ];
    let aCount = 0;
    for (let i = 0; i < 100; i++) {
      if (rng.pickWeighted(items) === 'a') aCount++;
    }
    expect(aCount).toBeGreaterThan(80);
  });

  it('pickWeighted returns undefined for empty', () => {
    const rng = new SeededRandom(1);
    expect(rng.pickWeighted([])).toBeUndefined();
  });

  it('derive creates independent stream', () => {
    const rng = new SeededRandom(42);
    const d1 = rng.derive('stream-a');
    const d2 = rng.derive('stream-b');
    expect(d1.next()).not.toBe(d2.next());
  });

  it('handles seed of 0 gracefully', () => {
    const rng = new SeededRandom(0);
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  // Mulberry32 wraps its state increment to 32 bits. Omitting the wrap keeps
  // the state as an ever-growing float; the bitwise ops still coerce mod 2^32
  // so the output matches — until the state passes 2^53, `+= 0x6d2b79f5`
  // stops being exact, and the sequence silently drifts from the algorithm.
  describe('Mulberry32 conformance', () => {
    /** Reference Mulberry32 with an explicit uint32 state. */
    function reference(seed: number): () => number {
      let a = seed >>> 0;
      if (a === 0) a = 0xdeadbeef;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    it('matches reference Mulberry32 across long streams', () => {
      for (const seed of [0, 1, 42, 0xdeadbeef, 123456789]) {
        const rng = new SeededRandom(seed);
        const ref = reference(seed);
        // Well past the ~4.9M draw where an unwrapped float state loses
        // low-bit precision and diverges.
        for (let i = 0; i < 5_200_000; i++) {
          if (rng.next() !== ref()) {
            throw new Error(`seed ${seed} diverged from Mulberry32 at draw ${i}`);
          }
        }
      }
    });

    it('keeps the state a uint32', () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 1000; i++) {
        rng.next();
        const state = rng.getState();
        expect(Number.isInteger(state)).toBe(true);
        expect(state).toBeGreaterThanOrEqual(0);
        expect(state).toBeLessThanOrEqual(0xffffffff);
      }
    });

    it('derive stays keyed to the wrapped state', () => {
      const a = new SeededRandom(42);
      const b = new SeededRandom(42);
      for (let i = 0; i < 10; i++) {
        a.next();
        b.next();
      }
      expect(a.derive('x').next()).toBe(b.derive('x').next());
    });
  });
});

describe('hashString', () => {
  it('returns a positive 32-bit integer', () => {
    const h = hashString('hello world');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('is deterministic', () => {
    expect(hashString('test')).toBe(hashString('test'));
  });

  it('differs for different strings', () => {
    expect(hashString('abc')).not.toBe(hashString('xyz'));
  });
});
