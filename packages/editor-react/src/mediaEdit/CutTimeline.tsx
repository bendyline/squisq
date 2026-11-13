/**
 * The Cuts timeline: the clip's waveform under a ruler, with removed sections
 * shaded, a selection, and a playhead. Click to move the playhead, drag to
 * select a section, drag a cut's edges to adjust it. Zooming widens the track
 * inside a scrolling viewport; the waveform canvas stays the viewport's size
 * and redraws the visible span, so a long recording zooms to word level
 * without an enormous canvas.
 *
 * Positions are SOURCE seconds; labels are shown from the clip's start.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MediaCut } from '@bendyline/squisq/mediaEdit';
import type { MediaEditWaveformResult } from '@bendyline/squisq-video-react/media-edit';
import {
  formatRulerLabel,
  formatTimecode,
  peakInRange,
  rulerStep,
  type TimeRange,
} from './cutList';

/** Pointer travel before a press becomes a selection drag. */
const DRAG_THRESHOLD_PX = 4;
/** Dragging this close to a viewport edge scrolls the timeline. */
const EDGE_SCROLL_ZONE_PX = 28;
const EDGE_SCROLL_STEP_PX = 18;
/** Cuts narrower than this on screen hide their edge handles — zoom in to adjust them. */
const NARROW_CUT_PX = 18;
/** Room a ruler label needs to its right. */
const RULER_LABEL_PX = 40;
const NUDGE_SEC = 0.1;
const NUDGE_COARSE_SEC = 1;

export type CutEdge = 'start' | 'end';

export interface CutTimelineProps {
  /** The clip's trim window. */
  bounds: TimeRange;
  /** Normalized cuts inside `bounds`. */
  cuts: readonly MediaCut[];
  selection: TimeRange | null;
  playhead: number;
  /** Null while it loads, or when the clip has no audio. */
  waveform: MediaEditWaveformResult | null;
  /** 1 fits the whole clip in the viewport. */
  zoom: number;
  /** Id of the element describing how to use the timeline. */
  describedBy?: string;
  onSeek: (time: number) => void;
  onSelect: (selection: TimeRange | null) => void;
  /** An edge drag or nudge is starting: the moment to take an undo snapshot. */
  onEdgeEditStart: () => void;
  onMoveEdge: (index: number, edge: CutEdge, time: number) => void;
  onRemoveCut: (index: number) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/** Display gain that brings the loudest slice to full height (quiet takes stay readable). */
function waveformGain(peaks: Float32Array): number {
  let max = 0;
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > max) max = peaks[i];
  }
  return max > 0.01 ? 1 / max : 1;
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  waveform: MediaEditWaveformResult | null,
  gain: number,
  viewStart: number,
  secondsPerPixel: number,
  width: number,
): void {
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(canvas).color;
  const mid = height / 2;
  if (!waveform) {
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, Math.floor(mid), width, 1);
    ctx.globalAlpha = 1;
    return;
  }
  const { peaks, peaksPerSec } = waveform;
  const slicesPerPixel = secondsPerPixel * peaksPerSec;
  for (let x = 0; x < width; x++) {
    const from = (viewStart + x * secondsPerPixel) * peaksPerSec;
    const level = Math.min(1, peakInRange(peaks, from, from + slicesPerPixel) * gain);
    // A gentle curve lifts quiet speech off the centre line.
    const half = Math.max(0.5, Math.pow(level, 0.7) * (mid - 2));
    ctx.fillRect(x, mid - half, 1, half * 2);
  }
}

