import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { strip } from './accessoryBlockFixtures';
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

  it('makes a card of each section of a document whose title has an introduction', () => {
    const result = deck(
      '# Welcome\n\nAn ordinary document.\n\n## Write\n\n- Type to add text.\n\n## Share\n\nExport it.\n\n## Present\n\nEach heading is a slide.\n',
    );
    expect(result.title).toBe('Welcome');
    expect(result.cards.map((card) => card.sourceBlockId)).toEqual(['write', 'share', 'present']);
    expect(result.cards.map((card) => card.front.blocks[0].title)).toEqual([
      'Write',
      'Share',
      'Present',
    ]);
  });

  it('keeps an introduction over an Answer section as one card', () => {
    const result = deck(
      '## What is HTTP 418?\n\nName the response.\n\n### Hint\n\nTea.\n\n### Answer\n\nI am a teapot.\n',
    );
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].sourceBlockId).toBe('what-is-http-418');
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

  it('leaves a study card kept with a section to the card reader, and keeps every marker', () => {
    // A programmatic block may still carry the old template-like names; the
    // two that now mark accessory blocks are no longer heading markers.
    const doc = markdownToDoc(parseMarkdown('## Question\n\nAnswer.\n'));
    const block = { ...doc.blocks[0]!, template: 'quiz' };
    expect(resolveFlashcardMarker(block)).toBeUndefined();
    expect(resolveFlashcardMarker({ ...block, template: 'flashcard' })).toBeUndefined();
    expect(resolveFlashcardMarker({ ...block, template: 'deck' })).toBe('group');
    const marked = markdownToDoc(
      parseMarkdown('## Pick one {study=quiz}\n\n### Q\n\n### A {correct=true}\n\n### B\n'),
    );
    expect(resolveFlashcardMarker(marked.blocks[0]!)).toBe('multiple-choice');
  });

  describe('with study cards kept with a section', () => {
    const DOC = [
      '## Photosynthesis',
      '',
      'Plants turn light into sugar.',
      '',
      '### What do plants make? {[flashcard origin=ai]}',
      '',
      'Sugar.',
      '',
      '## Marked {study=flashcard}',
      '',
      'A marked card’s answer.',
      '',
      '## Water',
      '',
      'Roots drink water.',
      '',
      '### Which part drinks? {[quiz]}',
      '',
      '- [ ] Petals',
      '- [x] Roots',
      '',
      'Roots take up water.',
      '',
      '### Broken? {[quiz]}',
      '',
      '- [ ] No tick',
      '- [ ] Anywhere',
    ].join('\n');
    const docOf = (md: string) => markdownToDoc(parseMarkdown(md));

    it('studies the study cards and marked cards, in document order, each labelled with its section', () => {
      const result = materializeFlashcards(docOf(DOC));
      expect(
        result.cards.map((card) => [card.kind, card.label, card.front.blocks[0]?.title]),
      ).toEqual([
        ['basic', 'Photosynthesis', 'What do plants make?'],
        ['basic', undefined, 'Marked'],
        ['multiple-choice', 'Water', 'Which part drinks?'],
      ]);
      const [flashcard, , question] = result.cards;
      expect(flashcard).toMatchObject({ ownerBlockId: 'photosynthesis', origin: 'ai' });
      expect(flashcard!.id).toMatch(/^f/);
      expect(question!.choices!.map((choice) => choice.correct)).toEqual([false, true]);
      expect(question!.back).toEqual(question!.choices![1]!.content);
      expect(question!.explanation?.blocks[0]?.contents).toHaveLength(1);
      // The broken question is left out and said why.
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'quiz-no-correct', severity: 'error' }),
      );
    });

    it('chooses its source: study cards only, headings only, or study and marked cards', () => {
      const titles = (source: 'cards' | 'headings' | 'explicit') =>
        materializeFlashcards(docOf(DOC), { source }).cards.map(
          (card) => card.front.blocks[0]?.title,
        );
      expect(titles('cards')).toEqual(['What do plants make?', 'Which part drinks?']);
      expect(titles('explicit')).toEqual(['What do plants make?', 'Marked', 'Which part drinks?']);
      // From headings, a study card is never a card or part of one.
      expect(titles('headings')).not.toContain('What do plants make?');
      expect(
        JSON.stringify(materializeFlashcards(docOf(DOC), { source: 'headings' })),
      ).not.toContain('Sugar.');
    });

    it('infers cards from headings exactly as before in a document with no study cards', () => {
      const plain = '## One\n\nFirst answer.\n\n## Two\n\nSecond answer.\n';
      expect(materializeFlashcards(docOf(plain))).toEqual(
        materializeFlashcards(docOf(plain), { source: 'headings' }),
      );
      const withSummary = plain.replace('## Two', '### A slide {[summary]}\n\n- Point\n\n## Two');
      expect(strip(materializeFlashcards(docOf(withSummary)))).toEqual(
        strip(materializeFlashcards(docOf(plain))),
      );
    });

    it('keeps each card’s id when cards are reordered', () => {
      const ids = (md: string) =>
        materializeFlashcards(docOf(md), { source: 'cards' }).cards.map((card) => card.id);
      const swapped = DOC.replace(
        '### What do plants make? {[flashcard origin=ai]}\n\nSugar.',
        'Plants also need water.',
      ).replace(
        '## Water\n\nRoots drink water.',
        '## Water\n\nRoots drink water.\n\n### What do plants make? {[flashcard origin=ai]}\n\nSugar.',
      );
      expect(new Set(ids(swapped))).toEqual(new Set(ids(DOC)));
    });
  });
});
