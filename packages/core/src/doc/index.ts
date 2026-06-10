export * from './templates/index.js';
export * from './utils/animationUtils.js';
export * from './utils/themeUtils.js';
export { markdownToDoc, flattenBlocks, countBlocks, getBlockDepth } from './markdownToDoc.js';
export type { MarkdownToDocOptions } from './markdownToDoc.js';
export { docToMarkdown } from './docToMarkdown.js';
export {
  encodeLayersForFrontmatter,
  decodeLayersFromFrontmatter,
  readCustomTemplatesFromFrontmatter,
  writeCustomTemplatesToFrontmatter,
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
} from './customTemplatesFrontmatter.js';
export { getLayers } from './getLayers.js';
export type { RenderContext } from './getLayers.js';
export { resolveAudioMapping, scoreTextSimilarity } from './audioMapping.js';
export {
  isDataFence,
  parseDataFence,
  parseYamlSubset,
  findFirstTable,
  extractTableData,
} from './structuredData.js';
export type { DataFenceParseResult, ExtractedTableData } from './structuredData.js';
export { validateMarkdownSource, validateMarkdownDoc } from './validate.js';
export type { ValidateOptions, MarkdownValidationResult } from './validate.js';
export { fallbackBlockLayers } from './templates/fallbackBlock.js';
