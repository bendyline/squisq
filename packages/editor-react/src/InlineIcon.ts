/**
 * InlineIcon — Tiptap Node Extension
 *
 * Atomic inline node that round-trips FontAwesome icons through the
 * WYSIWYG editor. The markdown bridge stashes `{[github]}` source as
 * `<i data-icon="github" data-family="brands" data-name="github"
 * class="fa-brands fa-github"></i>`; this extension lets ProseMirror
 * recognize that markup, persist the attributes through edits, and
 * re-emit it when serializing back to HTML/markdown.
 *
 * Atom / inline / non-selectable means the icon behaves like an emoji:
 * the caret can land before or after it, Backspace deletes it whole,
 * and Tiptap won't try to put content inside it.
 */

import { Node, mergeAttributes } from '@tiptap/core';

interface InlineIconAttrs {
  /** Token as authored in markdown — e.g. `github`, `fa-solid:user`. */
  token: string;
  family: 'brands' | 'solid' | 'regular';
  name: string;
}

export const InlineIcon = Node.create({
  name: 'inlineIcon',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      token: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-icon') ?? '',
        renderHTML: (attrs: InlineIconAttrs) =>
          attrs.token ? { 'data-icon': attrs.token } : {},
      },
      family: {
        default: 'solid',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-family') ?? 'solid',
        renderHTML: (attrs: InlineIconAttrs) =>
          attrs.family ? { 'data-family': attrs.family } : {},
      },
      name: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-name') ?? '',
        renderHTML: (attrs: InlineIconAttrs) =>
          attrs.name ? { 'data-name': attrs.name } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'i[data-icon]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const family = (HTMLAttributes['data-family'] as string | undefined) ?? 'solid';
    const name = (HTMLAttributes['data-name'] as string | undefined) ?? '';
    // The `<i>` carries `class="fa-brands fa-github"` so the bundled
    // FontAwesome CSS picks it up. We also keep `data-*` mirrors so
    // the bridge regex can round-trip back to markdown without
    // parsing the class string.
    const className = name ? `fa-${family} fa-${name}` : '';
    return [
      'i',
      mergeAttributes(HTMLAttributes, {
        class: className,
        contenteditable: 'false',
      }),
    ];
  },
});
