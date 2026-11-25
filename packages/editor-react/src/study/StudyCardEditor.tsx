/**
 * One study card's fields: the question, and the answer (a flashcard) or the
 * choices with the right one marked and an explanation (a quiz question).
 * Fields save when left, if changed, as the summary wording fields do; a new
 * card is saved only once it is a card (a question, an answer, one right
 * choice among two or more), so no empty card reaches the document.
 */
import { useId, useState } from 'react';
import type { StudyCard, StudyCardIssue, StudyCardText } from '@bendyline/squisq/study';
import { sameStudyCardFields, studyCardFields } from './studyCardFields';

export interface StudyCardEditorProps {
  /** The card in the document, or undefined for a new one. */
  card?: StudyCard;
  /** A new card's fields to start from. */
  initial?: StudyCardText;
  issues?: readonly StudyCardIssue[];
  disabled: boolean;
  /** The changed fields: an existing card saves them; a new one passes them to `onSaveNew`. */
  onChange?: (fields: StudyCardText) => void;
  onSaveNew?: (fields: StudyCardText) => void;
  onCancelNew?: () => void;
  onRemove?: () => void;
  onKeep?: () => void;
  /** Ordinal for the card's accessible name ("Card 2"). */
  index: number;
}

export function StudyCardEditor({
  card,
  initial,
  issues = [],
  disabled,
  onChange,
  onSaveNew,
  onCancelNew,
  onRemove,
  onKeep,
  index,
}: StudyCardEditorProps) {
  const id = useId();
  const saved = card ? studyCardFields(card) : initial!;
  // The fields as typed; they follow the document whenever the card changes there.
  const [fields, setFields] = useState(saved);
  const [basis, setBasis] = useState(saved);
  if (!sameStudyCardFields(saved, basis)) {
    setBasis(saved);
    setFields(saved);
  }
  const isNew = !card;
  const kind = fields.kind;
  const label = kind === 'quiz' ? 'Quiz question' : 'Flashcard';
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  /** Save the fields as they are now, when they say something new. */
  const commit = (next: StudyCardText = fields) => {
    if (isNew || sameStudyCardFields(next, saved)) return;
    onChange?.(next);
  };
  const update = (patch: Partial<StudyCardText>) =>
    setFields((current) => ({ ...current, ...patch }));
  const choices = fields.choices ?? [];
  const setChoice = (at: number, patch: Partial<{ text: string; correct: boolean }>) =>
    update({
      choices: choices.map((choice, position) =>
        position === at
          ? { ...choice, ...patch }
          : patch.correct
            ? { ...choice, correct: false }
            : choice,
      ),
    });

  return (
    <article
      className={`squisq-study-card${card?.stale ? ' squisq-study-card--stale' : ''}${errors.length ? ' squisq-study-card--invalid' : ''}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="squisq-study-card-header">
        <h4 id={`${id}-title`} className="squisq-study-card-title">
          {isNew ? `New ${label.toLowerCase()}` : `${label} ${index}`}
        </h4>
        <span className="squisq-study-card-tags">
          {card?.origin === 'ai' && (
            <small className="squisq-study-card-tag">
              <span className="squisq-sr-only">Written by </span>AI
            </small>
          )}
          {card?.stale && (
            <small className="squisq-study-card-tag squisq-study-card-tag--warn">
              Section changed
            </small>
          )}
          {errors.length > 0 && (
            <small className="squisq-study-card-tag squisq-study-card-tag--warn">To fix</small>
          )}
        </span>
      </header>
      <label className="squisq-study-field">
        Question
        <input
          value={fields.question}
          disabled={disabled}
          onChange={(event) => update({ question: event.target.value })}
          onBlur={() => commit()}
        />
      </label>
      {kind === 'flashcard' ? (
        <label className="squisq-study-field">
          Answer
          <textarea
            rows={3}
            value={fields.answer ?? ''}
            disabled={disabled}
            onChange={(event) => update({ answer: event.target.value })}
            onBlur={() => commit()}
          />
        </label>
      ) : (
        <>
          <fieldset className="squisq-study-choices" disabled={disabled}>
            <legend>Choices — mark the right answer</legend>
            {choices.map((choice, at) => (
              <div key={at} className="squisq-study-choice">
                <input
                  type="radio"
                  name={`${id}-right`}
                  aria-label={`Choice ${at + 1} is the right answer`}
                  checked={choice.correct}
                  onChange={() => {
                    const next = {
                      ...fields,
                      choices: choices.map((item, position) => ({
                        ...item,
                        correct: position === at,
                      })),
                    };
                    setFields(next);
                    commit(next);
                  }}
                />
                <input
                  aria-label={`Choice ${at + 1}`}
                  value={choice.text}
                  onChange={(event) => setChoice(at, { text: event.target.value })}
                  onBlur={() => commit()}
                />
                <button
                  type="button"
                  aria-label={`Remove choice ${at + 1}`}
                  title="Remove this choice"
                  disabled={choices.length <= 2}
                  onClick={() => {
                    const next = {
                      ...fields,
                      choices: choices.filter((_item, position) => position !== at),
                    };
                    if (choice.correct && next.choices.length)
                      next.choices[0] = { ...next.choices[0]!, correct: true };
                    setFields(next);
                    commit(next);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update({ choices: [...choices, { text: '', correct: false }] })}
            >
              Add a choice
            </button>
          </fieldset>
          <label className="squisq-study-field">
            Explanation (optional)
            <textarea
              rows={2}
              value={fields.explanation ?? ''}
              disabled={disabled}
              onChange={(event) => update({ explanation: event.target.value })}
              onBlur={() => commit()}
            />
          </label>
        </>
      )}
      {[...errors, ...warnings].length > 0 && (
        <ul className="squisq-study-card-issues">
          {[...errors, ...warnings].map((issue, at) => (
            <li key={at}>{issue.message}</li>
          ))}
        </ul>
      )}
      <div className="squisq-study-card-actions">
        {isNew ? (
          <>
            <button type="button" disabled={disabled} onClick={() => onSaveNew?.(fields)}>
              Save card
            </button>
            <button type="button" onClick={onCancelNew}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {card?.stale && onKeep && (
              <button
                type="button"
                disabled={disabled}
                title="The card is still right: record the section’s text as it is now."
                onClick={onKeep}
              >
                Keep
              </button>
            )}
            <button type="button" disabled={disabled} onClick={onRemove}>
              Remove card
            </button>
          </>
        )}
      </div>
    </article>
  );
}
