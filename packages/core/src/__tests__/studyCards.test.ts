/**
 * Reading study cards kept with a section: `{[flashcard]}` and `{[quiz]}`
 * accessory blocks, their lasting keys, what is wrong with a malformed one,
 * and when an AI card is flagged because its section's text changed.
 */
import { describe, expect, it } from 'vitest';
import { hasStudyCards, readStudyCards, studyCardKey } from '../doc/flashcards/studyCards';
import { passageKey, sectionPassage } from '../doc/sectionPassages';
import { validateMarkdownSource } from '../doc/validate';
import { STUDY_CARD_EXAMPLE, studyCardGuide } from '../doc/flashcards/studyCardGuide';
import { convert } from './accessoryBlockFixtures';

const SECTION = 'Plants turn light into sugar.';
const EXAMPLE = [
  '## Photosynthesis',
  '',
  SECTION,
  '',
  `### What do plants make from light? {[flashcard origin=ai passage=${passageKey(SECTION)}]}`,
  '',
  'Sugar, which stores the energy.',
  '',
  `### Where does it happen? {[quiz origin=ai passage=${passageKey(SECTION)}]}`,
  '',
  '- [ ] In the roots',
  '- [x] In the chloroplasts',
  '- [ ] In the mitochondria',
  '',
  'Chloroplasts hold the chlorophyll.',
].join('\n');
const read = (md: string) => readStudyCards(convert(md));
const codes = (md: string) => read(md).issues.map((issue) => issue.code);
/** A quiz question with `body` under it, in a section. */
const quiz = (body: string, tag = '{[quiz]}') =>
  `## Topic\n\nSome text about it.\n\n### A question? ${tag}\n\n${body}`;

