/**
 * Canonical Monaco entry for squisq — and for apps downstream of it.
 *
 * Anything that needs Monaco (squisq's own RawEditor via {@link useMonacoLoader},
 * or a downstream app that wants its own editor) should get it from *here*
 * rather than importing `monaco-editor` directly. That guarantees a single
 * shared instance — one language / theme / completion-provider registry — and
 * gives squisq one place to decide which slice of Monaco ships. Downstream
 * hosts therefore need no bundler aliasing or hand-rolled "slim" Monaco entry
 * (getting that recipe wrong silently breaks features like the suggest widget).
 *
 * This is the FULL editor. `editor.main.js` pulls in:
 *   - every editor-feature contribution — the suggest-widget controller
 *     (completion popups), hover, folding, find, parameter hints, bracket
 *     matching, …
 *   - TM grammars for ~70 languages (syntax highlighting in fenced code), and
 *   - the rich css / html / json / typescript language *services*.
 *
 * `editor.main.js` has no sibling `.d.ts` (only `editor.api.d.ts` is
 * published), so we take the types from `editor.api`: the side-effect import
 * registers all the contributions, and the re-export exposes the — now
 * augmented — API surface. Both reference the same underlying singleton.
 *
 * NOTE: the language *services* (css/html/json/typescript) need Monaco web
 * workers wired via `globalThis.MonacoEnvironment`. Without that host-side
 * setup their in-editor IntelliSense stays dormant — but highlighting,
 * editing, and custom completion providers (e.g. the `{[template]}` typeahead)
 * all run on the main thread and work with no worker configuration.
 */

// Side-effect: register the full editor + all language contributions.
import 'monaco-editor/esm/vs/editor/editor.main.js';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { registerJsoncLanguage } from './monacoJsonc.js';

// Monaco's rich JSON service intentionally uses the `json` id for both JSON
// and JSON-with-comments. Register a lightweight `jsonc` tokenizer as well so
// Markdown's dynamic fenced-code embedding (` ```jsonc `) can resolve that id
// and apply JSON-style highlighting in the raw editor.
registerJsoncLanguage(monaco);

// Typed API surface (the only barrel Monaco publishes declarations for).
export * from 'monaco-editor/esm/vs/editor/editor.api.js';
