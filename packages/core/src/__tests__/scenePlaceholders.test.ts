import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';

/** What Insert → Drawing and Insert → Layout leave, untouched, mid-document. */
const DRAWING = '### Drawing {[drawing]}\n\n';
const LAYOUT =
  '### Layout {[layout]}\n\n' +
  '####  {#text-1} {[text x=360 y=380 width=1200 height=320 fontSize=64 fontWeight=bold align=center valign=middle]}\n\n' +
  'Layout\n\n';

function slideIds(sections: string, omit: boolean): string[] {
  const markdown = `# Plan\n\nIntro.\n\n## Room\n\nHow it is laid out.\n\n${sections}## After\n\nEnd.\n`;
  const preview = buildPreviewDoc(markdownToDoc(parseMarkdown(markdown)), {
    omitUntouchedPlaceholders: omit,
  });
  return preview.blocks.map((block) => block.id);
}

describe('untouched scene placeholders', () => {
  it('are left out of an exported deck', () => {
    expect(slideIds(DRAWING + LAYOUT, true)).not.toContain('drawing');
    expect(slideIds(DRAWING + LAYOUT, true)).not.toContain('layout');
    expect(slideIds(DRAWING + LAYOUT, true)).toEqual(
      expect.arrayContaining(['plan', 'room', 'after']),
    );
  });

  it('stay in the live slideshow, where the author opens their designer', () => {
    expect(slideIds(DRAWING + LAYOUT, false)).toEqual(
      expect.arrayContaining(['drawing', 'layout']),
    );
  });

  it('keep their slide once the author has made them theirs', () => {
    // Renamed.
    expect(slideIds('### Floor plan {[drawing]}\n\n', true)).toContain('floor-plan');
    // Something drawn.
    expect(
      slideIds(
        '### Drawing {[drawing]}\n\n#### {#box-1} {[rect x=100 y=100 width=300 height=200]}\n\n',
        true,
      ),
    ).toContain('drawing');
    // The starter's words changed.
    expect(slideIds(LAYOUT.replace(/\nLayout\n/, '\nWelcome, team\n'), true)).toContain('layout');
    // A second box added.
    expect(
      slideIds(
        LAYOUT + '####  {#text-2} {[text x=360 y=760 width=1200 height=120]}\n\nSubtitle\n\n',
        true,
      ),
    ).toContain('layout');
  });
});
