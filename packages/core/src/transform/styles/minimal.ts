import type { TransformStyleConfig } from '../types.js';

/** Short highlights with a bounded fallback for every remaining section. */
export const minimalStyle: TransformStyleConfig = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Short highlights and a single brief line per section',
  contentMode: 'brief',
  minConfidence: 0.6,
  transformRatio: 0.2,
  preferredTypes: ['stat', 'quote'],
  colorSchemes: ['blue', 'green'],
  insertSectionHeaders: false,
  interleaveImages: false,
  blocksPerSection: { max: 1 },
  transitionStyle: 'fade',
  suggestedThemeId: 'minimalist',
  page: { spacing: 'generous', emphasisCurve: 'even' },
};
