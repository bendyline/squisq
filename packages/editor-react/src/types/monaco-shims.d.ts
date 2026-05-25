/**
 * Monaco ships `editor.main.js` (the full bundle with language contributions)
 * but only publishes `.d.ts` for `editor.api`. We import the `.main.js`
 * subpath at runtime to register all languages, then cast through
 * `as unknown as typeof import('monaco-editor')` at the call site. This
 * ambient declaration makes the subpath import resolve without a
 * `@ts-expect-error` (which doesn't survive Prettier's formatting choice
 * for the surrounding parenthesized expression — see useMonacoLoader.ts).
 */
declare module 'monaco-editor/esm/vs/editor/editor.main.js';
