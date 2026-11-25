/**
 * Writing study cards into a document's markdown.
 *
 * {@link writeStudyCards} applies a list of changes — add a card under a
 * section, replace one, keep an AI card whose section changed, remove one —
 * with targeted edits, on the shared accessory block writer
 * (`accessoryBlockSource.ts`): a new card goes after its section's own text,
 * after the cards already there; a changed card has its heading and own body
 * replaced where it is; nothing else in the document is touched.
 *
 * Cards are addressed by their lasting key (`studyCardKey`), never by their
 * accessory block id, which changes when a card is added before them — so a
 * batch saved while an AI run is still adding cards cannot hit the wrong one.
 *
 * Every card is built as markdown nodes and stringified, so its text is
 * escaped, and the result is read back: a card that does not come back as
 * written (a question ending in `{…}`, which markdown reads as heading
 * settings) is left out and reported in `rejected`, never written wrong.
 */

import type {
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownList,
  MarkdownListItem,
  MarkdownParagraph,
} from '../../markdown/types.js';
import { parseMarkdown } from '../../markdown/parse.js';
import { extractPlainText } from '../../markdown/utils.js';
import type { SourceTextEdit } from '../../markdown/sourceTextEdits.js';
import { markdownToDoc } from '../markdownToDoc.js';
import { accessoryBlockMarkdown, openAccessoryBlockSource } from '../accessoryBlockSource.js';
import { ACCESSORY_BLOCK_OWNER_PARAM } from '../accessoryBlockTypes.js';
import { isPassageKey, sectionPassage } from '../sectionPassages.js';
import {
  readStudyCards,
  studyCardTextKey,
  type StudyCard,
  type StudyCardKind,
} from './studyCards.js';

/** A card to write: its content as markdown nodes, and who made it. */
export interface StudyCardDraft {
  kind: StudyCardKind;
  question: MarkdownInlineNode[];
  /** Flashcard: the answer. */
  answer?: MarkdownBlockNode[];
  /** Quiz: part of the question, before the choices. */
  prompt?: MarkdownBlockNode[];
  /** Quiz: the choices, exactly one correct. */
  choices?: Array<{ content: MarkdownBlockNode[]; correct: boolean }>;
  /** Quiz: why the right answer is right. */
  explanation?: MarkdownBlockNode[];
  /** Written by AI. */
  origin?: 'ai';
  /** The passage key of its section's text when AI wrote it. */
  passage?: string;
}

/** A card's fields as plain text (model output, a form): escaped when written. */
export interface StudyCardText {
  kind: StudyCardKind;
  question: string;
  answer?: string;
  prompt?: string;
  choices?: Array<{ text: string; correct: boolean }>;
  explanation?: string;
  origin?: 'ai';
  passage?: string;
}

export type StudyCardChange =
  /** A new card under `ownerId`, after the section's cards already there. */
  | { op: 'add'; ownerId: string; card: StudyCardDraft }
  /** Replace a card's content. Its origin and passage are the draft's: an edited card is yours. */
  | { op: 'update'; key: string; card: StudyCardDraft }
  /** An AI card whose section changed is still right: record the section's text as it is now. */
  | { op: 'keep'; key: string }
  | { op: 'remove'; key: string };

/** A change that was not written, and why. */
export interface StudyCardRejection {
  /** Its index in the changes given. */
  change: number;
  message: string;
  key?: string;
  ownerId?: string;
}

export interface StudyCardsWrite {
  /** Edits against the source, ascending and not overlapping. */
  edits: SourceTextEdit[];
  /** The source with the edits applied. */
  result: string;
  /** The cards `result` holds, as read back from it. */
  cards: StudyCard[];
  /** What could not be written, and why; the rest was. */
  rejected: StudyCardRejection[];
}

// ── Drafts ──────────────────────────────────────────────────────────────

const spaced = (text: string) => text.replace(/\s+/gu, ' ').trim();
const textNode = (value: string): MarkdownInlineNode => ({ type: 'text', value });
const paragraph = (children: MarkdownInlineNode[]): MarkdownParagraph => ({
  type: 'paragraph',
  children,
});

/** Plain text as paragraphs: blank lines separate them, other line breaks are spaces. */
function textParagraphs(text: string | undefined): MarkdownBlockNode[] {
  return (text ?? '')
    .split(/\n\s*\n/u)
    .map(spaced)
    .filter(Boolean)
    .map((part) => paragraph([textNode(part)]));
}

