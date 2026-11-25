/**
 * TemplateAnnotation — Tiptap Heading Extension
 *
 * Extends Tiptap's built-in Heading node to support `data-template`,
 * `data-template-params`, and `data-template-empty` HTML attributes. These
 * attributes store the authored template annotation without exposing its raw
 * `{[…]}` syntax in the Write view.
 *
 * When present, the heading renders a visible badge (styled CSS chip)
 * showing the template name, e.g. `[chart]`.
 *
 * The tiptapBridge converts `### Title {[chart]}` markdown into
 * `<h3 data-template="chart">Title</h3>` and back, so this extension
 * ensures Tiptap's schema preserves those attributes through edits.
 */

import Heading from '@tiptap/extension-heading';
import { DOMSerializer } from '@tiptap/pm/model';
import { accessoryBlockTypeInfo, isAccessoryBlockType } from '@bendyline/squisq/doc';
import { templateLabel } from './TemplatePicker';
import { summarizeBlockProps } from './blockProperties';

/** What an accessory block's badge says when pointed at: kept with its section, never shown. */
function accessoryBadgeTitle(templateName: string): string {
  if (!isAccessoryBlockType(templateName)) return '';
  return `${accessoryBlockTypeInfo(templateName).label}. Kept with this section; never shown as a slide or in an export.`;
}

/**
 * HeadingWithTemplate — drop-in replacement for Tiptap's Heading that
 * persists template annotation attributes.
 */
export const HeadingWithTemplate = Heading.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      ...Object.fromEntries(
        this.options.levels.map((level) => [
          `Mod-${level}`,
          () => this.editor.isEditable && this.editor.commands.toggleHeading({ level }),
        ]),
      ),
    };
  },

  /**
   * The same DOM as `renderHTML`, as a node view only so the heading can say
   * which DOM changes are not edits. ProseMirror treats any change to a
   * heading's DOM outside a widget as an edit to re-read and redraws the
   * heading's range: a browser extension or test tool writing a `style` or
   * `data-*` onto the template badge (Playwright's screenshots hide the caret
   * that way) redrew the section, and the widgets in it remounted, flashed
   * empty and shifted the page. The badges hold no content, and the heading
   * element's own attributes come from the node, so changes to either are
   * ignored; the text inside `contentDOM` is read as before.
   */
  addNodeView() {
    return ({ node }) => {
      const spec = node.type.spec.toDOM?.(node) ?? [`h${String(node.attrs.level)}`, 0];
      const { dom, contentDOM } = DOMSerializer.renderSpec(document, spec);
      let current = node;
      return {
        dom,
        contentDOM,
        update: (next) => {
          // A different heading (level, template, params) re-renders whole,
          // as it did without a node view.
          if (!next.sameMarkup(current)) return false;
          current = next;
          return true;
        },
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          const target = mutation.target;
          if (contentDOM && (target === contentDOM || contentDOM.contains(target))) return false;
          return target === dom ? mutation.type === 'attributes' : true;
        },
      };
    };
  },

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
      dataTemplateEmpty: {
        default: false,
        parseHTML: (element: HTMLElement) => element.hasAttribute('data-template-empty'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.dataTemplateEmpty) return {};
          return { 'data-template-empty': 'true' };
        },
      },
      dataBlockAttrs: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-block-attrs') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.dataBlockAttrs) return {};
          return { 'data-block-attrs': attributes.dataBlockAttrs };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level;
    const tag = `h${level}`;
    const templateName = HTMLAttributes['data-template'];
    // Concise summary of authored block properties (transition / timing),
    // painted on the props badge so the canvas shows what's set at a glance.
    const propsSummary = summarizeBlockProps(
      (HTMLAttributes['data-block-attrs'] as string | undefined) ?? null,
      (HTMLAttributes['data-template-params'] as string | undefined) ?? null,
    );

    // Render heading with a trailing badge span. The badge and its inner core
    // have no real text content — labels/braces are painted via CSS so the
    // template name never becomes part of serialized heading text (which
    // would leak into markdown on round-trip).
    //
    // When no template is set we still render a subtle "empty" badge so
    // authors have a visible affordance for opening the template picker
    // straight from the heading (matches the clicky chip shown for
    // templated headings). The empty variant has no `data-template`
    // attribute, so the bridge treats the heading as plain on save.
    // An accessory block (`{[summary]}`) is side information about the section
    // above it. Its chip names what it is and changes nothing: it has no
    // block type to choose and no slide properties. The class stays
    // `squisq-template-badge`, which the bridge cuts heading HTML at.
    if (isAccessoryBlockType(templateName)) {
      return [
        tag,
        { ...HTMLAttributes, 'data-accessory-block': templateName },
        ['span', { class: 'squisq-heading-content' }, 0],
        [
          'span',
          {
            class: 'squisq-template-badge squisq-template-badge--accessory',
            contenteditable: 'false',
            title: accessoryBadgeTitle(templateName),
            'data-template': templateName,
          },
          [
            'span',
            {
              class: 'squisq-template-badge-core',
              'data-template-label': templateLabel(templateName),
              'aria-hidden': 'true',
            },
          ],
        ],
      ];
    }

    if (templateName) {
      return [
        tag,
        HTMLAttributes,
        ['span', { class: 'squisq-heading-content' }, 0],
        [
          'span',
          {
            class: 'squisq-template-badge',
            contenteditable: 'false',
            role: 'button',
            tabindex: '0',
            'aria-haspopup': 'listbox',
            title: 'Change block type',
            'data-template': templateName,
          },
          [
            'span',
            {
              class: 'squisq-template-badge-core',
              'data-template-label': templateLabel(templateName),
              'aria-hidden': 'true',
            },
          ],
        ],
        propsBadgeSpec(propsSummary),
      ];
    }

    return [
      tag,
      HTMLAttributes,
      ['span', { class: 'squisq-heading-content' }, 0],
      [
        'span',
        {
          class: 'squisq-template-badge squisq-template-badge--empty',
          contenteditable: 'false',
          role: 'button',
          tabindex: '0',
          'aria-haspopup': 'listbox',
          title: 'Choose block type',
        },
        [
          'span',
          {
            class: 'squisq-template-badge-core',
            'data-template-label': 'Block',
            'aria-hidden': 'true',
          },
        ],
      ],
      propsBadgeSpec(propsSummary),
    ];
  },
});

/**
 * The block-properties chip rendered beside the template badge — the on-canvas
 * entry point to the {@link BlockPropertiesPopover} (transition, timing, …).
 *
 * Like the template badge, this is an EMPTY inert span: the sliders glyph and
 * the optional `summary` text are painted via CSS (`::before` / `::after` with
 * `content: attr(data-props-summary)`, using the Font Awesome font the editor
 * already loads). Keeping it childless is deliberate — `tiptapToMarkdown`
 * serializes the rendered heading HTML, so any real child node here would risk
 * leaking into the markdown; a `data-*` attribute is stripped with the span.
 * Clicks are delegated in `WysiwygEditor`.
 */
function propsBadgeSpec(summary: string): [string, Record<string, string>] {
  const attrs: Record<string, string> = {
    class: 'squisq-props-badge',
    contenteditable: 'false',
    role: 'button',
    tabindex: '0',
    'aria-haspopup': 'dialog',
    title: summary ? `Block properties — ${summary}` : 'Block properties',
  };
  // Only set the attribute when there's something to show, so the CSS
  // `[data-props-summary]` selector cleanly distinguishes "has properties".
  if (summary) attrs['data-props-summary'] = summary;
  return ['span', attrs];
}
