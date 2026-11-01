import { BlockRenderer, MediaContext, useBuildNavigation } from '@bendyline/squisq-react';
import { blockBuildSteps, buildSourceText } from '@bendyline/squisq/doc';
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
 *
 * ## The slide is live, not a thumbnail
 *
 * The presenter talks over what playback will show, so the slide runs on its
 * own block clock: video clips roll from their in-point when the slide comes
 * up, and count-ups count. See `RecorderSlideStage`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { Block, BuildCursor, MediaProvider, ViewportConfig } from '@bendyline/squisq/schemas';
import { Icon } from '../../Icon.js';
import { clampSlideIndex, slideStepForKey } from '../slidesModePolicy.js';
import type { RecorderSlide } from './slideDeck.js';

export interface RecorderSlidesPanelProps {
  onBuildShown?: (blockId: string, step: number, sourceText: string) => void;
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
  onBuildShown,
}: RecorderSlidesPanelProps) {
  const count = slides.length;
  const active = slides[clampSlideIndex(index, count)];

  const builds = useBuildNavigation(active?.visual, true, true);
  const { next: nextBuild, previous: previousBuild, enter: enterBuild } = builds;
  const sourceText = active?.visual ? buildSourceText(blockBuildSteps(active.visual)) : '';
  useEffect(() => {
    if (!active || !onBuildShown) return;
    for (let step = 0; step < builds.cursor.revealed; step++)
      onBuildShown(active.blockId, step, sourceText);
  }, [active, builds.cursor.revealed, sourceText, recording, onBuildShown]);

  const step = useCallback(
    (delta: number) => {
      if (delta > 0 ? nextBuild() : previousBuild()) return;
      const next = clampSlideIndex(index + delta, count);
      if (next === index) return;
      enterBuild(slides[next]?.visual, delta < 0);
      onIndexChange(next);
    },
    [index, count, onIndexChange, nextBuild, previousBuild, enterBuild, slides],
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
          {builds.count > 0 ? ` · Build ${builds.cursor.revealed} of ${builds.count}` : ''}
        </span>
        <span style={dotsStyle} aria-hidden="true">
          {slides.map((slide, i) => (
            <span
              key={slide.id}
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
          disabled={index <= 0 && builds.cursor.revealed === 0}
          aria-label="Previous slide"
        >
          <Icon icon="fa-solid fa-chevron-left" />
        </button>
        <button
          type="button"
          style={navButtonStyle}
          onClick={() => step(1)}
          disabled={
            index >= count - 1 &&
            builds.cursor.revealed >= builds.count &&
            builds.cursor.progress >= 1
          }
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
            <RecorderSlideStage
              key={active.id}
              visual={active.visual}
              buildPlayback={builds.cursor}
              viewport={viewport}
              basePath={basePath}
              mediaProvider={mediaProvider}
              recording={recording}
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

interface RecorderSlideStageProps {
  visual: Block;
  buildPlayback: BuildCursor;
  viewport: ViewportConfig;
  basePath: string;
  mediaProvider: MediaProvider | null;
  recording: boolean;
}

/**
 * The slide on screen. Keyed by block at the call site, so arriving on a slide
 * mounts it fresh — its clock, clips and entrance animations start over, as
 * they do when playback reaches the block.
 *
 * Clips play muted: the microphone is live in this dialog, and a clip's own
 * sound already plays with the doc — heard here, it would land in the take
 * as well.
 */
function RecorderSlideStage({
  visual,
  buildPlayback,
  viewport,
  basePath,
  mediaProvider,
  recording,
}: RecorderSlideStageProps) {
  const blockTime = useSlideClock(readsBlockClock(visual), recording);
  return (
    <MediaContext.Provider value={mediaProvider}>
      <BlockRenderer
        block={visual}
        buildPlayback={buildPlayback}
        blockTime={blockTime}
        isPlaying
        muted
        basePath={basePath}
        viewport={viewport}
      />
    </MediaContext.Provider>
  );
}

/**
 * Whether anything on the slide follows `blockTime`. Entrance animations are
 * CSS and run from mount on their own; clips and count-ups are the layers
 * that sit on their first frame until the block clock moves.
 */
function readsBlockClock(visual: Block): boolean {
  return (visual.layers ?? []).some(
    (layer) => layer.type === 'video' || layer.animation?.type === 'countUp',
  );
}

/**
 * Seconds since the slide came up. Ticks only when `running`, so a still
 * slide never re-renders per frame while a take encodes.
 *
 * A take restarts it: the slide on screen at Record is the take's first
 * block, so playback starts its clips at the take's t=0, and so does this.
 */
function useSlideClock(running: boolean, recording: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const originRef = useRef<number | null>(null);

  useEffect(() => {
    if (recording) originRef.current = null;
  }, [recording]);

  useEffect(() => {
    if (!running) return;
    let frame = requestAnimationFrame(function tick(now) {
      const origin = (originRef.current ??= now);
      setSeconds((now - origin) / 1000);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [running]);

  return seconds;
}
