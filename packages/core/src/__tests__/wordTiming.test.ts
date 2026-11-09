import { describe, expect, it } from 'vitest';
import { phraseOffset, phraseStartTime, wordTimeAt } from '../timing/wordTiming.js';

// "The island rose. Then the island sank." with a bookmark on every word.
const sourceText = 'The island rose. Then the island sank.';
const words = [...sourceText.matchAll(/\S+/gu)];
const timeline = {
  sourceText,
  bookmarks: words.map((word, index) => ({ charOffset: word.index, time: 1 + index * 0.5 })),
};

describe('word timings', () => {
  it('times a character by the word spoken there, or by the next word', () => {
    const rose = sourceText.indexOf('rose');
    expect(wordTimeAt(timeline.bookmarks, rose)).toBe(2);
    expect(wordTimeAt(timeline.bookmarks, rose, 'next')).toBe(2);
    // Mid-word: the word being spoken, or the one after it.
    expect(wordTimeAt(timeline.bookmarks, rose + 2)).toBe(2);
    expect(wordTimeAt(timeline.bookmarks, rose + 2, 'next')).toBe(2.5);
    expect(wordTimeAt(timeline.bookmarks, sourceText.length, 'next')).toBeUndefined();
    expect(wordTimeAt([], 0)).toBeUndefined();
  });

  it('starts a phrase at its first word, from a given offset, with a lead', () => {
    expect(phraseStartTime(timeline, 'the island')).toBe(3);
    expect(phraseStartTime(timeline, 'island', { from: phraseOffset(timeline, 'Then') })).toBe(3.5);
    expect(phraseStartTime(timeline, 'The island', { lead: 0.2 })).toBe(0.8);
    expect(phraseStartTime(timeline, 'The island', { lead: 5 })).toBe(0);
    expect(phraseStartTime(timeline, 'volcano')).toBeNull();
    expect(phraseOffset(timeline, '')).toBe(-1);
  });
});
