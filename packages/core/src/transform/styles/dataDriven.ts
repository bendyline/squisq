import type { TransformStyleConfig } from '../types.js';

/** Numbers-forward — aggressively extracts stats, comparisons, and dates. */
export const dataDrivenStyle: TransformStyleConfig = {
  id: 'data-driven',
  name: 'Data-Driven',
  description: 'Aggressively highlights statistics, comparisons, and timelines',
  minConfidence: 0.3,
  transformRatio: 0.8,
  preferredTypes: ['stat', 'comparison', 'date', 'list', 'fact'],
  colorSchemes: ['blue', 'orange', 'green', 'purple', 'red'],
  insertSectionHeaders: true,
  interleaveImages: false,
  blocksPerSection: { min: 2, max: 6 },
  transitionStyle: 'cut',
};
