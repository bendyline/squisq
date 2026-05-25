/**
 * useMonacoLoader
 *
 * Idempotently dynamic-imports `monaco-editor` and points the
 * `@monaco-editor/react` singleton loader at the bundled copy. Replaces
 * the historical top-of-module `import * as monaco from 'monaco-editor';
 * loader.config({ monaco })` pattern, which forced every consumer of
 * `@bendyline/squisq-editor-react` — including ones that only import
 * `JsonEditor` or a type — to drag in monaco's ~9MB worth of language
 * services and workers at module evaluation time.
 *
 * Hosts that want the smallest possible bundle can keep aliasing
 * `monaco-editor` to a slim entry as before; the behavior is identical
 * once the dynamic import settles.
 *
 * The promise is cached at module scope so the first subscriber
 * anywhere in the app pays the import cost and every later subscriber
 * reuses the same settled value.
 */

import { useEffect, useState } from 'react';
import { loader } from '@monaco-editor/react';

/** In-flight (or settled) dynamic import shared across all callers. */
let monacoPromise: Promise<typeof import('monaco-editor')> | null = null;

/** Settled namespace once the promise resolves — read synchronously by mount-time consumers. */
let monacoNamespace: typeof import('monaco-editor') | null = null;

export interface UseMonacoLoaderResult {
  /** The monaco namespace once loaded, or `null` while the import is in flight. */
  monaco: typeof import('monaco-editor') | null;
  /** Flips to `true` after the import settles. Gate `<Editor>` / `<DiffEditor>` renders on this. */
  ready: boolean;
}

/**
 * Subscribe to the lazy-loaded monaco namespace. The first caller
 * triggers `import('monaco-editor')` and configures the
 * `@monaco-editor/react` loader; subsequent callers receive the same
 * cached value.
 */
export function useMonacoLoader(): UseMonacoLoaderResult {
  const [state, setState] = useState<UseMonacoLoaderResult>(() => ({
    monaco: monacoNamespace,
    ready: monacoNamespace !== null,
  }));

  useEffect(() => {
    if (state.ready) return;
    if (!monacoPromise) {
      // Import the explicit ESM entry file rather than the bare
      // package specifier `'monaco-editor'`. The package's
      // `package.json` has no `main` / no `exports` (only `module`),
      // which trips Vite's strict resolver on both static and
      // dynamic imports of the bare name. Pointing at the file
      // directly — the same path monaco's `module` field points at —
      // turns this into a regular file-path resolve that doesn't
      // care about the manifest's entry fields. Works identically
      // in Vite dev / build, vitest's transform pipeline, and any
      // bundler-using downstream consumer.
      //
      // Use `editor.main.js`, NOT `editor.api.js`. The `api` entry is
      // the bare standalone API with zero language contributions —
      // RawEditor's `defaultLanguage="typescript"` then mounts with
      // no tokenizer registered, and every file renders as
      // undifferentiated foreground text (the regression that surfaced
      // when a `.ts` file in the chat workspace previewer showed up
      // with no syntax coloring). `editor.main.js` re-exports the API
      // and additionally pulls in `basic-languages/monaco.contribution`
      // (TM grammars for ~70 languages) plus the four rich language
      // services (css / html / json / typescript). This is what makes
      // `defaultLanguage` actually do anything. The cost is the language
      // bundle — but since we load it lazily on first EditorShell mount,
      // it stays out of the resolver graph for consumers that only
      // import types or `JsonEditor` from this package.
      // `editor.main.js` ships without a sibling `.d.ts` (only
      // `editor.api.d.ts` is published), so the subpath import doesn't
      // resolve to a declaration file. Suppress the TS7016 and rely on
      // the `as unknown as` cast below — at runtime the namespace shape
      // is a superset of `editor.api`'s, since main re-exports the
      // entire api surface alongside the language contributions.
      monacoPromise = (
        // @ts-expect-error — no .d.ts for editor.main.js subpath
        import('monaco-editor/esm/vs/editor/editor.main.js') as unknown as Promise<
          typeof import('monaco-editor')
        >
      ).then((m) => {
        loader.config({ monaco: m });
        monacoNamespace = m;
        return m;
      });
    }
    let cancelled = false;
    void monacoPromise.then((m) => {
      if (cancelled) return;
      setState({ monaco: m, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, [state.ready]);

  return state;
}