export function CutTimeline({
  bounds,
  cuts,
  selection,
  playhead,
  waveform,
  zoom,
  describedBy,
  onSeek,
  onSelect,
  onEdgeEditStart,
  onMoveEdge,
  onRemoveCut,
  onKeyDown,
}: CutTimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ width: 0, scrollLeft: 0 });

  const span = Math.max(1e-6, bounds.end - bounds.start);
  const trackWidth = view.width * zoom;
  const secondsPerPixel = trackWidth > 0 ? span / trackWidth : Number.POSITIVE_INFINITY;
  const fraction = (time: number) => (time - bounds.start) / span;
  const percent = (time: number) => `${(fraction(time) * 100).toFixed(4)}%`;

  // Track the viewport: its width (the panel is hidden until its tab opens) and scroll offset.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () =>
      setView((current) =>
        current.width === scroller.clientWidth && current.scrollLeft === scroller.scrollLeft
          ? current
          : { width: scroller.clientWidth, scrollLeft: scroller.scrollLeft },
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Zooming keeps the playhead in the middle of the viewport.
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || zoomRef.current === zoom) return;
    zoomRef.current = zoom;
    scroller.scrollLeft = Math.max(0, fraction(playhead) * trackWidth - view.width / 2);
    // Only a zoom change re-centres; playhead moves are followed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Follow the playhead when it leaves the viewport (playback, keyboard moves).
  // Not during a drag: the pointer scrolls the timeline itself at the edges.
  const draggingRef = useRef(false);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || draggingRef.current || trackWidth <= view.width) return;
    const x = fraction(playhead) * trackWidth;
    if (x < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, x - view.width * 0.85);
    else if (x > scroller.scrollLeft + view.width - 8) scroller.scrollLeft = x - view.width * 0.15;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead]);

  const gain = useMemo(() => (waveform ? waveformGain(waveform.peaks) : 1), [waveform]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view.width <= 0) return;
    drawWaveform(
      canvas,
      waveform,
      gain,
      bounds.start + view.scrollLeft * secondsPerPixel,
      secondsPerPixel,
      view.width,
    );
  }, [waveform, gain, bounds.start, secondsPerPixel, view.width, view.scrollLeft]);

  const timeAt = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return bounds.start;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return bounds.start;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return bounds.start + ratio * span;
  };

  const scrollNearEdge = (clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (clientX > rect.right - EDGE_SCROLL_ZONE_PX) scroller.scrollLeft += EDGE_SCROLL_STEP_PX;
    else if (clientX < rect.left + EDGE_SCROLL_ZONE_PX) scroller.scrollLeft -= EDGE_SCROLL_STEP_PX;
  };

  /** Run `onMove` for each pointer move until the button is released. */
  const trackPointer = (onMove: (event: PointerEvent) => void, onEnd?: (x: number) => void) => {
    const finish = (event: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      draggingRef.current = false;
      onEnd?.(event.clientX);
    };
    draggingRef.current = true;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Cut handles and restore buttons take their own presses.
    if ((event.target as Element).closest('button, [role="slider"]')) return;
    event.preventDefault();
    scrollerRef.current?.focus({ preventScroll: true });
    const originX = event.clientX;
    const origin = timeAt(originX);
    let dragged = false;
    trackPointer(
      (move) => {
        if (!dragged && Math.abs(move.clientX - originX) < DRAG_THRESHOLD_PX) return;
        dragged = true;
        scrollNearEdge(move.clientX);
        const time = timeAt(move.clientX);
        onSelect({ start: Math.min(origin, time), end: Math.max(origin, time) });
        // Scrub with the moving end, so a video shows where the selection stops.
        onSeek(time);
      },
      (endX) => {
        if (dragged) {
          onSeek(Math.min(origin, timeAt(endX)));
        } else {
          onSelect(null);
          onSeek(origin);
        }
      },
    );
  };

  const startEdgeDrag =
    (index: number, edge: CutEdge) => (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      onEdgeEditStart();
      trackPointer((move) => {
        scrollNearEdge(move.clientX);
        onMoveEdge(index, edge, timeAt(move.clientX));
      });
    };

  const onEdgeKeyDown =
    (index: number, edge: CutEdge) => (event: ReactKeyboardEvent<HTMLSpanElement>) => {
      const cut = cuts[index];
      if (!cut || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        onRemoveCut(index);
        scrollerRef.current?.focus({ preventScroll: true });
        return;
      }
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (direction === 0) return;
      event.preventDefault();
      event.stopPropagation();
      onEdgeEditStart();
      onMoveEdge(
        index,
        edge,
        cut[edge] + direction * (event.shiftKey ? NUDGE_COARSE_SEC : NUDGE_SEC),
      );
    };

  // Ruler labels for the visible span only — a zoomed-in hour has thousands.
  const ticks: Array<{ x: number; label: string }> = [];
  if (trackWidth > 0) {
    const step = rulerStep(secondsPerPixel);
    const firstVisible = view.scrollLeft * secondsPerPixel;
    const lastVisible = Math.min(span, (view.scrollLeft + view.width) * secondsPerPixel);
    // Count in whole steps: adding a fractional step repeatedly drifts.
    for (let n = Math.ceil(firstVisible / step); n * step <= lastVisible; n++) {
      const x = (n * step) / secondsPerPixel;
      // A label with no room before the clip's end would be clipped mid-digit.
      if (x > trackWidth - RULER_LABEL_PX) break;
      ticks.push({ x, label: formatRulerLabel(n * step, step) });
    }
  }

  const clipTime = (time: number) => formatTimecode(time - bounds.start);
  return (
    <div
      ref={scrollerRef}
      className="squisq-media-edit-timeline"
      role="group"
      aria-label="Clip timeline"
      aria-describedby={describedBy}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        const { clientWidth, scrollLeft } = event.currentTarget;
        setView((current) =>
          current.width === clientWidth && current.scrollLeft === scrollLeft
            ? current
            : { width: clientWidth, scrollLeft },
        );
      }}
    >
      <div
        ref={trackRef}
        className="squisq-media-edit-timeline__track"
        style={{ width: `${zoom * 100}%` }}
        onPointerDown={startSelection}
      >
        <div className="squisq-media-edit-timeline__ruler" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.label}
              className="squisq-media-edit-timeline__tick"
              style={{ left: tick.x }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          className="squisq-media-edit-timeline__wave"
          style={{ width: view.width }}
          aria-hidden="true"
        />
        {cuts.map((cut, index) => {
          const narrow = (cut.end - cut.start) / secondsPerPixel < NARROW_CUT_PX;
          const number = index + 1;
          const handle = (edge: CutEdge) => (
            <span
              className={`squisq-media-edit-timeline__handle squisq-media-edit-timeline__handle--${edge}`}
              role="slider"
              tabIndex={0}
              aria-label={`Cut ${number} ${edge}`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Number(span.toFixed(3))}
              aria-valuenow={Number((cut[edge] - bounds.start).toFixed(3))}
              aria-valuetext={clipTime(cut[edge])}
              onPointerDown={startEdgeDrag(index, edge)}
              onKeyDown={onEdgeKeyDown(index, edge)}
            />
          );
          return (
            <div
              key={index}
              className="squisq-media-edit-timeline__cut"
              data-testid="media-edit-cut"
              data-narrow={narrow ? 'true' : undefined}
              style={{
                left: percent(cut.start),
                width: percent(bounds.start + cut.end - cut.start),
              }}
            >
              {handle('start')}
              <button
                type="button"
                className="squisq-media-edit-timeline__restore"
                aria-label={`Restore cut ${number} on the timeline`}
                title="Restore this section"
                onClick={() => onRemoveCut(index)}
              >
                ×
              </button>
              {handle('end')}
            </div>
          );
        })}
        {selection && (
          <div
            className="squisq-media-edit-timeline__selection"
            data-testid="media-edit-selection"
            style={{
              left: percent(selection.start),
              width: percent(bounds.start + selection.end - selection.start),
            }}
          />
        )}
        <div
          className="squisq-media-edit-timeline__playhead"
          data-testid="media-edit-playhead"
          style={{ left: percent(playhead) }}
        />
      </div>
    </div>
  );
}