/** A card from plain text, as a model or a form gives it. */
export function studyCardDraftFromText(fields: StudyCardText): StudyCardDraft {
  return {
    kind: fields.kind,
    question: [textNode(spaced(fields.question))],
    ...(fields.kind === 'flashcard' ? { answer: textParagraphs(fields.answer) } : {}),
    ...(fields.kind === 'quiz'
      ? {
          prompt: textParagraphs(fields.prompt),
          choices: (fields.choices ?? []).map((choice) => ({
            content: textParagraphs(choice.text),
            correct: choice.correct,
          })),
          explanation: textParagraphs(fields.explanation),
        }
      : {}),
    ...(fields.origin ? { origin: fields.origin } : {}),
    ...(fields.passage ? { passage: fields.passage } : {}),
  };
}

/**
 * Block content typed as markdown, kept inside a card: a heading there would
 * end the card or nest in it, so it becomes a bold paragraph.
 */
function markdownBlocks(text: string | undefined): MarkdownBlockNode[] {
  if (!text?.trim()) return [];
  return parseMarkdown(text).children.map((node) =>
    node.type === 'heading'
      ? paragraph([{ type: 'strong', children: node.children } as MarkdownInlineNode])
      : node,
  );
}

/** Inline content typed as markdown: one paragraph's formatting kept, anything else as text. */
function markdownInline(text: string): MarkdownInlineNode[] {
  const nodes = parseMarkdown(text.replace(/\s+/gu, ' ').trim()).children;
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (only?.type === 'paragraph') return only.children;
  return [textNode(spaced(nodes.map((node) => extractPlainText(node)).join(' ')))];
}

/** A card from fields a person typed as markdown. */
export function studyCardDraftFromMarkdown(fields: StudyCardText): StudyCardDraft {
  return {
    kind: fields.kind,
    question: markdownInline(fields.question),
    ...(fields.kind === 'flashcard' ? { answer: markdownBlocks(fields.answer) } : {}),
    ...(fields.kind === 'quiz'
      ? {
          prompt: markdownBlocks(fields.prompt),
          choices: (fields.choices ?? []).map((choice) => ({
            content: [paragraph(markdownInline(choice.text))],
            correct: choice.correct,
          })),
          explanation: markdownBlocks(fields.explanation),
        }
      : {}),
    ...(fields.origin ? { origin: fields.origin } : {}),
    ...(fields.passage ? { passage: fields.passage } : {}),
  };
}

/** A card in the document, as a draft to change. */
export function studyCardDraftOf(card: StudyCard): StudyCardDraft {
  return {
    kind: card.kind,
    question: card.questionNodes,
    ...(card.answer ? { answer: card.answer } : {}),
    ...(card.prompt ? { prompt: card.prompt } : {}),
    ...(card.choices
      ? {
          choices: card.choices.map((choice) => ({
            content: choice.content,
            correct: choice.correct,
          })),
        }
      : {}),
    ...(card.explanation ? { explanation: card.explanation } : {}),
    ...(card.origin ? { origin: card.origin } : {}),
    ...(card.passage ? { passage: card.passage } : {}),
  };
}

const plainOf = (nodes: readonly (MarkdownBlockNode | MarkdownInlineNode)[] | undefined) =>
  spaced((nodes ?? []).map((node) => extractPlainText(node)).join(' '));

/** Why a draft cannot be a card, or null. */
export function studyCardDraftProblem(card: StudyCardDraft): string | null {
  if (!plainOf(card.question)) return 'A card needs a question.';
  if (card.kind === 'flashcard')
    return plainOf(card.answer) ? null : 'A flashcard needs an answer.';
  const choices = card.choices ?? [];
  if (choices.length < 2) return 'A question needs at least two choices.';
  if (choices.some((choice) => !plainOf(choice.content))) return 'A choice cannot be empty.';
  const correct = choices.filter((choice) => choice.correct).length;
  if (correct !== 1) return 'Tick exactly one choice as the right answer.';
  if (card.passage !== undefined && !isPassageKey(card.passage))
    return 'The card’s passage key is not valid.';
  return null;
}

// ── Writing ─────────────────────────────────────────────────────────────

