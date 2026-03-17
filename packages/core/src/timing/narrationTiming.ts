/**
 * Narration timing estimation.
 *
 * Estimates how long text takes to speak aloud, accounting for:
 * - Numbers spoken as multiple words (e.g., "1910" → "nineteen ten")
 * - Pauses at commas
 * - Year pronunciation conventions (1000–2099)
 *
 * Ported from qualla-internal's AudioTiming.ts (pure functions, no Node.js deps).
 */

/** Numbers are spoken more slowly than regular words (1.3× multiplier). */
const NUMBER_SPEAKING_MULTIPLIER = 1.3;

/** Comma pause in "word equivalents" — speakers pause ~0.3 words at commas. */
const COMMA_PAUSE_PENALTY = 0.3;

/** Default speaking rate in words per second (~150 WPM). */
export const DEFAULT_WORDS_PER_SECOND = 2.5;

/**
 * Estimate how many "spoken word equivalents" a single token represents.
 * Numbers get expanded (e.g., "175,000" → ~5 words × 1.3 multiplier).
 */
export function estimateSpokenWordCount(token: string): number {
  const cleaned = token.replace(/,/g, '');
  const num = parseFloat(cleaned);

  if (isNaN(num) || !isFinite(num)) {
    return 1; // Not a number — count as 1 word
  }

  return estimateNumberWordCount(cleaned, num) * NUMBER_SPEAKING_MULTIPLIER;
}

/**
 * Raw word count for a number (before the speaking multiplier).
 */
function estimateNumberWordCount(cleaned: string, num: number): number {
  // Handle decimals: "3.14" → words("3") + "point" + 2 digits
  if (cleaned.includes('.')) {
    const [whole, decimal] = cleaned.split('.');
    const wholeNum = parseFloat(whole) || 0;
    return estimateNumberWordCount(whole, wholeNum) + 1 + decimal.length;
  }

  const absNum = Math.abs(num);
  let words = num < 0 ? 1 : 0; // "negative" / "minus"

  if (absNum === 0) return 1; // "zero"

  // Years (1000–2099) are spoken as two two-digit groups:
  // "1910" → "nineteen ten", "2024" → "twenty twenty-four"
  if (absNum >= 1000 && absNum <= 2099 && Number.isInteger(absNum)) {
    const yearStr = absNum.toString();
    if (yearStr.length === 4) {
      const firstTwo = parseInt(yearStr.slice(0, 2));
      const lastTwo = parseInt(yearStr.slice(2));

      // First part
      if (firstTwo >= 10 && firstTwo <= 19) {
        words += 1;
      } else if (firstTwo >= 20 && firstTwo <= 99) {
        words += firstTwo % 10 === 0 ? 1 : 2;
      } else {
        words += 2; // "two thousand"
      }

      // Second part
      if (lastTwo === 0) {
        if (firstTwo >= 10 && firstTwo <= 99 && firstTwo !== 20) {
          words += 1; // "hundred"
        }
      } else if (lastTwo >= 1 && lastTwo <= 9) {
        words += 2; // "oh five"
      } else if (lastTwo >= 10 && lastTwo <= 19) {
        words += 1;
      } else {
        words += lastTwo % 10 === 0 ? 1 : 2;
      }

      return Math.max(words, 2);
    }
  }

  // General number handling — each magnitude group adds words
  let remaining = absNum;

  if (remaining >= 1_000_000_000) {
    const billions = Math.floor(remaining / 1_000_000_000);
    words += estimateNumberWordCount(String(billions), billions);
    words += 1; // "billion"
    remaining %= 1_000_000_000;
  }

  if (remaining >= 1_000_000) {
    const millions = Math.floor(remaining / 1_000_000);
    words += estimateNumberWordCount(String(millions), millions);
    words += 1; // "million"
    remaining %= 1_000_000;
  }

  if (remaining >= 1_000) {
    const thousands = Math.floor(remaining / 1_000);
    words += estimateNumberWordCount(String(thousands), thousands);
    words += 1; // "thousand"
    remaining %= 1_000;
  }

  if (remaining >= 100) {
    words += 2; // digit + "hundred"
    remaining %= 100;
  }

  if (remaining >= 1) {
    if (remaining >= 20) {
      words += remaining % 10 === 0 ? 1 : 2;
    } else {
      words += 1; // 1–19
    }
  }

  return Math.max(words, 1);
}

/**
 * Count "spoken word equivalents" in a block of text,
 * expanding numbers and adding comma pauses.
 */
export function countSpokenWords(text: string): number {
  const tokens = text.split(/\s+/).filter((w) => w.length > 0);
  let count = 0;

  for (const token of tokens) {
    // Strip punctuation only at token boundaries so internal punctuation
    // (e.g., decimals like "3.14" or digit-grouping commas "1,000") is preserved.
    const stripped = token.replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '');
    count += estimateSpokenWordCount(stripped);

    // Count only punctuation commas for pauses: exclude digit-grouping commas
    // (i.e., commas with digits on both sides, like in "1,234").
    let punctuationCommaCount = 0;
    for (let i = 0; i < token.length; i++) {
      if (token[i] === ',') {
        const prev = i > 0 ? token[i - 1] : '';
        const next = i < token.length - 1 ? token[i + 1] : '';
        const prevIsDigit = prev >= '0' && prev <= '9';
        const nextIsDigit = next >= '0' && next <= '9';
        if (!(prevIsDigit && nextIsDigit)) {
          punctuationCommaCount++;
        }
      }
    }
    count += punctuationCommaCount * COMMA_PAUSE_PENALTY;
  }

  return count;
}

/**
 * Estimate audio time at a character offset using word-proportion mapping.
 *
 * Given the full source text and a character position, returns the
 * estimated time (in seconds) at which that position would be spoken.
 *
 * @param text - Full source text
 * @param charOffset - Character offset to estimate timing for
 * @param totalDuration - Total audio duration in seconds
 * @returns Estimated time in seconds
 */
export function estimateTimeFromText(
  text: string,
  charOffset: number,
  totalDuration: number,
): number {
  const textBefore = text.slice(0, charOffset);
  const spokenWordsBefore = countSpokenWords(textBefore);
  const totalSpokenWords = countSpokenWords(text);

  if (totalSpokenWords === 0) return 0;
  return (spokenWordsBefore / totalSpokenWords) * totalDuration;
}

/**
 * Estimate how long a spoken prefix adds to audio duration.
 *
 * When audio includes a spoken title or header before the main content,
 * this calculates the extra duration to offset timing calculations.
 *
 * @param prefix - Prefix text (e.g., an article title spoken before the body)
 * @param wordsPerSecond - Speaking rate (default: 2.5)
 * @returns Estimated duration in seconds
 */
export function calculatePrefixDuration(
  prefix: string,
  wordsPerSecond: number = DEFAULT_WORDS_PER_SECOND,
): number {
  if (!prefix) return 0;

  const words = prefix.split(/\s+/).filter((w) => w.length > 0);
  const newlineCount = (prefix.match(/\n\n/g) || []).length;
  const pauseTime = newlineCount * 0.5;

  return words.length / wordsPerSecond + pauseTime;
}

/**
 * Estimate narration duration for a block of text.
 *
 * @param text - The text to estimate
 * @param wordsPerSecond - Speaking rate (default: 2.5, i.e. ~150 WPM)
 * @returns Duration in seconds
 */
export function estimateNarrationDuration(
  text: string,
  wordsPerSecond: number = DEFAULT_WORDS_PER_SECOND,
): number {
  const spokenWords = countSpokenWords(text);
  return spokenWords / wordsPerSecond;
}
