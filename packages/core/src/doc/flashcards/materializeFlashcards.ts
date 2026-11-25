/**
 * Flashcard-mode projection.
 *
 * Flashcards are a study rendition of a document, not a visual template. A
 * deck is made from two kinds of source:
 *
 * - **Study cards kept with a section** — `{[flashcard]}` / `{[quiz]}`
 *   accessory blocks (see `studyCards.ts`), each labelled with its section.
 * - **The heading tree** — cards inferred from heading structure, or marked
 *   with `{study=flashcard}` / `{study=multiple-choice-flashcard}`.
 *
 * A document holding any study card block is studied from its study cards
 * and its marked cards; without one, cards are inferred from its headings as
 * they always have been. The projection keeps rich Markdown nodes and nested
 * blocks intact so React and future exporters can render the same authored
 * content without reducing cards to strings.
 */

import type { Block, Doc } from '../../schemas/Doc.js';
import type { MarkdownBlockNode } from '../../markdown/types.js';
import { withoutAccessoryBlocks } from '../accessoryBlocks.js';
import { isAccessoryBlockType } from '../accessoryBlockTypes.js';
import { flattenBlocks } from '../markdownToDoc.js';
import {
  hasStudyCards,
  readStudyCards,
  type StudyCard,
  type StudyCardIssueCode,
} from './studyCards.js';

export type FlashcardKind = 'basic' | 'multiple-choice';
/**
 * Where a deck's cards come from: `auto` (study cards and marked cards when
 * the document has study cards, otherwise cards inferred from headings),
 * `explicit` (study cards and marked cards), `headings` (cards inferred from
 * headings, study cards left out), `cards` (study cards only).
 */
export type FlashcardSourceMode = 'auto' | 'explicit' | 'headings' | 'cards';

export interface FlashcardFace {
  /** Blocks rendered on this face, in source order. */
  blocks: Block[];
}

export interface FlashcardChoice {
  id: string;
  sourceBlockId: string;
  content: FlashcardFace;
  correct: boolean;
}

export interface Flashcard {
  /** For a study card, its lasting key (`studyCardKey`); otherwise its block's id. */
  id: string;
  sourceBlockId: string;
  kind: FlashcardKind;
  /** A study card's section. */
  ownerBlockId?: string;
  /** A study card written by AI. */
  origin?: 'ai';
  /** Optional parent heading used as a compact deck/category label. */
  label?: string;
  front: FlashcardFace;
  /** Basic-card answer, or the correct answer for a multiple-choice card. */
  back: FlashcardFace;
  choices?: FlashcardChoice[];
  /** Parent-owned body shown after reveal/grading for multi-child cards. */
  explanation?: FlashcardFace;
}

export type FlashcardDiagnosticCode =
  | 'empty-front'
  | 'empty-back'
  | 'multiple-choice-needs-distractor'
  | 'multiple-correct-answers'
  | StudyCardIssueCode;

export interface FlashcardDiagnostic {
  severity: 'warning' | 'error';
  code: FlashcardDiagnosticCode;
  message: string;
  blockId: string;
}

export interface FlashcardDeck {
  title?: string;
  cards: Flashcard[];
  diagnostics: FlashcardDiagnostic[];
}

export interface MaterializeFlashcardsOptions {
  /** Where the cards come from (see {@link FlashcardSourceMode}); `auto` by default. */
  source?: FlashcardSourceMode;
}

type FlashcardMarker = FlashcardKind | 'group';

const GENERIC_ANSWER_TITLES = new Set([
  'answer',
  'back',
  'solution',
  'explanation',
  'correct answer',
  'correct',
  'distractor',
  'option',
]);

function normalizeMarker(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
    : '';
}

function markerFromValue(value: unknown): FlashcardMarker | undefined {
  const normalized = normalizeMarker(value);
  if (normalized === 'flashcard' || normalized === 'card' || normalized === 'basicflashcard') {
    return 'basic';
  }
  if (
    normalized === 'multiplechoiceflashcard' ||
    normalized === 'multiplechoice' ||
    normalized === 'quiz'
  ) {
    return 'multiple-choice';
  }
  if (normalized === 'group' || normalized === 'flashcardgroup' || normalized === 'deck') {
    return 'group';
  }
  return undefined;
}

