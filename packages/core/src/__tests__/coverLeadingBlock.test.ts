import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { coverRepeatsLeadingBlock } from '../doc/coverLeadingBlock.js';

function repeats(markdown: string): boolean {
  return coverRepeatsLeadingBlock(markdownToDoc(parseMarkdown(markdown)));
}

describe('coverRepeatsLeadingBlock', () => {
  it('is true for a title and the opening sentence the cover shows', () => {
    expect(repeats('# Video review\n\nA clear opening sentence.\n\n## Next\n\n- One\n')).toBe(true);
  });

  it('is true for a title alone', () => {
    expect(repeats('# Notes\n\n## First\n\nBody.\n')).toBe(true);
  });

  it('is false when the first section says more than the cover', () => {
    expect(repeats('# Review\n\nOpening.\n\nA second paragraph.\n')).toBe(false);
    expect(repeats('# Review\n\n- A point\n- Another\n')).toBe(false);
  });

  it('is false when the author chose a template for it', () => {
    expect(repeats('# Welcome {[title subtitle="Hi"]}\n\nOpening.\n')).toBe(false);
  });

  it('is false when the cover takes its title from elsewhere', () => {
    expect(repeats('---\ntitle: Report\n---\n\n# Summary\n\nOpening.\n')).toBe(false);
  });
});
