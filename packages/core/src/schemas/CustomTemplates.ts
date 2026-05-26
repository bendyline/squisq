/**
 * Custom Templates Schema
 *
 * User-defined block layout templates. The author designs a visual
 * layout once (in the editor's TemplateDesigner) and saves it as a
 * `CustomTemplateDefinition`. The definition lives either in the
 * document's frontmatter (per-doc, portable, ships with the markdown)
 * or in the user's local library (cross-doc reuse via localStorage).
 *
 * A custom template's content is just a `Layer[]` — the same shape that
 * built-in templates emit at expansion time. The novel bit is
 * *placeholder tokens*: TextLayer / ImageLayer content fields may carry
 * strings like `{title}`, `{content}`, `{children}`, or `{image:N}`
 * that the resolver (see `doc/templates/tokens/resolveTokens.ts`)
 * substitutes against the source Block at render time.
 *
 * Responsiveness model: every numeric position field in `layers` is
 * stored as a `%`-string relative to `viewport`, so the same template
 * renders correctly at any of Squisq's viewport presets (landscape,
 * portrait, square). The `viewport` field itself is purely an
 * authoring-time reference — it tells the designer canvas which aspect
 * ratio to mount with, and the thumbnail renderer which viewBox to use.
 */

import type { Layer } from './Doc.js';

/**
 * A single user-defined template. Stored in `Doc.customTemplates`
 * (frontmatter-backed) or in the user's local library.
 */
export interface CustomTemplateDefinition {
  /**
   * Stable id used in heading annotations (`### Foo {[name]}`). Must be
   * a slug — lowercase alphanumerics, hyphens. The picker enforces
   * uniqueness within a (doc + library) merged namespace.
   */
  name: string;

  /** Human-readable label shown in the template picker. */
  label: string;

  /** Optional one-sentence description for the picker card. */
  description?: string;

  /**
   * Authoring viewport — the canvas size the designer drew against.
   * Stored so the designer and thumbnail renderer can reproduce the
   * same canvas. Layer positions are stored as `%`-strings, so the
   * actual render-time viewport can differ from this without breaking
   * the layout. Defaults to 1920×1080 landscape.
   */
  viewport: {
    width: number;
    height: number;
  };

  /**
   * The visual content. Every `position.x` / `position.y` /
   * `position.width` / `position.height` should be a `%`-string at
   * save time (the designer's normalizePositions step enforces this).
   *
   * Tokens supported in v1:
   *   - TextLayer.content.text — `{title}`, `{content}`, `{children}`,
   *     `{image:N}` (substitutes the Nth image's alt text)
   *   - ImageLayer.content.src — `{image:N}` (substitutes the URL)
   */
  layers: Layer[];
}

/**
 * Tag value for the YAML frontmatter key that carries inlined custom
 * template definitions. Exported so the markdown bridge stays in sync.
 */
export const FRONTMATTER_CUSTOM_TEMPLATES_KEY = 'squisq-custom-templates';
