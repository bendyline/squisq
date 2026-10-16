import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/index.js';
import { analyzeBlocks, applyTransform } from '../transform/index.js';

/**
 * Transforms pull highlights -- facts, stats, quotes -- out of a section's
 * prose. A list's items and a table's cells are not prose: stitched together
 * they read as one sentence ("First item Second item Item Status Export
 * Ready"), which became a fact card that replaced the whole section and
 * dropped its heading from the slideshow and the PowerPoint export.
 */

const STRUCTURED = [
  '# Ship review',
  '',
  'Persistence marker.',
  '',
  '## Checklist',
  '',
  '- First item',
  '- Second item',
  '',
  '| Item | Status |',
  '| --- | --- |',
  '| Export | Ready |',
  '',
].join('\n');

function sectionBlocks(markdown: string) {
  return markdownToDoc(parseMarkdown(markdown)).blocks;
}

describe('transform extraction reads prose only', () => {
  it('does not read a list and a table as a fact', () => {
    const checklist = analyzeBlocks(sectionBlocks(STRUCTURED)).find(
      (entry) => entry.block.title === 'Checklist',
    );
    expect(checklist?.extractions).toEqual([]);
  });

  it('still extracts from prose beside a list, at offsets into the analyzed text', () => {
    const markdown = [
      '# Results',
      '',
      '- First item',
      '- Second item',
      '',
      'Revenue grew 45% to $2.3 million in 2024, the strongest year on record.',
      '',
    ].join('\n');
    const [entry] = analyzeBlocks(sectionBlocks(markdown));
    expect(entry.extractions.length).toBeGreaterThan(0);
    for (const element of entry.extractions) {
      expect(element.text).not.toContain('First item');
      expect(entry.plainText.slice(element.sourcePosition, element.endPosition)).toBe(element.text);
    }
  });

  it("keeps a structured section's heading through the documentary transform", () => {
    const { doc } = applyTransform(markdownToDoc(parseMarkdown(STRUCTURED)), 'documentary');
    const titles = doc.blocks.map((block) => block.title);
    expect(titles).toContain('Checklist');
    expect(doc.blocks.some((block) => block.template === 'factCard')).toBe(false);
  });
});