/** Resolve an authored study marker without changing the visual template model. */
export function resolveFlashcardMarker(block: Block): FlashcardMarker | undefined {
  const metadataMarker =
    markerFromValue(block.metadata?.study) ?? markerFromValue(block.metadata?.['study-mode']);
  if (metadataMarker) return metadataMarker;

  for (const className of block.classes ?? []) {
    const classMarker = markerFromValue(className);
    if (classMarker) return classMarker;
  }

  // Programmatic Docs and early adopters may already use template-like names.
  // Admit those as semantic aliases, but the canonical Markdown authoring form
  // remains `{study=...}` so visual templates and study behavior stay separate.
  // A name that marks an accessory block (`{[flashcard]}`, `{[quiz]}`) is a
  // study card kept with its section, read by `readStudyCards`, never this.
  if (isAccessoryBlockType(block.template)) return undefined;
  return markerFromValue(block.template);
}

function hasTitle(block: Block): boolean {
  return typeof block.title === 'string' && block.title.trim().length > 0;
}

function hasBody(block: Block): boolean {
  return (
    (block.contents?.length ?? 0) > 0 ||
    (block.media?.length ?? 0) > 0 ||
    (block.layers?.length ?? 0) > 0
  );
}

function hasOwnContent(block: Block): boolean {
  return hasTitle(block) || hasBody(block);
}

function isGenericAnswerBlock(block: Block): boolean {
  return hasTitle(block) && GENERIC_ANSWER_TITLES.has(block.title!.trim().toLowerCase());
}

function selfOnly(block: Block): Block {
  const { children: _children, ...self } = block;
  return self;
}

function titleOnly(block: Block): Block {
  const {
    children: _children,
    contents: _contents,
    media: _media,
    layers: _layers,
    ...title
  } = block;
  return title;
}

function bodyOnly(block: Block): Block {
  const { children: _children, title: _title, ...body } = block;
  return body;
}

function face(...blocks: Block[]): FlashcardFace {
  return { blocks };
}

function isTrue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['true', 'yes', 'on', '1', 'correct'].includes(value.trim().toLowerCase());
}

function isCorrectChoice(block: Block): boolean {
  return (
    isTrue(block.metadata?.correct) ||
    isTrue(block.metadata?.answer) ||
    (block.classes ?? []).some((className) => normalizeMarker(className) === 'correct')
  );
}

/**
 * A conservative bottom-up signal used only to distinguish deck/group
 * headings from cards. Generic Answer/Back/Solution leaves are deliberately
 * not cards on their own; they complete their parent card instead.
 */
function looksLikeCompleteCard(block: Block): boolean {
  const marker = resolveFlashcardMarker(block);
  if (marker === 'group') return false;
  if (marker === 'basic' || marker === 'multiple-choice') return true;
  if (isGenericAnswerBlock(block)) return false;

  const children = block.children ?? [];
  if (children.length === 0) return hasTitle(block) && hasBody(block);
  if (children.length === 1) {
    return hasOwnContent(block) && hasOwnContent(children[0]);
  }
  return children.every(hasOwnContent);
}

function hasExplicitCardDescendant(block: Block): boolean {
  for (const child of block.children ?? []) {
    const marker = resolveFlashcardMarker(child);
    if (marker === 'basic' || marker === 'multiple-choice') return true;
    if (hasExplicitCardDescendant(child)) return true;
  }
  return false;
}

function shouldTreatAsImplicitGroup(block: Block): boolean {
  const children = block.children ?? [];
  if (children.length === 0) return false;
  if (hasExplicitCardDescendant(block)) return true;

  const completeCards = children.filter(looksLikeCompleteCard).length;
  if (hasBody(block)) {
    // A heading with an introduction over sections that are each a card is a
    // document's title (or a chapter) and its sections, not one card whose
    // first section is the question and every other section the answer. An
    // Answer/Back child still makes it a card with a parent-owned front.
    return completeCards >= 2 && !children.some(isGenericAnswerBlock);
  }

  if (children.length === 1) {
    return looksLikeCompleteCard(children[0]) && !isGenericAnswerBlock(children[0]);
  }

  return completeCards >= 2;
}

function explanationFor(block: Block): FlashcardFace | undefined {
  return hasBody(block) ? face(bodyOnly(block)) : undefined;
}

