import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import {
  materializeFlashcards,
  resolveFlashcardMarker,
} from '../doc/flashcards/materializeFlashcards.js';

function deck(markdown: string) {
  return materializeFlashcards(markdownToDoc(parseMarkdown(markdown)));
}

describe('materializeFlashcards', () => {
  it('maps a leaf heading title to the front and its body to the back', () => {
    const result = deck('## Capital of France\n\nParis.\n');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].front.blocks[0].title).toBe('Capital of France');
    expect(result.cards[0].front.blocks[0].contents).toBeUndefined();
    expect(result.cards[0].back.blocks[0].title).toBeUndefined();
    expect(result.cards[0].back.blocks[0].contents).toHaveLength(1);
    expect(result.title).toBeUndefined();
  });

  it('preserves an authored deck title even when it matches the first question', () => {
    const result = deck('---\ntitle: Capital of France\n---\n\n## Capital of France\n\nParis.\n');
    expect(result.title).toBe('Capital of France');
  });

  it('uses parent-owned content as the front and one child as the back', () => {
    const result = deck(
      '## What is HTTP 418?\n\nName the response.\n\n### Answer\n\nI am a teapot.\n',
    );
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].front.blocks[0]).toMatchObject({ title: 'What is HTTP 418?' });
    expect(result.cards[0].back.blocks[0]).toMatchObject({ title: 'Answer' });
  });

  it('uses child one as the front and children two through N as the back', () => {
    const result = deck(
      '## Forces {study=flashcard}\n\nHelpful explanation.\n\n### State the law\n\n### Formula\n\nF = ma.\n\n### Meaning\n\nForce is mass times acceleration.\n',
    );
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ kind: 'basic', label: 'Forces' });
    expect(result.cards[0].front.blocks.map((block) => block.title)).toEqual(['State the law']);
    expect(result.cards[0].back.blocks.map((block) => block.title)).toEqual(['Formula', 'Meaning']);
    expect(result.cards[0].explanation?.blocks).toHaveLength(1);
  });

  it('treats an outer empty heading as a group when its children are complete cards', () => {
    const result = deck(
      '# Geography\n\n## France\n\n### Answer\n\nParis.\n\n## Japan\n\n### Answer\n\nTokyo.\n',
    );
    expect(result.cards.map((card) => card.sourceBlockId)).toEqual(['france', 'japan']);
  });

  it('builds multiple-choice choices, honors an explicit correct marker, and keeps an explanation', () => {
    const result = deck(
      '## Forces {study=multiple-choice-flashcard}\n\nBecause force is measured in newtons.\n\n### Which is a force unit?\n\n### Joule\n\n### Newton {correct=true}\n\n### Watt\n',
    );
    const card = result.cards[0];
    expect(card.kind).toBe('multiple-choice');
    expect(card.front.blocks[0].title).toBe('Which is a force unit?');
    expect(card.choices).toHaveLength(3);
    expect(card.choices?.find((choice) => choice.correct)?.sourceBlockId).toBe('newton');
    expect(card.back.blocks[0].title).toBe('Newton');
    expect(card.explanation).toBeDefined();
  });

  it('uses the second child as the positional correct answer when no marker is present', () => {
    const result = deck(
      '## Quiz {study=multiplechoiceflashcard}\n\n### Question\n\n### Correct\n\n### Fake\n',
    );
    expect(result.cards[0].choices?.map((choice) => choice.correct)).toEqual([true, false]);
  });

  it('can restrict discovery to explicit cards and supports class aliases', () => {
    const doc = markdownToDoc(
      parseMarkdown('## Automatic\n\nBody.\n\n## Marked {.flashcard}\n\nAnswer.\n'),
    );
    const result = materializeFlashcards(doc, { source: 'explicit' });
    expect(result.cards.map((card) => card.sourceBlockId)).toEqual(['marked']);
    expect(resolveFlashcardMarker(doc.blocks[1])).toBe('basic');
  });

  it('reports and skips explicit cards without an answer', () => {
    const result = deck('## Empty {study=flashcard}\n');
    expect(result.cards).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'empty-back', blockId: 'empty' }),
    );
  });
});