/** What a card says, as compared after writing. */
function signature(card: StudyCardDraft | StudyCard, ownerId: string | undefined): string {
  const choices = 'choices' in card && card.choices ? card.choices : undefined;
  return JSON.stringify({
    kind: card.kind,
    owner: ownerId ?? null,
    question: studyCardTextKey(
      'questionNodes' in card ? plainOf(card.questionNodes) : plainOf(card.question),
    ),
    answer: plainOf(card.answer),
    prompt: plainOf(card.prompt),
    choices: (choices ?? []).map((choice) => [plainOf(choice.content), choice.correct]),
    explanation: plainOf(card.explanation),
    origin: card.origin ?? null,
    passage: card.passage ?? null,
  });
}

/** A card's body as markdown nodes. */
function bodyOf(card: StudyCardDraft): MarkdownBlockNode[] {
  if (card.kind === 'flashcard') return card.answer ?? [];
  const list: MarkdownList = {
    type: 'list',
    ordered: false,
    spread: false,
    children: (card.choices ?? []).map((choice): MarkdownListItem => ({
      type: 'listItem',
      checked: choice.correct,
      spread: false,
      children: choice.content,
    })),
  };
  return [...(card.prompt ?? []), list, ...(card.explanation ?? [])];
}

/** The tag settings a card is written with: its origin and passage, then any kept from before. */
function paramsOf(card: StudyCardDraft, kept: Record<string, string> = {}): Record<string, string> {
  const params: Record<string, string> = {};
  if (card.passage) params.passage = card.passage;
  if (card.origin) params.origin = card.origin;
  for (const [name, value] of Object.entries(kept))
    if (name !== 'passage' && name !== 'origin' && name !== ACCESSORY_BLOCK_OWNER_PARAM)
      params[name] = value;
  return params;
}

function cardMarkdown(
  card: StudyCardDraft,
  depth: number,
  of: string | undefined,
  kept?: Record<string, string>,
): string {
  const written = accessoryBlockMarkdown({
    type: card.kind,
    depth,
    title: card.question,
    params: paramsOf(card, kept),
    ...(of ? { of } : {}),
    body: bodyOf(card),
  });
  return written.body ? `${written.heading}\n\n${written.body}` : written.heading;
}

interface Attempt {
  edits: SourceTextEdit[];
  result: string;
  rejected: StudyCardRejection[];
  /** Per change written: the signature it should read back as. */
  expected: Map<number, string>;
}

