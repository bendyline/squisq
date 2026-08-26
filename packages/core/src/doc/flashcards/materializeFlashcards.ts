/**
 * Flashcard-mode projection.
 *
 * Flashcards are a study rendition of the existing heading-driven Block tree,
 * not a visual template. The projection keeps rich Markdown nodes and nested
 * blocks intact so React and future exporters can render the same authored
 * content without reducing cards to strings.
 */

import type { Block, Doc } from '../../schemas/Doc.js';

export type FlashcardKind = 'basic' | 'multiple-choice';
export type FlashcardSourceMode = 'auto' | 'explicit';

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
  id: string;
  sourceBlockId: string;
  kind: FlashcardKind;
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
  | 'multiple-correct-answers';

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
  /**
   * `auto` (default) discovers card-shaped blocks and honors explicit study
   * metadata. `explicit` includes only blocks marked `study=flashcard` or
   * `study=multiple-choice-flashcard` (and their class/template aliases).
   */
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
  if (hasBody(block)) return false;

  if (children.length === 1) {
    return looksLikeCompleteCard(children[0]) && !isGenericAnswerBlock(children[0]);
  }

  return children.filter(looksLikeCompleteCard).length >= 2;
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
  const source = options.source ?? 'auto';
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

  for (const block of doc.blocks) visit(block);

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
