/**
 * TimelineTrack
 *
 * Horizontal timeline strip for the Timeline view. Shows every block as a bar
 * (width ∝ duration, x ∝ startTime) with every media clip on an independent
 * track below. The track viewport scrolls in both directions when the document
 * is wider or has more media tracks than the dock can show at once.
 * Clicking a block selects it (the editor above follows). Dragging a block's
 * right edge changes its duration; dragging its left edge changes the previous
 * block's duration (the boundary, since startTime is derived). Dragging a media
 * clip moves its `startAt`; dragging the clip's right edge changes its length;
 * double-clicking a clip toggles `spillover`. All edits are written back to the
 * markdown source via {@link timelineSource}.
 *
 * The playhead scrubs when dragged, and so does a press on the ruler or on the
 * lane above the bars that holds the playhead's knob. Scrubbing against either
 * edge of the viewport scrolls the track so a long document can be scrubbed end
 * to end on a narrow screen.
 *
 * Touch: a swipe across the bars scrolls the track, so a finger only edits
 * through dedicated handles. The selected block's edges grab at once (they opt
 * out of browser panning); a media clip, or its trimming edge, lifts after a
 * long press — a finger that travels before then is scrolling, and the press
 * is dropped. A press the browser takes over (`pointercancel`) never commits.
 *
 * A dynamic-slides document times its own summary slides, so its section bars
 * offer no edge drags and their menu can only clear a pin: one pinned section
 * would stop a narrated deck from compiling and fall back to the authored blocks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block, Doc, MediaClip } from '@bendyline/squisq/schemas';
import {
  resolveMediaSchedule,
  getDocPlaybackDuration,
  VIEWPORT_PRESETS,
  type ScheduledClip,
} from '@bendyline/squisq/schemas';
import { flattenBlocks, DEFAULT_THEME, getPinnedBlockMeta } from '@bendyline/squisq/doc';
import { createMediaTimeMap } from '@bendyline/squisq/mediaEdit';
import { usesDynamicPresentation } from '@bendyline/squisq/transform';
import { useProcessedAudio } from '@bendyline/squisq-video-react/media-edit';
import { MediaClipLayer, MediaContext } from '@bendyline/squisq-react';
import { useEditorContext } from './EditorContext';
import { usePreviewSettingsOptional } from './PreviewControls';
import {
  setBlockDurationInSource,
  setBlockStartTimeInSource,
  setBlockTransitionInSource,
  setMediaClipInSource,
  placeClipInBlock,
  type ClipSpec,
  type MediaClipPatch,
} from './timelineSource';
import {
  collectEmbeddedMedia,
  collectTimelinePlaybackSchedule,
  resolveEmbeddedMediaTiming,
} from './embeddedMedia';
import { BlockThumbnail } from './TimelineBlockPreview';
import { resolveBlockVisual } from './resolveBlockVisual';
import { useTimelineClock, type TimelineClock } from './useTimelineClock';
import { timelineMediaLabel } from './timelineMediaLabel';
import { timelineBars } from './timelineBars';
import { readHeadingLineTransition } from './headingTransition';
import { useResolvedMediaSrc } from './tiptap/useResolvedMediaSrc';
import {
  TimelineItemMenu,
  type TimelineItemMenuTarget,
  type TimelineMenuAnchor,
} from './TimelineItemMenu';

/** Viewport the per-bar thumbnails render at. */
const PREVIEW_VIEWPORT = VIEWPORT_PRESETS.landscape;

const DEFAULT_PX_PER_SECOND = 18;
const ZOOM_MIN = 4;
const ZOOM_MAX = 160;
const ZOOM_FACTOR = 1.4;
const MIN_DURATION = 0.5; // seconds — floor when dragging a block edge
/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** A fingertip jitters more than a mouse; touch uses a wider click/drag slop. */
const TOUCH_SLOP_PX = 8;
/** Hold time (ms) before a touch on a media clip lifts it for moving/trimming. */
const LONG_PRESS_MS = 350;
/** Width (px) of the zone at each viewport edge that auto-scrolls a scrub. */
const SCRUB_EDGE_PX = 28;
/** Fastest auto-scroll (px per frame) while scrubbing against an edge. */
const SCRUB_EDGE_SPEED = 12;
/** Candidate ruler-tick intervals (seconds); the first wide enough is used. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
/** Minimum pixels between ruler ticks. */
const TICK_MIN_PX = 64;
/** Approximate width of one sampled frame in a video bar. */
const FILMSTRIP_FRAME_WIDTH = 72;
/** Keep long recordings from mounting an unbounded number of decoders. */
const FILMSTRIP_MAX_FRAMES = 8;

interface TimelineVideoFilmstripProps {
  src: string;
  sourceStart: number;
  sourceLength: number;
  width: number;
}

