export * from './templates/index.js';
export * from './utils/animationUtils.js';
export * from './utils/themeUtils.js';
export * from './utils/applyRenderStyle.js';
export * from './utils/imageTreatment.js';
export * from './utils/diagramText.js';
export * from './templateInputs.js';
export * from './coverSlideSettings.js';
export * from './utils/shapeGeometry.js';
export {
  markdownToDoc,
  flattenBlocks,
  flattenRenderableBlocks,
  countBlocks,
  getBlockDepth,
  getBlockBodyText,
  getPinnedBlockMeta,
} from './markdownToDoc.js';
export type { MarkdownToDocOptions } from './markdownToDoc.js';
export { docToMarkdown } from './docToMarkdown.js';
export { buildPreviewDoc, documentTitleFromFileName } from './buildPreviewDoc.js';
export type { BuildPreviewDocOptions } from './buildPreviewDoc.js';
export {
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
export {
  materializePageSection,
  materializePageSections,
  resolvePageStyle,
} from './page/materializePageSection.js';
export type {
  MaterializePageSectionOptions,
  MaterializePageSectionsOptions,
  PageTransformHints,
} from './page/materializePageSection.js';
export { isTemplatedPageBlock, resolvePageBlock } from './page/resolvePageBlock.js';
export type { ResolvedPageBlock } from './page/resolvePageBlock.js';
export { sectionExtractors } from './page/sectionExtractors.js';
export type {
  PageSectionContext,
  PageSectionDraft,
  SectionExtractor,
} from './page/sectionExtractors.js';
export type {
  PageMedia,
  PageRichText,
  PageSection,
  PageSectionDiagnostic,
  PageSectionItem,
  PageSectionMaterialization,
  PageSectionSource,
  PageSpatialKind,
} from './page/PageSection.js';
export {
  PAGE_BASE_CSS,
  buildPageCss,
  buildPageCssVars,
  pageStyleDataAttributes,
} from './pageCss.js';
export {
  layoutCapacity,
  resolveLayoutCells,
  transposeCells,
  validateDashboardLayoutDefinition,
} from './dashboard/DashboardLayout.js';
export type {
  DashboardCellDefinition,
  DashboardLayoutDefinition,
  DashboardLayoutValidationError,
  DashboardLayoutValidationResult,
  DashboardTitleSlotDefinition,
  ResolvedDashboardCell,
} from './dashboard/DashboardLayout.js';
export {
  BUILTIN_DASHBOARD_LAYOUTS,
  getDashboardLayoutSummaries,
  listDashboardLayouts,
} from './dashboard/builtinDashboardLayouts.js';
export type { DashboardLayoutSummary } from './dashboard/builtinDashboardLayouts.js';
export {
  DASHBOARD_AUTO_LAYOUT_ID,
  chooseDashboardLayout,
  resolveDashboardLayoutDefinition,
} from './dashboard/chooseDashboardLayout.js';
export {
  DASHBOARD_FRONTMATTER_KEYS,
  DEFAULT_DASHBOARD_SETTINGS,
  resolveDashboardSettings,
} from './dashboard/dashboardSettings.js';
export type {
  DashboardSettings,
  DashboardSettingsOverrides,
} from './dashboard/dashboardSettings.js';
export {
  DASHBOARD_STYLE_IDS,
  DASHBOARD_STYLES,
  DEFAULT_DASHBOARD_STYLE,
  buildDashboardCellChrome,
  dashboardCanvasFill,
  dashboardCellAccent,
  resolveDashboardStyleId,
  stripBlockBackdropLayer,
  stripsBlockBackdrop,
} from './dashboard/dashboardStyle.js';
export type {
  DashboardCellChrome,
  DashboardStyleId,
  DashboardStyleSummary,
} from './dashboard/dashboardStyle.js';
export {
  FRONTMATTER_DASHBOARD_LAYOUTS_KEY,
  readDashboardLayoutsFromFrontmatter,
  writeDashboardLayoutsToFrontmatter,
} from './dashboard/dashboardLayoutsFrontmatter.js';
export {
  DASHBOARD_ZOOM_LEVELS,
  desiredCellZoom,
  normalizeDashboardZoom,
  resolveDashboardZooms,
} from './dashboard/dashboardZoom.js';
export type {
  DashboardZoomCandidate,
  DashboardZoomLevel,
  DashboardZoomMode,
} from './dashboard/dashboardZoom.js';
export { composeDashboardLayers, materializeDashboard } from './dashboard/materializeDashboard.js';
export type {
  DashboardCell,
  DashboardCellFrame,
  DashboardDiagnostic,
  DashboardMaterialization,
  DashboardRectPct,
  DashboardTitle,
  MaterializeDashboardOptions,
} from './dashboard/materializeDashboard.js';
export { resolveAudioMapping, scoreTextSimilarity } from './audioMapping.js';
export { applyNarrationTiming, type NarrationResolution } from './applyNarrationTiming.js';
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
export {
  ASCII_CHAR_H,
  ASCII_CHAR_W,
  ASCII_DIAGRAM_FENCE_LANGS,
  asciiCellToCanvas,
  asciiDiagramFromBlocks,
  asciiDiagramFromTemplateData,
  asciiDiagramToTemplateData,
  canvasToAsciiCell,
  detectAsciiDiagram,
  isAsciiDiagramFence,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
  isRepairableDiagram,
  parseAsciiDiagram,
  renderAsciiDiagram,
  repairAsciiDiagram,
} from './asciiDiagram/index.js';
export type {
  AsciiDiagram,
  AsciiDiagramDetection,
  AsciiDiagramEdge,
  AsciiDiagramNode,
  RenderAsciiDiagramOptions,
  RepairResult,
} from './asciiDiagram/index.js';
export {
  ASCII_TIMELINE_FENCE_LANGS,
  asciiTimelineToTemplateData,
  detectAsciiTimeline,
  isAsciiTimelineFence,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
  isWrappedFlowTimelineSource,
  parseAsciiTimeline,
  parseAsciiTimelineWithStats,
  parseWrappedFlowTimeline,
  renderAsciiTimeline,
} from './asciiTimeline/index.js';
export type {
  AsciiTimeline,
  AsciiTimelineDetection,
  AsciiTimelineEvent,
  AsciiTimelineLink,
  AsciiTimelineMarker,
  AsciiTimelineSide,
  AsciiTimelineStats,
  AsciiTimelineStyle,
  AsciiTimelineTrack,
  DetectAsciiTimelineOptions,
  RenderAsciiTimelineOptions,
} from './asciiTimeline/index.js';
export {
  TREE_FENCE_LANGS,
  detectTree,
  findFirstList,
  isEligibleTreeFenceLang,
  isExplicitTreeLang,
  isTreeFence,
  parseTree,
  renderTree,
  treeFromMarkdownList,
  treeFromTemplateData,
  treeToTemplateData,
} from './treeview/index.js';
export type {
  RenderTreeOptions,
  Tree,
  TreeDetection,
  TreeItem,
  TreeNode,
} from './treeview/index.js';
