/**
 * Public exports for the custom-template designer + runtime.
 *
 * The host editor consumes these in three places:
 *   - `<CustomTemplateProvider>` wraps the editor so the picker and
 *     designer can read/write doc + library template lists.
 *   - `<TemplateThumbnail>` renders the small icon shown on each
 *     custom template's picker card.
 *   - `<TemplateDesigner>` is the modal Scene-backed editor opened by
 *     the picker's "+ New custom template" card. (Coming in step 10.)
 */

export {
  CustomTemplateProvider,
  useCustomTemplates,
  type CustomTemplateContextValue,
  type CustomTemplateProviderProps,
} from './CustomTemplateContext';
export { TemplateThumbnail } from './thumbnail';
export {
  listLibraryTemplates,
  saveLibraryTemplate,
  deleteLibraryTemplate,
  clearLibrary,
  LIBRARY_STORAGE_KEY,
} from './library';
export { TemplateDesigner, type DesignerSaveTarget } from './TemplateDesigner';
export { CustomLayoutManager, type CustomLayoutManagerProps } from './CustomLayoutManager';
export { useDocCustomTemplates, type DocCustomTemplates } from './useDocCustomTemplates';
export { useMemoryLayerAdapter, applyCommand } from './useMemoryLayerAdapter';
export { normalizePositions } from './normalizePositions';
