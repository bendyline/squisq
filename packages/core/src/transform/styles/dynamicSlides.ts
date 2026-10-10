import type { TransformStyleConfig } from '../types.js';
/** Generated from current prose on every projection; only author hints are durable. */
export const dynamicSlidesStyle: TransformStyleConfig = {
  id: 'dynamic-slides',
  name: 'Dynamic slides',
  description:
    'Advanced summarization: generate concise slides and diagrams from the current text and your hints',
  contentMode: 'presentation',
  minConfidence: 0.25,
  transformRatio: 1,
  preferredTypes: [],
  colorSchemes: ['blue', 'green', 'orange'],
  insertSectionHeaders: false,
  interleaveImages: false,
  blocksPerSection: { max: 4 },
  transitionStyle: 'fade',
};
