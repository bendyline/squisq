/**
 * Studying study cards kept with a section: the deck shows them labelled
 * with their section, can be limited to one kind, and tells the host how each
 * card went — against ids that last — so progress can be kept later.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { markdownToDoc, readStudyCards } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { FlashcardView } from '../FlashcardView';

const MARKDOWN = [
  '## Photosynthesis',
  '',
  'Plants turn light into sugar.',
  '',
  '### What do plants make? {[flashcard]}',
  '',
  'Sugar.',
  '',
  '### Where does it happen? {[quiz]}',
  '',
  '- [ ] In the roots',
  '- [x] In the leaves',
  '- [ ] In the flowers',
  '',
  'Leaves hold the chlorophyll.',
].join('\n');
const doc = markdownToDoc(parseMarkdown(MARKDOWN));
const [flashcard, question] = readStudyCards(doc).cards;

describe('studying study cards', () => {
  it('shows the cards labelled with their section, and reports each answer against its lasting key', () => {
    const onRate = vi.fn();
    const onAnswer = vi.fn();
    const onComplete = vi.fn();
    render(<FlashcardView doc={doc} onRate={onRate} onAnswer={onAnswer} onComplete={onComplete} />);

    expect(screen.getByText('What do plants make?')).toBeTruthy();
    expect(screen.getAllByText('Photosynthesis').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('Sugar.')).toBeTruthy();
    // Next rates the card “got it”.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onRate).toHaveBeenCalledWith({
      card: {
        id: flashcard!.key,
        kind: 'basic',
        sourceBlockId: flashcard!.accessoryBlockId,
        ownerBlockId: 'photosynthesis',
      },
      rating: 'got-it',
      retry: false,
    });

    fireEvent.click(screen.getByRole('button', { name: /In the flowers/ }));
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        card: expect.objectContaining({ id: question!.key, kind: 'multiple-choice' }),
        correct: false,
        retry: false,
      }),
    );
    expect(onAnswer.mock.calls[0]![0].choiceId).toMatch(new RegExp(`^${question!.key}:`));
    expect(screen.getByText('Leaves hold the chlorophyll.')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      remembered: 1,
      missed: 1,
      total: 2,
      retry: false,
    });
  });

  it('studies only the kinds asked for', () => {
    render(<FlashcardView doc={doc} kinds={['multiple-choice']} />);
    expect(screen.getByText('Where does it happen?')).toBeTruthy();
    expect(screen.queryByText('What do plants make?')).toBeNull();
    expect(screen.getByText('Card 1 of 1')).toBeTruthy();
  });

  it('picks the choice shown first with the 1 key', () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <FlashcardView doc={doc} kinds={['multiple-choice']} onAnswer={onAnswer} />,
    );
    const shown = [...container.querySelectorAll('.squisq-flashcards__choice')].map(
      (choice) => choice.textContent ?? '',
    );
    fireEvent.keyDown(container.querySelector('.squisq-flashcards')!, { key: '1' });
    const picked = question!.choices!.find((choice) =>
      onAnswer.mock.calls[0]![0].choiceId.endsWith(choice.key),
    );
    expect(shown[0]).toContain(picked!.text);
  });

  it('counts a question whose answer is shown unchosen as missed', () => {
    const onAnswer = vi.fn();
    render(<FlashcardView doc={doc} kinds={['multiple-choice']} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ choiceId: null, correct: false }),
    );
  });
});
