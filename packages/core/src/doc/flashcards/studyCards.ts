/**
 * Study cards kept with a section.
 *
 * A study card is an accessory block (see `accessoryBlockTypes.ts`) under the
 * section it is about:
 *
 * ```markdown
 * ### What do plants make from light? {[flashcard]}
 *
 * Sugar, which stores the energy.
 *
 * ### Where does it happen? {[quiz]}
 *
 * - [ ] In the roots
 * - [x] In the chloroplasts
 *
 * Chloroplasts hold the chlorophyll.
 * ```
 *
 * A flashcard's heading is its question and its body the answer. A quiz
 * question's heading is the question, its first list the choices — a
 * checklist with exactly one ticked — and anything after the list the
 * explanation (anything before it is part of the question). Cards are flat:
 * a heading nested inside one is part of it and never shown.
 *
 * A card made by AI says so (`origin=ai`) and records its section's passage
 * key (`passage=`), so it can be flagged for review when the section's text
 * changes. Every card has a key that stays the same when cards are reordered
 * or moved, a section is renamed, or an answer is fixed: the key of its kind
 * and question. It is what a host records answers against.
 */

import type { Block, Doc } from '../../schemas/Doc.js';
import type {
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownList,
  MarkdownListItem,
} from '../../markdown/types.js';
import { extractPlainText } from '../../markdown/utils.js';
import { hashString } from '../../random/SeededRandom.js';
import { collectAccessoryBlocks } from '../accessoryBlocks.js';
import { ACCESSORY_BLOCK_OWNER_PARAM } from '../accessoryBlockTypes.js';
import { isPassageKey, sectionPassage } from '../sectionPassages.js';

/** The two kinds of study card, by the accessory block type that holds them. */
export type StudyCardKind = 'flashcard' | 'quiz';
export const STUDY_CARD_KINDS: readonly StudyCardKind[] = ['flashcard', 'quiz'];

/** True for a study card's accessory block type. */
export function isStudyCardKind(value: unknown): value is StudyCardKind {
  return value === 'flashcard' || value === 'quiz';
}

/** One choice of a quiz question. */
export interface StudyCardChoice {
  /** Stays the same when choices are reordered: the key of its text. */
  key: string;
  /** Its plain text. */
  text: string;
  /** What the list item holds. */
  content: MarkdownBlockNode[];
  correct: boolean;
}

export interface StudyCard {
  /** The card's lasting identity: `studyCardKey(kind, question)`, or its `key=` setting. */
  key: string;
  kind: StudyCardKind;
  /** The accessory block holding it (ordinal: it changes when cards are added before it). */
  accessoryBlockId: string;
  /** The section it is about. */
  ownerId?: string;
  /** 1-based line of its heading. */
  line?: number;
  /** The question, as plain text. */
  question: string;
  /** The question as written, formatting kept. */
  questionNodes: MarkdownInlineNode[];
  /** Quiz: anything between the heading and the choices, part of the question. */
  prompt?: MarkdownBlockNode[];
  /** Flashcard: the answer. */
  answer?: MarkdownBlockNode[];
  /** Quiz: the choices, in the order written. */
  choices?: StudyCardChoice[];
  /** Quiz: why the right answer is right. */
  explanation?: MarkdownBlockNode[];
  /** Written by AI. */
  origin?: 'ai';
  /** The passage key of its section's text when AI wrote it. */
  passage?: string;
  /** Written by AI, and its section's text has changed since. */
  stale: boolean;
  /** Can be studied: it has no error. */
  usable: boolean;
}

export type StudyCardIssueCode =
  | 'card-no-question'
  | 'card-no-answer'
  | 'quiz-no-choices'
  | 'quiz-plain-list'
  | 'quiz-too-few-choices'
  | 'quiz-no-correct'
  | 'quiz-several-correct'
  | 'quiz-empty-choice'
  | 'quiz-duplicate-choice'
  | 'card-bad-passage'
  | 'card-bad-origin'
  | 'card-bad-key'
  | 'card-unknown-setting'
  | 'card-no-owner'
  | 'card-owner-missing'
  | 'card-nested-heading'
  | 'card-duplicate';

export interface StudyCardIssue {
  code: StudyCardIssueCode;
  /** An error leaves the card out of the deck; a warning does not. */
  severity: 'error' | 'warning';
  /** A plain sentence for the person who wrote the card. */
  message: string;
  accessoryBlockId: string;
  cardKey?: string;
  ownerId?: string;
  line?: number;
}

