/**
 * Code fences that keep the opener their author wrote.
 *
 * The Markdown bridge writes a fence's marker (`~~~`, or a run longer than
 * ```` ``` ````) and the part of its info string after the language
 * (`title="x.js"`) as data attributes on the `<pre>`. Tiptap's code block
 * keeps only the first `language-*` class, so both were dropped on parse and
 * every save rewrote `~~~bash` as ```` ```bash ```` and cut info strings to
 * the language.
 */
import { Extension } from '@tiptap/core';

const FENCE_MARKER = /^(`{3,}|~{3,})$/;

export const CodeFenceSource = Extension.create({
  name: 'codeFenceSource',

  addGlobalAttributes() {
    return [
      {
        types: ['codeBlock'],
        attributes: {
          fenceMarker: {
            default: null,
            parseHTML: (element: HTMLElement): string | null => {
              const value = element.getAttribute('data-squisq-fence');
              return value && FENCE_MARKER.test(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
              typeof attributes.fenceMarker === 'string' &&
              FENCE_MARKER.test(attributes.fenceMarker)
                ? { 'data-squisq-fence': attributes.fenceMarker }
                : {},
          },
          fenceMeta: {
            default: null,
            parseHTML: (element: HTMLElement): string | null =>
              element.getAttribute('data-squisq-fence-meta') || null,
            renderHTML: (attributes: Record<string, unknown>): Record<string, string> =>
              typeof attributes.fenceMeta === 'string' && attributes.fenceMeta
                ? { 'data-squisq-fence-meta': attributes.fenceMeta }
                : {},
          },
        },
      },
    ];
  },
});
