import { describe, expect, it } from 'vitest';
import { CODE_SNIPPET_LINE_HEIGHT, codeSnippetAutoHeight } from '../codeSnippetSizing';

describe('codeSnippetAutoHeight', () => {
  it('fits an empty or one-line snippet with no spare trailing line', () => {
    expect(codeSnippetAutoHeight('')).toBe(76);
    expect(codeSnippetAutoHeight('const answer = 42;')).toBe(76);
  });

  it('adds one Monaco line-height for each physical source line', () => {
    const oneLine = codeSnippetAutoHeight('one');
    expect(codeSnippetAutoHeight('one\ntwo')).toBe(oneLine + CODE_SNIPPET_LINE_HEIGHT);
    expect(codeSnippetAutoHeight('one\r\ntwo\r\nthree')).toBe(
      oneLine + CODE_SNIPPET_LINE_HEIGHT * 2,
    );
  });

  it('counts a trailing newline as a new empty source line', () => {
    expect(codeSnippetAutoHeight('one\n')).toBe(
      codeSnippetAutoHeight('one') + CODE_SNIPPET_LINE_HEIGHT,
    );
  });
});