function writeOnce(
  source: string,
  changes: readonly StudyCardChange[],
  skip: ReadonlySet<number>,
): Attempt {
  const located = openAccessoryBlockSource(source);
  const { doc, nodes } = located;
  const read = readStudyCards(doc);
  const byKey = new Map(read.cards.map((card) => [card.key, card]));
  const edits: SourceTextEdit[] = [];
  const rejected: StudyCardRejection[] = [];
  const expected = new Map<number, string>();
  const touched = new Set<string>();
  const startOf = (node: MarkdownBlockNode) => node.position?.start.offset ?? -1;
  const endOf = (node: MarkdownBlockNode) => node.position?.end.offset ?? -1;
  /** New cards, grouped where they go so a run of them is one insertion. */
  const insertions = new Map<
    string,
    { at: number; depth: number; ownerId: string; cards: number[] }
  >();

  changes.forEach((change, index) => {
    if (skip.has(index)) return;
    const reject = (message: string, extra: Partial<StudyCardRejection> = {}) =>
      rejected.push({ change: index, message, ...extra });
    if (change.op === 'add') {
      const problem = studyCardDraftProblem(change.card);
      if (problem) return reject(problem, { ownerId: change.ownerId });
      const zone = located.zone(change.ownerId, change.card.kind);
      if (!zone || !sectionPassage(doc, change.ownerId))
        return reject('The section this card is for is not in the document.', {
          ownerId: change.ownerId,
        });
      const slot = `${zone.end}\u0000${change.ownerId}`;
      const group = insertions.get(slot) ?? {
        at: zone.end,
        depth: zone.depth,
        ownerId: change.ownerId,
        cards: [],
      };
      group.cards.push(index);
      insertions.set(slot, group);
      expected.set(index, signature(change.card, change.ownerId));
      return;
    }
    const card = byKey.get(change.key);
    if (!card) return reject('This card is no longer in the document.', { key: change.key });
    if (touched.has(change.key))
      return reject('This card is changed twice in one save.', { key: change.key });
    touched.add(change.key);
    const block = located.byId.get(card.accessoryBlockId);
    if (!block) return reject('This card is no longer in the document.', { key: change.key });

    if (change.op === 'remove') {
      const edit = located.deletion(block);
      if (edit) edits.push(edit);
      return;
    }
    if (change.op === 'keep') {
      const current = card.ownerId ? sectionPassage(doc, card.ownerId) : undefined;
      if (!current || card.origin !== 'ai')
        return reject('Only an AI card kept with a section can be kept.', { key: change.key });
      if (card.passage === current.key) return;
      const edit = located.headingEdit(block, { passage: current.key });
      if (!edit) return reject('This card’s heading cannot be changed.', { key: change.key });
      edits.push(edit);
      expected.set(index, signature({ ...card, passage: current.key }, card.ownerId));
      return;
    }
    // update: the heading line and the card's own body, where they differ.
    const problem = studyCardDraftProblem(change.card);
    if (problem) return reject(problem, { key: change.key });
    if (change.card.kind !== card.kind)
      return reject('A card cannot change from a flashcard to a quiz question.', {
        key: change.key,
      });
    const headingIndex = located.headingIndex(block);
    const heading = nodes[headingIndex];
    if (!heading?.position || heading.type !== 'heading')
      return reject('This card’s heading cannot be changed.', { key: change.key });
    const naturalOwner = located.ownerAt(headingIndex, heading.depth);
    const of = card.ownerId && card.ownerId !== naturalOwner ? card.ownerId : undefined;
    const bodyEnd = located.nextHeadingIndex(headingIndex + 1);
    const lastOwn = bodyEnd - 1 > headingIndex ? nodes[bodyEnd - 1]! : heading;
    const start = startOf(heading);
    const end = endOf(lastOwn);
    const text = located.toEol(
      cardMarkdown(change.card, heading.depth, of, block.templateOverrides ?? {}),
    );
    if (source.slice(start, end) !== text) edits.push({ start, end, text });
    expected.set(index, signature(change.card, card.ownerId));
  });

  for (const group of insertions.values()) {
    const edit = located.insertion(group.at, group.depth, group.ownerId, (of) =>
      group.cards.map((index) => {
        const change = changes[index] as Extract<StudyCardChange, { op: 'add' }>;
        return cardMarkdown(change.card, group.depth, of);
      }),
    );
    if (edit) edits.push(edit);
  }

  const finished = located.finish(edits);
  return { ...finished, rejected, expected };
}

/** Indexes of changes whose card did not read back as written. */
function unwritten(attempt: Attempt): Set<number> {
  const back = readStudyCards(markdownToDoc(parseMarkdown(attempt.result))).cards;
  const pool = new Map<string, number>();
  for (const card of back) {
    const key = signature(card, card.ownerId);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  const failed = new Set<number>();
  for (const [index, key] of attempt.expected) {
    const left = pool.get(key) ?? 0;
    if (left > 0) pool.set(key, left - 1);
    else failed.add(index);
  }
  return failed;
}

function failureMessage(change: StudyCardChange): string {
  const question =
    change.op === 'add' || change.op === 'update' ? plainOf(change.card.question) : '';
  return /\{[^}]*\}\s*$/u.test(question)
    ? 'A question cannot end in {…}: markdown reads that as heading settings.'
    : 'This card could not be written as given.';
}

/** Apply changes to the study cards in `source` (see the module comment). */
export function writeStudyCards(
  source: string,
  changes: readonly StudyCardChange[],
): StudyCardsWrite {
  let attempt = writeOnce(source, changes, new Set());
  const failed = unwritten(attempt);
  if (failed.size) {
    attempt = writeOnce(source, changes, failed);
    const again = unwritten(attempt);
    attempt.rejected.push(
      ...[...failed, ...again].map((index) => ({
        change: index,
        message: failureMessage(changes[index]!),
        ...(changes[index]!.op === 'add'
          ? { ownerId: (changes[index] as Extract<StudyCardChange, { op: 'add' }>).ownerId }
          : { key: (changes[index] as Exclude<StudyCardChange, { op: 'add' }>).key }),
      })),
    );
    if (again.size) {
      // What still did not read back is left out too, so nothing is written wrong.
      attempt = writeOnce(source, changes, new Set([...failed, ...again]));
    }
  }
  return {
    edits: attempt.edits,
    result: attempt.result,
    cards: readStudyCards(markdownToDoc(parseMarkdown(attempt.result))).cards,
    rejected: attempt.rejected.sort((a, b) => a.change - b.change),
  };
}
