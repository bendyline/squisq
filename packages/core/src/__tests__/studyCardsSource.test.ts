/**
 * Writing study cards: placed after a section's own text and its cards
 * already there, edited where they are, addressed by their lasting key,
 * escaped, read back before they count as written — and adding them changes
 * nothing that is narrated, shown or exported.
 */
import { describe, expect, it } from 'vitest';
import {
  studyCardDraftFromMarkdown,
  studyCardDraftFromText,
  studyCardDraftOf,
  writeStudyCards,
  type StudyCardChange,
} from '../doc/flashcards/studyCardsSource';
import { readStudyCards, studyCardKey } from '../doc/flashcards/studyCards';
import { passageKey, sectionPassages } from '../doc/sectionPassages';
import { pruneAccessoryBlocks, withoutAccessoryBlocks } from '../doc/accessoryBlocks';
import { buildNarrationScript } from '../narration/script';
import { docChapters } from '../timing/captionFiles';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';
import { materializePageSections } from '../doc/page/materializePageSection';
import { createPresentationPlan } from '../transform/presentationPlanner';
import { applyTransform } from '../transform/applyTransform';
import { getTransformStyleIds } from '../transform/registry';
import { writePresentationHints } from '../transform/presentationHintsSource';
import { DOCUMENTS, convert, strip } from './accessoryBlockFixtures';

const DOC = [
  '## Photosynthesis',
  '',
  'Plants turn light into sugar.',
  '',
  '### Light',
  '',
  'Leaves catch the light.',
  '',
  '## Water',
  '',
  'Roots drink water.',
  '',
].join('\n');

const flashcard = (
  question: string,
  answer: string,
  extra: Partial<Parameters<typeof studyCardDraftFromText>[0]> = {},
) => studyCardDraftFromText({ kind: 'flashcard', question, answer, ...extra });
const quiz = (question: string, choices: Array<[string, boolean]>, explanation?: string) =>
  studyCardDraftFromText({
    kind: 'quiz',
    question,
    choices: choices.map(([text, correct]) => ({ text, correct })),
    ...(explanation ? { explanation } : {}),
  });
const add = (ownerId: string, card: ReturnType<typeof flashcard>): StudyCardChange => ({
  op: 'add',
  ownerId,
  card,
});

describe('adding study cards', () => {
  it('goes after the section’s own text, at its first sub-section’s depth', () => {
    const written = writeStudyCards(DOC, [
      add('photosynthesis', flashcard('What do plants make?', 'Sugar.')),
      add(
        'photosynthesis',
        quiz(
          'Where?',
          [
            ['In the roots', false],
            ['In the leaves', true],
          ],
          'Leaves hold the chlorophyll.',
        ),
      ),
    ]);
    expect(written.rejected).toEqual([]);
    expect(written.result).toBe(
      DOC.replace(
        '### Light',
        [
          '### What do plants make? {[flashcard]}',
          '',
          'Sugar.',
          '',
          '### Where? {[quiz]}',
          '',
          '- [ ] In the roots',
          '- [x] In the leaves',
          '',
          'Leaves hold the chlorophyll.',
          '',
          '### Light',
        ].join('\n'),
      ),
    );
    expect(written.cards.map((card) => [card.kind, card.ownerId, card.usable])).toEqual([
      ['flashcard', 'photosynthesis', true],
      ['quiz', 'photosynthesis', true],
    ]);
  });

  it('goes after the cards already there, and after the section’s slide summaries', () => {
    const once = writeStudyCards(DOC, [add('water', flashcard('First?', 'One.'))]).result;
    const withSummary = once.replace(
      '### First? {[flashcard]}',
      '### A slide {[summary]}\n\n- A point\n\n### First? {[flashcard]}',
    );
    const twice = writeStudyCards(withSummary, [add('water', flashcard('Second?', 'Two.'))]);
    expect(
      twice.result.endsWith(
        '### First? {[flashcard]}\n\nOne.\n\n### Second? {[flashcard]}\n\nTwo.\n',
      ),
    ).toBe(true);
    // A summary written later still goes before the cards.
    const design = writePresentationHints(twice.result, {
      version: 1,
      density: 'balanced',
      inbetweens: true,
      blocks: [{ blockId: 'water', slides: [{ headline: 'Opening', points: ['Point'] }] }],
    });
    const order = readStudyCards(convert(design.result)).cards.map((card) => card.question);
    expect(order).toEqual(['First?', 'Second?']);
    expect(design.result.indexOf('Opening')).toBeLessThan(design.result.indexOf('First?'));
  });

  it('names its section where it cannot nest under it, and records an AI card’s passage', () => {
    const deep = '# A\n\nText.\n\n###### Six\n\nDeep text.\n';
    const passage = passageKey('Deep text.');
    const written = writeStudyCards(deep, [
      add('six', flashcard('How deep?', 'Six.', { origin: 'ai', passage })),
    ]);
    expect(written.result).toBe(
      `${deep}\n###### How deep? {[flashcard passage=${passage} origin=ai of=six]}\n\nSix.\n`,
    );
    expect(written.cards[0]).toMatchObject({ ownerId: 'six', origin: 'ai', stale: false });
  });

  it('keeps line endings and changes nothing else', () => {
    const crlf = DOC.replace(/\n/g, '\r\n');
    const written = writeStudyCards(crlf, [add('water', flashcard('Why?', 'Thirst.'))]);
    expect(written.result).toBe(`${crlf}\r\n### Why? {[flashcard]}\r\n\r\nThirst.\r\n`);
  });
});