export interface StudyCardsRead {
  /** Every card, usable or not, in document order. */
  cards: StudyCard[];
  issues: StudyCardIssue[];
}

/** The settings a card's tag may carry. */
const CARD_SETTINGS = new Set(['origin', 'passage', 'key', ACCESSORY_BLOCK_OWNER_PARAM]);
const KEY_SETTING_RE = /^[0-9a-z][0-9a-z-]{0,63}$/u;

/** Text as compared for sameness: letters and digits, lower-cased, single-spaced. */
export function studyCardTextKey(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A card's lasting identity: its kind and its question, as compared for sameness. */
export function studyCardKey(kind: StudyCardKind, question: string): string {
  const text = studyCardTextKey(question);
  return `${kind === 'quiz' ? 'q' : 'f'}${hashString(text).toString(36)}-${text.length.toString(36)}`;
}

const spaced = (text: string) => text.replace(/\s+/gu, ' ').trim();
const plain = (nodes: readonly (MarkdownBlockNode | MarkdownInlineNode)[]) =>
  spaced(nodes.map((node) => extractPlainText(node)).join(' '));

/** True when a document holds any study card block. */
export function hasStudyCards(doc: Doc): boolean {
  return collectAccessoryBlocks(doc.blocks).some((block) =>
    isStudyCardKind(block.accessoryBlock?.type),
  );
}

/** Read every study card in a document, with what is wrong with any of them. */
export function readStudyCards(doc: Doc): StudyCardsRead {
  const cards: StudyCard[] = [];
  const issues: StudyCardIssue[] = [];
  const seen = new Map<string, number>();
  for (const block of collectAccessoryBlocks(doc.blocks)) {
    const kind = block.accessoryBlock?.type;
    if (!isStudyCardKind(kind)) continue;
    const read = readCard(doc, block, kind);
    // Two cards asking the same question get the same key; the later ones are
    // told apart by their place, and warned about.
    const count = seen.get(read.card.key) ?? 0;
    seen.set(read.card.key, count + 1);
    if (count > 0) {
      read.issues.push(issueOf(read.card, 'card-duplicate', 'warning'));
      read.card.key = `${read.card.key}~${count + 1}`;
      for (const issue of read.issues) issue.cardKey = read.card.key;
    }
    cards.push(read.card);
    issues.push(...read.issues);
  }
  return { cards, issues };
}

const MESSAGES: Record<StudyCardIssueCode, string> = {
  'card-no-question': 'This card has no question. Write it in the heading.',
  'card-no-answer': 'This flashcard has no answer. Write the answer under its heading.',
  'quiz-no-choices':
    'This question has no choices. Add a list under it, one line per choice: "- [ ] A wrong answer", "- [x] The right answer".',
  'quiz-plain-list':
    'The list under this question has no checkboxes. Write each choice as "- [ ] …" and tick the right one: "- [x] …".',
  'quiz-too-few-choices': 'A question needs at least two choices.',
  'quiz-no-correct': 'No choice is ticked. Tick the right answer: "- [x] …".',
  'quiz-several-correct': 'More than one choice is ticked. Tick only the right answer.',
  'quiz-empty-choice': 'One of the choices is empty.',
  'quiz-duplicate-choice': 'Two choices say the same thing.',
  'card-bad-passage':
    'The passage= setting is not a passage key, so this card cannot be checked against its section. Remove it, or make the card again.',
  'card-bad-origin': 'The origin= setting is not known; use origin=ai or leave it out.',
  'card-bad-key':
    'The key= setting should be letters, digits and hyphens; the card’s question is used instead.',
  'card-unknown-setting': 'This card has a setting cards do not use.',
  'card-no-owner':
    'This card is at the top of the document, with no text before the first heading for it to be about.',
  'card-owner-missing': 'This card names a section (of=) that is not in the document.',
  'card-nested-heading':
    'A heading under this card counts as part of it and is not shown. Put it at the card’s level or above.',
  'card-duplicate': 'Another card above asks the same question.',
};

function issueOf(
  card: Pick<StudyCard, 'key' | 'accessoryBlockId' | 'ownerId' | 'line'>,
  code: StudyCardIssueCode,
  severity: StudyCardIssue['severity'],
  detail?: string,
): StudyCardIssue {
  return {
    code,
    severity,
    message: detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code],
    accessoryBlockId: card.accessoryBlockId,
    cardKey: card.key,
    ...(card.ownerId ? { ownerId: card.ownerId } : {}),
    ...(card.line !== undefined ? { line: card.line } : {}),
  };
}

