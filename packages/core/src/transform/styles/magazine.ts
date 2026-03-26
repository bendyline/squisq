import type { TransformStyleConfig } from '../types.js';

/** Visual variety — pull quotes, definitions, image-heavy layout. */
export const magazineStyle: TransformStyleConfig = {
  id: 'magazine',
  name: 'Magazine',
  description: 'Visual variety with pull quotes, facts, and rich image layouts',
  minConfidence: 0.4,
  transformRatio: 0.6,
  preferredTypes: ['quote', 'fact', 'list', 'definition', 'stat', 'impactLine'],
  colorSchemes: ['blue', 'green', 'purple', 'orange', 'red'],
  insertSectionHeaders: true,
  interleaveImages: true,
  blocksPerSection: { min: 2, max: 5 },
  transitionStyle: 'dissolve',
};
