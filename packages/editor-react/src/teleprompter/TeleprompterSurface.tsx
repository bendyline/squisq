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
  /** Click a word to jump the prompter there. */
  onSeekToken?: (tokenIndex: number) => void;
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
      if (spans.length > 0) applyHighlight(clampedIdx);
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

  const handleClick = onSeekToken
    ? (event: ReactMouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        const span = target?.closest<HTMLElement>('[data-token-idx]');
        if (!span) return;
        const idx = Number(span.dataset.tokenIdx);
        if (Number.isFinite(idx)) onSeekToken(idx);
      }
    : undefined;

  return (
    <div
      ref={surfaceRef}
      className={`squisq-teleprompter-surface${mirrored ? ' squisq-teleprompter-surface--mirrored' : ''}`}
      style={{ ...vars, fontSize: `${fontSizePx}px` }}
      data-testid="teleprompter-surface"
    >
      <div className="squisq-teleprompter-flip">
        <div
          ref={columnRef}
          className="squisq-teleprompter-scroll"
          style={compact ? { padding: '30vh 5% 60vh' } : undefined}
          onClick={handleClick}
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
