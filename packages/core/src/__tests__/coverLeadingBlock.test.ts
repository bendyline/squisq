import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { coverRepeatsLeadingBlock } from '../doc/coverLeadingBlock.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';

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

// The player, the video exporter and the PowerPoint exporter are all handed
// the slideshow projection, whose slides no longer carry `sourceHeading`. The
// check once said `false` for every projected doc, so every ordinary deck
// opened on the cover and then showed the same words again as slide one.
describe('coverRepeatsLeadingBlock on the slideshow projection', () => {
  function projected(markdown: string): boolean {
    return coverRepeatsLeadingBlock(buildPreviewDoc(markdownToDoc(parseMarkdown(markdown))));
  }

  it('agrees with the source document', () => {
    for (const markdown of [
      '# Video review\n\nA clear opening sentence.\n\n## Next\n\n- One\n',
      '---\nsquisq-theme: gezellig\n---\n# Offsite plan\n\nTwo days by the water.\n\n## Agenda\n\n- Arrive\n',
      '# Notes\n\n## First\n\nBody.\n',
      '# Review\n\nOpening.\n\nA second paragraph.\n',
      '# Welcome {[title subtitle="Hi"]}\n\nOpening.\n',
      '---\ntitle: Report\n---\n\n# Summary\n\nOpening.\n',
    ]) {
      expect(projected(markdown), markdown).toBe(repeats(markdown));
    }
  });

  it('survives projecting a projection', () => {
    const once = buildPreviewDoc(
      markdownToDoc(parseMarkdown('# Notes\n\nOpening.\n\n## A\n\nB.\n')),
    );
    expect(coverRepeatsLeadingBlock(buildPreviewDoc(once))).toBe(true);
  });

  it('is false for a projection whose first slide is not the first block', () => {
    const doc = buildPreviewDoc(
      markdownToDoc(parseMarkdown('# Notes\n\nOpening.\n\n## A\n\nB.\n')),
    );
    expect(coverRepeatsLeadingBlock({ ...doc, blocks: doc.blocks.slice(1) })).toBe(false);
  });
});
