/**
 * Monaco language-service worker wiring.
 *
 * Monaco offloads its heavy language services — css / html / json / typescript
 * IntelliSense — plus a base editor service (word-based completions, link
 * detection, diffing) to web workers. Those worker bundles must be produced by
 * the HOST application's bundler: the mechanisms for it (Vite's `?worker`
 * import suffix, `new Worker(new URL(...))`, webpack loaders) are all
 * bundler-specific and cannot live inside this tsup-built library.
 *
 * So the division of labor is: the host supplies the five worker constructors
 * (one line each with Vite's `?worker`), and this helper owns the
 * `label → worker` mapping — the part that's fiddly and easy to get wrong.
 *
 * Call once, before the first editor mounts (typically in the app entry):
 *
 * ```ts
 * import { configureMonacoWorkers } from '@bendyline/squisq-editor-react/monaco-workers';
 * import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
 * import JsonWorker   from 'monaco-editor/esm/vs/language/json/json.worker?worker';
 * import CssWorker    from 'monaco-editor/esm/vs/language/css/css.worker?worker';
 * import HtmlWorker   from 'monaco-editor/esm/vs/language/html/html.worker?worker';
 * import TsWorker     from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
 *
 * configureMonacoWorkers({
 *   editor: EditorWorker, json: JsonWorker, css: CssWorker,
 *   html: HtmlWorker, ts: TsWorker,
 * });
 * ```
 *
 * This is purely additive: without it, highlighting, editing, and custom
 * completion providers (e.g. the `{[template]}` typeahead) still work — they
 * run on the main thread. Only the language-service IntelliSense is dormant
 * until the workers are wired.
 */

/** Zero-arg worker constructor, as produced by Vite's `?worker` import. */
export type MonacoWorkerConstructor = new () => Worker;

export interface MonacoWorkerConstructors {
  /** Base editor worker (word completions, links, diff). Required. */
  editor: MonacoWorkerConstructor;
  /** JSON language service. */
  json?: MonacoWorkerConstructor;
  /** CSS/SCSS/LESS language service. */
  css?: MonacoWorkerConstructor;
  /** HTML/Handlebars/Razor language service. */
  html?: MonacoWorkerConstructor;
  /** TypeScript service — also handles JavaScript. */
  ts?: MonacoWorkerConstructor;
}

type MonacoEnvironmentHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
};

/**
 * Install `globalThis.MonacoEnvironment.getWorker` so Monaco routes each
 * language to the matching worker, falling back to the base editor worker for
 * any label without a dedicated service (which is every plain language — its
 * grammar-based highlighting needs no worker).
 */
export function configureMonacoWorkers(workers: MonacoWorkerConstructors): void {
  const host = globalThis as MonacoEnvironmentHost;
  host.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          if (workers.json) return new workers.json();
          break;
        case 'css':
        case 'scss':
        case 'less':
          if (workers.css) return new workers.css();
          break;
        case 'html':
        case 'handlebars':
        case 'razor':
          if (workers.html) return new workers.html();
          break;
        case 'typescript':
        case 'javascript':
          if (workers.ts) return new workers.ts();
          break;
      }
      return new workers.editor();
    },
  };
}