function readCard(
  doc: Doc,
  block: Block,
  kind: StudyCardKind,
): { card: StudyCard; issues: StudyCardIssue[] } {
  const params = block.templateOverrides ?? {};
  const question = spaced(block.title ?? '');
  const ownerId = block.accessoryBlock?.of;
  const line = block.sourceHeading?.position?.start.line;
  const pinned =
    params.key !== undefined && KEY_SETTING_RE.test(params.key) ? params.key : undefined;
  const card: StudyCard = {
    key: pinned ?? studyCardKey(kind, question),
    kind,
    accessoryBlockId: block.id,
    ...(ownerId ? { ownerId } : {}),
    ...(line !== undefined ? { line } : {}),
    question,
    questionNodes: block.sourceHeading?.children ?? [],
    stale: false,
    usable: true,
  };
  const issues: StudyCardIssue[] = [];
  const add = (code: StudyCardIssueCode, severity: StudyCardIssue['severity'], detail?: string) =>
    issues.push(issueOf(card, code, severity, detail));

  // Settings.
  if (params.origin !== undefined) {
    if (params.origin === 'ai') card.origin = 'ai';
    else add('card-bad-origin', 'warning');
  }
  if (params.passage !== undefined) {
    if (isPassageKey(params.passage)) card.passage = params.passage;
    else add('card-bad-passage', 'warning');
  }
  if (params.key !== undefined && !pinned) add('card-bad-key', 'warning');
  for (const name of Object.keys(params))
    if (!CARD_SETTINGS.has(name)) add('card-unknown-setting', 'warning', `(${name})`);

  // Its section.
  if (!ownerId) add('card-no-owner', 'warning');
  else if (!sectionPassage(doc, ownerId)) add('card-owner-missing', 'warning');
  if ((block.children ?? []).length > 0) add('card-nested-heading', 'warning');

  if (!question) add('card-no-question', 'error');

  // The body: everything up to the next heading of any depth.
  const body = block.contents ?? [];
  if (kind === 'flashcard') {
    if (body.length && plain(body)) card.answer = body;
    else add('card-no-answer', 'error');
  } else {
    readQuizBody(card, body, add);
  }

  // Flagged when AI wrote it from text the section no longer says.
  if (card.origin === 'ai' && card.passage && ownerId) {
    const current = sectionPassage(doc, ownerId);
    card.stale = !!current && current.key !== card.passage;
  }
  card.usable = !issues.some((issue) => issue.severity === 'error');
  return { card, issues };
}

function readQuizBody(
  card: StudyCard,
  body: MarkdownBlockNode[],
  add: (code: StudyCardIssueCode, severity: StudyCardIssue['severity'], detail?: string) => void,
): void {
  const listIndex = body.findIndex((node): node is MarkdownList => node.type === 'list');
  if (listIndex < 0) {
    add('quiz-no-choices', 'error');
    return;
  }
  const list = body[listIndex] as MarkdownList;
  if (listIndex > 0) card.prompt = body.slice(0, listIndex);
  const after = body.slice(listIndex + 1);
  if (after.length && plain(after)) card.explanation = after;

  const items = list.children as MarkdownListItem[];
  if (!items.some((item) => item.checked === true || item.checked === false)) {
    add('quiz-plain-list', 'error');
    return;
  }
  const choices: StudyCardChoice[] = items.map((item) => {
    const text = plain(item.children ?? []);
    return {
      key: `c${hashString(studyCardTextKey(text)).toString(36)}`,
      text,
      content: item.children ?? [],
      correct: item.checked === true,
    };
  });
  card.choices = choices;
  if (choices.some((choice) => !choice.text)) add('quiz-empty-choice', 'error');
  if (choices.length < 2) add('quiz-too-few-choices', 'error');
  const correct = choices.filter((choice) => choice.correct).length;
  if (correct === 0) add('quiz-no-correct', 'error');
  if (correct > 1) add('quiz-several-correct', 'error');
  const texts = choices.map((choice) => studyCardTextKey(choice.text)).filter(Boolean);
  if (new Set(texts).size < texts.length) add('quiz-duplicate-choice', 'warning');
}