function materializeBasic(block: Block, diagnostics: FlashcardDiagnostic[]): Flashcard | undefined {
  const children = block.children ?? [];
  let front: FlashcardFace;
  let back: FlashcardFace;
  let label: string | undefined;
  let explanation: FlashcardFace | undefined;

  if (children.length === 0) {
    front = hasTitle(block) ? face(titleOnly(block)) : face();
    back = hasBody(block) ? face(bodyOnly(block)) : face();
  } else if (children.length === 1) {
    front = hasOwnContent(block) ? face(selfOnly(block)) : face();
    back = hasOwnContent(children[0]) ? face(children[0]) : face();
  } else {
    front = hasOwnContent(children[0]) ? face(children[0]) : face();
    back = face(...children.slice(1).filter(hasOwnContent));
    label = hasTitle(block) ? block.title!.trim() : undefined;
    explanation = explanationFor(block);
  }

  if (front.blocks.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'empty-front',
      message: `Flashcard "${block.id}" has no content for its front`,
      blockId: block.id,
    });
  }
  if (back.blocks.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'empty-back',
      message: `Flashcard "${block.id}" has no content for its answer`,
      blockId: block.id,
    });
  }
  if (front.blocks.length === 0 || back.blocks.length === 0) return undefined;

  return {
    id: block.id,
    sourceBlockId: block.id,
    kind: 'basic',
    ...(label ? { label } : {}),
    front,
    back,
    ...(explanation ? { explanation } : {}),
  };
}

function materializeMultipleChoice(
  block: Block,
  diagnostics: FlashcardDiagnostic[],
): Flashcard | undefined {
  const children = block.children ?? [];
  const question = children[0];
  const answerBlocks = children.slice(1).filter(hasOwnContent);

  if (!question || !hasOwnContent(question)) {
    diagnostics.push({
      severity: 'error',
      code: 'empty-front',
      message: `Multiple-choice flashcard "${block.id}" has no question block`,
      blockId: block.id,
    });
  }
  if (answerBlocks.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'empty-back',
      message: `Multiple-choice flashcard "${block.id}" has no answer choices`,
      blockId: block.id,
    });
  }
  if (!question || !hasOwnContent(question) || answerBlocks.length === 0) return undefined;

  const explicitlyCorrect = answerBlocks.filter(isCorrectChoice);
  if (explicitlyCorrect.length > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'multiple-correct-answers',
      message: `Multiple-choice flashcard "${block.id}" marks more than one answer correct; the first marker wins`,
      blockId: block.id,
    });
  }
  const correctBlock = explicitlyCorrect[0] ?? answerBlocks[0];

  if (answerBlocks.length < 2) {
    diagnostics.push({
      severity: 'warning',
      code: 'multiple-choice-needs-distractor',
      message: `Multiple-choice flashcard "${block.id}" needs at least one distractor`,
      blockId: block.id,
    });
  }

  const choices = answerBlocks.map((answer, index) => ({
    id: `${block.id}-choice-${index + 1}`,
    sourceBlockId: answer.id,
    content: face(answer),
    correct: answer === correctBlock,
  }));
  const explanation = explanationFor(block);

  return {
    id: block.id,
    sourceBlockId: block.id,
    kind: 'multiple-choice',
    ...(hasTitle(block) ? { label: block.title!.trim() } : {}),
    front: face(question),
    back: face(correctBlock),
    choices,
    ...(explanation ? { explanation } : {}),
  };
}

function resolveDeckTitle(doc: Doc): string | undefined {
  const frontmatterTitle = doc.frontmatter?.title;
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }
  return doc.startBlock?.title?.trim() || undefined;
}

