/**
 * Deterministic English-oriented syllable estimation.
 *
 * Approximation limits (accepted by design): ±1 on roughly 15% of
 * English words; systematically wrong on loanwords ("cafe", "naive"),
 * some vowel-hiatus words ("create", "quiet"), and non-English text.
 * Every consumer tolerates per-word error — the pacing controller
 * smooths rates and anchors on cumulative sums, and the aligner pays
 * symmetric insert/delete costs — so the estimator only needs to be
 * unbiased on average. Exact outputs are part of the deterministic
 * contract (tests pin a corpus table).
 */

import { estimateSpokenWordCount } from '../timing/narrationTiming.js';

/** Same boundary-punctuation strip as `countSpokenWords`. */
const BOUNDARY_PUNCT = /^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g;

/** Average syllables per spoken word-equivalent when expanding numbers. */
const SYLLABLES_PER_SPOKEN_WORD = 1.4;

/**
 * Estimate the syllable count of a single whitespace-delimited token.
 * Always ≥ 1 for non-empty tokens.
 */
export function estimateSyllables(token: string): number {
  const stripped = token.replace(BOUNDARY_PUNCT, '');
  if (!stripped) return 1;

  // Numeric tokens: expand via the spoken-word estimator ("1910" →
  // "nineteen ten" ≈ 2 spoken words × 1.3 × 1.4 ≈ 4 syllables).
  if (/^[-+]?[\d.,]+$/.test(stripped)) {
    const num = parseFloat(stripped.replace(/,/g, ''));
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      return Math.max(1, Math.round(estimateSpokenWordCount(stripped) * SYLLABLES_PER_SPOKEN_WORD));
    }
  }

  // Vowel-less all-caps runs read as initialisms letter by letter
  // ("HTML" → aitch-tee-em-el ≈ 4). "NASA" has vowels and falls through.
  if (/^[A-Z]{2,5}$/.test(stripped) && !/[AEIOUY]/.test(stripped)) {
    return stripped.length;
  }

  // Hyphenated/slashed compounds: sum the parts ("beam-splitter" → 3).
  const parts = stripped
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return 1;
  let total = 0;
  for (const part of parts) {
    total += countAlphaSyllables(part.replace(/'/g, ''));
  }
  return Math.max(1, total);
}

/** Vowel-group heuristic over a lowercase alphabetic word. */
function countAlphaSyllables(word: string): number {
  if (!word) return 0;
  const groups = word.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 0;
  if (count === 0) return 1;

  if (count > 1 && /[^aeiouy]e$/.test(word)) {
    // Terminal silent e: "table", "whale", "give".
    count -= 1;
  }
  if (count > 1 && /[^aeiouy]ed$/.test(word) && !/[td]ed$/.test(word)) {
    // Past-tense -ed is silent after most consonants ("walked"),
    // syllabic after t/d ("wanted", "loaded").
    count -= 1;
  }
  if (count > 1 && /[^aeiouy]es$/.test(word) && !/(?:[sxz]|[cs]h)es$/.test(word)) {
    // Plural -es is silent after most consonants ("makes"), syllabic
    // after sibilants ("boxes", "riches").
    count -= 1;
  }
  if (/[^aeiouy]le$/.test(word)) {
    // Syllabic -le after a consonant: "table", "little" — restores the
    // syllable the silent-e rule removed. Vowel + "le" ("whale") skips.
    count += 1;
  }
  return Math.max(1, count);
}
