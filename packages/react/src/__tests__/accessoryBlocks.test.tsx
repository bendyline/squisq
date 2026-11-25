/**
 * Accessory blocks (`### Headline {[summary]}`) are side information about a
 * section — never a slide in the player, never content on a page.
 */
import { describe, expect, it } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { useDocPlayback } from '../hooks/useDocPlayback';
import { MarkdownRenderer } from '../MarkdownRenderer';

function block(id: string, startTime: number, extra: Partial<Block> = {}): Block {
  return { id, startTime, duration: 5, audioSegment: 0, layers: [], ...extra };
}

describe('accessory blocks in the player and renderer', () => {
  it('are never slides, even at the top level of a flat document', () => {
    const doc: Doc = {
      articleId: 'd',
      duration: 10,
      blocks: [
        block('a', 0),
        block('~summary', 5, { duration: 0, accessoryBlock: { type: 'summary' } }),
        block('b', 5),
      ],
      audio: { segments: [] },
    };
    const { result } = renderHook(() =>
      useDocPlayback(doc, 0, { viewport: VIEWPORT_PRESETS.landscape }),
    );
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('are not drawn on a page', () => {
    const nodes = parseMarkdown(
      [
        '## Plan',
        '',
        'Shown.',
        '',
        '### Not shown {[summary]}',
        '',
        '- Not shown either',
        '',
        '### Shown child',
      ].join('\n'),
    ).children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.textContent).toContain('Shown.');
    expect(container.textContent).toContain('Shown child');
    expect(container.textContent).not.toContain('Not shown');
  });
});
