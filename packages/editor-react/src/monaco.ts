/**
 * Canonical Monaco entry for Squisq and downstream hosts.
 *
 * This entry deliberately avoids Monaco's `editor.main.js` and
 * `editor.all.js` barrels. It registers the compact editing feature profile
 * used by every Squisq editor. Language grammars and worker-backed services
 * are loaded on demand through `loadMonacoLanguages`, so a Markdown source
 * view does not initialize an IDE's worth of unrelated features and languages.
 *
 * Rich CSS/HTML/JSON/JavaScript/TypeScript services still need workers wired
 * through `configureMonacoWorkers`. Syntax highlighting, editing, and Squisq's
 * custom completion providers do not start those workers.
 */

import './monacoFeatures.js';

// Typed API surface (the only barrel Monaco publishes declarations for).
export * from 'monaco-editor/esm/vs/editor/editor.api.js';
export {
  monacoLanguageRequestKey,
  monacoLanguagesForDocument,
  normalizeMonacoLanguage,
} from './monacoLanguageDetection.js';
export { loadMonacoLanguages } from './monacoLanguages.js';

/** Load Monaco's completion/snippet UI without placing it in the editor core. */
export async function loadMonacoSuggestions(): Promise<void> {
  await import('./monacoSuggestions.js');
}
export type {
  MonacoLanguageLoadOptions,
  MonacoLanguageRequest,
} from './monacoLanguageDetection.js';
