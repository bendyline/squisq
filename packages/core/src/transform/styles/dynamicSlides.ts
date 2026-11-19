import type { TransformStyleConfig } from '../types.js';
/**
 * Generated from current prose on every projection; only author hints are durable.
 *
 * Shown to authors as **Custom**: the style whose slides they can adjust one by
 * one. The id stays `dynamic-slides`, because documents persist it in
 * `squisq-transform` and the presentation pipeline keys on it.
 */
export const dynamicSlidesStyle: TransformStyleConfig = {
  id: 'dynamic-slides',
  name: 'Custom',
  description:
    'Concise slides and diagrams generated from your text, which you can adjust slide by slide',
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
