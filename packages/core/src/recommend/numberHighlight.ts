/**
 * Matches a prominent number suitable for a Stat Highlight block. Qualifies
 * on currency prefixes, common unit suffixes, and standalone large numbers.
 * Plain small numbers (`42`) intentionally do not qualify.
 */
const NUMBER_HIGHLIGHT_RE =
  /(?:[$€£¥]\s?\d+(?:[.,]\d+)*(?:\s?(?:[MBK]|million|billion|thousand))?|\d+(?:[.,]\d+)*\s?(?:%|‰|x|×|[MBK]|million|billion|thousand|percent|years?|days?|hours?)|\d{3,}(?:[.,]\d+)*)/i;

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
