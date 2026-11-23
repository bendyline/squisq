import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { FlashcardView, type FlashcardControls } from '../FlashcardView';

const DECK = markdownToDoc(
  parseMarkdown(
    '## What is HTTP 418?\n\n### Answer\n\nI am a teapot.\n\n## Capital of France\n\nParis.\n',
  ),
);

function renderWithHostControls() {
  const seen: { current: FlashcardControls | null } = { current: null };
  const result = render(
    <FlashcardView
      doc={DECK}
      renderControls={(controls) => {
        seen.current = controls;
        return <output data-testid="host-controls">{controls.cardIndex}</output>;
      }}
    />,
  );
  return { ...result, controls: () => seen.current! };
}

describe('FlashcardView renderControls', () => {
  it("draws the host's controls instead of its own toolbar and footer", () => {
    const { container, controls } = renderWithHostControls();

    expect(screen.getByTestId('host-controls')).toBeTruthy();
    for (const name of ['Shuffle', 'Restart', 'Previous', 'Reveal']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(container.querySelector('.squisq-flashcards__footer')).toBeNull();
    expect(controls()).toMatchObject({
      cardIndex: 0,
      cardCount: 2,
      revealed: false,
      finished: false,
      cardKind: 'basic',
      canGoBack: false,
      progress: 0,
    });
  });

  it('drives the deck through the actions it hands the host', () => {
    const { controls } = renderWithHostControls();

    act(() => controls().next());
    expect(screen.getByText('I am a teapot.')).toBeTruthy();
    expect(controls()).toMatchObject({ revealed: true, canGoBack: true, progress: 0.5 });

    act(() => controls().rate('again'));
    expect(screen.getByText('Capital of France')).toBeTruthy();
    expect(controls()).toMatchObject({ cardIndex: 1, lastCard: true, missedCount: 1 });

    act(() => controls().next());
    act(() => controls().rate('got-it'));
    expect(screen.getByText('Session complete')).toBeTruthy();
    expect(controls()).toMatchObject({ finished: true, cardIndex: 2, progress: 1 });
    // The summary keeps its own actions; Previous is the host's.
    expect(screen.getByRole('button', { name: 'Retry missed' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Previous card' })).toBeNull();

    act(() => controls().retryMissed());
    expect(controls()).toMatchObject({ cardIndex: 0, cardCount: 1, finished: false });

    act(() => controls().toggleShuffle());
    expect(controls()).toMatchObject({ shuffled: true, cardCount: 2 });
  });
});
