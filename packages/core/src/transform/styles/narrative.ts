import type { TransformStyleConfig } from '../types.js';

/** Timeline-focused — emphasizes dates, quotes, and story arc. */
export const narrativeStyle: TransformStyleConfig = {
  id: 'narrative',
  name: 'Narrative',
  description: 'Story-driven with timeline events, quotes, and impact moments',
  minConfidence: 0.4,
  transformRatio: 0.5,
  preferredTypes: ['date', 'quote', 'impactLine', 'fact', 'stat'],
  colorSchemes: ['blue', 'purple', 'green'],
  insertSectionHeaders: true,
  interleaveImages: true,
  blocksPerSection: { min: 1, max: 4 },
  transitionStyle: 'fade',
};
