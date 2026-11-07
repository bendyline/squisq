/**
 * Line breaks for text written without spaces.
 *
 * The PDF writer wraps at whitespace. Chinese and Japanese have none between
 * words: a line may break between any two of their characters, except that
 * closing punctuation (and Japanese small kana and the long-vowel mark) may
 * not begin a line, and opening punctuation may not end one.
 */

/** Chinese and Japanese characters, which a line may break between. */
const BREAKS_BETWEEN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u;
/** Punctuation and small kana that may not begin a line. */
const NO_LINE_START =
  /[.,!?;:)\]}、。，．：；！？）］｝」』】〉》〕・ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/u;
/** Punctuation that may not end a line. */
const NO_LINE_END = /[（［｛「『【〈《〔]/u;

/**
 * A space-free word cut at every place a line may break inside it. A word
 * with no Chinese or Japanese comes back whole.
 */
export function breakBetweenCjk(word: string): string[] {
  if (!BREAKS_BETWEEN.test(word)) return [word];
  const pieces: string[] = [];
  let piece = '';
  let previousBreaks = false;
  let previousOpens = false;
  for (const ch of word) {
    const breaks = BREAKS_BETWEEN.test(ch);
    if (piece && (breaks || previousBreaks) && !previousOpens && !NO_LINE_START.test(ch)) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
    previousBreaks = breaks;
    previousOpens = NO_LINE_END.test(ch);
  }
  if (piece) pieces.push(piece);
  return pieces;
}
