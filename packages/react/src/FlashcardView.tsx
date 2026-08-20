/** Flashcards — progressively revealed study/quiz rendition of a Doc. */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Block, Doc, Theme } from '@bendyline/squisq/schemas';
import { resolveFontFamily } from '@bendyline/squisq/schemas';
import {
  materializeFlashcards,
  resolveThemeForDoc,
  type Flashcard,
  type FlashcardChoice,
  type FlashcardFace,
  type FlashcardSourceMode,
} from '@bendyline/squisq/doc';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import { MarkdownRenderer, type CodeBlockCopyHandler } from './MarkdownRenderer';
import { BlockRenderer } from './BlockRenderer';

export interface FlashcardViewProps {
  doc: Doc;
  theme?: Theme;
  basePath?: string;
  source?: FlashcardSourceMode;
  /** Start the deck in shuffled order (default false). */
  shuffle?: boolean;
  /** Capture shortcuts without requiring focus (default false). */
  globalKeyboardShortcuts?: boolean;
  showCodeCopyButton?: boolean;
  onCopyCode?: CodeBlockCopyHandler;
  fenceRenderers?: FenceRendererMap;
  className?: string;
}

type CardRating = 'again' | 'got-it';

export interface FlashcardFaceViewProps {
  face: FlashcardFace;
  theme: Theme;
  basePath: string;
  showCodeCopyButton: boolean;
  onCopyCode?: CodeBlockCopyHandler;
  fenceRenderers?: FenceRendererMap;
}

type FaceContentProps = FlashcardFaceViewProps;

function FaceBlock({
  block,
  depth,
  theme,
  basePath,
  showCodeCopyButton,
  onCopyCode,
  fenceRenderers,
}: {
  block: Block;
  depth: number;
} & Omit<FaceContentProps, 'face'>) {
  const Heading = depth === 0 ? 'h2' : depth === 1 ? 'h3' : 'h4';
  return (
    <section className="squisq-flashcards__content-block" data-source-block-id={block.id}>
      {block.title && <Heading className="squisq-flashcards__content-title">{block.title}</Heading>}
      {block.contents && block.contents.length > 0 && (
        <MarkdownRenderer
          nodes={block.contents}
          theme={theme}
          showCodeCopyButton={showCodeCopyButton}
          onCopyCode={onCopyCode}
          fenceRenderers={fenceRenderers}
        />
      )}
      {block.layers && block.layers.length > 0 && (
        <div className="squisq-flashcards__canvas">
          <BlockRenderer
            block={block}
            blockTime={Math.max(0, block.duration)}
            basePath={basePath}
            viewport={{ width: 960, height: 540 }}
            animationsEnabled={false}
            theme={theme}
            muted
          />
        </div>
      )}
      {block.children?.map((child) => (
        <FaceBlock
          key={child.id}
          block={child}
          depth={depth + 1}
          theme={theme}
          basePath={basePath}
          showCodeCopyButton={showCodeCopyButton}
          onCopyCode={onCopyCode}
          fenceRenderers={fenceRenderers}
        />
      ))}
    </section>
  );
}

function FaceContent(props: FaceContentProps) {
  return (
    <div className="squisq-flashcards__face-content">
      {props.face.blocks.map((block) => (
        <FaceBlock key={block.id} block={block} depth={0} {...props} />
      ))}
    </div>
  );
}

/** Rich, theme-aware renderer for one materialized flashcard face. */
export function FlashcardFaceView(props: FlashcardFaceViewProps) {
  return <FaceContent {...props} />;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffled<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  let state = hashSeed(seed) || 1;
  const random = () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function ChoiceContent(props: Omit<FaceContentProps, 'face'> & { choice: FlashcardChoice }) {
  return <FaceContent {...props} face={props.choice.content} />;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('button, a, input, select, textarea, [contenteditable="true"]')
  );
}

