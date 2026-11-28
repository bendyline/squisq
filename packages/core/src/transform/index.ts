export { applyTransform } from './applyTransform.js';
export { transformNarratedSegment } from './narratedSegment.js';
export { allocateTiming } from './timingAllocator.js';
export type {
  NarratedSegmentInput,
  NarratedSegmentResult,
  NarratedSegmentTransformOptions,
  NarratedSegmentVideo,
} from './narratedSegment.js';
export { createTransformStyleRegistry } from './registry.js';

export {
  resolveTransformStyle,
  getTransformStyleIds,
  getTransformStyleSummaries,
  DEFAULT_TRANSFORM_STYLE_ID,
} from './registry.js';

export type {
  TransformStyleId,
  TransformStyleInput,
  TransformStyleSummary,
  TransformStyleConfig,
  TransformStyleRegistry,
  TransformImage,
  TransformOptions,
  TransformResult,
} from './types.js';

export type { AnalyzedBlock, BlockImage } from './blockAnalyzer.js';
export { analyzeBlocks, extractDocImages } from './blockAnalyzer.js';

export * from './presentationPlan.js';
export {
  createPresentationPlan,
  createPresentationPlanReport,
  presentationSlideCounts,
  bindPresentationDesigns,
  presentationSlideStarts,
  withSlideStarts,
  type PresentationDesignBinding,
  type PresentationDesignSection,
  type PresentationPlanReport,
  type PresentationRollup,
  type PresentationRollupProblem,
} from './presentationPlanner.js';
export { compilePresentationPlan, applySavedPresentation } from './presentationCompiler.js';
export {
  collectPresentationMedia,
  type PresentationMediaItem,
  type PresentationNodeMediaItem,
  type PresentationBlockMediaItem,
} from './presentationMedia.js';

export * from './presentationHints.js';
export * from './presentationHintsDoc.js';
export * from './presentationHintsSource.js';

export * from './grounding.js';
// The protocol a model follows to word a deck: prompts, reply shapes, and the gates on a reply.
export * from './presentationAuthor.js';
// The loop that runs that protocol; a host supplies only the transport.
export * from './presentationWording.js';
// The model transport the authoring protocols share (study cards are `@bendyline/squisq/study`).
export * from './authorModel.js';
export * from './conceptReveal.js';
// What a slide shows of a long passage: its key points, chosen without a model.
export {
  KEY_POINT_CHARACTERS,
  divideSection,
  keyPointText,
  keySentences,
  sectionSlideCount,
  type KeySentence,
  type KeySentenceContext,
  type SlideStart,
} from './keyPoints.js';
