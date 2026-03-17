/**
 * Seeded pseudo-random number generator (Mulberry32 algorithm).
 *
 * Provides deterministic, reproducible randomness from an integer seed.
 * Useful for consistent slideshow generation, shuffling, and selection.
 *
 * ```ts
 * const rng = new SeededRandom(42);
 * rng.next();            // 0.0–1.0
 * rng.nextInt(10);       // 0–9
 * rng.pick(['a', 'b']);  // 'a' or 'b'
 * ```
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0xdeadbeef;
    }
  }

  /** Random float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Random integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Random integer in [min, max). */
  nextIntRange(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  /** Random boolean with given probability of `true` (default 0.5). */
  nextBool(probability: number = 0.5): boolean {
    return this.next() < probability;
  }

  /** Pick a random element, or `undefined` if array is empty. */
  pick<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[this.nextInt(array.length)];
  }

  /** Pick a random element; throws if empty. */
  pickRequired<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.nextInt(array.length)];
  }

  /** Pick `count` unique random elements (fewer if array is smaller). */
  pickMultiple<T>(array: T[], count: number): T[] {
    if (count >= array.length) {
      return this.shuffle([...array]);
    }
    const result: T[] = [];
    const available = [...array];
    for (let i = 0; i < count && available.length > 0; i++) {
      const index = this.nextInt(available.length);
      result.push(available[index]);
      available.splice(index, 1);
    }
    return result;
  }

  /** Fisher-Yates shuffle **in place**. Returns the same array. */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /** Return a **new** shuffled copy. */
  shuffled<T>(array: readonly T[]): T[] {
    return this.shuffle([...array]);
  }

  /** Weighted random selection. Returns `undefined` if items is empty. */
  pickWeighted<T>(items: { item: T; weight: number }[]): T | undefined {
    if (items.length === 0) return undefined;

    const totalWeight = items.reduce((sum, { weight }) => sum + weight, 0);
    if (totalWeight <= 0) return items[0]?.item;

    let random = this.next() * totalWeight;
    for (const { item, weight } of items) {
      random -= weight;
      if (random <= 0) return item;
    }
    return items[items.length - 1]?.item;
  }

  /** Current internal state (for debugging / serialization). */
  getState(): number {
    return this.state;
  }

  /** Create an independent sub-stream keyed by a modifier. */
  derive(modifier: string | number): SeededRandom {
    const hash = typeof modifier === 'string' ? hashString(modifier) : modifier >>> 0;
    return new SeededRandom(this.state ^ hash);
  }
}

/**
 * Simple string → 32-bit hash (djb2 algorithm).
 * Useful for turning a document ID into a numeric seed.
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}
