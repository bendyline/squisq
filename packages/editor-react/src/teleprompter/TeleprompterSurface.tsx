/**
 * The teleprompter script surface — pure presentational and portal-able.
 *
 * Zero context reads: everything arrives via props, so the same element
 * renders docked, inside a Document-PiP window, or in a popup. Two
 * performance-critical details:
 *
 * 1. The token spans render ONCE per script/font change (memoized
 *    column). The active-word highlight and the smooth scroll are
 *    applied imperatively from a rAF loop — re-rendering thousands of
 *    spans through React at 15 Hz would jank.
 * 2. The rAF loop is requested on the surface's OWN window
 *    (`ownerDocument.defaultView`), not the opener — a Document-PiP
 *    window keeps animating while the main window is occluded. Mount
 *    with a `key` per float target so the loop rebinds on window moves.
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Theme } from '@bendyline/squisq/schemas';
import type { NarrationScript } from '@bendyline/squisq/narration';
import {
  EYE_LINE_FRACTION,
  measureTokenLines,
  stepScroll,
  targetOffsetFor,
  type TokenLineMap,
} from './scrollModel';
import { ensureTeleprompterStyles, prompterVarsFromTheme } from './teleprompterTheme';

/** Maximum wheel/trackpad nudge rate: responsive to a notch, gentle during a gesture. */
const WHEEL_NUDGE_INTERVAL_MS = 60;

export interface TeleprompterSurfaceProps {
  script: NarrationScript;
  /** Fractional word position; floor is the active token. */
  wordPos: number;
  fontSizePx: number;
  mirrored: boolean;
  lineGuide: boolean;
  countdownRemaining: number | null;
  recordingIndicator: boolean;
  theme: Theme;
  /** Hide block markers / tighten padding for small float windows. */
  compact?: boolean;
  /** Double-click a word to jump the prompter there. */
  onSeekToken?: (tokenIndex: number) => void;
  /** Move by whole words in response to direct surface input. */
  onNudge?: (deltaTokens: number) => void;
  /** Pause or resume voice/constant-rate automatic advancement. */
  onToggleAutoAdvance?: () => void;
}

interface Paragraph {
  key: string;
  tokenIndexes: number[];
}

interface BlockGroup {
  blockId: string;
  heading?: string;
  paragraphs: Paragraph[];
}

function groupScript(script: NarrationScript): BlockGroup[] {
  return script.blocks.map((range) => {
    const paragraphs: Paragraph[] = [];
    let current: number[] = [];
    for (let i = range.tokenStart; i < range.tokenEnd; i++) {
      current.push(i);
      if (script.tokens[i].pauseAfter >= 2 && i < range.tokenEnd - 1) {
        paragraphs.push({ key: `${range.blockId}-${paragraphs.length}`, tokenIndexes: current });
        current = [];
      }
    }
    if (current.length > 0) {
      paragraphs.push({ key: `${range.blockId}-${paragraphs.length}`, tokenIndexes: current });
    }
    const group: BlockGroup = { blockId: range.blockId, paragraphs };
    if (range.heading !== undefined) group.heading = range.heading;
    return group;
  });
}

/** The static token column — memoized so wordPos updates never re-render it. */
const ScriptColumn = memo(function ScriptColumn({
  script,
  compact,
}: {
  script: NarrationScript;
  compact: boolean;
}) {
  const groups = useMemo(() => groupScript(script), [script]);
  return (
    <>
      {groups.map((group) => (
        <section key={group.blockId} data-block-id={group.blockId}>
          {!compact && group.heading ? (
            <span className="squisq-teleprompter-block-marker">{group.heading}</span>
          ) : null}
          {group.paragraphs.map((paragraph) => (
            <p key={paragraph.key} className="squisq-teleprompter-para">
              {paragraph.tokenIndexes.map((idx) => (
                <span key={idx} className="squisq-teleprompter-word" data-token-idx={idx}>
                  {script.tokens[idx].text}{' '}
                </span>
              ))}
            </p>
          ))}
        </section>
      ))}
    </>
  );
});

