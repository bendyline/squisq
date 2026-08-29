/**
 * Superscript / Subscript — Tiptap Mark Extensions
 *
 * Vertical alignment is the one piece of inline formatting that arrives from
 * real-world documents far more often than it is typed: a spreadsheet's
 * footnote markers, a Word document's `w:vertAlign` runs, an imported HTML
 * table. Without these marks ProseMirror has no schema slot for `<sup>`, so the
 * Write view drops the tags on the first edit and the imported markup is lost.
 *
 * Defined locally rather than pulled from `@tiptap/extension-superscript` and
 * `-subscript`: two marks of a dozen lines each do not justify two more pinned
 * dependencies on the editor's peer surface.
 *
 * The markdown bridge renders `<sup>x</sup>` straight through (see
 * `tiptapBridge.ts`), and core's parser folds that tag pair back into a real
 * `superscript` / `subscript` inline node — so the source form stays plain
 * inline HTML at every hop.
 */

import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    verticalAlign: {
      toggleSuperscript: () => ReturnType;
      toggleSubscript: () => ReturnType;
    };
  }
}

export const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',

  parseHTML() {
    // The `vertical-align` rule matters for PASTE: Word and Google Docs both
    // express a superscript as a styled span rather than a `<sup>` tag.
    return [
      { tag: 'sup' },
      { style: 'vertical-align', getAttrs: (v) => (v === 'super' ? null : false) },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleSuperscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-.': () => this.editor.commands.toggleSuperscript() };
  },
});

export const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',

  parseHTML() {
    return [
      { tag: 'sub' },
      { style: 'vertical-align', getAttrs: (v) => (v === 'sub' ? null : false) },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sub', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleSubscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-,': () => this.editor.commands.toggleSubscript() };
  },
});
