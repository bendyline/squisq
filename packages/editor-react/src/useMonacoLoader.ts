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
      monacoPromise = (
        import('monaco-editor/esm/vs/editor/editor.api.js') as unknown as Promise<
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
