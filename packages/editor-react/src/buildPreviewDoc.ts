/**
 * The slideshow projection moved into core (`@bendyline/squisq/doc`) so the
 * exporters — which must not depend on a React package — run the exact same
 * doc → slide sequence the editor preview renders. This module stays as the
 * historical import path for editor-react's own callers.
 */

export {
  buildPreviewDoc,
  documentTitleFromFileName,
  type BuildPreviewDocOptions,
} from '@bendyline/squisq/doc';
