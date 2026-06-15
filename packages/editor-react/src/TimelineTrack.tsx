/**
 * TimelineTrack
 *
 * Horizontal timeline strip for the Timeline view. Shows every block as a bar
 * (width ∝ duration, x ∝ startTime) with its media clips as sub-bars below.
 * Clicking a block selects it (the editor above follows). Dragging a block's
 * right edge changes its duration; dragging its left edge changes the previous
 * block's duration (the boundary, since startTime is derived). Dragging a media
 * clip moves its `startAt`; dragging the clip's right edge changes its length;
 * double-clicking a clip toggles `spillover`. All edits are written back to the
 * markdown source via {@link timelineSource}.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block, MediaClip } from '@bendyline/squisq/schemas';
import {
  resolveMediaSchedule,
  getDocPlaybackDuration,
  type ScheduledClip,
} from '@bendyline/squisq/schemas';
import { flattenBlocks } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';
import {
  setBlockDurationInSource,
  setMediaClipInSource,
  placeClipInBlock,
  type ClipSpec,
} from './timelineSource';
import { collectEmbeddedMedia } from './embeddedMedia';

const DEFAULT_PX_PER_SECOND = 18;
const ZOOM_MIN = 4;
const ZOOM_MAX = 160;
const ZOOM_FACTOR = 1.4;
const MIN_DURATION = 0.5; // seconds — floor when dragging a block edge
/** Candidate ruler-tick intervals (seconds); the first wide enough is used. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
/** Minimum pixels between ruler ticks. */
const TICK_MIN_PX = 64;

type DragKind =
  | 'block-right'
  | 'block-left'
  | 'clip-move'
  | 'clip-right'
  | 'embed-move'
  | 'embed-right';

interface DragState {
  kind: DragKind;
  startX: number;
  /** Lower bound (seconds) for the dragged value (0 for position drags). */
  floor: number;
  /** Value (seconds) at drag start, added to the pointer delta. */
  previewBase: number;
  /** Live preview value (seconds) shown while dragging. */
  preview: number;
  commit: (seconds: number) => void;
  /** Id of the bar/clip being dragged (for live preview geometry). */
  targetId: string;
  /**
   * For block-edge drags: index of the block whose duration changes. Its bar
   * previews at `preview` and every block after it shifts by the delta so the
   * whole track follows the mouse live.
   */
  pivotIndex?: number;
  /**
   * True after pointer-up: the edit is committed but kept applied so the bar
   * holds its new position while the markdown re-parses (debounced). Cleared
   * once the regenerated `doc` reflects the edit — avoids a snap-back flash.
   */
  committed?: boolean;
}

function headingLine(block: Block): number | undefined {
  return block.sourceHeading?.position?.start.line;
}

export interface TimelineTrackProps {
  height?: number;
}

