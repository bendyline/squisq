import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    expect(screen.getByText('I am a teapot.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
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
    for (const name of ['Shuffle', 'Restart', 'Previous', 'Reveal answer']) {
      expect(header.contains(screen.getByRole('button', { name }))).toBe(true);
    }
    expect(header.textContent).toContain('Web facts');
    expect(header.textContent).toContain('Card 1 of 1');
    expect(screen.queryByText('Flashcards')).toBeNull();
    expect(container.querySelector('.squisq-flashcards__footer')).toBeNull();
    expect(container.querySelector('.squisq-flashcards__shortcut-hint')).toBeNull();
    // The shortcut hint line is gone, so the buttons carry the shortcuts.
    const reveal = screen.getByRole('button', { name: 'Reveal answer' });
    expect(reveal.getAttribute('aria-keyshortcuts')).toBe('Space ArrowRight');
    expect(reveal.getAttribute('title')).toBe('Reveal answer (Space or →)');

    fireEvent.click(reveal);
    expect(screen.getByText('I am a teapot.')).toBeTruthy();
    expect(header.contains(screen.getByRole('button', { name: 'Got it' }))).toBe(true);
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
      fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
      expect(card.scrollTop).toBe(120);

      // Taller than the card: stop with its start just inside the top.
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(card.scrollTop).toBe(0);
      answerRect = { top: 250, bottom: 900 };
      fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    expect(container.querySelector('.squisq-flashcards__canvas svg')).toBeTruthy();
    expect(container.querySelector('.squisq-flashcards__answer pre')).toBeNull();
  });
});
