/**
 * Slide summaries (`### Headline {[summary]}`) are side information about the
 * section above them, so the editor's other surfaces treat them as part of
 * that section: the outline leaves them out and changes their level with
 * their section, a block card holds them with their section, and a new block
 * is never inserted among them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { OutlinePanel } from '../OutlinePanel';
import { getBlockSlices } from '../blockRange';
import { blockInsertionPoint, sourceOutline, resolveOutlineInsertion } from '../sourceEdits';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const MARKDOWN = [
  '## Results',
  '',
  'Revenue grew.',
  '',
  '### Revenue grew {[summary]}',
  '',
  '- Up 40%',
  '',
  '#### Inside the summary',
  '',
  '### Detail',
  '',
  'A real child.',
  '',
  '## Plan',
  '',
  'Hire.',
  '',
].join('\n');

function SourceProbe() {
  const { markdownSource } = useEditorContext();
  return <output data-testid="markdown-source">{markdownSource}</output>;
}

describe('the outline', () => {
  it('leaves summaries out', async () => {
    const { container } = render(
      <EditorProvider initialMarkdown={MARKDOWN} initialView="wysiwyg" articleId="test">
        <OutlinePanel />
      </EditorProvider>,
    );
    await screen.findByTestId('outline-panel');
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('.squisq-outline-row')].map((row) =>
          row.textContent?.trim(),
        ),
      ).toEqual(['Results', 'Detail', 'Plan']),
    );
  });

  it('changes a section’s summaries’ level with the section', async () => {
    render(
      <EditorProvider initialMarkdown={MARKDOWN} initialView="wysiwyg" articleId="test">
        <OutlinePanel />
        <SourceProbe />
      </EditorProvider>,
    );
    const demote = await screen.findAllByRole('button', {
      name: /Demote heading \(currently H2\)/,
    });
    fireEvent.click(demote[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('markdown-source').textContent).toContain(
        '### Results\n\nRevenue grew.\n\n#### Revenue grew {[summary]}\n\n- Up 40%\n\n##### Inside the summary',
      ),
    );
  });
});

describe('block cards', () => {
  it('hold a section’s summaries with the section', () => {
    const slices = getBlockSlices(MARKDOWN);
    expect(slices.map((slice) => slice.text.split('\n')[0])).toEqual([
      '## Results',
      '### Detail',
      '## Plan',
    ]);
    expect(slices[0]!.text).toContain('### Revenue grew {[summary]}');
  });
});

describe('inserting a block', () => {
  const at = (text: string) => MARKDOWN.indexOf(text);

  it('goes before a section’s summaries, never among them', () => {
    const { blocks } = sourceOutline(MARKDOWN);
    // Blocks: Results, para, summary, list, nested, Detail, para, Plan, para.
    expect(resolveOutlineInsertion(blocks, 3, 'afterBlock')).toMatchObject({
      index: 2,
      sectionDepth: 2,
    });
    expect(resolveOutlineInsertion(blocks, 4, 'sectionEnd')).toMatchObject({ index: 2 });
    expect(resolveOutlineInsertion(blocks, 1, 'sectionEnd')).toMatchObject({ index: 2 });
  });

  it('in the source, at the end of the section’s own text', () => {
    const point = blockInsertionPoint(MARKDOWN, at('Up 40%'), 'afterBlock');
    expect(MARKDOWN.slice(0, point.offset)).toBe('## Results\n\nRevenue grew.');
  });
});
