/**
 * Matches a prominent number suitable for a Stat Highlight block. Qualifies
 * on currency prefixes, common unit suffixes, and standalone large numbers.
 * Plain small numbers (`42`) intentionally do not qualify.
 */
// A unit must end its word: "62 by 70 miles" is not "62 b(illion)". A large
// number standing alone must be a whole one, not one side of a dimension
// ("69 by 190 miles" is an orbit, not the figure 190), and a multiplier is
// not a dimension ("2x faster", but not "1920 x 1080").
const NUMBER_HIGHLIGHT_RE =
  /(?:[$€£¥]\s?\d+(?:[.,]\d+)*(?:\s?(?:[MBK]|million|billion|thousand)(?![a-z]))?|\d+(?:[.,]\d+)*\s?(?:%|‰|(?:x|×)(?!\s?\d)|[MBK]|million|billion|thousand|percent|times|years?|days?|hours?)(?![a-z])|(?<![\d.,])(?<!\d\s?(?:by|x|×)\s?)(?:\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d+)?(?![\d.,]?\d)(?!\s?(?:by|x|×)\s?\d))/i;

/** A prominent number found inside a short stat-like string. */
export interface NumberHighlightMatch {
  value: string;
  index: number;
  end: number;
}

/** Find the prominent number phrase inside a string, if one exists. */
export function matchNumberHighlight(text: string): NumberHighlightMatch | null {
  const match = NUMBER_HIGHLIGHT_RE.exec(text);
  if (!match || match.index === undefined) return null;
  return {
    value: match[0],
    index: match.index,
    end: match.index + match[0].length,
  };
}
