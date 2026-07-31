/**
 * Host-pluggable fence renderers — the contract shared by the read path
 * (`@bendyline/squisq-react`'s `MarkdownRenderer` / `LinearDocView`) and
 * the edit path (`@bendyline/squisq-editor-react`'s `HostFenceExtension`).
 *
 * A host registers a renderer per fence *language* (the token after the
 * opening backticks). Wherever squisq renders markdown, a fenced code
 * block whose language is claimed renders through the host's component
 * instead of the default code block; unclaimed fences are untouched.
 *
 * Design constraints the contract encodes:
 *
 *   - **All payload lives in the fence body.** The info string's *meta*
 *     segment does not survive the WYSIWYG round-trip (ProseMirror keeps
 *     only the `language-*` class token), so `meta` is populated on the
 *     read path only and renderers must not depend on it.
 *   - **Core stays React-free.** `FenceRenderer` returns `unknown`; the
 *     react packages narrow it to `ReactNode` at their boundaries.
 *   - Failures fall back: the react integrations wrap renderers in an
 *     error boundary that degrades to the plain code block, so a broken
 *     host widget never takes a document down with it.
 */

import type { Theme } from '../schemas/Theme.js';

/** Everything a fence renderer receives for one claimed fence. */
export interface FenceRenderContext {
  /** Normalized (trimmed, lowercased) fence language token. */
  lang: string;
  /**
   * The info-string remainder after the language. READ PATH ONLY — absent
   * in edit mode (it does not survive the ProseMirror round-trip). Do not
   * store payload here; use the body.
   */
  meta?: string;
  /** Fence body, verbatim. */
  value: string;
  /**
   * Parsed body when it was valid JSON or the documented YAML subset
   * (see `parseDataFence` in `@bendyline/squisq/doc`); undefined when
   * parsing failed or was not attempted. Renderers needing guaranteed
   * structure should parse `value` themselves.
   */
  data?: unknown;
  /** Surface-applied theme — read colors/typography directly from it. */
  theme?: Theme;
  /** Which pipeline is rendering: static read view or the live editor. */
  mode: 'read' | 'edit';
  /**
   * Edit mode only: replace the fence body with `next` in one undoable
   * editor transaction. Absent on the read path.
   */
  replaceValue?: (next: string) => void;
}

/**
 * A host renderer for one fence language. Returns the host UI for the
 * fence — `ReactNode` in the react integrations; typed `unknown` here so
 * core carries no React dependency.
 */
export type FenceRenderer = (ctx: FenceRenderContext) => unknown;

/**
 * Registry: normalized fence language → renderer. Keys are matched
 * against `lang.trim().toLowerCase()`; register lowercase keys.
 */
export type FenceRendererMap = Record<string, FenceRenderer>;

/**
 * The registry's claimed languages, for plumbing that needs the *set*
 * without the functions (e.g. the page materializer's
 * `widgetFenceLangs`, or `CodeSnippetExtension.reservedLanguages`).
 */
export function fenceRendererLangs(renderers: FenceRendererMap | undefined): readonly string[] {
  return renderers ? Object.keys(renderers).map((lang) => lang.trim().toLowerCase()) : [];
}
