import type { TransformStyleConfig } from '../types.js';

/** One slide per heading, with only that section's visual features. */
export const headingsAndFeaturesStyle: TransformStyleConfig = {
  id: 'headings-and-features',
  name: 'Headings and features',
  description: 'Headings with their images, videos, and diagrams; no body prose',
  contentMode: 'headings-and-features',
  minConfidence: 1,
  transformRatio: 0,
  preferredTypes: [],
  colorSchemes: ['blue', 'green'],
  insertSectionHeaders: false,
  interleaveImages: false,
  blocksPerSection: { max: 1 },
  transitionStyle: 'fade',
  page: { spacing: 'generous', emphasisCurve: 'even' },
};
