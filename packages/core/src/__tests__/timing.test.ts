import { describe, expect, it } from 'vitest';
import {
  countSpokenWords,
  estimateSpokenWordCount,
  estimateTimeFromText,
  calculatePrefixDuration,
  estimateNarrationDuration,
  estimateReadingTime,
  estimateNarrationTime,
  DEFAULT_WORDS_PER_SECOND,
} from '../timing/index.js';

// ── narrationTiming ────────────────────────────────────────────────

describe('estimateSpokenWordCount', () => {
  it('counts a regular word as 1', () => {
    expect(estimateSpokenWordCount('hello')).toBe(1);
  });

  it('expands a small number (50 → "fifty" → 1 word × 1.3)', () => {
    expect(estimateSpokenWordCount('50')).toBeCloseTo(1.3);
  });

  it('expands a year (1910 → "nineteen ten" → 2 × 1.3)', () => {
    expect(estimateSpokenWordCount('1910')).toBeCloseTo(2.6);
  });

  it('expands a large number (175000)', () => {
    // "one hundred seventy-five" (4 words) + "thousand" (1) = 5 words × 1.3
    expect(estimateSpokenWordCount('175000')).toBeCloseTo(6.5, 1);
  });

  it('handles 2024 as a year', () => {
    // "twenty twenty-four" → 3 words × 1.3
    expect(estimateSpokenWordCount('2024')).toBeCloseTo(3.9);
  });

  it('handles zero', () => {
    // "zero" → 1 word × 1.3
    expect(estimateSpokenWordCount('0')).toBeCloseTo(1.3);
  });

  it('handles non-numeric strings', () => {
    expect(estimateSpokenWordCount('hello')).toBe(1);
    expect(estimateSpokenWordCount('')).toBe(1);
  });
});

describe('countSpokenWords', () => {
  it('counts plain text words', () => {
    expect(countSpokenWords('the quick brown fox')).toBe(4);
  });

  it('includes comma pause penalties', () => {
    const withComma = countSpokenWords('hello, world');
    const without = countSpokenWords('hello world');
    expect(withComma).toBeGreaterThan(without);
    expect(withComma - without).toBeCloseTo(0.3);
  });

  it('expands numbers within text', () => {
    const result = countSpokenWords('In 1910 there were 50 houses');
    // "In"(1) + "1910"(2.6) + "there"(1) + "were"(1) + "50"(1.3) + "houses"(1)
    expect(result).toBeCloseTo(7.9);
  });

  it('returns 0 for empty text', () => {
    expect(countSpokenWords('')).toBe(0);
  });
});

describe('estimateTimeFromText', () => {
  it('returns 0 at the beginning', () => {
    expect(estimateTimeFromText('hello world', 0, 10)).toBe(0);
  });

  it('returns proportional time at the midpoint', () => {
    const time = estimateTimeFromText('one two three four', 8, 20);
    // "one two" = 2 words before offset 8, total = 4 words → 50% → 10s
    expect(time).toBeCloseTo(10);
  });

  it('returns totalDuration at the end', () => {
    const text = 'some text here';
    const time = estimateTimeFromText(text, text.length, 30);
    expect(time).toBeCloseTo(30);
  });

  it('returns 0 for empty text', () => {
    expect(estimateTimeFromText('', 0, 10)).toBe(0);
  });
});

describe('calculatePrefixDuration', () => {
  it('returns 0 for empty string', () => {
    expect(calculatePrefixDuration('')).toBe(0);
  });

  it('estimates based on word count', () => {
    // 5 words at 2.5 wps = 2 seconds
    expect(calculatePrefixDuration('one two three four five')).toBeCloseTo(2);
  });

  it('adds pause time for paragraph breaks', () => {
    const withBreak = calculatePrefixDuration('Title\n\nContent here');
    const without = calculatePrefixDuration('Title Content here');
    expect(withBreak).toBeGreaterThan(without);
    // One paragraph break → +0.5s
    expect(withBreak - without).toBeCloseTo(0.5);
  });
});

describe('estimateNarrationDuration', () => {
  it('estimates simple text', () => {
    // 5 words at 2.5 wps = 2 seconds
    expect(estimateNarrationDuration('one two three four five')).toBeCloseTo(2);
  });

  it('accepts custom rate', () => {
    // 5 words at 5 wps = 1 second
    expect(estimateNarrationDuration('one two three four five', 5)).toBeCloseTo(1);
  });
});

// ── readingTime ────────────────────────────────────────────────────

describe('estimateReadingTime', () => {
  it('estimates 200-word text at 1 minute', () => {
    const text = Array(200).fill('word').join(' ');
    const result = estimateReadingTime(text);
    expect(result.words).toBe(200);
    expect(result.minutes).toBeCloseTo(1);
    expect(result.seconds).toBe(60);
  });

  it('respects custom WPM', () => {
    const text = Array(100).fill('word').join(' ');
    const result = estimateReadingTime(text, { wordsPerMinute: 100 });
    expect(result.minutes).toBeCloseTo(1);
  });

  it('returns 0 for empty text', () => {
    const result = estimateReadingTime('');
    expect(result.words).toBe(0);
    expect(result.seconds).toBe(0);
  });
});

describe('estimateNarrationTime', () => {
  it('accounts for number expansion', () => {
    const plain = estimateNarrationTime('five words in this text');
    const withNum = estimateNarrationTime('In 1910 there were 50 houses');
    // Numbers add more spoken-word equivalents
    expect(withNum.spokenWords).toBeGreaterThan(plain.spokenWords);
  });

  it('returns reasonable seconds', () => {
    const result = estimateNarrationTime('one two three four five');
    expect(result.seconds).toBe(2); // 5 words / 2.5 wps = 2s
  });
});

describe('DEFAULT_WORDS_PER_SECOND', () => {
  it('is 2.5', () => {
    expect(DEFAULT_WORDS_PER_SECOND).toBe(2.5);
  });
});
