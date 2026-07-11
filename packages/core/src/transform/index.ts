export { applyTransform } from './applyTransform.js';
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
