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

export type { BlockContentProfile, RecommendationResult } from './templates.js';
export { profileBlockContents, recommendTemplatesForBlock } from './templates.js';