/**
 * A sampled, non-playing frame strip behind a timeline video label. Separate
 * muted video elements avoid canvas/CORS restrictions and let the browser
 * share its cache for the resolved media URL.
 */
function TimelineVideoFilmstrip({
  src,
  sourceStart,
  sourceLength,
  width,
}: TimelineVideoFilmstripProps) {
  const resolvedSrc = useResolvedMediaSrc(src);
  const frameCount = Math.min(
    FILMSTRIP_MAX_FRAMES,
    Math.max(1, Math.ceil(width / FILMSTRIP_FRAME_WIDTH)),
  );

  return (
    <div className="squisq-timeline-video-filmstrip" aria-hidden="true">
      {Array.from({ length: frameCount }, (_, index) => {
        const sampleTime =
          Math.max(0, sourceStart) + Math.max(0, sourceLength) * ((index + 0.5) / frameCount);
        return (
          <video
            key={`${index}:${sampleTime}`}
            src={resolvedSrc || undefined}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            draggable={false}
            onLoadedMetadata={(event) => seekTimelineFrame(event.currentTarget, sampleTime)}
          />
        );
      })}
    </div>
  );
}

/** Seek a filmstrip tile to its sample while respecting finite media bounds. */
function seekTimelineFrame(video: HTMLVideoElement, sampleTime: number): void {
  const lastDecodableTime =
    Number.isFinite(video.duration) && video.duration > 0
      ? Math.max(0, video.duration - 0.04)
      : sampleTime;
  const target = Math.max(0, Math.min(sampleTime, lastDecodableTime));
  try {
    video.currentTime = target;
  } catch {
    // A malformed or not-yet-seekable source simply keeps its first frame.
  }
}

type DragKind =
  'block-right' | 'block-left' | 'clip-move' | 'clip-right' | 'embed-move' | 'embed-right';

/**
 * Drags a finger only starts after a long press. Media bars fill most of the
 * track, so an immediate grab would turn every swipe-to-scroll into an edit.
 */
const LONG_PRESS_KINDS: ReadonlySet<DragKind> = new Set([
  'clip-move',
  'clip-right',
  'embed-move',
  'embed-right',
]);

