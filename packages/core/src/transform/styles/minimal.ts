import type { TransformStyleConfig } from '../types.js';

/** Light touch — only the highest-confidence items get transformed. */
export const minimalStyle: TransformStyleConfig = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Light touch — only the strongest highlights, mostly text',
  minConfidence: 0.6,
  transformRatio: 0.2,
  preferredTypes: ['stat', 'quote'],
  colorSchemes: ['blue', 'green'],
  insertSectionHeaders: false,
  interleaveImages: false,
  blocksPerSection: { min: 1, max: 2 },
  transitionStyle: 'fade',
};
