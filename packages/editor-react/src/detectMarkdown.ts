/**
 * Markdown detection — heuristic for spotting markdown source in pasted text.
 *
 * Used by the WYSIWYG editor's paste handler to decide whether plain-text
 * paste content should be parsed as markdown rather than inserted literally.
 *
 * The heuristic prefers false negatives (treating markdown as plain text)
 * over false positives (mangling plain text that happens to contain a few
 * special characters).
 */

/** Block-level patterns that strongly indicate markdown. Any one is enough. */
const STRONG_BLOCK_PATTERNS: RegExp[] = [
  /^#{1,6}\s+\S/, // # Heading
  /^[-*+]\s+\S/, // - bullet
  /^\d+\.\s+\S/, // 1. ordered
  /^>\s+\S/, // > blockquote
  /^```/, // ``` code fence
  /^\|.+\|\s*$/, // | table | row |
  /^[-*+]\s+\[[ xX]\]\s+/, // - [ ] task
];

/** Inline patterns that are weaker indicators on their own. */
const INLINE_PATTERNS: RegExp[] = [
  /\*\*[^*\n]+\*\*/, // **bold**
  /__[^_\n]+__/, // __bold__
  /`[^`\n]+`/, // `code`
  /\[[^\]\n]+\]\([^)\n]+\)/, // [link](url)
  /!\[[^\]\n]*\]\([^)\n]+\)/, // ![image](url)
  /~~[^~\n]+~~/, // ~~strike~~
];

/**
 * Returns true if the text looks like markdown source.
 *
 * Detection rules:
 *  - Any line matching a strong block pattern → yes
 *  - Two or more inline pattern matches anywhere in the text → yes
 *  - Otherwise → no
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 2) return false;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const re of STRONG_BLOCK_PATTERNS) {
      if (re.test(trimmed)) return true;
    }
  }

  let inlineHits = 0;
  for (const re of INLINE_PATTERNS) {
    if (re.test(text)) {
      inlineHits++;
      if (inlineHits >= 2) return true;
    }
  }

  return false;
}
