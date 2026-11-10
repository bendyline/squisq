/**
 * Template recommendations for the editor's block template picker.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from '@bendyline/squisq/markdown';
 * import { profileBlockContents, recommendTemplatesForBlock } from '@bendyline/squisq/recommend';
 *
 * const doc = parseMarkdown(blockBodySource);
 * const profile = profileBlockContents(doc.children);
 * const { recommended, rest } = recommendTemplatesForBlock(profile, ALL_TEMPLATE_NAMES);
 * ```
 */

export type {
  AutoTemplateOptions,
  BlockContentProfile,
  ProfileBlockOptions,
  RecommendationResult,
} from './templates.js';
export { pickAutoTemplate, profileBlockContents, recommendTemplatesForBlock } from './templates.js';
// What a list is a picture of: a process, a cycle, key numbers, a hierarchy…
export type { ListShape, ListShapeInput, ListShapeResult } from './listShape.js';
export { classifyListShape } from './listShape.js';
