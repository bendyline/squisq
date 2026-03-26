import type { TransformStyleConfig } from '../types.js';

/** Conservative style — sparse highlights, preserves most text as-is. */
export const documentaryStyle: TransformStyleConfig = {
  id: 'documentary',
  name: 'Documentary',
  description: 'Conservative — highlights only the strongest stats, dates, and quotes',
  minConfidence: 0.5,
  transformRatio: 0.3,
  preferredTypes: ['stat', 'date', 'quote', 'fact'],
  colorSchemes: ['blue', 'green', 'purple'],
  insertSectionHeaders: false,
  interleaveImages: true,
  blocksPerSection: { min: 1, max: 3 },
  transitionStyle: 'fade',
};
