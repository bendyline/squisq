/**
 * Image-editor primitives: schema re-exports, state helpers, persistence,
 * version history, and SVG → raster export.
 *
 * See `@bendyline/squisq/imageEdit` for the public subpath entry.
 */

// Schema (re-exported from schemas for ergonomic single-import)
export type {
  ImageEditDoc,
  ImageEditLayer,
  ImageEditLayerKind,
  ImageEditCanvas,
  ImageEditMeta,
  EditorLayerMeta,
} from '../schemas/ImageEditDoc.js';

// State helpers
export {
  IMAGE_EDIT_STATE_FILENAME,
  IMAGE_EDIT_ASSETS_PREFIX,
  createEmptyImageEditDoc,
  addLayer,
  removeLayer,
  reorderLayer,
  updateLayer,
  setCanvas,
  touch,
} from './state.js';

// Persistence
export { readImageEditDoc, writeImageEditDoc } from './persistence.js';

// Version paths
export {
  IMAGE_EDIT_VERSIONS_PREFIX,
  IMAGE_EDIT_DEFAULT_BASENAME,
  buildImageEditVersionPath,
  parseImageEditVersionPath,
} from './versionPaths.js';

// Version operations
export {
  saveImageEditVersion,
  listImageEditVersions,
  readImageEditVersion,
  readImageEditVersionText,
  revertToImageEditVersion,
  pruneImageEditVersions,
  coalesceImageEditVersions,
  type SaveImageEditVersionOptions,
  type SaveImageEditVersionResult,
  type RevertImageEditOptions,
} from './versions.js';

// Manager
export {
  ImageEditVersionManager,
  type ImageEditVersionManagerOptions,
} from './ImageEditVersionManager.js';

// Note: shared version types (`Version`, `PrunePolicy`, `CoalesceOptions`)
// are re-exported from `@bendyline/squisq/versions` and the package root.
// Import them from there to avoid duplicating the export surface.

// Export
export {
  exportImageEditDoc,
  type ImageEditExportFormat,
  type ImageEditExportOptions,
} from './export.js';
