import { describe, it, expect } from 'vitest';
import { estimateSyllables } from '../narration/syllables';

describe('estimateSyllables', () => {
  // Pinned corpus: exact values are part of the deterministic contract.
  // ±1 misses on unusual words are acceptable and documented; these
  // pins catch unintended drift, not linguistic perfection.
  const corpus: Array<[string, number]> = [
    ['a', 1],
    ['the', 1],
    ['word', 1],
    ['hello', 2],
    ['reading', 2],
    ['syllable', 3],
    ['teleprompter', 4],
    ['narration', 3],
    ['deterministic', 5],
    ['table', 2],
    ['little', 2],
    ['whale', 1],
    ['give', 1],
    ['make', 1],
    ['makes', 1],
    ['boxes', 2],
    ['riches', 2],
    ['walked', 1],
    ['wanted', 2],
    ['loaded', 2],
    ['agreed', 2],
    ['squisq', 1],
    ['beam-splitter', 3],
    ["don't", 1],
    ['yellow', 2],
    ['rhythm', 1],
    ['HTML', 4],
    ['NASA', 2],
    ['USA', 2], // vowel-bearing caps fall through to vowel groups (u + a)
    ['Hello,', 2],
    ['"quoted"', 2],
    ['end.', 1],
  ];

  it.each(corpus)('%s → %d', (word, expected) => {
    expect(estimateSyllables(word)).toBe(expected);
  });

  it('expands numbers via spoken-word equivalents', () => {
    // "1910" → "nineteen ten" ≈ 2 words × 1.3 × 1.4 ≈ 4
    expect(estimateSyllables('1910')).toBeGreaterThanOrEqual(3);
    expect(estimateSyllables('1910')).toBeLessThanOrEqual(5);
    // "175,000" is many spoken words
    expect(estimateSyllables('175,000')).toBeGreaterThanOrEqual(5);
    expect(estimateSyllables('7')).toBeGreaterThanOrEqual(1);
  });

  it('never returns less than 1 for non-empty tokens', () => {
    for (const t of ['x', '—', '...', '?!', 'b2b', 'C-3PO']) {
      expect(estimateSyllables(t)).toBeGreaterThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(estimateSyllables('deterministic')).toBe(estimateSyllables('deterministic'));
  });
});
