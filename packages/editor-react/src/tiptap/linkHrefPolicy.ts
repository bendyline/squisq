/**
 * The Write view's link-href check.
 *
 * `@tiptap/extension-link` (2.27) compiles its own check from a template
 * literal, where `\-` loses its backslash: the class `[^a-z+.\-:]` becomes the
 * range `.`–`:`, which includes `/`. So a relative href whose first path
 * segment is plain word characters — `media/brief.pdf`, `attachments/a.zip`
 * — is refused: the link is dropped when a document loads and its href
 * emptied when one is inserted, and the next save writes the loss back.
 * Host link schemes (`linkSchemes`) are refused the same way.
 *
 * Accept whatever Tiptap accepts, plus whatever squisq's own link policy
 * accepts — `sanitizeUrl`, which the renderers and LinkDialog already
 * enforce. That policy still refuses `javascript:`, `vbscript:` and `data:`
 * whatever a host lists, so nothing executable gets through either check.
 */
import { sanitizeUrl } from '@bendyline/squisq/markdown';

export function isAllowedLinkHref(
  url: string,
  defaultValidate: (url: string) => boolean,
  extraLinkSchemes?: readonly string[],
): boolean {
  return defaultValidate(url) || sanitizeUrl(url, 'link', { extraLinkSchemes }) !== null;
}