describe('reading study cards', () => {
  it('reads a flashcard and a quiz question, with their section', () => {
    const { cards, issues } = read(EXAMPLE);
    expect(issues).toEqual([]);
    expect(cards).toHaveLength(2);
    const [flashcard, question] = cards;
    expect(flashcard).toMatchObject({
      kind: 'flashcard',
      question: 'What do plants make from light?',
      ownerId: 'photosynthesis',
      origin: 'ai',
      passage: passageKey(SECTION),
      stale: false,
      usable: true,
    });
    expect(flashcard!.answer).toHaveLength(1);
    expect(question).toMatchObject({ kind: 'quiz', question: 'Where does it happen?' });
    expect(question!.choices!.map((choice) => [choice.text, choice.correct])).toEqual([
      ['In the roots', false],
      ['In the chloroplasts', true],
      ['In the mitochondria', false],
    ]);
    expect(question!.explanation).toHaveLength(1);
    expect(hasStudyCards(convert(EXAMPLE))).toBe(true);
    expect(hasStudyCards(convert('## A slide {[summary]}\n\n- Point'))).toBe(false);
  });

  it('keeps a card’s key when cards are reordered or moved, the section renamed or the answer fixed', () => {
    const keys = (md: string) => read(md).cards.map((card) => card.key);
    const [flashcardKey, quizKey] = keys(EXAMPLE);
    expect(flashcardKey).toBe(studyCardKey('flashcard', 'What do plants make from light?'));
    expect(keys(EXAMPLE.replace('## Photosynthesis', '## How plants eat'))).toEqual([
      flashcardKey,
      quizKey,
    ]);
    expect(keys(EXAMPLE.replace('Sugar, which', 'Glucose, which'))[0]).toBe(flashcardKey);
    const moved = `## Elsewhere\n\nOther text.\n\n${EXAMPLE.split('\n').slice(4, 7).join('\n')}`;
    expect(keys(moved)).toEqual([flashcardKey]);
    // A choice keeps its key when the choices are reordered.
    const choiceKeys = (md: string) =>
      Object.fromEntries(read(md).cards[1]!.choices!.map((choice) => [choice.text, choice.key]));
    expect(
      choiceKeys(
        EXAMPLE.replace(
          '- [ ] In the roots\n- [x] In the chloroplasts',
          '- [x] In the chloroplasts\n- [ ] In the roots',
        ),
      ),
    ).toEqual(choiceKeys(EXAMPLE));
    // Rewording the question makes it a new card.
    expect(keys(EXAMPLE.replace('Where does it happen?', 'Where in the plant?'))[1]).not.toBe(
      quizKey,
    );
  });

  it('tells apart two cards asking the same question, and honours a pinned key', () => {
    const twice = `${EXAMPLE}\n\n### What do plants make from light? {[flashcard]}\n\nSugar.`;
    const { cards, issues } = read(twice);
    expect(cards[2]!.key).toBe(`${cards[0]!.key}~2`);
    expect(issues.map((issue) => issue.code)).toEqual(['card-duplicate']);
    expect(read(quiz('- [x] Yes\n- [ ] No', '{[quiz key=my-card]}')).cards[0]!.key).toBe('my-card');
  });

  it('flags an AI card when its section’s text changes, and only then', () => {
    expect(
      read(EXAMPLE.replace(SECTION, `${SECTION}\nIt is called photosynthesis.`)).cards.map(
        (card) => card.stale,
      ),
    ).toEqual([true, true]);
    expect(
      read(EXAMPLE.replace('## Photosynthesis', '## Renamed {#photosynthesis}')).cards.every(
        (card) => !card.stale,
      ),
    ).toBe(true);
    // A card someone wrote themselves is never flagged.
    const own = EXAMPLE.replace(/ origin=ai passage=[\w-]+/g, '').replace(SECTION, 'Changed.');
    expect(read(own).cards.every((card) => !card.stale)).toBe(true);
    expect(sectionPassage(convert(EXAMPLE), 'photosynthesis')!.key).toBe(passageKey(SECTION));
  });

  it('says what is wrong with a malformed card, and leaves it out of the deck when it cannot be studied', () => {
    const errors: Array<[string, string]> = [
      [quiz('No list at all.'), 'quiz-no-choices'],
      [quiz('- Plain\n- List'), 'quiz-plain-list'],
      [quiz('- [x] Only one'), 'quiz-too-few-choices'],
      [quiz('- [ ] One\n- [ ] Two'), 'quiz-no-correct'],
      [quiz('- [x] One\n- [x] Two'), 'quiz-several-correct'],
      ['## Topic\n\nText.\n\n### Lonely question? {[flashcard]}', 'card-no-answer'],
      ['## Topic\n\nText.\n\n### {[flashcard]}\n\nAn answer.', 'card-no-question'],
    ];
    for (const [md, code] of errors) {
      const result = read(md);
      expect(
        result.issues.map((issue) => issue.code),
        code,
      ).toContain(code);
      expect(result.issues.find((issue) => issue.code === code)?.severity, code).toBe('error');
      expect(result.cards[0]!.usable, code).toBe(false);
    }
  });

  it('warns about settings and placement without leaving the card out', () => {
    const warnings: Array<[string, string]> = [
      [quiz('- [x] A\n- [ ] A'), 'quiz-duplicate-choice'],
      [quiz('- [x] A\n- [ ] B', '{[quiz passage=abc]}'), 'card-bad-passage'],
      [quiz('- [x] A\n- [ ] B', '{[quiz origin=me]}'), 'card-bad-origin'],
      [quiz('- [x] A\n- [ ] B', '{[quiz key=Not_A_Key!]}'), 'card-bad-key'],
      [quiz('- [x] A\n- [ ] B', '{[quiz colour=red]}'), 'card-unknown-setting'],
      [quiz('- [x] A\n- [ ] B\n\n#### Inside the card\n\nHidden.'), 'card-nested-heading'],
      ['## Real\n\nText.\n\n## A question? {[flashcard of=gone]}\n\nAnswer.', 'card-owner-missing'],
    ];
    for (const [md, code] of warnings) {
      const result = read(md);
      expect(
        result.issues.map((issue) => issue.code),
        code,
      ).toContain(code);
      expect(result.issues.find((issue) => issue.code === code)?.severity, code).toBe('warning');
      expect(result.cards[0]!.usable, code).toBe(true);
    }
    expect(codes(quiz('- [x] A\n- [ ] B', '{[quiz of=topic]}'))).toEqual([]);
  });

  it('keeps what comes before the choices as part of the question', () => {
    const card = read(quiz('Look at the leaf first.\n\n- [x] Green\n- [ ] Blue')).cards[0]!;
    expect(card.prompt).toHaveLength(1);
    expect(card.choices).toHaveLength(2);
    expect(card.explanation).toBeUndefined();
  });

  it('names the line and the section of each issue', () => {
    const issue = read(quiz('- [ ] One\n- [ ] Two')).issues[0]!;
    expect(issue).toMatchObject({ ownerId: 'topic', line: 5, accessoryBlockId: 'topic~quiz' });
    expect(issue.message).toContain('Tick the right answer');
  });
});

describe('validating study cards', () => {
  it('reports what is wrong with a card as a warning on its line', () => {
    const found = validateMarkdownSource(quiz('- [x] One\n- [x] Two')).diagnostics.find(
      (diagnostic) => diagnostic.code === 'study-quiz-several-correct',
    );
    expect(found).toMatchObject({ severity: 'warning', blockId: 'topic~quiz', line: 5 });
    expect(
      validateMarkdownSource(EXAMPLE).diagnostics.filter((d) => d.code.startsWith('study-')),
    ).toEqual([]);
  });
});

describe('the study card guide', () => {
  it('shows cards exactly as the reader expects them', () => {
    const { cards, issues } = read(STUDY_CARD_EXAMPLE);
    expect(issues).toEqual([]);
    expect(cards.map((card) => [card.kind, card.ownerId, card.usable])).toEqual([
      ['flashcard', 'photosynthesis', true],
      ['quiz', 'photosynthesis', true],
    ]);
    expect(studyCardGuide().join(' ')).toContain('{[flashcard]}');
  });
});
