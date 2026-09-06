/** Sizing constants shared by the code-snippet shell and Monaco instance. */
export const CODE_SNIPPET_HEADER_HEIGHT = 34;
export const CODE_SNIPPET_LINE_HEIGHT = 20;
export const CODE_SNIPPET_VERTICAL_PADDING = 20;

const CODE_SNIPPET_SHELL_BORDER = 2;

/**
 * Size a code-snippet inset to exactly its physical source lines plus Monaco's
 * own symmetric top/bottom padding — no spare trailing line, which read as a
 * dead gap under short snippets.
 * The stylesheet's max-height still caps long snippets and lets Monaco scroll.
 */
export function codeSnippetAutoHeight(source: string): number {
  const sourceLineCount = source.split('\n').length;
  return (
    CODE_SNIPPET_SHELL_BORDER +
    CODE_SNIPPET_HEADER_HEIGHT +
    CODE_SNIPPET_VERTICAL_PADDING +
    sourceLineCount * CODE_SNIPPET_LINE_HEIGHT
  );
}
