import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { FlashcardView } from '../FlashcardView';

function doc(markdown: string) {
  return markdownToDoc(parseMarkdown(markdown));
}

describe('FlashcardView', () => {
  it('progressively reveals a basic answer and records self-assessment', () => {
    render(
      <FlashcardView
        doc={doc(
          '---\ntitle: Web facts\n---\n\n## What is HTTP 418?\n\n### Answer\n\nI am a teapot.\n\n## Capital of France\n\nParis.\n',
        )}
      />,
    );

    expect(screen.getByText('Web facts')).toBeTruthy();
    expect(screen.getByText('What is HTTP 418?')).toBeTruthy();
    expect(screen.queryByText('I am a teapot.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('I am a teapot.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Capital of France')).toBeTruthy();
  });

  it('grades a multiple-choice answer and reveals the correct choice', () => {
    render(
      <FlashcardView
        doc={doc(
          '## Forces {study=multiple-choice-flashcard}\n\n### Which is a force unit?\n\n### Newton\n\n### Joule\n\n### Watt\n',
        )}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Joule/ }));
    expect(screen.getByText('Not quite')).toBeTruthy();
    expect(screen.getByText('The correct answer is')).toBeTruthy();
    expect(screen.getAllByText('Newton').length).toBeGreaterThanOrEqual(1);
  });

  it('supports keyboard reveal and a retry-missed session', () => {
    const { container } = render(<FlashcardView doc={doc('## One\n\nAnswer one.\n')} />);
    const root = container.querySelector('.squisq-flashcards')!;

    fireEvent.keyDown(root, { key: ' ' });
    expect(screen.getByText('Answer one.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));

    expect(screen.getByText('Session complete')).toBeTruthy();
    expect(screen.getByText('1 card needs another look.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry missed' }));
    expect(screen.getByText('Card 1 of 1')).toBeTruthy();
  });

  it('renders a useful empty state and materialization diagnostics', () => {
    render(<FlashcardView doc={doc('## Empty {study=flashcard}\n')} />);
    expect(screen.getByText('No complete flashcards yet')).toBeTruthy();
    expect(screen.getByText(/has no content for its answer/)).toBeTruthy();
  });

  it('keeps navigation outside the scrollable card content viewport', () => {
    const { container } = render(<FlashcardView doc={doc('## Question\n\nAnswer.\n')} />);
    const cardViewport = screen.getByRole('main', { name: 'Scrollable flashcard content' });
    const footer = container.querySelector('.squisq-flashcards__footer');
    expect(cardViewport.classList.contains('squisq-flashcards__card')).toBe(true);
    expect(cardViewport.nextElementSibling).toBe(footer);
  });

  it('spends no rows on an eyebrow, progress bar or shortcut hint, reading progress beside Previous', () => {
    const { container } = render(
      <FlashcardView doc={doc('---\ntitle: Web facts\n---\n\n## Question\n\nAnswer.\n')} />,
    );
    expect(screen.queryByText('Flashcards')).toBeNull();
    expect(container.querySelector('.squisq-flashcards__shortcut-hint')).toBeNull();

    const previous = screen.getByRole('button', { name: 'Previous' });
    const progressGroup = previous.nextElementSibling!;
    expect(
      progressGroup.parentElement!.parentElement!.classList.contains('squisq-flashcards__footer'),
    ).toBe(true);
    expect(progressGroup.textContent).toBe('Card 1 of 1');
    // The progress bar rides under the position instead of a row of its own.
    expect(container.querySelectorAll('.squisq-flashcards__progress')).toHaveLength(1);
    expect(progressGroup.querySelector('.squisq-flashcards__progress')).toBeTruthy();
    // The buttons carry the shortcuts the hint line used to spell out.
    expect(previous.getAttribute('title')).toBe('Previous (←)');
    expect(screen.getByRole('button', { name: 'Reveal' }).getAttribute('title')).toBe(
      'Reveal (Space or →)',
    );

    // The revealed answer carries no visible eyebrow, only its accessible name.
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    const answer = screen.getByRole('region', { name: 'Answer' });
    expect(answer.textContent).toBe('Answer.');
    expect(answer.querySelector('.squisq-flashcards__answer-label')).toBeNull();
  });

  it('moves the buttons into rails beside the card only while the deck is landscape', () => {
    // jsdom has no layout: size the deck by test and drive its ResizeObserver.
    let deckSize = { width: 1200, height: 600 };
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const size = this.classList.contains('squisq-flashcards')
          ? deckSize
          : { width: 0, height: 0 };
        return DOMRect.fromRect(size);
      });
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const resize = (size: { width: number; height: number }) => {
      deckSize = size;
      act(() => resizeCallbacks.forEach((callback) => callback()));
    };
    const ratingOrder = (container: HTMLElement) =>
      Array.from(
        container.querySelectorAll('.squisq-flashcards__primary-actions button'),
        (button) => button.textContent,
      );
    try {
      const deck = doc('## One\n\nAnswer one.\n\n## Two\n\nAnswer two.\n');
      const { container, rerender } = render(<FlashcardView doc={deck} />);
      const root = container.querySelector('.squisq-flashcards')!;
      expect(root.classList.contains('squisq-flashcards--side-rails')).toBe(true);
      // The rails are the footer's two groups, so tab order is unchanged.
      expect(container.querySelector('.squisq-flashcards__back')!.textContent).toContain(
        'Card 1 of 2',
      );
      // A rail stacks the primary action on top, in the DOM as on screen.
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
      expect(ratingOrder(container)).toEqual(['Next', 'Again']);

      // Inside the hysteresis band (1.1–1.2) the rails stay; below it they go.
      resize({ width: 1150, height: 1000 });
      expect(root.classList.contains('squisq-flashcards--side-rails')).toBe(true);
      resize({ width: 1000, height: 1000 });
      expect(root.classList.contains('squisq-flashcards--side-rails')).toBe(false);
      // A row ends on the primary action.
      expect(ratingOrder(container)).toEqual(['Again', 'Next']);
      // Landscape but too narrow for two rails and a readable card.
      resize({ width: 800, height: 500 });
      expect(root.classList.contains('squisq-flashcards--side-rails')).toBe(false);

      resize({ width: 1200, height: 600 });
      rerender(<FlashcardView density="compact" doc={deck} />);
      expect(root.classList.contains('squisq-flashcards--side-rails')).toBe(false);
    } finally {
      rectSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('puts every control in one toolbar above the card when compact', () => {
    const { container } = render(
      <FlashcardView
        density="compact"
        doc={doc('---\ntitle: Web facts\n---\n\n## What is HTTP 418?\n\nI am a teapot.\n')}
      />,
    );
    const root = container.querySelector('.squisq-flashcards')!;
    expect(root.classList.contains('squisq-flashcards--compact')).toBe(true);

    const header = container.querySelector('.squisq-flashcards__header')!;
    for (const name of ['Shuffle', 'Restart', 'Previous', 'Reveal']) {
      expect(header.contains(screen.getByRole('button', { name }))).toBe(true);
    }
    expect(header.textContent).toContain('Web facts');
    expect(header.textContent).toContain('Card 1 of 1');
    expect(screen.queryByText('Flashcards')).toBeNull();
    expect(container.querySelector('.squisq-flashcards__footer')).toBeNull();
    expect(container.querySelector('.squisq-flashcards__progress')).toBeTruthy();
    const reveal = screen.getByRole('button', { name: 'Reveal' });
    expect(reveal.getAttribute('aria-keyshortcuts')).toBe('Space ArrowRight');
    expect(reveal.getAttribute('title')).toBe('Reveal (Space or →)');

    fireEvent.click(reveal);
    expect(screen.getByText('I am a teapot.')).toBeTruthy();
    // The last card's "got it" finishes the session.
    expect(header.contains(screen.getByRole('button', { name: 'Finish' }))).toBe(true);
  });

  it('scrolls a revealed answer below the fold into view, never past its start', () => {
    // jsdom has no layout: place the card viewport at 0–300 and the answer by test.
    let answerRect = { top: 0, bottom: 0 };
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const box = this.classList.contains('squisq-flashcards__card')
          ? { top: 0, bottom: 300 }
          : this.classList.contains('squisq-flashcards__answer')
            ? answerRect
            : { top: 0, bottom: 0 };
        return DOMRect.fromRect({ y: box.top, height: box.bottom - box.top });
      });
    try {
      render(<FlashcardView doc={doc('## One\n\nAnswer one.\n\n## Two\n\nAnswer two.\n')} />);
      const card = screen.getByRole('main', { name: 'Scrollable flashcard content' });

      // Its end is 120px below the fold: scroll just that far.
      answerRect = { top: 200, bottom: 420 };
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
      expect(card.scrollTop).toBe(120);

      // Taller than the card: stop with its start just inside the top.
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(card.scrollTop).toBe(0);
      answerRect = { top: 250, bottom: 900 };
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
      expect(card.scrollTop).toBe(238);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('renders an ASCII diagram through the existing visual template pipeline', () => {
    const { container } = render(
      <FlashcardView
        doc={doc(
          '## Architecture {study=flashcard}\n\nName the flow.\n\n### System Overview\n\n```text\n┌─────────┐     ┌───────────┐     ┌──────────┐\n│ Extract │ ──> │ Transform │ ──> │   Load   │\n└─────────┘     └───────────┘     └──────────┘\n```\n',
        )}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(container.querySelector('.squisq-flashcards__canvas svg')).toBeTruthy();
    expect(container.querySelector('.squisq-flashcards__answer pre')).toBeNull();
  });
});