interface DragState {
  kind: DragKind;
  startX: number;
  startY: number;
  /** Pointer that owns the drag; other pointers (a second finger) are ignored. */
  pointerId?: number;
  /** Travel (px) before the press counts as a drag rather than a click. */
  threshold: number;
  /**
   * False while a touch waits out its long press. Travel before then is the
   * user scrolling the track, so the press is dropped and the browser pans.
   * True from the start for mouse/pen drags and for touch-only handles.
   */
  armed: boolean;
  /** True once a long press lifted the item (drives the lifted styling). */
  lifted?: boolean;
  /** Lower bound (seconds) for the dragged value (0 for position drags). */
  floor: number;
  /** Value (seconds) at drag start, added to the pointer delta. */
  previewBase: number;
  /** Live preview value (seconds) shown while dragging. */
  preview: number;
  commit: (seconds: number) => void;
  /**
   * Optional click action: run on pointer-up when the press did NOT travel past
   * {@link DRAG_THRESHOLD_PX}. A bare click must never `commit` — for an
   * embedded `<video>` that silently rewrote it into a `{[video …]}` annotation.
   * It selects / seeks instead.
   */
  onClick?: () => void;
  /** True once the pointer moved past the click threshold — i.e. a real drag. */
  moved?: boolean;
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

type TimelineMenuState =
  | { kind: 'block'; id: string; sourceLine: number; anchor: TimelineMenuAnchor }
  | {
      kind: 'video';
      id: string;
      sourceLine: number;
      src: string;
      absoluteStart: number;
      embedded: boolean;
      anchor: TimelineMenuAnchor;
    };

function headingLine(block: Block): number | undefined {
  return block.sourceHeading?.position?.start.line;
}

export interface TimelineTrackProps {
  height?: number;
  /** Base path used when a media source is not resolved by MediaContext. */
  basePath?: string;
  /**
   * Doc used for bar geometry / timing. Callers pass the narration-timed
   * projection so the track matches what actually plays; falls back to the
   * editor's raw parse. Editing still round-trips because the projected doc
   * keeps each block's `sourceHeading`.
   */
  doc?: Doc | null;
  /** Optional shared clock used by docked timeline companions. */
  clock?: TimelineClock;
  /** Reuse an already-resolved schedule instead of deriving it from the doc. */
  schedule?: ScheduledClip[];
  /**
   * @deprecated Preview panes are visual-only and no longer take audio
   * ownership. Retained so existing callers remain source-compatible.
   */
  videoVisible?: boolean;
}

export function TimelineTrack({
  height = 160,
  basePath = '/',
  doc: docProp,
  clock,
  schedule,
}: TimelineTrackProps) {
  const {
    doc: contextDoc,
    markdownSource,
    setMarkdownSource,
    goToBlockByLine,
    activeBlockStartLine,
    mediaProvider,
    colorScheme,
    mediaEditRenders,
    openMediaEdit,
  } = useEditorContext();
  const processedAudio = useProcessedAudio(mediaEditRenders);
  // Prefer the caller's (narration-timed) doc for geometry; fall back to the raw
  // parse. Source edits still resolve because both carry `sourceHeading` lines.
  const doc = docProp ?? contextDoc;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [itemMenu, setItemMenu] = useState<TimelineMenuState | null>(null);
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The ruler starts at time 0 (past the leading gutter), so it anchors x↔time. */
  const rulerRef = useRef<HTMLDivElement>(null);
  // Window-level gesture handlers read the current scale from a ref so they
  // don't re-bind on zoom.
  const scaleRef = useRef(pxPerSecond);
  scaleRef.current = pxPerSecond;

  // Slide summaries (accessory blocks) take no time and are never shown.
  const blocks = useMemo(
    () => (doc ? flattenBlocks(doc.blocks).filter((block) => !block.accessoryBlock) : []),
    [doc],
  );
  const timingLocked = doc ? usesDynamicPresentation(doc) : false;

  // Tiny slideshow thumbnail for every block, filling its bar. Resolved once
  // per doc/theme so dragging (which re-renders bar geometry each frame)
  // doesn't re-render the SVGs.
  const previewSettings = usePreviewSettingsOptional();
  const previewTheme = previewSettings?.activeTheme ?? DEFAULT_THEME;
  const visualByBlock = useMemo(() => {
    const map = new Map<string, Block>();
    if (doc) {
      for (const b of blocks) {
        const visual = resolveBlockVisual(doc, b, previewTheme, PREVIEW_VIEWPORT);
        if (visual) map.set(b.id, visual);
      }
    }
    return map;
  }, [doc, blocks, previewTheme]);
  const derivedClips = useMemo<ScheduledClip[]>(
    () => (doc ? resolveMediaSchedule(doc) : []),
    [doc],
  );
  const clips = schedule ?? derivedClips;
  const playbackClips = useMemo(
    () => (doc ? collectTimelinePlaybackSchedule(doc, clips, { processedAudio }) : clips),
    [clips, doc, processedAudio],
  );
  const total = useMemo(() => (doc ? getDocPlaybackDuration(doc) : 0), [doc]);
  const width = Math.max(total * pxPerSecond, 200);

  // Real-time playback clock for the playhead + media. Starting playback also
  // drops any in-progress edit so the playhead drives.
  const internalClock = useTimelineClock(total);
  const activeClock = clock ?? internalClock;
  const { currentTime, isPlaying, play, pause, seek } = activeClock;
  const startPlay = useCallback(() => {
    setDrag(null);
    play();
  }, [play]);

  // Scrubbing: drag the playhead — or press the ruler / the knob lane and drag —
  // to seek. Pauses playback, follows the one pointer that started it, and ends
  // on release or when the browser cancels the gesture.
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRef = useRef<{
    pointerId?: number;
    startX: number;
    clientX: number;
    moved: boolean;
  } | null>(null);
  const timeAtClientX = useCallback((clientX: number) => {
    const origin = rulerRef.current?.getBoundingClientRect().left ?? 0;
    return (clientX - origin) / scaleRef.current;
  }, []);
  const beginScrub = useCallback(
    (e: React.PointerEvent, jumpToPointer: boolean) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      pause();
      scrubRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        clientX: e.clientX,
        moved: false,
      };
      if (jumpToPointer) seek(timeAtClientX(e.clientX));
      setScrubbing(true);
    },
    [pause, seek, timeAtClientX],
  );
  useEffect(() => {
    if (!scrubbing) return;
    const owns = (e: PointerEvent) => {
      const s = scrubRef.current;
      return s != null && (s.pointerId === undefined || e.pointerId === s.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const s = scrubRef.current;
      if (!s || !owns(e)) return;
      s.clientX = e.clientX;
      if (Math.abs(e.clientX - s.startX) >= DRAG_THRESHOLD_PX) s.moved = true;
      seek(timeAtClientX(e.clientX));
    };
    const onEnd = (e: PointerEvent) => {
      if (!owns(e)) return;
      scrubRef.current = null;
      setScrubbing(false);
    };
    // Holding the pointer against either edge keeps the track scrolling (and
    // the playhead seeking) — on a phone the viewport shows only a few seconds.
    // Only after the pointer has moved, so pressing a playhead that already
    // sits near an edge doesn't set the track sliding.
    let frame = 0;
    const step = () => {
      const s = scrubRef.current;
      const scroll = scrollRef.current;
      const rect = s?.moved ? scroll?.getBoundingClientRect() : undefined;
      if (s && scroll && rect && rect.width > SCRUB_EDGE_PX * 2) {
        const leftZone = rect.left + SCRUB_EDGE_PX;
        const rightZone = rect.right - SCRUB_EDGE_PX;
        const depth =
          s.clientX < leftZone
            ? s.clientX - leftZone
            : s.clientX > rightZone
              ? s.clientX - rightZone
              : 0;
        if (depth !== 0) {
          const before = scroll.scrollLeft;
          const speed = Math.min(SCRUB_EDGE_SPEED, Math.max(2, Math.abs(depth) / 2));
          scroll.scrollLeft = before + Math.sign(depth) * speed;
          if (scroll.scrollLeft !== before) seek(timeAtClientX(s.clientX));
        }
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [scrubbing, seek, timeAtClientX]);

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

  // While playing, follow the playhead: when it crosses into a new block,
  // select that block so the card editor + bar highlight track playback. Guarded
  // by a ref so we only fire on block boundaries, not every animation frame.
  const followedBlockRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      followedBlockRef.current = null;
      return;
    }
    const block = blockAtTime(currentTime);
    if (!block || block.id === followedBlockRef.current) return;
    followedBlockRef.current = block.id;
    const line = headingLine(block);
    if (line != null) goToBlockByLine(line);
  }, [isPlaying, currentTime, blockAtTime, goToBlockByLine]);

  // Auto-scroll so the playhead stays visible while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const x = currentTime * pxPerSecond + (rulerRef.current?.offsetLeft ?? 0);
    const left = scroll.scrollLeft;
    const right = left + scroll.clientWidth;
    if (x < left || x > right - 80) {
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
    }
  }, [isPlaying, currentTime, pxPerSecond]);

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

  // Time or relocate a body-embedded media element. Inline `<video>`/`<audio>`
  // elements keep their HTML representation and receive data-squisq timing
  // attributes; other embed forms continue to use media annotations.
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

  // Live drag handling on the window so the pointer can leave the bar.
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const isDragging = drag != null && !drag.committed;
  // Latest pointer position, so a long press lifts the item where the finger
  // now rests rather than where it first landed.
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const longPressTimerRef = useRef<number | null>(null);
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearLongPress, [clearLongPress]);
  useEffect(() => {
    if (!isDragging) return;
    const owns = (d: DragState, e: PointerEvent) =>
      d.pointerId === undefined || e.pointerId === d.pointerId;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !owns(d, e)) return;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (!d.armed) {
        // Travel before the long press elapses is a scroll: let the browser
        // have the gesture and forget the press.
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > d.threshold) {
          clearLongPress();
          setDrag(null);
        }
        return;
      }
      const deltaPx = e.clientX - d.startX;
      const moved = d.moved || Math.abs(deltaPx) >= d.threshold;
      const deltaSec = deltaPx / scaleRef.current;
      setDrag({ ...d, moved, preview: Math.max(d.floor, d.previewBase + deltaSec) });
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !owns(d, e)) return;
      clearLongPress();
      if (!d.moved) {
        // A click, not a drag: never mutate the source. Committing here is what
        // silently turned an embedded <video> into a {[video …]} tag. Run the
        // optional select/seek action instead and drop the drag.
        d.onClick?.();
        setDrag(null);
        return;
      }
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
    // The browser took the gesture over (it began a scroll, or a system
    // gesture): drop the edit. Without this a cancelled touch stayed "dragging"
    // and the next tap anywhere committed it.
    const onCancel = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !owns(d, e)) return;
      clearLongPress();
      setDrag(null);
    };
    // A long press raises the context menu on Android; the press is ours.
    const onContextMenu = (e: Event) => e.preventDefault();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [isDragging, clearLongPress]);

  // Once a finger has lifted a clip, its travel moves the clip, not the track.
  // Bound for the timeline's lifetime rather than per drag: browsers decide at
  // touchstart whether a touch sequence can be cancelled at all (iOS and
  // Chromium scroll off the main thread otherwise), so a listener added once
  // the press is underway arrives too late. Non-passive so preventDefault holds.
  const rootRef = useRef<HTMLDivElement>(null);
  const hasDoc = doc != null;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current?.armed && !dragRef.current.committed && e.cancelable) {
        e.preventDefault();
      }
    };
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => root.removeEventListener('touchmove', onTouchMove);
  }, [hasDoc]);

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
      opts?: { pivotIndex?: number; floor?: number; onClick?: () => void },
    ) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      // Position drags (moving a clip) floor at 0; length drags floor at MIN_DURATION.
      const floor =
        opts?.floor ?? (kind === 'clip-move' || kind === 'embed-move' ? 0 : MIN_DURATION);
      const touch = e.pointerType === 'touch';
      const armed = !(touch && LONG_PRESS_KINDS.has(kind));
      clearLongPress();
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (!armed) {
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null;
          const d = dragRef.current;
          if (!d || d.armed || d.targetId !== targetId) return;
          // Re-anchor on the resting finger so the lift itself moves nothing.
          setDrag({ ...d, armed: true, lifted: true, startX: lastPointerRef.current.x });
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      }
      setDrag({
        kind,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        threshold: touch ? TOUCH_SLOP_PX : DRAG_THRESHOLD_PX,
        armed,
        floor,
        preview: base,
        previewBase: base,
        commit,
        targetId,
        pivotIndex: opts?.pivotIndex,
        onClick: opts?.onClick,
      });
    },
    [clearLongPress],
  );

  // Non-destructive click on a timeline clip: move the playhead to its start and
  // select its owning block (mirrors clicking a block bar). Never edits source,
  // so clicking a recording no longer rewrites its <video> into a tag.
  const selectClipAt = useCallback(
    (time: number, blockId?: string) => {
      seek(time);
      const owner = blockId != null ? blocks.find((b) => b.id === blockId) : undefined;
      const line = owner ? headingLine(owner) : undefined;
      if (line != null) goToBlockByLine(line);
    },
    [seek, blocks, goToBlockByLine],
  );

  if (!doc) return null;

  let itemMenuTarget: TimelineItemMenuTarget | null = null;
  if (itemMenu?.kind === 'block') {
    const block = blocks.find((candidate) => candidate.id === itemMenu.id);
    if (block) {
      const pinned = getPinnedBlockMeta(block);
      const heading = markdownSource.split('\n')[itemMenu.sourceLine - 1] ?? '';
      itemMenuTarget = {
        kind: 'block',
        key: block.id,
        title: block.title ?? block.id,
        duration: block.duration,
        explicitDuration: pinned.duration != null,
        startTime: pinned.startTime ?? null,
        transition: readHeadingLineTransition(heading),
        timingLocked,
      };
    }
  } else if (itemMenu?.kind === 'video') {
    const clip = itemMenu.embedded
      ? null
      : clips.find(
          (candidate) =>
            (candidate.segment?.groupId ?? candidate.id) === itemMenu.id &&
            candidate.kind === 'video' &&
            !candidate.derivedFrom,
        );
    const raw = clip ? rawClipById.get(clip.segment?.groupId ?? clip.id) : undefined;
    itemMenuTarget = {
      kind: 'video',
      key: itemMenu.id,
      title: timelineMediaLabel(itemMenu.src, 'video'),
      placement: itemMenu.embedded ? 'content' : (clip?.placement ?? 'default'),
      canUseContentPlacement: itemMenu.embedded || raw?.origin?.format === 'html',
      lockToBlock: itemMenu.embedded || clip?.lockToBlock === true || clip?.anchor === 'block',
      absoluteStart: clip?.absoluteStart ?? itemMenu.absoluteStart,
      pipSize: raw?.pipSize,
      pipShape: raw?.pipShape,
      pipPosition: raw?.pipPosition,
      defaultPipSize: previewSettings?.activePipSize ?? 'small',
      defaultPipShape: previewSettings?.activePipShape ?? 'square',
      defaultPipPosition: previewSettings?.activePipPosition ?? 'bottom-right',
    };
  }

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
    <div ref={rootRef} className="squisq-timeline" style={{ height }} data-testid="timeline-track">
      <div className="squisq-timeline-controls">
        <button
          type="button"
          className="squisq-timeline-zoom-button squisq-timeline-play-button"
          onClick={isPlaying ? pause : startPlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          data-tooltip={isPlaying ? 'Pause' : 'Play'}
          data-testid="timeline-play"
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <span className="squisq-timeline-time" data-testid="timeline-time">
          {formatClock(currentTime)} / {formatClock(total)}
        </span>
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
        {/* The leading gutter (CSS) keeps time 0 — and a playhead parked there —
            clear of the viewport's left edge, where half its grip was clipped. */}
        <div
          className="squisq-timeline-inner"
          style={{ width: `calc(${width}px + var(--squisq-timeline-gutter, 0px))` }}
        >
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
                  onClick={() => {
                    seek(b.startTime);
                    if (line != null) goToBlockByLine(line);
                  }}
                >
                  {visualByBlock.has(b.id) && (
                    <div className="squisq-timeline-block-thumb" aria-hidden>
                      <BlockThumbnail
                        visual={visualByBlock.get(b.id)!}
                        viewport={PREVIEW_VIEWPORT}
                        mediaProvider={mediaProvider}
                      />
                    </div>
                  )}
                  {!timingLocked && prev && headingLine(prev) != null && (
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
                    <button
                      type="button"
                      className="squisq-timeline-item-menu-trigger"
                      aria-label={`Block options for ${b.title ?? b.id}`}
                      aria-haspopup="dialog"
                      aria-expanded={itemMenu?.kind === 'block' && itemMenu.id === b.id}
                      title="Block options"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setItemMenu({
                          kind: 'block',
                          id: b.id,
                          sourceLine: line,
                          anchor: anchorOf(event.currentTarget),
                        });
                      }}
                    >
                      …
                    </button>
                  )}
                  {!timingLocked && line != null && (
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

          <div className="squisq-timeline-media-tracks" aria-label="Media tracks">
            {/* One bar per authored clip: processed-audio companions play but are
                not bars, and the segments of a cut clip draw as one bar with
                a marker at each cut. */}
            {timelineBars(clips).map(({ clip: c, cutMarks }) => {
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
              const editable = c.sourceLine != null && c.lockToBlock !== true;
              const lifted = drag?.targetId === c.id && drag.lifted === true && !drag.committed;
              const specOf = (): ClipSpec => {
                const raw = rawClipById.get(c.segment?.groupId ?? c.id);
                return raw
                  ? {
                      kind: raw.kind,
                      src: raw.src,
                      placement: raw.placement,
                      lockToBlock: raw.lockToBlock,
                      pipSize: raw.pipSize,
                      pipShape: raw.pipShape,
                      pipPosition: raw.pipPosition,
                      clipStart: raw.clipStart,
                      clipEnd: raw.clipEnd,
                      spillover: raw.spillover,
                      ...(raw.edits ? { edits: raw.edits } : {}),
                    }
                  : { kind: c.kind, src: c.src, clipStart: c.sourceIn };
              };
              return (
                <div
                  key={`scheduled:${c.id}`}
                  className="squisq-timeline-row squisq-timeline-row--media"
                  data-testid="timeline-media-track"
                  data-track-id={c.id}
                >
                  <div
                    className={`squisq-timeline-clip squisq-timeline-clip--${c.kind}${
                      c.anchor === 'document' ? ' squisq-timeline-clip--document' : ''
                    }${c.lockToBlock === true ? ' squisq-timeline-clip--locked' : ''}${
                      lifted ? ' squisq-timeline-clip--lifted' : ''
                    }`}
                    style={{ left, width: clipWidth }}
                    title={`${c.src} — ${formatDur(length)}${
                      c.lockToBlock === true
                        ? ' (locked to block)'
                        : c.anchor === 'document'
                          ? ' (independent)'
                          : ''
                    }`}
                    onPointerDown={(e) =>
                      editable &&
                      beginDrag(
                        e,
                        'clip-move',
                        c.id,
                        c.absoluteStart,
                        (absStart) => {
                          if (c.anchor === 'document') {
                            const next = setMediaClipInSource(markdownSource, c.sourceLine!, {
                              startAt: absStart,
                            });
                            if (next) setMarkdownSource(next);
                          } else {
                            moveClipToTime(c.sourceLine, c.blockId, specOf(), absStart);
                          }
                        },
                        { onClick: () => selectClipAt(c.absoluteStart, c.blockId) },
                      )
                    }
                    onDoubleClick={() => {
                      if (!editable || c.sourceLine == null) return;
                      // Toggle spillover (block clips only).
                      const next = setMediaClipInSource(markdownSource, c.sourceLine, {
                        spillover: c.anchor === 'block' ? true : null,
                      });
                      if (next) setMarkdownSource(next);
                    }}
                  >
                    {c.kind === 'video' && (
                      <TimelineVideoFilmstrip
                        src={c.src}
                        sourceStart={c.sourceIn ?? 0}
                        sourceLength={length}
                        width={clipWidth}
                      />
                    )}
                    <span className="squisq-timeline-clip-label">
                      {timelineMediaLabel(c.src, c.kind)}
                    </span>
                    {cutMarks.map((at) => (
                      <span
                        key={at}
                        className="squisq-timeline-cut-mark"
                        style={{ left: (at - c.absoluteStart) * pxPerSecond }}
                        aria-hidden
                      />
                    ))}
                    {c.kind === 'video' && c.sourceLine != null && (
                      <button
                        type="button"
                        className="squisq-timeline-item-menu-trigger squisq-timeline-item-menu-trigger--clip"
                        aria-label={`Video options for ${timelineMediaLabel(c.src, c.kind)}`}
                        aria-haspopup="dialog"
                        aria-expanded={itemMenu?.kind === 'video' && itemMenu.id === c.id}
                        title="Video options"
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setItemMenu({
                            kind: 'video',
                            id: c.id,
                            sourceLine: c.sourceLine!,
                            src: c.src,
                            absoluteStart: c.absoluteStart,
                            embedded: false,
                            anchor: anchorOf(event.currentTarget),
                          });
                        }}
                      >
                        …
                      </button>
                    )}
                    {editable && (
                      <span
                        className="squisq-timeline-edge squisq-timeline-edge--right"
                        onPointerDown={(e) =>
                          beginDrag(e, 'clip-right', c.id, length, (len) => {
                            // The bar shows played length; with cuts, map it back to a
                            // source out-point through the clip's time map.
                            const raw = rawClipById.get(c.id);
                            const clipEnd = raw?.edits?.cuts?.length
                              ? createMediaTimeMap({
                                  clipStart: raw.clipStart,
                                  cuts: raw.edits.cuts,
                                }).playedToSource(len)
                              : (c.sourceIn ?? 0) + len;
                            const next = setMediaClipInSource(markdownSource, c.sourceLine!, {
                              clipEnd,
                            });
                            if (next) setMarkdownSource(next);
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Media embedded in a block's body (recordings, dropped files).
                HTML media retains its element when timed or moved. */}
            {blocks.flatMap((b, i) =>
              collectEmbeddedMedia(b).map((m, j) => {
                const id = `embed:${b.id}:${j}`;
                const timing = resolveEmbeddedMediaTiming(b, m);
                const absStart = timing.absoluteStart;
                const length = timing.absoluteEnd - timing.absoluteStart;
                const sourceIn = timing.sourceIn ?? 0;
                const startAt = Math.max(0, m.startAt ?? 0);
                const authoredLength = m.clipEnd == null ? null : Math.max(0, m.clipEnd - sourceIn);
                const previewBlockRemainder = Math.max(0, previewWidth(i) / pxPerSecond - startAt);
                const previewLength =
                  authoredLength == null
                    ? previewBlockRemainder
                    : Math.min(authoredLength, previewBlockRemainder);
                let left = previewLeft(i);
                let clipWidth = previewWidth(i);
                left += startAt * pxPerSecond;
                clipWidth = Math.max(previewLength * pxPerSecond, 4);
                if (drag?.targetId === id && drag.kind === 'embed-move') {
                  left = drag.preview * pxPerSecond;
                } else if (drag?.targetId === id && drag.kind === 'embed-right') {
                  clipWidth = Math.max(drag.preview * pxPerSecond, 4);
                }
                const spec: ClipSpec = {
                  kind: m.kind,
                  src: m.src,
                  ...(m.clipStart != null ? { clipStart: m.clipStart } : {}),
                  ...(m.clipEnd != null ? { clipEnd: m.clipEnd } : {}),
                };
                return (
                  <div
                    key={`embedded:${id}`}
                    className="squisq-timeline-row squisq-timeline-row--media"
                    data-testid="timeline-media-track"
                    data-track-id={id}
                  >
                    <div
                      className={`squisq-timeline-clip squisq-timeline-clip--${m.kind} squisq-timeline-clip--embedded${
                        drag?.targetId === id && drag.lifted === true && !drag.committed
                          ? ' squisq-timeline-clip--lifted'
                          : ''
                      }`}
                      style={{ left, width: clipWidth }}
                      title={`${m.src} — drag to time / move between blocks`}
                      onPointerDown={(e) =>
                        m.sourceLine != null &&
                        beginDrag(
                          e,
                          'embed-move',
                          id,
                          absStart,
                          (newAbsStart) => {
                            placeEmbeddedClip(
                              m.sourceLine,
                              { ...spec, clipEnd: sourceIn + length },
                              newAbsStart,
                            );
                          },
                          { onClick: () => selectClipAt(b.startTime, b.id) },
                        )
                      }
                    >
                      {m.kind === 'video' && (
                        <TimelineVideoFilmstrip
                          src={m.src}
                          sourceStart={sourceIn}
                          sourceLength={length}
                          width={clipWidth}
                        />
                      )}
                      <span className="squisq-timeline-clip-label">
                        {timelineMediaLabel(m.src, m.kind)}
                      </span>
                      {m.kind === 'video' && m.sourceLine != null && (
                        <button
                          type="button"
                          className="squisq-timeline-item-menu-trigger squisq-timeline-item-menu-trigger--clip"
                          aria-label={`Video options for ${timelineMediaLabel(m.src, m.kind)}`}
                          aria-haspopup="dialog"
                          aria-expanded={itemMenu?.kind === 'video' && itemMenu.id === id}
                          title="Video options"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setItemMenu({
                              kind: 'video',
                              id,
                              sourceLine: m.sourceLine!,
                              src: m.src,
                              absoluteStart: absStart,
                              embedded: true,
                              anchor: anchorOf(event.currentTarget),
                            });
                          }}
                        >
                          …
                        </button>
                      )}
                      {m.sourceLine != null && (
                        <span
                          className="squisq-timeline-edge squisq-timeline-edge--right"
                          onPointerDown={(e) =>
                            beginDrag(e, 'embed-right', id, length, (len) => {
                              placeEmbeddedClip(
                                m.sourceLine,
                                { ...spec, clipEnd: sourceIn + len },
                                absStart,
                              );
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              }),
            )}
          </div>

          <div
            ref={rulerRef}
            className="squisq-timeline-row squisq-timeline-row--ruler"
            data-testid="timeline-ruler"
            onPointerDown={(e) => beginScrub(e, true)}
          >
            {ticks.map((t) => (
              <div key={t} className="squisq-timeline-tick" style={{ left: t * pxPerSecond }}>
                <span className="squisq-timeline-tick-label">{formatDur(t)}</span>
              </div>
            ))}
          </div>

          {/* The lane above the bars that the playhead's knob rides in. Pressing
              anywhere along it jumps the playhead there and keeps scrubbing, so
              a finger that lands beside the knob still catches it. */}
          <div
            className="squisq-timeline-scrub-lane"
            data-testid="timeline-scrub-lane"
            aria-hidden
            onPointerDown={(e) => beginScrub(e, true)}
          />

          {/* Playhead — vertical line at the current time, over all rows.
              Drag the bar (or its knob) to scrub. */}
          <div
            className={`squisq-timeline-playhead${
              scrubbing ? ' squisq-timeline-playhead--scrubbing' : ''
            }`}
            style={{ left: currentTime * pxPerSecond }}
            data-testid="timeline-playhead"
            onPointerDown={(e) => beginScrub(e, false)}
          >
            <div className="squisq-timeline-playhead-knob" />
          </div>
        </div>
      </div>

      {/* Single audio owner for Timeline playback. Preview panes stay muted,
          while this off-screen host plays every scheduled/embedded audio or
          video source. Concurrent audible clips are mixed by the browser. */}
      <div ref={activeClock.registerMediaHost} className="squisq-timeline-media-host" aria-hidden>
        <MediaContext.Provider value={mediaProvider ?? null}>
          <MediaClipLayer
            schedule={playbackClips}
            currentTime={currentTime}
            isPlaying={isPlaying}
            basePath={basePath}
          />
        </MediaContext.Provider>
      </div>

      {itemMenu && itemMenuTarget && (
        <TimelineItemMenu
          key={`${itemMenu.kind}:${itemMenu.id}`}
          anchor={itemMenu.anchor}
          target={itemMenuTarget}
          colorScheme={colorScheme}
          accentColor={previewSettings?.activeTheme.colors.primary}
          onBlockDuration={(seconds) => {
            if (itemMenu.kind !== 'block') return;
            const next = setBlockDurationInSource(markdownSource, itemMenu.sourceLine, seconds);
            if (next) setMarkdownSource(next);
          }}
          onBlockStartTime={(seconds) => {
            if (itemMenu.kind !== 'block') return;
            const next = setBlockStartTimeInSource(markdownSource, itemMenu.sourceLine, seconds);
            if (next) setMarkdownSource(next);
          }}
          onBlockClearTiming={() => {
            if (itemMenu.kind !== 'block') return;
            const line = itemMenu.sourceLine;
            const cleared = setBlockDurationInSource(markdownSource, line, null) ?? markdownSource;
            const next = setBlockStartTimeInSource(cleared, line, null) ?? cleared;
            if (next !== markdownSource) setMarkdownSource(next);
          }}
          onBlockTransition={(transition) => {
            if (itemMenu.kind !== 'block') return;
            const next = setBlockTransitionInSource(
              markdownSource,
              itemMenu.sourceLine,
              transition,
            );
            if (next) setMarkdownSource(next);
          }}
          onVideoPatch={(patch: MediaClipPatch) => {
            if (itemMenu.kind !== 'video') return;
            const next = setMediaClipInSource(markdownSource, itemMenu.sourceLine, patch);
            if (next) setMarkdownSource(next);
          }}
          {...(itemMenu.kind === 'video' && mediaEditRenders
            ? {
                onEditMedia: () =>
                  openMediaEdit({
                    src: itemMenu.src,
                    kind: 'video',
                    sourceLine: itemMenu.sourceLine,
                  }),
              }
            : {})}
          onClose={() => setItemMenu(null)}
        />
      )}
    </div>
  );
}

function anchorOf(element: HTMLElement): TimelineMenuAnchor {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatDur(seconds: number): string {
  const s = Math.round(seconds * 10) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}:${String(rem).padStart(2, '0')}`;
}