export function TimelineTrack({ height = 160 }: TimelineTrackProps) {
  const { doc, markdownSource, setMarkdownSource, goToBlockByLine, activeBlockStartLine } =
    useEditorContext();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);

  const blocks = useMemo(() => (doc ? flattenBlocks(doc.blocks) : []), [doc]);
  const clips = useMemo<ScheduledClip[]>(() => (doc ? resolveMediaSchedule(doc) : []), [doc]);
  const total = useMemo(() => (doc ? getDocPlaybackDuration(doc) : 0), [doc]);
  const width = Math.max(total * pxPerSecond, 200);

  // Raw clip lookup (keeps clipStart/clipEnd/spillover that the schedule drops)
  // so a clip can be rebuilt verbatim when relocated to another block.
  const rawClipById = useMemo(() => {
    const map = new Map<string, MediaClip>();
    if (doc) {
      for (const b of flattenBlocks(doc.blocks)) for (const m of b.media ?? []) map.set(m.id, m);
      for (const m of doc.documentMedia ?? []) map.set(m.id, m);
    }
    return map;
  }, [doc]);

  // The heading-bearing block whose [startTime, startTime+duration) contains
  // `time`, clamped to the first/last such block. Used to retarget a dragged
  // clip to whichever block it lands in.
  const blockAtTime = useCallback(
    (time: number): Block | null => {
      const withHeadings = blocks.filter((b) => headingLine(b) != null);
      if (withHeadings.length === 0) return null;
      let found = withHeadings[0];
      for (const b of withHeadings) {
        if (time >= b.startTime) found = b;
      }
      return found;
    },
    [blocks],
  );

  // Move a clip's start to an absolute timeline position. If the new start
  // lands in a different block, the clip's annotation relocates to that block
  // (rebuilt from `spec`); within the same block it's a minimal `startAt` edit.
  // `extraPatch` carries non-position edits (e.g. clipEnd) for the same-block case.
  const moveClipToTime = useCallback(
    (
      sourceLine: number | undefined,
      currentBlockId: string | undefined,
      spec: ClipSpec,
      newAbsStart: number,
      extraPatch?: { clipEnd?: number },
    ) => {
      if (sourceLine == null) return;
      const target = blockAtTime(newAbsStart);
      const targetLine = target ? headingLine(target) : undefined;
      if (target == null || targetLine == null) return;
      const startAt = Math.max(0, newAbsStart - target.startTime);
      if (currentBlockId === target.id) {
        // Same block → in-place edit, preserving any extra params on the line.
        const next = setMediaClipInSource(markdownSource, sourceLine, { startAt, ...extraPatch });
        if (next) setMarkdownSource(next);
        return;
      }
      const next = placeClipInBlock(
        markdownSource,
        sourceLine,
        targetLine,
        extraPatch?.clipEnd != null ? { ...spec, clipEnd: extraPatch.clipEnd } : spec,
        startAt,
      );
      if (next) setMarkdownSource(next);
    },
    [blockAtTime, markdownSource, setMarkdownSource],
  );

  // Convert a body-embedded media tag into a timed clip annotation at
  // `newAbsStart` (relocating to the landing block). Always writes an
  // annotation, since the embed isn't one yet.
  const placeEmbeddedClip = useCallback(
    (sourceLine: number | undefined, spec: ClipSpec, newAbsStart: number) => {
      if (sourceLine == null) return;
      const target = blockAtTime(newAbsStart);
      const targetLine = target ? headingLine(target) : undefined;
      if (target == null || targetLine == null) return;
      const startAt = Math.max(0, newAbsStart - target.startTime);
      const next = placeClipInBlock(markdownSource, sourceLine, targetLine, spec, startAt);
      if (next) setMarkdownSource(next);
    },
    [blockAtTime, markdownSource, setMarkdownSource],
  );

  const zoomIn = useCallback(() => setPxPerSecond((s) => Math.min(ZOOM_MAX, s * ZOOM_FACTOR)), []);
  const zoomOut = useCallback(() => setPxPerSecond((s) => Math.max(ZOOM_MIN, s / ZOOM_FACTOR)), []);

  // Track the visible width so the ruler can draw ticks across the whole
  // viewport, not just up to where the content ends.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Live drag handling on the window so the pointer can leave the bar. The
  // current scale is read from a ref so the handler doesn't re-bind on zoom.
  const scaleRef = useRef(pxPerSecond);
  scaleRef.current = pxPerSecond;
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const isDragging = drag != null && !drag.committed;
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaSec = (e.clientX - d.startX) / scaleRef.current;
      setDrag({ ...d, preview: Math.max(d.floor, d.previewBase + deltaSec) });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      d.commit(d.preview);
      // Keep the preview applied (committed) until the regenerated doc reflects
      // the edit, so the bar doesn't snap back to the old layout for a frame.
      setDrag({ ...d, committed: true });
      // Fallback: if the edit produced identical markdown (no re-parse), drop
      // the committed preview anyway so it can't get stuck.
      window.setTimeout(() => {
        if (dragRef.current?.committed) setDrag(null);
      }, 500);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isDragging]);

  // Drop the committed preview once the doc re-parses with the new value.
  useEffect(() => {
    if (dragRef.current?.committed) setDrag(null);
  }, [doc]);

  const beginDrag = useCallback(
    (
      e: React.PointerEvent,
      kind: DragKind,
      targetId: string,
      base: number,
      commit: (seconds: number) => void,
      opts?: { pivotIndex?: number; floor?: number },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      // Position drags (moving a clip) floor at 0; length drags floor at MIN_DURATION.
      const floor =
        opts?.floor ?? (kind === 'clip-move' || kind === 'embed-move' ? 0 : MIN_DURATION);
      setDrag({
        kind,
        startX: e.clientX,
        floor,
        preview: base,
        previewBase: base,
        commit,
        targetId,
        pivotIndex: opts?.pivotIndex,
      });
    },
    [],
  );

  if (!doc) return null;

  // Live layout while a block edge is dragged: the pivot block previews at the
  // new duration and every block after it shifts by the delta, so the track
  // re-lays-out under the mouse instead of snapping on release.
  const blockDrag =
    drag && (drag.kind === 'block-right' || drag.kind === 'block-left') ? drag : null;
  const pivot = blockDrag?.pivotIndex ?? -1;
  const blockDelta = blockDrag ? blockDrag.preview - blockDrag.previewBase : 0;
  const previewLeft = (index: number) =>
    (blocks[index].startTime + (index > pivot ? blockDelta : 0)) * pxPerSecond;
  const previewWidth = (index: number) =>
    Math.max((index === pivot ? blockDrag!.preview : blocks[index].duration) * pxPerSecond, 2);
  const clipShift = (clip: ScheduledClip) => {
    if (!blockDrag || clip.anchor === 'document' || !clip.blockId) return 0;
    const owning = blocks.findIndex((b) => b.id === clip.blockId);
    return owning > pivot ? blockDelta : 0;
  };

  // Ruler ticks: the smallest interval that keeps labels at least TICK_MIN_PX
  // apart at the current zoom.
  const tickSeconds =
    TICK_STEPS.find((s) => s * pxPerSecond >= TICK_MIN_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
  // Fill ticks across the whole visible track, continuing past the content end.
  const rulerEnd = Math.max(total, viewportWidth / pxPerSecond);
  const ticks: number[] = [];
  for (let t = 0; t <= rulerEnd + 0.001 && ticks.length < 1000; t += tickSeconds) ticks.push(t);

  return (
    <div className="squisq-timeline" style={{ height }} data-testid="timeline-track">
      <div className="squisq-timeline-controls">
        <button
          type="button"
          className="squisq-timeline-zoom-button"
          onClick={zoomOut}
          disabled={pxPerSecond <= ZOOM_MIN}
          aria-label="Zoom out"
          data-tooltip="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="squisq-timeline-zoom-button"
          onClick={zoomIn}
          disabled={pxPerSecond >= ZOOM_MAX}
          aria-label="Zoom in"
          data-tooltip="Zoom in"
        >
          +
        </button>
      </div>
      <div className="squisq-timeline-scroll" ref={scrollRef}>
        <div className="squisq-timeline-inner" style={{ width }}>
          <div className="squisq-timeline-row squisq-timeline-row--blocks">
            {blocks.map((b, i) => {
              const line = headingLine(b);
              const isActive = line != null && line === activeBlockStartLine;
              const left = previewLeft(i);
              const barWidth = previewWidth(i);
              const prev = i > 0 ? blocks[i - 1] : null;
              return (
                <div
                  key={b.id}
                  className={`squisq-timeline-block${isActive ? ' squisq-timeline-block--active' : ''}`}
                  style={{ left, width: barWidth }}
                  title={`${b.title ?? b.id} — ${formatDur(b.duration)}`}
                  onClick={() => line != null && goToBlockByLine(line)}
                >
                  {prev && headingLine(prev) != null && (
                    <span
                      className="squisq-timeline-edge squisq-timeline-edge--left"
                      onPointerDown={(e) =>
                        beginDrag(
                          e,
                          'block-left',
                          b.id,
                          prev.duration,
                          (sec) => {
                            // Moving the boundary changes the previous block's duration.
                            const next = setBlockDurationInSource(
                              markdownSource,
                              headingLine(prev)!,
                              sec,
                            );
                            if (next) setMarkdownSource(next);
                          },
                          { pivotIndex: i - 1 },
                        )
                      }
                    />
                  )}
                  <span className="squisq-timeline-block-label">{b.title ?? b.id}</span>
                  {line != null && (
                    <span
                      className="squisq-timeline-edge squisq-timeline-edge--right"
                      onPointerDown={(e) =>
                        beginDrag(
                          e,
                          'block-right',
                          b.id,
                          b.duration,
                          (sec) => {
                            const next = setBlockDurationInSource(markdownSource, line, sec);
                            if (next) setMarkdownSource(next);
                          },
                          { pivotIndex: i },
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="squisq-timeline-row squisq-timeline-row--media">
            {clips.map((c) => {
              const length = c.absoluteEnd - c.absoluteStart;
              // Live geometry while dragging: follow a block-edge drag's shift,
              // or the clip's own move/resize (drag.preview is an absolute time).
              let left = (c.absoluteStart + clipShift(c)) * pxPerSecond;
              let clipWidth = Math.max(length * pxPerSecond, 4);
              if (drag?.targetId === c.id && drag.kind === 'clip-move') {
                left = drag.preview * pxPerSecond;
              } else if (drag?.targetId === c.id && drag.kind === 'clip-right') {
                clipWidth = Math.max(drag.preview * pxPerSecond, 4);
              }
              const editable = c.sourceLine != null;
              const specOf = (): ClipSpec => {
                const raw = rawClipById.get(c.id);
                return raw
                  ? {
                      kind: raw.kind,
                      src: raw.src,
                      clipStart: raw.clipStart,
                      clipEnd: raw.clipEnd,
                      spillover: raw.spillover,
                    }
                  : { kind: c.kind, src: c.src, clipStart: c.sourceIn };
              };
              return (
                <div
                  key={c.id}
                  className={`squisq-timeline-clip squisq-timeline-clip--${c.kind}${
                    c.anchor === 'document' ? ' squisq-timeline-clip--document' : ''
                  }`}
                  style={{ left, width: clipWidth }}
                  title={`${c.src} — ${formatDur(length)}${c.anchor === 'document' ? ' (document)' : ''}`}
                  onPointerDown={(e) =>
                    editable &&
                    beginDrag(e, 'clip-move', c.id, c.absoluteStart, (absStart) => {
                      if (c.anchor === 'document') {
                        const next = setMediaClipInSource(markdownSource, c.sourceLine!, {
                          startAt: absStart,
                        });
                        if (next) setMarkdownSource(next);
                      } else {
                        moveClipToTime(c.sourceLine, c.blockId, specOf(), absStart);
                      }
                    })
                  }
                  onDoubleClick={() => {
                    if (c.sourceLine == null) return;
                    // Toggle spillover (block clips only).
                    const next = setMediaClipInSource(markdownSource, c.sourceLine, {
                      spillover: c.anchor === 'block' ? true : null,
                    });
                    if (next) setMarkdownSource(next);
                  }}
                >
                  <span className="squisq-timeline-clip-label">{clipName(c.src)}</span>
                  {editable && (
                    <span
                      className="squisq-timeline-edge squisq-timeline-edge--right"
                      onPointerDown={(e) =>
                        beginDrag(e, 'clip-right', c.id, length, (len) => {
                          const next = setMediaClipInSource(markdownSource, c.sourceLine!, {
                            clipEnd: (c.sourceIn ?? 0) + len,
                          });
                          if (next) setMarkdownSource(next);
                        })
                      }
                    />
                  )}
                </div>
              );
            })}

            {/* Media embedded in a block's body (recordings, dropped files):
                snapped to the parent block. Editing one converts it to a timed
                clip annotation and relocates it to wherever it's dragged. */}
            {blocks.flatMap((b, i) =>
              collectEmbeddedMedia(b).map((m, j) => {
                const id = `embed:${b.id}:${j}`;
                const absStart = b.startTime;
                const length = b.duration;
                let left = previewLeft(i);
                let clipWidth = previewWidth(i);
                if (drag?.targetId === id && drag.kind === 'embed-move') {
                  left = drag.preview * pxPerSecond;
                } else if (drag?.targetId === id && drag.kind === 'embed-right') {
                  clipWidth = Math.max(drag.preview * pxPerSecond, 4);
                }
                const spec: ClipSpec = { kind: m.kind, src: m.src };
                return (
                  <div
                    key={id}
                    className={`squisq-timeline-clip squisq-timeline-clip--${m.kind} squisq-timeline-clip--embedded`}
                    style={{ left, width: clipWidth }}
                    title={`${m.src} — drag to time / move between blocks`}
                    onPointerDown={(e) =>
                      m.sourceLine != null &&
                      beginDrag(e, 'embed-move', id, absStart, (newAbsStart) => {
                        placeEmbeddedClip(m.sourceLine, { ...spec, clipEnd: length }, newAbsStart);
                      })
                    }
                  >
                    <span className="squisq-timeline-clip-label">{clipName(m.src)}</span>
                    {m.sourceLine != null && (
                      <span
                        className="squisq-timeline-edge squisq-timeline-edge--right"
                        onPointerDown={(e) =>
                          beginDrag(e, 'embed-right', id, length, (len) => {
                            placeEmbeddedClip(m.sourceLine, { ...spec, clipEnd: len }, absStart);
                          })
                        }
                      />
                    )}
                  </div>
                );
              }),
            )}
          </div>

          <div className="squisq-timeline-row squisq-timeline-row--ruler">
            {ticks.map((t) => (
              <div key={t} className="squisq-timeline-tick" style={{ left: t * pxPerSecond }}>
                <span className="squisq-timeline-tick-label">{formatDur(t)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDur(seconds: number): string {
  const s = Math.round(seconds * 10) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function clipName(src: string): string {
  const base = src.split('/').pop() ?? src;
  return base;
}
