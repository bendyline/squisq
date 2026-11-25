/**
 * A study card as the fields a person edits, and back. Fields hold markdown,
 * so formatting a person typed (or the card had) is kept.
 */
import type { MarkdownBlockNode, MarkdownInlineNode } from '@bendyline/squisq/markdown';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import type { StudyCard, StudyCardKind, StudyCardText } from '@bendyline/squisq/study';

const blocksText = (nodes: readonly MarkdownBlockNode[] | undefined): string =>
  nodes?.length ? stringifyMarkdown({ type: 'document', children: [...nodes] }).trim() : '';

const inlineText = (nodes: readonly MarkdownInlineNode[]): string =>
  nodes.length
    ? stringifyMarkdown({
        type: 'document',
        children: [{ type: 'paragraph', children: [...nodes] }],
      }).trim()
    : '';

/** A card's fields, as markdown. */
export function studyCardFields(card: StudyCard): StudyCardText {
  return {
    kind: card.kind,
    question: inlineText(card.questionNodes) || card.question,
    ...(card.kind === 'flashcard' ? { answer: blocksText(card.answer) } : {}),
    ...(card.kind === 'quiz'
      ? {
          prompt: blocksText(card.prompt),
          choices: (card.choices ?? []).map((choice) => ({
            text: blocksText(choice.content),
            correct: choice.correct,
          })),
          explanation: blocksText(card.explanation),
        }
      : {}),
  };
}

/** The fields of a new card. */
export function emptyStudyCardFields(kind: StudyCardKind): StudyCardText {
  return kind === 'quiz'
    ? {
        kind,
        question: '',
        choices: [
          { text: '', correct: true },
          { text: '', correct: false },
        ],
        explanation: '',
      }
    : { kind, question: '', answer: '' };
}

/** Whether two cards' fields say the same thing. */
export function sameStudyCardFields(a: StudyCardText, b: StudyCardText): boolean {
  const norm = (fields: StudyCardText) =>
    JSON.stringify({
      question: fields.question.trim(),
      answer: (fields.answer ?? '').trim(),
      prompt: (fields.prompt ?? '').trim(),
      choices: (fields.choices ?? []).map((choice) => [choice.text.trim(), choice.correct]),
      explanation: (fields.explanation ?? '').trim(),
    });
  return norm(a) === norm(b);
}
