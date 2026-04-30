/**
 * TemplateAnnotation — Tiptap Heading Extension
 *
 * Extends Tiptap's built-in Heading node to support `data-template` and
 * `data-template-params` HTML attributes. These attributes store which block
 * template should be used for a heading section.
 *
 * When present, the heading renders a visible badge (styled CSS chip)
 * showing the template name, e.g. `[chart]`.
 *
 * The tiptapBridge converts `### Title {[chart]}` markdown into
 * `<h3 data-template="chart">Title</h3>` and back, so this extension
 * ensures Tiptap's schema preserves those attributes through edits.
 */

import Heading from '@tiptap/extension-heading';
import { templateLabel } from './TemplatePicker';

/**
 * HeadingWithTemplate — drop-in replacement for Tiptap's Heading that
 * persists template annotation attributes.
 */
export const HeadingWithTemplate = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataTemplate: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-template') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.dataTemplate) return {};
          return { 'data-template': attributes.dataTemplate };
        },
      },
      dataTemplateParams: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-template-params') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.dataTemplateParams) return {};
          return { 'data-template-params': attributes.dataTemplateParams };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level;
    const tag = `h${level}`;
    const templateName = HTMLAttributes['data-template'];

    if (templateName) {
      // Render heading with a trailing badge span. The badge has no text
      // content — its label is painted via CSS `content: attr(data-template)`
      // so the template name never becomes part of the serialized heading
      // text (which would leak into markdown on round-trip).
      return [
        tag,
        HTMLAttributes,
        ['span', { class: 'squisq-heading-content' }, 0],
        [
          'span',
          {
            class: 'squisq-template-badge',
            contenteditable: 'false',
            'data-template': templateName,
            'data-template-label': templateLabel(templateName),
          },
        ],
      ];
    }

    // No template — render as normal heading
    return [tag, HTMLAttributes, 0];
  },
});
