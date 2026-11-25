/**
 * @vitest-environment jsdom
 *
 * Use › Flashcards studies a document's study cards even under a summary
 * style, whose projection leaves every accessory block out, and tells the
 * host how each card went.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider } from '../PreviewControls';
import { PreviewPanel, type FlashcardStudyCallbacks } from '../PreviewPanel';

afterEach(cleanup);

function Shell({ study }: { study?: FlashcardStudyCallbacks }) {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <PreviewPanel flashcardStudy={study} />
    </PreviewSettingsProvider>
  );
}

const MARKDOWN = [
  '---',
  'display-mode: flashcards',
  'squisq-transform: documentary',
  '---',
  '',
  '## Photosynthesis',
  '',
  'Plants turn light into sugar. The leaves catch the light and the roots bring the water.',
  '',
  '### What do plants make from light? {[flashcard]}',
  '',
  'Sugar, which stores the energy.',
  '',
  '## Water',
  '',
  'Roots drink water.',
].join('\n');

describe('studying a document’s study cards in the preview', () => {
  it('shows its study cards under a summary style, and reports how each went', async () => {
    const onRate = vi.fn();
    render(
      <EditorProvider initialMarkdown={MARKDOWN} initialView="preview">
        <Shell study={{ onRate }} />
      </EditorProvider>,
    );
    expect(await screen.findByText('What do plants make from light?')).toBeTruthy();
    expect(screen.getByText('Card 1 of 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('Sugar, which stores the energy.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onRate).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 'got-it',
        card: expect.objectContaining({ ownerBlockId: 'photosynthesis' }),
      }),
    );
  });
});
