/**
 * Monaco publishes declarations for `editor.api`, but not for its side-effect
 * contribution and language-registration modules. Squisq imports those deep
 * `.js` paths deliberately to build a compact, demand-driven editor profile.
 */
declare module 'monaco-editor/esm/vs/editor/*';
declare module 'monaco-editor/esm/vs/basic-languages/*';
declare module 'monaco-editor/esm/vs/language/*';