describe('what cannot be written', () => {
  it('leaves out a card that would not read back, and writes the rest', () => {
    const written = writeStudyCards(DOC, [
      add('water', flashcard('Ends in settings {study=flashcard}', 'Never written.')),
      add('water', flashcard('Fine?', 'Yes.')),
    ]);
    expect(written.rejected).toEqual([
      expect.objectContaining({ change: 0, message: expect.stringContaining('cannot end in {…}') }),
    ]);
    expect(written.cards.map((card) => card.question)).toEqual(['Fine?']);
    expect(written.result).not.toContain('Never written');
  });

  it('refuses a card with no answer, too few choices or not exactly one ticked', () => {
    const changes: StudyCardChange[] = [
      add('water', flashcard('No answer?', '')),
      add('water', quiz('One choice?', [['Only', true]])),
      add(
        'water',
        quiz('Two ticked?', [
          ['A', true],
          ['B', true],
        ]),
      ),
      add('missing', flashcard('Nowhere?', 'Gone.')),
    ];
    const written = writeStudyCards(DOC, changes);
    expect(written.result).toBe(DOC);
    expect(written.rejected.map((item) => item.change)).toEqual([0, 1, 2, 3]);
    expect(written.rejected[3]!.message).toBe(
      'The section this card is for is not in the document.',
    );
  });

  it('escapes text that markdown would read as formatting or structure', () => {
    const awkward = [
      'A *starred* question # with [brackets]?',
      'Ends with a colon:',
      '1. Looks like a list?',
    ];
    const written = writeStudyCards(
      DOC,
      awkward.map((question) =>
        add('water', flashcard(question, '- not a list\n\n# not a heading')),
      ),
    );
    expect(written.rejected).toEqual([]);
    expect(written.cards.map((card) => card.question)).toEqual(awkward);
  });
});

