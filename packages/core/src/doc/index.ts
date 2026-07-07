export * from './templates/index.js';
export * from './utils/animationUtils.js';
export * from './utils/themeUtils.js';
export * from './utils/applyRenderStyle.js';
export * from './utils/imageTreatment.js';
export * from './templateInputs.js';
export * from './utils/shapeGeometry.js';
export {
  markdownToDoc,
  flattenBlocks,
  flattenRenderableBlocks,
  countBlocks,
  getBlockDepth,
} from './markdownToDoc.js';
export type { MarkdownToDocOptions } from './markdownToDoc.js';
export { docToMarkdown } from './docToMarkdown.js';
export {
  encodeLayersForFrontmatter,
  decodeLayersFromFrontmatter,
  readCustomTemplatesFromFrontmatter,
  writeCustomTemplatesToFrontmatter,
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
} from './customTemplatesFrontmatter.js';
export {
  readCustomThemesFromFrontmatter,
  writeCustomThemesToFrontmatter,
  FRONTMATTER_CUSTOM_THEMES_KEY,
} from './customThemesFrontmatter.js';
export { resolveThemeForDoc } from './resolveDocTheme.js';
export { getLayers } from './getLayers.js';
export type { RenderContext } from './getLayers.js';
export { resolveAudioMapping, scoreTextSimilarity } from './audioMapping.js';
export {
  isDataFence,
  parseDataFence,
  replaceDataFence,
  parseYamlSubset,
  findFirstTable,
  extractTableData,
} from './structuredData.js';
export type { DataFenceParseResult, ExtractedTableData } from './structuredData.js';
export { validateMarkdownSource, validateMarkdownDoc } from './validate.js';
export type { ValidateOptions, MarkdownValidationResult } from './validate.js';
export { fallbackBlockLayers } from './templates/fallbackBlock.js';
export {
  BASE_INPUT_DESCRIPTORS,
  TEMPLATE_INPUT_DESCRIPTORS,
  coerceTemplateParams,
  lintTemplateParams,
} from './templates/inputDescriptors.js';
export type {
  InputCoercion,
  TemplateInputDescriptor,
  TemplateParamFinding,
} from './templates/inputDescriptors.js';
