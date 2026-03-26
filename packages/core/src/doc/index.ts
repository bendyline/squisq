export * from './templates/index.js';
export * from './utils/animationUtils.js';
export * from './utils/themeUtils.js';
export { markdownToDoc, flattenBlocks, countBlocks, getBlockDepth } from './markdownToDoc.js';
export type { MarkdownToDocOptions } from './markdownToDoc.js';
export { docToMarkdown } from './docToMarkdown.js';
export { getLayers } from './getLayers.js';
export type { RenderContext } from './getLayers.js';
export { resolveAudioMapping, scoreTextSimilarity } from './audioMapping.js';
