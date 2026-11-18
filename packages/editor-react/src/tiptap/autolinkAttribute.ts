/**
 * How the source wrote an address that is its own link text: `angle` for
 * `<https://…>` or `<me@x.test>`, `bare` for a GFM literal `https://…`.
 * `markdownToTiptap` sets it and `tiptapToMarkdown` writes the link back in
 * the same form, so opening a document never rewrites its addresses. Every
 * link mark that reads the bridge's HTML carries it.
 */
export const autolinkAttribute = {
  autolink: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-autolink'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.autolink ? { 'data-autolink': attributes.autolink } : {},
  },
};
