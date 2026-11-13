/**
 * Cuts: shorten a clip by removing sections on a timeline. Drag across the
 * waveform (or mark a start and an end at the playhead) to select a section
 * and cut it; drag a cut's edges to adjust it; restore any cut. "Result"
 * playback skips the cuts, so what plays here is what Apply will write.
 * Long pauses can be found and cut automatically, then adjusted like any
 * other cut.
 *
 * Nothing is re-encoded: cuts are source-time ranges in the recipe, skipped
 * at playback and export.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { createMediaTimeMap, type MediaCut } from '@bendyline/squisq/mediaEdit';
import type {
  MediaEditRenderManager,
  MediaEditWaveformResult,
} from '@bendyline/squisq-video-react/media-edit';
import { useResolvedMediaSrc } from '../tiptap/useResolvedMediaSrc';
import { CutTimeline, type CutEdge } from './CutTimeline';
import {
  MIN_CUT_SEC,
  addCut,
  cutAt,
  cutsInRange,
  formatLength,
  formatTimecode,
  moveCutEdge,
  removeCut,
  type TimeRange,
} from './cutList';
import { cutSeconds, formatClock, type RecipeDraft } from './mediaEditDraft';
import { PauseIcon, PlayIcon } from './mediaEditIcons';
import type { EditableMedia } from './mediaEditTargets';

const DEFAULT_MAX_PAUSE = 0.8;
/** The most a full zoom shows: a few seconds across the timeline. */
const MIN_VISIBLE_SEC = 4;
/** Lead-in and tail when previewing one cut, so the join is heard in context. */
const JOIN_CONTEXT_SEC = 1.5;
/** Playback this close to the end counts as finished. */
const END_SLACK_SEC = 0.03;
const HISTORY_LIMIT = 50;

