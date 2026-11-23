/**
 * FlashcardStatusControls
 *
 * The flashcard deck's controls drawn in the status bar: Shuffle and Restart,
 * Previous, the card's position with a progress bar, and the card's actions —
 * Reveal, then Again and Next (or Next card for a quiz). FlashcardView hands
 * them its state and actions through `renderControls`; PreviewPanel portals
 * them into the status bar's view region.
 *
 * Nothing moves from card to card: the position is sized to its widest label
 * and the actions sit right-aligned in a box sized to the widest set, so
 * Reveal and Next land on the same spot (status-bar.css).
 */

import type { FlashcardControls } from '@bendyline/squisq-react';

const ICON_PROPS = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true } as const;

export function FlashcardStatusControls(controls: FlashcardControls) {
  const { cardIndex, cardCount, revealed, finished, cardKind, lastCard } = controls;
  const position = finished ? 'Done' : `Card ${cardIndex + 1} of ${cardCount}`;

  let actions = null;
  if (!finished && revealed && cardKind === 'basic') {
    actions = (
      <>
        <button
          type="button"
          className="squisq-status-text-button"
          onClick={() => controls.rate('again')}
        >
          Again
        </button>
        <button
          type="button"
          className="squisq-status-text-button squisq-status-text-button--primary"
          onClick={() => controls.rate('got-it')}
        >
          {lastCard ? 'Finish' : 'Next'}
        </button>
      </>
    );
  } else if (!finished) {
    const label = revealed ? (lastCard ? 'Finish' : 'Next card') : 'Reveal';
    actions = (
      <button
        type="button"
        className="squisq-status-text-button squisq-status-text-button--primary"
        onClick={controls.next}
        aria-keyshortcuts="Space ArrowRight"
        data-tooltip={`${label} (Space or →)`}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="squisq-status-flashcards"
      role="group"
      aria-label="Flashcard controls"
      data-testid="flashcard-controls"
    >
      <button
        type="button"
        className="squisq-status-tool-button"
        aria-pressed={controls.shuffled}
        onClick={controls.toggleShuffle}
        data-tooltip="Shuffle the cards and start over"
      >
        <svg {...ICON_PROPS}>
          <path d="M1.5 4h2.2c1.1 0 1.8.5 2.4 1.4l1.8 3.2c.6.9 1.3 1.4 2.4 1.4h2.2M1.5 10h2.2c1.1 0 1.8-.5 2.4-1.4M8.3 5.4C8.9 4.5 9.6 4 10.7 4h2.2M11.2 2.4 12.9 4l-1.7 1.6M11.2 8.4l1.7 1.6-1.7 1.6" />
        </svg>
        <span>Shuffle</span>
      </button>
      <button
        type="button"
        className="squisq-status-tool-button"
        onClick={controls.restart}
        data-tooltip="Start over"
      >
        <svg {...ICON_PROPS}>
          <path d="M2.6 7.2a4.4 4.4 0 1 0 1.3-3.3M2.6 1.9v2.6h2.6" />
        </svg>
        <span>Restart</span>
      </button>

      <span className="squisq-status-divider" aria-hidden="true" />

      <button
        type="button"
        className="squisq-status-nav-button"
        onClick={controls.previous}
        disabled={!controls.canGoBack}
        aria-label="Previous"
        aria-keyshortcuts="ArrowLeft"
        data-tooltip="Previous (←)"
      >
        <svg {...ICON_PROPS}>
          <path d="M9 2.5 L4.5 7 L9 11.5" />
        </svg>
      </button>

      <span
        className="squisq-status-view-position"
        data-sizer={`Card ${cardCount} of ${cardCount}`}
        data-sizer-alt="Done"
      >
        <span data-testid="flashcard-position">{position}</span>
      </span>
      <span className="squisq-status-progress" aria-hidden="true">
        <span style={{ width: `${Math.round(controls.progress * 100)}%` }} />
      </span>

      {/* The widest sets of actions, invisible, hold the box's width. */}
      <span className="squisq-status-card-actions">
        <span>{actions}</span>
        <span aria-hidden="true">
          <span className="squisq-status-text-button">Again</span>
          <span className="squisq-status-text-button">Finish</span>
        </span>
        <span aria-hidden="true">
          <span className="squisq-status-text-button">Next card</span>
        </span>
      </span>
    </div>
  );
}
