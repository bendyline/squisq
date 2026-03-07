/**
 * Caption Utilities
 *
 * Shared text cleaning for image captions displayed on doc blocks.
 * Strips trailing punctuation for a cleaner visual presentation.
 */

/**
 * Strip trailing punctuation from a caption string.
 * Image captions on blocks look cleaner without terminal periods,
 * semicolons, or other sentence-ending punctuation.
 */
export function cleanCaption(text: string): string {
  return text.replace(/[.;:!?]+$/, '').trim();
}
