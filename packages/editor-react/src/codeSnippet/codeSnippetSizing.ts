/** Sizing constants shared by the code-snippet shell and Monaco instance. */
export const CODE_SNIPPET_HEADER_HEIGHT = 34;
export const CODE_SNIPPET_LINE_HEIGHT = 20;
export const CODE_SNIPPET_VERTICAL_PADDING = 20;

const CODE_SNIPPET_SHELL_BORDER = 2;
const CODE_SNIPPET_EXTRA_LINES = 1;

/**
 * Size a code-snippet inset to its physical source lines plus one empty line.
 * The stylesheet's max-height still caps long snippets and lets Monaco scroll.
 */
export function codeSnippetAutoHeight(source: string): number {
  const sourceLineCount = source.split('\n').length;
  return (
    CODE_SNIPPET_SHELL_BORDER +
    CODE_SNIPPET_HEADER_HEIGHT +
    CODE_SNIPPET_VERTICAL_PADDING +
    (sourceLineCount + CODE_SNIPPET_EXTRA_LINES) * CODE_SNIPPET_LINE_HEIGHT
  );
}
