/**
 * Tiptap attributes for a media node's edit recipe (`data-squisq-{kind}-fx`,
 * `-cuts`, `-gain`, `-fade-in`, `-fade-out`, `-crop`, `-group`).
 *
 * Values are carried verbatim as strings: the WYSIWYG view never interprets
 * a recipe, it only has to round-trip it byte-for-byte. Parsing and
 * validation live in `@bendyline/squisq/mediaEdit`.
 */

import {
  MEDIA_EDIT_PARAMS,
  mediaEditHtmlAttribute,
  type MediaEditParamKey,
} from '@bendyline/squisq/mediaEdit';

interface StringAttributeSpec {
  default: null;
  parseHTML: (element: HTMLElement) => string | null;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, string>;
}

/** Node attribute name for a recipe key: `fx` → `editFx`, `fadeIn` → `editFadeIn`. */
export function mediaEditNodeAttributeName(key: MediaEditParamKey): string {
  return `edit${key[0].toUpperCase()}${key.slice(1)}`;
}

/** Recipe keys a media kind carries (crop is video-only). */
export function mediaEditKeysFor(kind: 'audio' | 'video'): MediaEditParamKey[] {
  return MEDIA_EDIT_PARAMS.map((p) => p.key).filter((key) => kind === 'video' || key !== 'crop');
}

export function mediaEditNodeAttributes(
  kind: 'audio' | 'video',
): Record<string, StringAttributeSpec> {
  const specs: Record<string, StringAttributeSpec> = {};
  for (const key of mediaEditKeysFor(kind)) {
    const name = mediaEditNodeAttributeName(key);
    const html = mediaEditHtmlAttribute(kind, key);
    specs[name] = {
      default: null,
      parseHTML: (element) => element.getAttribute(html),
      renderHTML: (attributes) => {
        const value = attributes[name];
        return typeof value === 'string' && value !== '' ? { [html]: value } : {};
      },
    };
  }
  return specs;
}
