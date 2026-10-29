/**
 * Page templates — host capability for choosing the page a rendered document
 * is generated inside (the `squisq-output-template` frontmatter key; see
 * `applyHtmlPageTemplate` in `@bendyline/squisq-formats/html`).
 *
 * Only the host knows whether the open document renders through a template
 * and which files can serve as one, so the Document settings dialog offers a
 * Page template field only when the host passes `EditorShell` a
 * `pageTemplates` value.
 */

import { createContext, useContext } from 'react';

export interface PageTemplateChoice {
  /** The `squisq-output-template` value that selects this template. */
  readonly value: string;
  /** How the choice is listed, typically the template's path. */
  readonly label: string;
}

export interface PageTemplateSettings {
  /**
   * The templates the document may use. Called each time Document settings
   * opens, so a template added since appears without remounting the editor.
   */
  listTemplates: () => Promise<readonly PageTemplateChoice[]>;
  /**
   * What applies when the document names no template, such as
   * `'Workspace default (_templates/post.html)'`. Omit when nothing applies;
   * the field then offers that choice as "None".
   */
  defaultLabel?: string;
}

export const PageTemplateContext = createContext<PageTemplateSettings | null>(null);

/** The host's page template capability, or `null` when it offers none. */
export function usePageTemplateSettings(): PageTemplateSettings | null {
  return useContext(PageTemplateContext);
}