/** Convert a nested Doc into a deterministic study deck. */
export function materializeFlashcards(
  doc: Doc,
  options: MaterializeFlashcardsOptions = {},
): FlashcardDeck {
  const full = doc;
  const requested = options.source ?? 'auto';
  const studyCards =
    requested === 'cards' ||
    requested === 'explicit' ||
    (requested === 'auto' && hasStudyCards(full));
  // Cards inferred from headings only when study cards are not the deck.
  const source: 'auto' | 'explicit' | 'none' =
    requested === 'cards'
      ? 'none'
      : requested === 'headings' || (requested === 'auto' && !studyCards)
        ? 'auto'
        : 'explicit';
  // Other accessory blocks are side information, never a card or a card's back.
  doc = withoutAccessoryBlocks(doc);
  const cards: Flashcard[] = [];
  const diagnostics: FlashcardDiagnostic[] = [];

  const visit = (block: Block): void => {
    const marker = resolveFlashcardMarker(block);
    if (marker === 'group') {
      for (const child of block.children ?? []) visit(child);
      return;
    }

    if (marker === 'basic') {
      const card = materializeBasic(block, diagnostics);
      if (card) cards.push(card);
      return;
    }
    if (marker === 'multiple-choice') {
      const card = materializeMultipleChoice(block, diagnostics);
      if (card) cards.push(card);
      return;
    }

    if (source === 'explicit') {
      for (const child of block.children ?? []) visit(child);
      return;
    }

    if (shouldTreatAsImplicitGroup(block)) {
      for (const child of block.children ?? []) visit(child);
      return;
    }

    if (looksLikeCompleteCard(block)) {
      const card = materializeBasic(block, diagnostics);
      if (card) cards.push(card);
      return;
    }

    // An incomplete structural branch may still contain usable cards.
    for (const child of block.children ?? []) visit(child);
  };

  if (source !== 'none') for (const block of doc.blocks) visit(block);
  if (studyCards) {
    const read = readStudyCards(full);
    for (const issue of read.issues)
      diagnostics.push({
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        blockId: issue.accessoryBlockId,
      });
    const owners = new Map(flattenBlocks(full.blocks).map((block) => [block.id, block]));
    cards.push(
      ...read.cards.filter((card) => card.usable).map((card) => fromStudyCard(card, owners)),
    );
    // Study cards and marked cards in document order.
    const position = new Map(flattenBlocks(full.blocks).map((block, index) => [block.id, index]));
    cards.sort(
      (a, b) => (position.get(a.sourceBlockId) ?? 0) - (position.get(b.sourceBlockId) ?? 0),
    );
  }

  const resolvedTitle = resolveDeckTitle(doc);
  const authoredTitle =
    typeof doc.frontmatter?.title === 'string' ? doc.frontmatter.title.trim() : '';
  const firstCardTitle = cards[0]?.front.blocks[0]?.title?.trim();
  // markdownToDoc auto-generates a cover from the first heading. In a deck
  // with no authored title that would repeat the first question as a giant
  // deck heading, so suppress only that inferred duplicate.
  const title =
    resolvedTitle && (authoredTitle || resolvedTitle !== firstCardTitle)
      ? resolvedTitle
      : undefined;

  return {
    ...(title ? { title } : {}),
    cards,
    diagnostics,
  };
}

/** A face block made for a study card: its title and body, nothing else. */
function studyFaceBlock(id: string, title?: string, contents?: MarkdownBlockNode[]): Block {
  return {
    id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    ...(title ? { title } : {}),
    ...(contents?.length ? { contents } : {}),
  };
}

/** A study card kept with a section, as a deck card labelled with its section. */
function fromStudyCard(card: StudyCard, owners: ReadonlyMap<string, Block>): Flashcard {
  const label = card.ownerId ? owners.get(card.ownerId)?.title?.trim() : undefined;
  const front = face(studyFaceBlock(`${card.key}:front`, card.question, card.prompt));
  const shared = {
    id: card.key,
    sourceBlockId: card.accessoryBlockId,
    ...(card.ownerId ? { ownerBlockId: card.ownerId } : {}),
    ...(card.origin ? { origin: card.origin } : {}),
    ...(label ? { label } : {}),
    front,
  };
  if (card.kind === 'flashcard')
    return {
      ...shared,
      kind: 'basic',
      back: face(studyFaceBlock(`${card.key}:back`, undefined, card.answer)),
    };
  const used = new Map<string, number>();
  const choices = (card.choices ?? []).map((choice) => {
    const count = used.get(choice.key) ?? 0;
    used.set(choice.key, count + 1);
    const id = `${card.key}:${choice.key}${count ? `~${count + 1}` : ''}`;
    return {
      id,
      sourceBlockId: card.accessoryBlockId,
      content: face(studyFaceBlock(id, undefined, choice.content)),
      correct: choice.correct,
    };
  });
  const right = choices.find((choice) => choice.correct) ?? choices[0]!;
  return {
    ...shared,
    kind: 'multiple-choice',
    back: right.content,
    choices,
    ...(card.explanation
      ? { explanation: face(studyFaceBlock(`${card.key}:why`, undefined, card.explanation)) }
      : {}),
  };
}