export function FlashcardView({
  doc,
  theme,
  basePath = '.',
  source = 'auto',
  shuffle: initialShuffle = false,
  globalKeyboardShortcuts = false,
  showCodeCopyButton = false,
  onCopyCode,
  fenceRenderers,
  className,
}: FlashcardViewProps) {
  const activeTheme = useMemo(() => theme ?? resolveThemeForDoc(doc), [doc, theme]);
  const deck = useMemo(() => materializeFlashcards(doc, { source }), [doc, source]);
  const [shuffleEnabled, setShuffleEnabled] = useState(initialShuffle);
  const [sessionSeed, setSessionSeed] = useState(1);
  const [cardIndex, setCardIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, CardRating>>({});
  const [retryIds, setRetryIds] = useState<string[] | null>(null);

  const orderedCards = useMemo(
    () =>
      shuffleEnabled ? shuffled(deck.cards, `${doc.articleId}:${sessionSeed}`) : [...deck.cards],
    [deck.cards, doc.articleId, sessionSeed, shuffleEnabled],
  );
  const sessionCards = useMemo(
    () =>
      retryIds
        ? retryIds
            .map((id) => orderedCards.find((card) => card.id === id))
            .filter((card): card is Flashcard => !!card)
        : orderedCards,
    [orderedCards, retryIds],
  );
  const currentCard = sessionCards[cardIndex];
  const finished = sessionCards.length > 0 && cardIndex >= sessionCards.length;

  const resetPosition = useCallback(() => {
    setCardIndex(0);
    setRevealed(false);
    setSelectedChoiceId(null);
  }, []);

  const restart = useCallback(() => {
    setRatings({});
    setRetryIds(null);
    resetPosition();
    setSessionSeed((seed) => seed + 1);
  }, [resetPosition]);

  useEffect(() => {
    setRatings({});
    setRetryIds(null);
    resetPosition();
  }, [deck, resetPosition]);

  const revealAnswer = useCallback(() => {
    if (!currentCard) return;
    setRevealed(true);
    if (currentCard.kind === 'multiple-choice' && selectedChoiceId === null) {
      setRatings((current) => ({ ...current, [currentCard.id]: 'again' }));
    }
  }, [currentCard, selectedChoiceId]);

  const nextCard = useCallback(() => {
    if (!currentCard) return;
    if (!revealed) {
      revealAnswer();
      return;
    }
    setCardIndex((index) => index + 1);
    setRevealed(false);
    setSelectedChoiceId(null);
  }, [currentCard, revealAnswer, revealed]);

  const previousCard = useCallback(() => {
    if (finished) {
      setCardIndex(Math.max(0, sessionCards.length - 1));
      setRevealed(true);
      return;
    }
    if (revealed) {
      setRevealed(false);
      setSelectedChoiceId(null);
      return;
    }
    if (cardIndex > 0) {
      setCardIndex((index) => index - 1);
      setRevealed(true);
      setSelectedChoiceId(null);
    }
  }, [cardIndex, finished, revealed, sessionCards.length]);

  const choose = useCallback(
    (choice: FlashcardChoice) => {
      if (!currentCard || revealed) return;
      setSelectedChoiceId(choice.id);
      setRevealed(true);
      setRatings((current) => ({
        ...current,
        [currentCard.id]: choice.correct ? 'got-it' : 'again',
      }));
    },
    [currentCard, revealed],
  );

  const rate = useCallback(
    (rating: CardRating) => {
      if (!currentCard) return;
      setRatings((current) => ({ ...current, [currentCard.id]: rating }));
      setCardIndex((index) => index + 1);
      setRevealed(false);
      setSelectedChoiceId(null);
    },
    [currentCard],
  );

  const handleShortcut = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || isInteractiveTarget(event.target)) return;
      if (/^[1-9]$/.test(event.key) && currentCard?.kind === 'multiple-choice' && !revealed) {
        const choice = currentCard.choices?.[Number(event.key) - 1];
        if (choice) {
          event.preventDefault();
          choose(choice);
        }
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        previousCard();
      } else if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        nextCard();
      }
    },
    [choose, currentCard, nextCard, previousCard, revealed],
  );

  useEffect(() => {
    if (!globalKeyboardShortcuts) return;
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [globalKeyboardShortcuts, handleShortcut]);

  const faceProps = {
    theme: activeTheme,
    basePath,
    showCodeCopyButton,
    onCopyCode,
    fenceRenderers,
  };
  const titleFont = resolveFontFamily(activeTheme.typography.titleFont, 'Georgia, serif');
  const bodyFont = resolveFontFamily(activeTheme.typography.bodyFont, 'system-ui, sans-serif');
  const rootStyle = {
    '--squisq-flashcards-bg': activeTheme.colors.background,
    '--squisq-flashcards-surface': activeTheme.colors.backgroundLight,
    '--squisq-flashcards-text': activeTheme.colors.text,
    '--squisq-flashcards-muted': activeTheme.colors.textMuted,
    '--squisq-flashcards-primary': activeTheme.colors.primary,
    '--squisq-flashcards-secondary': activeTheme.colors.secondary,
    '--squisq-flashcards-highlight': activeTheme.colors.highlight,
    '--squisq-flashcards-warning': activeTheme.colors.warning,
    '--squisq-flashcards-radius': `${activeTheme.style.borderRadius ?? 18}px`,
    '--squisq-flashcards-title-font': titleFont,
    '--squisq-flashcards-body-font': bodyFont,
  } as CSSProperties;

  const missedIds = deck.cards
    .filter((card) => ratings[card.id] === 'again')
    .map((card) => card.id);
  const gotItCount = deck.cards.filter((card) => ratings[card.id] === 'got-it').length;

  if (deck.cards.length === 0) {
    return (
      <div
        className={`squisq-flashcards squisq-flashcards--empty${className ? ` ${className}` : ''}`}
        style={rootStyle}
        role="region"
        aria-label="Flashcards"
      >
        <div className="squisq-flashcards__empty-card">
          <h2>No complete flashcards yet</h2>
          <p>Add an answer beneath a heading, or nest an answer block under a question.</p>
          {deck.diagnostics.length > 0 && (
            <ul>
              {deck.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.blockId}-${diagnostic.code}-${index}`}>
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div
        className={`squisq-flashcards${className ? ` ${className}` : ''}`}
        style={rootStyle}
        role="region"
        aria-label="Flashcard session summary"
        tabIndex={0}
        onKeyDown={globalKeyboardShortcuts ? undefined : handleShortcut}
      >
        <div className="squisq-flashcards__summary">
          <span className="squisq-flashcards__eyebrow">Session complete</span>
          <h2>{gotItCount} remembered</h2>
          <p>
            {missedIds.length === 0
              ? `You completed all ${deck.cards.length} cards.`
              : `${missedIds.length} ${missedIds.length === 1 ? 'card needs' : 'cards need'} another look.`}
          </p>
          <div className="squisq-flashcards__summary-actions">
            {missedIds.length > 0 && (
              <button
                type="button"
                className="squisq-flashcards__button squisq-flashcards__button--primary"
                onClick={() => {
                  setRetryIds(missedIds);
                  resetPosition();
                }}
              >
                Retry missed
              </button>
            )}
            <button type="button" className="squisq-flashcards__button" onClick={restart}>
              Study again
            </button>
            <button type="button" className="squisq-flashcards__button" onClick={previousCard}>
              Previous card
            </button>
          </div>
        </div>
      </div>
    );
  }

  const choices = currentCard?.choices
    ? shuffled(currentCard.choices, `${currentCard.id}:${sessionSeed}`)
    : [];
  const selectedChoice = choices.find((choice) => choice.id === selectedChoiceId);

  return (
    <div
      className={`squisq-flashcards${className ? ` ${className}` : ''}`}
      style={rootStyle}
      role="region"
      aria-label="Flashcards"
      tabIndex={0}
      onKeyDown={globalKeyboardShortcuts ? undefined : handleShortcut}
    >
      <header className="squisq-flashcards__header">
        <div className="squisq-flashcards__deck-copy">
          <span className="squisq-flashcards__eyebrow">Flashcards</span>
          {deck.title && <h1>{deck.title}</h1>}
        </div>
        <div className="squisq-flashcards__tools">
          <button
            type="button"
            className="squisq-flashcards__tool"
            aria-pressed={shuffleEnabled}
            onClick={() => {
              setShuffleEnabled((enabled) => !enabled);
              restart();
            }}
          >
            Shuffle
          </button>
          <button type="button" className="squisq-flashcards__tool" onClick={restart}>
            Restart
          </button>
        </div>
      </header>

      <div className="squisq-flashcards__progress-row">
        <span>
          Card {cardIndex + 1} of {sessionCards.length}
        </span>
        <span>{revealed ? 'Answer revealed' : 'Question'}</span>
      </div>
      <div className="squisq-flashcards__progress" aria-hidden="true">
        <span
          style={{ width: `${((cardIndex + (revealed ? 1 : 0)) / sessionCards.length) * 100}%` }}
        />
      </div>

      <main className="squisq-flashcards__card" data-card-kind={currentCard.kind}>
        {currentCard.label && <div className="squisq-flashcards__label">{currentCard.label}</div>}
        <section className="squisq-flashcards__front" aria-label="Question">
          <FaceContent {...faceProps} face={currentCard.front} />
        </section>

        {currentCard.kind === 'multiple-choice' && (
          <div className="squisq-flashcards__choices" role="group" aria-label="Answer choices">
            {choices.map((choice, index) => {
              const selected = selectedChoiceId === choice.id;
              const status = revealed
                ? choice.correct
                  ? 'correct'
                  : selected
                    ? 'incorrect'
                    : 'idle'
                : 'idle';
              return (
                <button
                  key={choice.id}
                  type="button"
                  className="squisq-flashcards__choice"
                  data-choice-status={status}
                  aria-pressed={selected}
                  disabled={revealed}
                  onClick={() => choose(choice)}
                >
                  <span className="squisq-flashcards__choice-key" aria-hidden="true">
                    {index + 1}
                  </span>
                  <ChoiceContent {...faceProps} choice={choice} />
                </button>
              );
            })}
          </div>
        )}

        {revealed && currentCard.kind === 'basic' && (
          <section className="squisq-flashcards__answer" aria-label="Answer">
            <span className="squisq-flashcards__answer-label">Answer</span>
            <FaceContent {...faceProps} face={currentCard.back} />
          </section>
        )}

        {revealed && currentCard.kind === 'multiple-choice' && (
          <div
            className="squisq-flashcards__feedback"
            data-correct={selectedChoice?.correct === true}
            aria-live="polite"
          >
            <strong>
              {selectedChoice === undefined
                ? 'Answer revealed'
                : selectedChoice.correct
                  ? 'Correct'
                  : 'Not quite'}
            </strong>
            {!selectedChoice?.correct && (
              <div className="squisq-flashcards__correct-answer">
                <span>The correct answer is</span>
                <FaceContent {...faceProps} face={currentCard.back} />
              </div>
            )}
          </div>
        )}

        {revealed && currentCard.explanation && (
          <section className="squisq-flashcards__explanation" aria-label="Explanation">
            <span className="squisq-flashcards__answer-label">Explanation</span>
            <FaceContent {...faceProps} face={currentCard.explanation} />
          </section>
        )}
      </main>

      <footer className="squisq-flashcards__footer">
        <button
          type="button"
          className="squisq-flashcards__button"
          disabled={cardIndex === 0 && !revealed}
          onClick={previousCard}
        >
          Previous
        </button>
        <div className="squisq-flashcards__primary-actions">
          {revealed && currentCard.kind === 'basic' ? (
            <>
              <button
                type="button"
                className="squisq-flashcards__button"
                onClick={() => rate('again')}
              >
                Again
              </button>
              <button
                type="button"
                className="squisq-flashcards__button squisq-flashcards__button--primary"
                onClick={() => rate('got-it')}
              >
                Got it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="squisq-flashcards__button squisq-flashcards__button--primary"
              onClick={nextCard}
            >
              {revealed
                ? cardIndex === sessionCards.length - 1
                  ? 'Finish'
                  : 'Next card'
                : 'Reveal answer'}
            </button>
          )}
        </div>
      </footer>
      <p className="squisq-flashcards__shortcut-hint">
        Use ← and → to navigate, Space to reveal
        {currentCard.kind === 'multiple-choice' ? ', or 1–9 to answer' : ''}.
      </p>
    </div>
  );
}