export interface MediaEditCutsSectionProps {
  item: EditableMedia;
  draft: RecipeDraft;
  onChange: (next: RecipeDraft) => void;
  manager: MediaEditRenderManager;
  idPrefix: string;
  /** Whether this tab is showing; the panel stays mounted when it is not. */
  active: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type WaveformState =
  | { status: 'idle' }
  | { status: 'loading'; progress: number }
  | { status: 'ready'; waveform: MediaEditWaveformResult }
  | { status: 'failed'; error: string };

/** Waveforms already read, per engine: reopening the dialog on a long take does not decode it again. */
const waveformCache = new WeakMap<object, Map<string, MediaEditWaveformResult>>();

/** The clip's waveform, read once the tab is first opened. */
function useClipWaveform(
  manager: MediaEditRenderManager,
  src: string,
  wanted: boolean,
): WaveformState {
  const [state, setState] = useState<WaveformState>({ status: 'idle' });
  // Sticky: once started, the read finishes whether or not the tab stays open.
  const [started, setStarted] = useState(wanted);
  if (wanted && !started) setStarted(true);

  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    setState({ status: 'loading', progress: 0 });
    void (async () => {
      try {
        const source = await manager.loadSource(src);
        let cache = waveformCache.get(manager.renderer);
        if (!cache) {
          cache = new Map();
          waveformCache.set(manager.renderer, cache);
        }
        const key = `${src}\n${source.size}`;
        let result = cache.get(key);
        if (result === undefined) {
          let reported = 0;
          result = await manager.renderer.waveform(
            { source },
            {
              signal: controller.signal,
              onProgress: (fraction) => {
                if (controller.signal.aborted || fraction - reported < 0.02) return;
                reported = fraction;
                setState({ status: 'loading', progress: fraction });
              },
            },
          );
          cache.set(key, result);
        }
        if (controller.signal.aborted) return;
        setState({ status: 'ready', waveform: result });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setState({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => controller.abort();
  }, [started, manager, src]);

  return state;
}

export function MediaEditCutsSection({
  item,
  draft,
  onChange,
  manager,
  idPrefix,
  active,
}: MediaEditCutsSectionProps) {
  const hintId = useId();
  const resolvedSrc = useResolvedMediaSrc(item.src);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [elementDuration, setElementDuration] = useState<number | null>(null);
  const wave = useClipWaveform(manager, item.src, active);
  const read = wave.status === 'ready' ? wave.waveform : null;
  // A clip with no audio track has a length but nothing to draw.
  const waveform = read && read.peaks.length > 0 ? read : null;

  // The trim window. A recorder's WebM reports no length to the element, so
  // the length read from the file stands in once the read finishes.
  const sourceDuration =
    elementDuration ?? (read && read.durationSec > 0 ? read.durationSec : null);

  // Last resort, when the file could not be read: seeking far past the end
  // makes a browser work out the real length of a recording it can play.
  const lengthUnknown = wave.status === 'failed' && elementDuration == null;
  useEffect(() => {
    const media = mediaRef.current;
    if (lengthUnknown && media && media.duration === Number.POSITIVE_INFINITY) {
      media.currentTime = 1e101;
    }
  }, [lengthUnknown, resolvedSrc]);
  const bounds = useMemo<TimeRange | null>(() => {
    const start = item.clipStart ?? 0;
    const end = item.clipEnd ?? sourceDuration;
    return end != null && end > start ? { start, end } : null;
  }, [item.clipStart, item.clipEnd, sourceDuration]);
  const cuts = useMemo(() => (bounds ? cutsInRange(draft.cuts, bounds) : []), [draft.cuts, bounds]);
  const timeMap = useMemo(
    () =>
      bounds ? createMediaTimeMap({ clipStart: bounds.start, clipEnd: bounds.end, cuts }) : null,
    [bounds, cuts],
  );

  // Handlers that outlive a render (pointer drags, the playback loop) read these.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const cutsRef = useRef(cuts);
  cutsRef.current = cuts;

  // ── Cut edits, with their own undo ────────────────────────────────
  const [history, setHistory] = useState<MediaCut[][]>([]);
  const writeCuts = useCallback(
    (next: MediaCut[]) => onChange({ ...draftRef.current, cuts: next }),
    [onChange],
  );
  const snapshot = useCallback(() => {
    const before = draftRef.current.cuts.map((cut) => ({ ...cut }));
    setHistory((entries) => [...entries.slice(1 - HISTORY_LIMIT), before]);
  }, []);
  const commitCuts = useCallback(
    (next: MediaCut[]) => {
      snapshot();
      writeCuts(next);
    },
    [snapshot, writeCuts],
  );
  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    writeCuts(previous);
  }, [history, writeCuts]);

  // ── Transport ─────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(item.clipStart ?? 0);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  /** "Result" skips the cuts; "Original" plays through them. */
  const [skipCuts, setSkipCuts] = useState(true);
  const skipCutsRef = useRef(skipCuts);
  skipCutsRef.current = skipCuts;
  /** A one-off preview of a single cut: where it stops, and that it skips regardless. */
  const previewRef = useRef<{ stopAt: number } | null>(null);

  const seek = useCallback((time: number) => {
    const range = boundsRef.current;
    if (!range) return;
    const target = clamp(time, range.start, range.end);
    if (mediaRef.current) mediaRef.current.currentTime = target;
    setPlayhead(target);
  }, []);

  const pause = useCallback(() => {
    previewRef.current = null;
    mediaRef.current?.pause();
  }, []);

  const play = useCallback((from?: number, stopAt?: number) => {
    const range = boundsRef.current;
    const media = mediaRef.current;
    if (!range || !media) return;
    const skipping = stopAt != null || skipCutsRef.current;
    let start = from ?? playheadRef.current;
    if (start >= range.end - END_SLACK_SEC) start = range.start;
    if (skipping) start = cutAt(cutsRef.current, start)?.end ?? start;
    // Everything from here on is cut: nothing to play.
    if (start >= range.end - END_SLACK_SEC) return;
    previewRef.current = stopAt != null ? { stopAt } : null;
    media.currentTime = start;
    setPlayhead(start);
    // An interrupted or refused play() leaves the transport paused; nothing to report.
    void Promise.resolve(media.play()).catch(() => {});
  }, []);

  // While playing: follow the element, jump each cut, stop at the end.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      const media = mediaRef.current;
      const range = boundsRef.current;
      if (media && range) {
        let time = media.currentTime;
        const preview = previewRef.current;
        if (preview || skipCutsRef.current) {
          const cut = cutAt(cutsRef.current, time);
          if (cut) {
            time = cut.end;
            if (time < range.end - END_SLACK_SEC) media.currentTime = time;
          }
        }
        const stopAt = Math.min(preview?.stopAt ?? range.end, range.end);
        if (time >= stopAt - END_SLACK_SEC) {
          previewRef.current = null;
          media.pause();
          time = Math.min(time, range.end);
        }
        setPlayhead(time);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // Keep the playhead inside the clip as its length becomes known.
  useEffect(() => {
    if (bounds) seek(playheadRef.current);
  }, [bounds, seek]);

  // A hidden tab must not keep talking.
  useEffect(() => {
    if (!active) pause();
  }, [active, pause]);

  const noteDuration = (event: SyntheticEvent<HTMLMediaElement>) => {
    const { duration } = event.currentTarget;
    if (Number.isFinite(duration) && duration > 0) setElementDuration(duration);
  };
  const mediaProps = {
    src: resolvedSrc,
    preload: 'metadata' as const,
    ref: (element: HTMLMediaElement | null) => {
      mediaRef.current = element;
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onDurationChange: noteDuration,
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      noteDuration(event);
      // Show the frame under the playhead, not the file's first frame.
      event.currentTarget.currentTime = playheadRef.current;
    },
  };

  // ── Selection and cut actions ─────────────────────────────────────
  const [selection, setSelection] = useState<TimeRange | null>(null);
  const selectionLength = selection ? selection.end - selection.start : 0;
  const canCut = bounds != null && selectionLength >= MIN_CUT_SEC;

  const markStart = () =>
    setSelection((current) => ({
      start: playhead,
      end: current && current.end > playhead ? current.end : playhead,
    }));
  const markEnd = () =>
    setSelection((current) => ({
      start: current && current.start < playhead ? current.start : playhead,
      end: playhead,
    }));
  const cutSelection = () => {
    if (!bounds || !selection || !canCut) return;
    commitCuts(addCut(cuts, selection, bounds));
    setSelection(null);
    // Leave the playhead on the join: Play continues from just after the cut.
    seek(selection.start);
  };
  const restoreCut = useCallback(
    (index: number) => commitCuts(removeCut(cutsRef.current, index)),
    [commitCuts],
  );
  const moveEdge = useCallback(
    (index: number, edge: CutEdge, time: number) => {
      const range = boundsRef.current;
      if (!range) return;
      const next = moveCutEdge(cutsRef.current, index, edge, time, range);
      writeCuts(next);
      // Scrub with the edge, so a video shows the frame the cut lands on.
      const moved = next[index];
      if (moved) seek(moved[edge]);
    },
    [writeCuts, seek],
  );
  const previewCut = (cut: MediaCut) => {
    if (!bounds) return;
    play(
      Math.max(bounds.start, cut.start - JOIN_CONTEXT_SEC),
      Math.min(bounds.end, cut.end + JOIN_CONTEXT_SEC),
    );
  };

  // ── Zoom ──────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const maxZoom = bounds ? Math.max(1, (bounds.end - bounds.start) / MIN_VISIBLE_SEC) : 1;
  const zoomBy = (factor: number) => setZoom((current) => clamp(current * factor, 1, maxZoom));

  // ── Pause finder ──────────────────────────────────────────────────
  const [maxPause, setMaxPause] = useState(DEFAULT_MAX_PAUSE);
  const [finding, setFinding] = useState(false);
  const [pauseNote, setPauseNote] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const pauseAbort = useRef<AbortController | null>(null);
  useEffect(() => () => pauseAbort.current?.abort(), []);

  const findPauses = useCallback(async () => {
    pauseAbort.current?.abort();
    const controller = new AbortController();
    pauseAbort.current = controller;
    setFinding(true);
    setPauseNote(null);
    setPauseError(null);
    try {
      const source = await manager.loadSource(item.src);
      const result = await manager.renderer.pauses(
        { source, options: { maxPauseSec: maxPause, keepSec: Math.min(0.4, maxPause / 2) } },
        { signal: controller.signal },
      );
      const range = boundsRef.current;
      if (!range) return;
      const found = cutsInRange(result.cuts, range);
      if (found.length === 0) {
        setPauseNote('No pauses that long.');
      } else {
        // Added to the cuts already made, never replacing them.
        commitCuts(cutsInRange([...cutsRef.current, ...found], range));
        setPauseNote(`${found.length} ${found.length === 1 ? 'pause' : 'pauses'} shortened.`);
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setPauseError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (pauseAbort.current === controller) pauseAbort.current = null;
      setFinding(false);
    }
  }, [manager, item.src, maxPause, commitCuts]);

  // ── Keyboard, with the timeline focused ───────────────────────────
  const onTimelineKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!bounds || event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() !== 'z' || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      undo();
      return;
    }
    const step = event.shiftKey ? 0.1 : 1;
    switch (event.key) {
      case ' ':
        if (playing) pause();
        else play();
        break;
      case 'ArrowLeft':
        seek(playhead - step);
        break;
      case 'ArrowRight':
        seek(playhead + step);
        break;
      case 'Home':
        seek(bounds.start);
        break;
      case 'End':
        seek(bounds.end);
        break;
      case 'i':
      case 'I':
      case '[':
        markStart();
        break;
      case 'o':
      case 'O':
      case ']':
        markEnd();
        break;
      case 'x':
      case 'X':
      case 'Delete':
      case 'Backspace':
        if (!canCut) return;
        cutSelection();
        break;
      case 'Escape':
        // Only consume Escape when there is a selection to drop; otherwise it closes the dialog.
        if (!selection) return;
        setSelection(null);
        break;
      case '+':
      case '=':
        zoomBy(2);
        break;
      case '-':
      case '_':
        zoomBy(0.5);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // ── Readouts ──────────────────────────────────────────────────────
  const clipTime = (time: number) => formatTimecode(time - (bounds?.start ?? 0));
  const position =
    bounds && timeMap
      ? skipCuts
        ? formatTimecode(timeMap.snapSourceToPlayed(playhead))
        : clipTime(playhead)
      : formatTimecode(0);
  const length =
    bounds && timeMap
      ? formatTimecode(skipCuts ? timeMap.playedDuration : bounds.end - bounds.start)
      : '–:––';
  const summary = !bounds
    ? ''
    : cuts.length === 0
      ? 'No cuts yet.'
      : `${cuts.length} ${cuts.length === 1 ? 'cut removes' : 'cuts remove'} ${formatLength(cutSeconds(cuts))}: ` +
        `the clip plays for ${formatClock(timeMap?.playedDuration ?? 0)} instead of ${formatClock(bounds.end - bounds.start)}.`;
  const selectionText = !selection
    ? ''
    : selectionLength >= MIN_CUT_SEC
      ? `${clipTime(selection.start)} – ${clipTime(selection.end)} (${formatLength(selectionLength)})`
      : `From ${clipTime(selection.start)}`;
  const reading = wave.status === 'loading' ? `${Math.round(wave.progress * 100)}%` : null;

  return (
    <div className="squisq-media-edit-section squisq-media-edit-cuts">
      {resolvedSrc &&
        (item.kind === 'video' ? (
          <div className="squisq-media-edit-cuts__monitor">
            <video {...mediaProps} playsInline />
          </div>
        ) : (
          <audio {...mediaProps} />
        ))}

      <div className="squisq-media-edit-cuts__transport">
        <button
          type="button"
          className="squisq-media-edit-cuts__play"
          disabled={!bounds || !resolvedSrc}
          onClick={() => (playing ? pause() : play())}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="squisq-media-edit-cuts__time">
          {position} / {length}
        </span>
        <div className="squisq-media-edit-chips" role="group" aria-label="Play">
          <button
            type="button"
            aria-pressed={skipCuts}
            title="Play the clip as it will be, skipping the cuts"
            onClick={() => setSkipCuts(true)}
          >
            Result
          </button>
          <button
            type="button"
            aria-pressed={!skipCuts}
            title="Play everything, including the cut sections"
            onClick={() => setSkipCuts(false)}
          >
            Original
          </button>
        </div>
        <div className="squisq-media-edit-cuts__zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => zoomBy(0.5)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= maxZoom}
            onClick={() => zoomBy(2)}
          >
            +
          </button>
          <button type="button" disabled={zoom <= 1} onClick={() => setZoom(1)}>
            Fit
          </button>
        </div>
      </div>

      {bounds ? (
        <CutTimeline
          bounds={bounds}
          cuts={cuts}
          selection={selection}
          playhead={playhead}
          waveform={waveform}
          zoom={zoom}
          describedBy={hintId}
          onSeek={seek}
          onSelect={setSelection}
          onEdgeEditStart={snapshot}
          onMoveEdge={moveEdge}
          onRemoveCut={restoreCut}
          onKeyDown={onTimelineKeyDown}
        />
      ) : (
        <div className="squisq-media-edit-timeline squisq-media-edit-timeline--empty" role="status">
          {wave.status === 'failed'
            ? `This clip could not be read: ${wave.error}`
            : wave.status === 'ready'
              ? 'This clip’s length could not be read.'
              : `Reading the clip… ${reading ?? ''}`}
        </div>
      )}
      <div className="squisq-media-edit-cuts__actions">
        <button
          type="button"
          disabled={!bounds}
          title="Start the selection at the playhead (I)"
          onClick={markStart}
        >
          Set start
        </button>
        <button
          type="button"
          disabled={!bounds}
          title="End the selection at the playhead (O)"
          onClick={markEnd}
        >
          Set end
        </button>
        <button
          type="button"
          className="squisq-media-edit-cuts__cut"
          disabled={!canCut}
          title="Remove the selected section (X)"
          onClick={cutSelection}
        >
          Cut selection
        </button>
        <span className="squisq-media-edit-cuts__selection" data-testid="media-edit-selection-text">
          {selectionText}
        </span>
        <button type="button" disabled={history.length === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" disabled={cuts.length === 0} onClick={() => commitCuts([])}>
          Restore all
        </button>
      </div>

      <div className="squisq-media-edit-cuts__notes">
        <p id={hintId} className="squisq-media-edit-note">
          {bounds && reading
            ? `Reading the waveform… ${reading}`
            : bounds && wave.status === 'failed'
              ? 'The waveform could not be read; cuts still work by time.'
              : 'Drag across the timeline to select a section, then cut it. Drag the edges of a cut to adjust it.'}
        </p>
        <p className="squisq-media-edit-note" role="status" aria-live="polite">
          {summary}
        </p>
      </div>

      <div className="squisq-media-edit-cuts__lower">
        {bounds && cuts.length > 0 ? (
          <ol className="squisq-media-edit-cutlist" aria-label="Cuts">
            {cuts.map((cut, index) => (
              <li key={`${cut.start}-${cut.end}`}>
                <span className="squisq-media-edit-cutlist__range">
                  {clipTime(cut.start)} – {clipTime(cut.end)}
                </span>
                <span className="squisq-media-edit-cutlist__length">
                  {formatLength(cut.end - cut.start)}
                </span>
                <button
                  type="button"
                  aria-label={`Preview cut ${index + 1}`}
                  title="Play across this cut"
                  disabled={!resolvedSrc}
                  onClick={() => previewCut(cut)}
                >
                  <PlayIcon />
                  Preview
                </button>
                <button
                  type="button"
                  aria-label={`Restore cut ${index + 1}`}
                  onClick={() => restoreCut(index)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ol>
        ) : (
          // Holds the list's place: a list that appeared with the first cut
          // would push the timeline out from under the pointer.
          <div className="squisq-media-edit-cutlist squisq-media-edit-cutlist--empty">
            Each cut is listed here, to preview or restore.
          </div>
        )}

        <div className="squisq-media-edit-cuts__pauses">
          <div className="squisq-media-edit-row">
            <label className="squisq-media-edit-row__label" htmlFor={`${idPrefix}-pause`}>
              Shorten pauses longer than
            </label>
            <input
              id={`${idPrefix}-pause`}
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={maxPause}
              aria-valuetext={`${maxPause.toFixed(1)} seconds`}
              onChange={(e) => setMaxPause(Number(e.target.value))}
            />
            <output htmlFor={`${idPrefix}-pause`}>{maxPause.toFixed(1)} s</output>
          </div>
          <div className="squisq-media-edit-cuts__actions">
            <button type="button" onClick={findPauses} disabled={finding || !bounds}>
              {finding ? 'Finding pauses…' : 'Find pauses'}
            </button>
            {pauseNote && (
              <span className="squisq-media-edit-note" role="status">
                {pauseNote}
              </span>
            )}
          </div>
          {pauseError && (
            <p className="squisq-media-edit-note squisq-media-edit-note--error" role="alert">
              {pauseError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