export function TeleprompterSurface({
  script,
  wordPos,
  fontSizePx,
  mirrored,
  lineGuide,
  countdownRemaining,
  recordingIndicator,
  theme,
  compact = false,
  onSeekToken,
  onNudge,
  onToggleAutoAdvance,
}: TeleprompterSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const wordPosRef = useRef(wordPos);
  wordPosRef.current = wordPos;

  const vars = useMemo(() => prompterVarsFromTheme(theme), [theme]);

  // Inject the shared stylesheet into whichever document hosts us.
  useEffect(() => {
    const doc = surfaceRef.current?.ownerDocument;
    if (doc) ensureTeleprompterStyles(doc);
  }, []);

  // Mouse wheels and trackpads report wildly different delta sizes, so treat
  // every gesture as directional intent instead of requiring an arbitrary
  // threshold. Rate limiting keeps a trackpad stream gentle while ensuring a
  // single physical wheel notch always produces a word nudge.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !onNudge) return;

    let lastNudgeAt = Number.NEGATIVE_INFINITY;
    let lastDirection = 0;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.deltaY === 0) return;
      const direction = Math.sign(event.deltaY);
      event.preventDefault();
      if (direction === lastDirection && event.timeStamp - lastNudgeAt < WHEEL_NUDGE_INTERVAL_MS) {
        return;
      }

      onNudge(direction);
      lastNudgeAt = event.timeStamp;
      lastDirection = direction;
    };

    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, [onNudge]);

  // Imperative highlight + smooth scroll on the surface's own window.
  useEffect(() => {
    const surface = surfaceRef.current;
    const column = columnRef.current;
    if (!surface || !column) return;
    const win = surface.ownerDocument.defaultView ?? window;

    let lines: TokenLineMap | null = null;
    let spans: HTMLElement[] = [];
    let activeIdx = -1;
    let offset = 0;
    let lastTime = performance.now();
    let raf = 0;

    // Map each token index to the token that should be highlighted when the
    // prompter is on it: the nearest spoken word at or before it (falling
    // forward for leading punctuation). Keeps the active-word marker off
    // standalone punctuation as the cursor glides across it.
    const tokens = script.tokens;
    const spokenAt = new Int32Array(tokens.length);
    let lastSpoken = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].spoken) lastSpoken = i;
      spokenAt[i] = lastSpoken;
    }
    let firstSpoken = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].spoken) {
        firstSpoken = i;
        break;
      }
    }
    for (let i = 0; i < tokens.length && spokenAt[i] === -1; i++) spokenAt[i] = firstSpoken;

    const remeasure = () => {
      lines = measureTokenLines(column);
      spans = Array.from(column.querySelectorAll<HTMLElement>('[data-token-idx]'));
    };
    remeasure();

    const applyHighlight = (nextIdx: number) => {
      if (nextIdx === activeIdx) return;
      const lo = Math.min(activeIdx, nextIdx);
      const hi = Math.max(activeIdx, nextIdx);
      for (let i = Math.max(0, lo); i <= hi && i < spans.length; i++) {
        const span = spans[i];
        if (!span) continue;
        span.classList.toggle('squisq-teleprompter-word--active', i === nextIdx);
        span.classList.toggle('squisq-teleprompter-word--read', i < nextIdx);
      }
      activeIdx = nextIdx;
    };

    const loop = (now: number) => {
      const dtMs = now - lastTime;
      lastTime = now;
      const pos = wordPosRef.current;
      const clampedIdx = Math.min(Math.max(Math.floor(pos), 0), spans.length - 1);
      // Snap the highlight off punctuation onto the nearest spoken word.
      const highlightIdx =
        clampedIdx < spokenAt.length && spokenAt[clampedIdx] >= 0
          ? spokenAt[clampedIdx]
          : clampedIdx;
      if (spans.length > 0) applyHighlight(highlightIdx);
      if (lines) {
        const target = targetOffsetFor(pos, lines, surface.clientHeight);
        offset = stepScroll(offset, target, dtMs);
        column.style.transform = `translateY(${-offset}px)`;
      }
      raf = win.requestAnimationFrame(loop);
    };
    raf = win.requestAnimationFrame(loop);

    // The opener's ResizeObserver observing a same-cluster window's
    // element is fine; only rAF must belong to the surface's window.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(remeasure) : null;
    resizeObserver?.observe(surface);

    return () => {
      win.cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
    };
    // fontSizePx/compact change the layout → remeasure via effect rerun.
  }, [script, fontSizePx, compact]);

  const handleDoubleClick = onSeekToken
    ? (event: ReactMouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        const span = target?.closest<HTMLElement>('[data-token-idx]');
        if (!span) return;
        const idx = Number(span.dataset.tokenIdx);
        if (Number.isFinite(idx)) onSeekToken(idx);
      }
    : undefined;

  const handleMouseDown = onToggleAutoAdvance
    ? (event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onToggleAutoAdvance();
      }
    : undefined;

  // Chromium fires auxclick after the middle-button mouse sequence. The
  // toggle already happened on mousedown; cancelling auxclick prevents the
  // browser's autoscroll/open behavior without toggling a second time.
  const handleAuxClick = onToggleAutoAdvance
    ? (event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button === 1) event.preventDefault();
      }
    : undefined;

  return (
    <div
      ref={surfaceRef}
      className={`squisq-teleprompter-surface${mirrored ? ' squisq-teleprompter-surface--mirrored' : ''}`}
      style={{ ...vars, fontSize: `${fontSizePx}px` }}
      data-testid="teleprompter-surface"
      tabIndex={0}
      aria-label="Teleprompter script; left and right arrows or the mouse wheel adjust the word position; up starts automatic advancement; down stops it; press the mouse wheel to toggle it; double-click a word to jump"
      onMouseDown={handleMouseDown}
      onAuxClick={handleAuxClick}
    >
      <div className="squisq-teleprompter-flip">
        <div
          ref={columnRef}
          className="squisq-teleprompter-scroll"
          style={compact ? { padding: '30vh 5% 60vh' } : undefined}
          onDoubleClick={handleDoubleClick}
        >
          <ScriptColumn script={script} compact={compact} />
        </div>
      </div>
      {lineGuide ? (
        <>
          <div
            className="squisq-teleprompter-guide-band"
            style={{ top: `calc(${EYE_LINE_FRACTION * 100}% - 0.75em)`, height: '1.5em' }}
          />
          <div
            className="squisq-teleprompter-line-guide"
            style={{ top: `calc(${EYE_LINE_FRACTION * 100}% - 0.75em)`, height: '1.5em' }}
          />
        </>
      ) : null}
      {countdownRemaining !== null ? (
        <div className="squisq-teleprompter-countdown">
          <span className="squisq-teleprompter-countdown-digit">{countdownRemaining}</span>
        </div>
      ) : null}
      {recordingIndicator ? <div className="squisq-teleprompter-recdot" /> : null}
    </div>
  );
}
