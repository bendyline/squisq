/**
 * Reading time estimation.
 *
 * Estimates how long it takes to read text silently vs. narrate it aloud.
 * Uses configurable words-per-minute rates.
 */

import { countSpokenWords, DEFAULT_WORDS_PER_SECOND } from './narrationTiming.js';

/** Default silent reading rate (adults average ~200–250 WPM). */
const DEFAULT_READING_WPM = 200;

/** Result of a reading-time estimate. */
export interface ReadingTimeEstimate {
  /** Number of words (plain word count, not spoken equivalents). */
  words: number;
  /** Estimated minutes (decimal). */
  minutes: number;
  /** Estimated seconds (rounded). */
  seconds: number;
}

/** Options for reading-time estimation. */
export interface ReadingTimeOptions {
  /** Words per minute for silent reading (default: 200). */
  wordsPerMinute?: number;
}

/**
 * Estimate silent reading time for a block of text.
 *
 * @param text - The text to estimate
 * @param options - Optional configuration
 * @returns Word count + time estimate
 */
export function estimateReadingTime(
  text: string,
  options?: ReadingTimeOptions,
): ReadingTimeEstimate {
  const configuredWpm = options?.wordsPerMinute;
  const wpm =
    typeof configuredWpm === 'number' && configuredWpm > 0 ? configuredWpm : DEFAULT_READING_WPM;
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  const minutes = words / wpm;

  return {
    words,
    minutes,
    seconds: Math.round(minutes * 60),
  };
}

/** Result of a narration-time estimate. */
export interface NarrationTimeEstimate {
  /** Spoken word equivalents (numbers expanded, comma pauses added). */
  spokenWords: number;
  /** Estimated minutes (decimal). */
  minutes: number;
  /** Estimated seconds (rounded). */
  seconds: number;
}

/** Options for narration-time estimation. */
export interface NarrationTimeOptions {
  /** Words per second for narration (default: 2.5 ≈ 150 WPM). */
  wordsPerSecond?: number;
}

/**
 * Estimate narration (spoken) time for a block of text.
 *
 * Unlike silent reading, this accounts for numbers being spoken as
 * multiple words and pauses at commas.
 *
 * @param text - The text to estimate
 * @param options - Optional configuration
 * @returns Spoken word equivalents + time estimate
 */
export function estimateNarrationTime(
  text: string,
  options?: NarrationTimeOptions,
): NarrationTimeEstimate {
  const providedWps = options?.wordsPerSecond;
  const wps =
    typeof providedWps === 'number' && providedWps > 0 ? providedWps : DEFAULT_WORDS_PER_SECOND;
  const spokenWords = countSpokenWords(text);
  const totalSeconds = spokenWords / wps;

  return {
    spokenWords,
    minutes: totalSeconds / 60,
    seconds: Math.round(totalSeconds),
  };
}