describe('changing study cards', () => {
  const START = writeStudyCards(DOC, [
    add(
      'water',
      flashcard('Why water?', 'Roots drink it.', {
        origin: 'ai',
        passage: passageKey('Roots drink water.'),
      }),
    ),
    add(
      'water',
      quiz('Which part?', [
        ['Roots', true],
        ['Petals', false],
      ]),
    ),
  ]).result;
  const keyOf = (question: string, kind: 'flashcard' | 'quiz' = 'flashcard') =>
    studyCardKey(kind, question);

  it('replaces only the card that changes, by its key, and an edited AI card becomes yours', () => {
    const card = readStudyCards(convert(START)).cards[0]!;
    const written = writeStudyCards(START, [
      {
        op: 'update',
        key: card.key,
        card: {
          ...studyCardDraftOf(card),
          answer: flashcard('x', 'Roots soak it up.').answer,
          origin: undefined,
          passage: undefined,
        },
      },
    ]);
    expect(written.rejected).toEqual([]);
    expect(written.result).toBe(
      START.replace(
        /### Why water\? \{\[flashcard[^\n]*\n\nRoots drink it\./u,
        '### Why water? {[flashcard]}\n\nRoots soak it up.',
      ),
    );
    expect(written.cards[0]!.key).toBe(card.key);
    expect(written.cards[0]!.origin).toBeUndefined();
  });

  it('keeps an AI card whose section changed by recording the section as it is now', () => {
    const changed = START.replace('Roots drink water.', 'Roots drink a lot of water.');
    const before = readStudyCards(convert(changed)).cards[0]!;
    expect(before.stale).toBe(true);
    const kept = writeStudyCards(changed, [{ op: 'keep', key: before.key }]);
    expect(kept.cards[0]).toMatchObject({
      stale: false,
      origin: 'ai',
      passage: passageKey('Roots drink a lot of water.'),
    });
    // A card someone wrote cannot be kept: there is nothing to check.
    expect(
      writeStudyCards(changed, [{ op: 'keep', key: keyOf('Which part?', 'quiz') }]).rejected,
    ).toHaveLength(1);
  });

  it('removes a card by its key, at the end of the document too', () => {
    const written = writeStudyCards(START, [
      { op: 'remove', key: keyOf('Why water?') },
      { op: 'remove', key: keyOf('Which part?', 'quiz') },
    ]);
    expect(written.result).toBe(DOC);
  });

  it('is idempotent: writing a card as it is touches nothing', () => {
    const cards = readStudyCards(convert(START)).cards;
    const written = writeStudyCards(
      START,
      cards.map((card) => ({ op: 'update', key: card.key, card: studyCardDraftOf(card) })),
    );
    expect(written.edits).toEqual([]);
    expect(written.result).toBe(START);
  });

  it('finds a card by key even after cards were added before it', () => {
    const shifted = writeStudyCards(START, [
      add('photosynthesis', flashcard('Earlier?', 'Yes.')),
    ]).result;
    const removed = writeStudyCards(shifted, [{ op: 'remove', key: keyOf('Which part?', 'quiz') }]);
    expect(readStudyCards(convert(removed.result)).cards.map((card) => card.question)).toEqual([
      'Earlier?',
      'Why water?',
    ]);
  });

  it('reads cards typed as markdown, keeping formatting and keeping headings inside the card', () => {
    const draft = studyCardDraftFromMarkdown({
      kind: 'flashcard',
      question: 'What is *chlorophyll*?',
      answer: '# A pigment\n\nIt makes leaves **green**.',
    });
    const written = writeStudyCards(DOC, [add('water', draft)]);
    expect(written.result).toContain(
      '### What is *chlorophyll*? {[flashcard]}\n\n**A pigment**\n\nIt makes leaves **green**.',
    );
    expect(written.cards[0]!.question).toBe('What is chlorophyll?');
  });
});

describe('study cards change nothing else', () => {
  for (const [name, md] of Object.entries(DOCUMENTS)) {
    it(`leaves ${name} narrated, shown, planned and transformed exactly as before`, () => {
      const changes: StudyCardChange[] = sectionPassages(convert(md)).flatMap((section, index) => [
        add(
          section.blockId,
          flashcard(`Card ${index}?`, `Answer ${index}.`, { origin: 'ai', passage: section.key }),
        ),
        add(
          section.blockId,
          quiz(`Question ${index}?`, [
            [`Right ${index}`, true],
            [`Wrong ${index}`, false],
          ]),
        ),
      ]);
      const written = writeStudyCards(md, changes);
      expect(written.rejected).toEqual([]);
      expect(written.cards.length).toBe(changes.length);
      expect(written.cards.every((card) => card.usable && !card.stale)).toBe(true);
      const before = convert(md, 'notes.md');
      const after = convert(written.result, 'notes.md');
      expect(strip(pruneAccessoryBlocks(after.blocks))).toEqual(strip(before.blocks));
      expect(after.duration).toBe(before.duration);
      expect(buildNarrationScript(after)).toEqual(buildNarrationScript(before));
      expect(docChapters(after)).toEqual(docChapters(before));
      expect(strip(buildPreviewDoc(after))).toEqual(strip(buildPreviewDoc(before)));
      expect(strip(materializePageSections(after))).toEqual(strip(materializePageSections(before)));
      expect(createPresentationPlan(after)).toEqual(createPresentationPlan(before));
      for (const style of getTransformStyleIds())
        expect(strip(withoutAccessoryBlocks(applyTransform(after, style).doc)), style).toEqual(
          strip(applyTransform(before, style).doc),
        );
    });
  }
});
