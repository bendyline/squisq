import { describe, expect, it } from 'vitest';
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
});
