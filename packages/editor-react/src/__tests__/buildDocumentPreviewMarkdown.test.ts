import { describe, expect, it } from 'vitest';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { buildDocumentPreviewMarkdown } from '../buildDocumentPreviewMarkdown';

function docWith(blocks: Block[]): Doc {
  return {
    articleId: 'summary-doc',
    duration: 10,
    blocks,
    audio: { segments: [] },
    frontmatter: { title: 'Quarterly Report' },
  };
}

describe('buildDocumentPreviewMarkdown', () => {
  it('serializes programmatic transform blocks as readable document content', () => {
    const markdown = buildDocumentPreviewMarkdown(
      docWith([
        {
          id: 'transform-stat',
          template: 'statHighlight',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
          stat: '42%',
          description: 'Year-over-year growth',
        } as Block,
        {
          id: 'transform-list',
          template: 'list',
          startTime: 5,
          duration: 5,
          audioSegment: 0,
          title: 'Priorities',
          items: ['Reliability', 'Speed'],
        } as Block,
      ]),
    );

    expect(markdown).toContain('# Quarterly Report');
    expect(markdown).toContain('## 42%');
    expect(markdown).toContain('Year-over-year growth');
    expect(markdown).toContain('## Priorities');
    expect(markdown).toContain('Reliability');
    expect(markdown).toContain('Speed');
    expect(markdown).not.toContain('{[statHighlight');
  });

  it('preserves authored blocks that a conservative transform kept', () => {
    const markdown = buildDocumentPreviewMarkdown(
      docWith([
        {
          id: 'authored',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
          sourceHeading: {
            type: 'heading',
            depth: 2,
            children: [{ type: 'text', value: 'Context' }],
          },
          contents: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Original supporting detail.' }],
            },
          ],
        },
      ]),
    );

    expect(markdown).toContain('## Context');
    expect(markdown).toContain('Original supporting detail.');
  });
});
