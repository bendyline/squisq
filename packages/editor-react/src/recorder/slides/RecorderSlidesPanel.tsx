/**
 * RecorderSlidesPanel — the recorder dialog's right column in slides mode.
 *
 * The teleprompter's opposite number: instead of scrolling a script, it shows
 * the deck one slide at a time so the presenter can talk to what the audience
 * will see, with the block's own prose beneath as notes.
 *
 * Fully controlled. The MODAL owns the active index, because the index is what
 * gets stamped into the advance log — pressing Record must be able to seed the
 * log with whatever slide is already up, and the panel has no view of the
 * recorder.
 *
 * ## Layout discipline
 *
 * The expanded dialog sets `overflowY: 'hidden'` on itself so its columns get
 * a bounded flex height. Every level here therefore carries `minHeight: 0`,
 * and only the notes region is allowed to scroll — otherwise the slide card
 * grows past the viewport and the whole column starts scrolling instead.
 */

import { useCallback, type CSSProperties, type KeyboardEvent } from 'react';
import type { MediaProvider, ViewportConfig } from '@bendyline/squisq/schemas';
import { BlockThumbnail } from '../../TimelineBlockPreview.js';
import { Icon } from '../../Icon.js';
import { clampSlideIndex, slideStepForKey } from '../slidesModePolicy.js';
import type { RecorderSlide } from './slideDeck.js';

export interface RecorderSlidesPanelProps {
  slides: RecorderSlide[];
  /** Active slide index — controlled by the host. */
  index: number;
  onIndexChange: (next: number) => void;
  viewport: ViewportConfig;
  basePath?: string;
  mediaProvider?: MediaProvider | null;
  /** True while a take is rolling — switches the hint to the recording copy. */
  recording?: boolean;
  /** Block ids already first-shown this take; drives the progress dots. */
  shownBlockIds?: ReadonlySet<string>;
}

const rootStyle: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  outline: 'none',
  color: 'var(--squisq-recorder-text)',
};

const headerStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 10px',
  borderBottom: '1px solid var(--squisq-recorder-border)',
};

const counterStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const dotsStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 3,
};

const navButtonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'var(--squisq-recorder-input)',
  color: 'var(--squisq-recorder-text)',
  border: '1px solid var(--squisq-recorder-border)',
  borderRadius: 0,
};

const stageStyle: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 8,
  background: 'var(--squisq-recorder-surface-muted)',
};

const notesStyle: CSSProperties = {
  flex: '0 0 auto',
  maxHeight: '32%',
  minHeight: 0,
  overflowY: 'auto',
  padding: '10px 12px',
  borderTop: '1px solid var(--squisq-recorder-border)',
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--squisq-recorder-muted)',
};

const headingStyle: CSSProperties = {
  margin: '0 0 6px 0',
  fontSize: 13,
  fontWeight: 600,
};

/** Tags that consume their own Space/Arrow keys — never step the deck from one. */
const SELF_HANDLING = /^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/;

export function RecorderSlidesPanel({
  slides,
  index,
  onIndexChange,
  viewport,
  basePath = '/',
  mediaProvider = null,
  recording = false,
  shownBlockIds,
}: RecorderSlidesPanelProps) {
  const count = slides.length;
  const active = slides[clampSlideIndex(index, count)];

  const step = useCallback(
    (delta: number) => onIndexChange(clampSlideIndex(index + delta, count)),
    [index, count, onIndexChange],
  );

  /**
   * Scoped to this container, never `document`: `useModalDialog` already owns
   * Escape and Tab on the document in the capture phase, and a document-level
   * Space handler would hijack the Filename input and double-fire on any
   * focused button.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const delta = slideStepForKey(event.key);
      if (delta === 0) return;
      const target = event.target as HTMLElement;
      if (target !== event.currentTarget && SELF_HANDLING.test(target.tagName)) return;
      event.preventDefault();
      step(delta);
    },
    [step],
  );

  if (count === 0 || !active) {
    return (
      <div style={{ ...rootStyle, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={hintStyle}>This document has no slides yet.</p>
      </div>
    );
  }

  return (
    <div
      style={rootStyle}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="recorder-slides-panel"
      aria-label="Slides"
    >
      <div style={headerStyle}>
        <span style={counterStyle} role="status">
          Slide {index + 1} of {count}
        </span>
        <span style={dotsStyle} aria-hidden="true">
          {slides.map((slide, i) => (
            <span
              key={slide.blockId}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background:
                  i === index
                    ? 'var(--squisq-recorder-accent)'
                    : shownBlockIds?.has(slide.blockId)
                      ? 'var(--squisq-recorder-text)'
                      : 'var(--squisq-recorder-border)',
              }}
            />
          ))}
        </span>
        <button
          type="button"
          style={navButtonStyle}
          onClick={() => step(-1)}
          disabled={index <= 0}
          aria-label="Previous slide"
        >
          <Icon icon="fa-solid fa-chevron-left" />
        </button>
        <button
          type="button"
          style={navButtonStyle}
          onClick={() => step(1)}
          disabled={index >= count - 1}
          aria-label="Next slide"
        >
          <Icon icon="fa-solid fa-chevron-right" />
        </button>
      </div>

      <div style={stageStyle}>
        <div
          style={{
            width: '100%',
            maxHeight: '100%',
            aspectRatio: `${viewport.width} / ${viewport.height}`,
            overflow: 'hidden',
            background: '#000',
          }}
        >
          {active.visual ? (
            <BlockThumbnail
              visual={active.visual}
              viewport={viewport}
              basePath={basePath}
              mediaProvider={mediaProvider}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                textAlign: 'center',
                background: 'var(--squisq-recorder-input)',
                color: 'var(--squisq-recorder-muted)',
                fontSize: 13,
              }}
            >
              {active.heading} — no slide rendition
            </div>
          )}
        </div>
      </div>

      <div style={notesStyle} data-testid="recorder-slide-notes">
        <p style={headingStyle}>{active.heading}</p>
        {active.bodyText ? (
          <div>{active.bodyText}</div>
        ) : (
          <p style={hintStyle}>No additional narrative for this slide.</p>
        )}
        <p style={{ ...hintStyle, marginTop: 8 }}>
          {recording
            ? 'Recording — each slide is timed from when you first show it.'
            : 'Use the arrow keys or the buttons to move through the deck.'}
        </p>
      </div>
    </div>
  );
}
