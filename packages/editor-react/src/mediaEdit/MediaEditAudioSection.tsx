/**
 * Audio cleanup: one row per stage of the fixed chain (rumble filter → noise
 * reduction → breath reduction → loudness), presets, and an A/B preview of a
 * short window rendered off the main thread.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MEDIA_FX_SPECS, serializeMediaFx, type MediaFxOpId } from '@bendyline/squisq/mediaEdit';
import type {
  MediaEditPreviewResult,
  MediaEditRenderManager,
} from '@bendyline/squisq-video-react/media-edit';
import { useResolvedMediaSrc } from '../tiptap/useResolvedMediaSrc';
import {
  formatClock,
  fxFromDraft,
  presetFx,
  type RecipeDraft,
  type StageDraft,
} from './mediaEditDraft';
import type { EditableMedia } from './mediaEditTargets';

interface StageSpec {
  id: MediaFxOpId;
  label: string;
  hint: string;
  /** Slider domain (always ascending); `toValue`/`toSlider` map to the op value. */
  min: number;
  max: number;
  step: number;
  toValue: (slider: number) => number;
  toSlider: (value: number) => number;
  format: (value: number) => string;
}

const STAGES: readonly StageSpec[] = [
  {
    id: 'highpass',
    label: 'Rumble filter',
    hint: 'Cuts low-frequency rumble, handling noise, and mic thumps.',
    min: MEDIA_FX_SPECS.highpass.min,
    max: 200,
    step: 5,
    toValue: (s) => s,
    toSlider: (v) => v,
    format: (v) => `${Math.round(v)} Hz`,
  },
  {
    id: 'denoise',
    label: 'Noise reduction',
    hint: 'Removes steady hiss, hum, and room tone behind the voice.',
    min: 0,
    max: 100,
    step: 5,
    toValue: (s) => s / 100,
    toSlider: (v) => Math.round(v * 100),
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    id: 'debreath',
    label: 'Breath reduction',
    hint: 'Softens breaths between phrases without cutting them out.',
    min: 0,
    max: Math.abs(MEDIA_FX_SPECS.debreath.min),
    step: 1,
    toValue: (s) => -s,
    toSlider: (v) => Math.abs(v),
    format: (v) => (v === 0 ? '0 dB' : `−${Math.abs(Math.round(v))} dB`),
  },
  {
    id: 'loudness',
    label: 'Loudness',
    hint: 'Evens out the overall level to a standard target, without clipping.',
    min: MEDIA_FX_SPECS.loudness.min,
    max: MEDIA_FX_SPECS.loudness.max,
    step: 1,
    toValue: (s) => s,
    toSlider: (v) => v,
    format: (v) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))} LUFS`,
  },
];

const LOUDNESS_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: -16, label: 'Web & podcast' },
  { value: -14, label: 'Streaming' },
  { value: -23, label: 'Broadcast' },
];

const PREVIEW_SECONDS = 10;

/** Duration of a media URL from its metadata, when the container reports one. */
function useMediaDuration(url: string): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!url || typeof Audio === 'undefined') return;
    const probe = new Audio();
    probe.preload = 'metadata';
    const onMeta = () => setDuration(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.addEventListener('loadedmetadata', onMeta);
    probe.src = url;
    return () => {
      probe.removeEventListener('loadedmetadata', onMeta);
      probe.removeAttribute('src');
      probe.load();
    };
  }, [url]);
  return duration;
}

type Listening = 'original' | 'processed';

/**
 * Web Audio A/B player over two same-length PCM buffers, looping the preview
 * window. Playing either side starts from the cue point — the window's start,
 * or wherever the playback bar was last dropped — so both sides are heard
 * over the same words. `position` (seconds into the window) follows playback.
 */
function usePreviewPlayer(preview: MediaEditPreviewResult | null) {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startedRef = useRef<{ at: number; offset: number } | null>(null);
  const [playing, setPlaying] = useState<Listening | null>(null);
  const cueRef = useRef(0);
  const [position, setPosition] = useState(0);
  const frames = preview?.original[0]?.length ?? 0;
  const duration = preview && frames > 0 ? frames / preview.sampleRate : 0;

  const currentOffset = useCallback(() => {
    const ctx = ctxRef.current;
    const started = startedRef.current;
    if (!ctx || !started || duration <= 0) return cueRef.current;
    return (started.offset + ctx.currentTime - started.at) % duration;
  }, [duration]);

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    startedRef.current = null;
    cueRef.current = 0;
    setPosition(0);
    setPlaying(null);
  }, []);

  useEffect(() => stop, [preview, stop]);
  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );

  const play = useCallback(
    (which: Listening) => {
      if (!preview) return;
      const ctx = (ctxRef.current ??= new AudioContext({ sampleRate: preview.sampleRate }));
      const channels = which === 'original' ? preview.original : preview.processed;
      const length = channels[0]?.length ?? 0;
      if (length === 0) return;
      const offset = cueRef.current;
      setPosition(offset);
      sourceRef.current?.stop();
      sourceRef.current?.disconnect();
      const buffer = ctx.createBuffer(channels.length, length, preview.sampleRate);
      channels.forEach((data, c) => buffer.getChannelData(c).set(data));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(ctx.destination);
      source.start(0, offset);
      sourceRef.current = source;
      startedRef.current = { at: ctx.currentTime, offset };
      setPlaying(which);
    },
    [preview],
  );

  const seek = useCallback(
    (seconds: number) => {
      // Stop short of the end: a looping source started AT its end wraps to 0.
      cueRef.current = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.05));
      setPosition(cueRef.current);
      if (playing) play(playing);
    },
    [duration, playing, play],
  );

  // Follow the playhead while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      setPosition(currentOffset());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, currentOffset]);

  return { playing, play, stop, seek, position, duration };
}

function PlayIcon() {
  return (
    <svg
      className="squisq-media-edit-icon"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 1 9 5 2 9Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      className="squisq-media-edit-icon"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
    </svg>
  );
}

export interface MediaEditAudioSectionProps {
  item: EditableMedia;
  draft: RecipeDraft;
  onChange: (next: RecipeDraft) => void;
  manager: MediaEditRenderManager;
  idPrefix: string;
}

export function MediaEditAudioSection({
  item,
  draft,
  onChange,
  manager,
  idPrefix,
}: MediaEditAudioSectionProps) {
  const draftFx = fxFromDraft(draft);
  const knownFx = serializeMediaFx({ ops: draftFx.ops, unknown: [] });
  const setStage = (id: MediaFxOpId, patch: Partial<StageDraft>) =>
    onChange({ ...draft, fx: { ...draft.fx, [id]: { ...draft.fx[id], ...patch } } });

  const resolvedSrc = useResolvedMediaSrc(item.src);
  const duration = useMediaDuration(resolvedSrc);
  const windowMin = item.clipStart ?? 0;
  const windowMax = Math.max(windowMin, (item.clipEnd ?? duration ?? windowMin) - 1);
  const [previewFrom, setPreviewFrom] = useState(windowMin);
  const [preview, setPreview] = useState<MediaEditPreviewResult | null>(null);
  const [previewedFx, setPreviewedFx] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const player = usePreviewPlayer(preview);
  useEffect(() => () => previewAbort.current?.abort(), []);

  const runPreview = useCallback(async () => {
    if (draftFx.ops.length === 0) return;
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const source = await manager.loadSource(item.src);
      const result = await manager.renderer.preview(
        { source, fx: knownFx, startSec: previewFrom, endSec: previewFrom + PREVIEW_SECONDS },
        { signal: controller.signal },
      );
      setPreviewedFx(knownFx);
      setPreview(result);
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (previewAbort.current === controller) previewAbort.current = null;
      setPreviewing(false);
    }
  }, [draftFx.ops.length, manager, item.src, knownFx, previewFrom]);

  return (
    <div className="squisq-media-edit-section">
      <div className="squisq-media-edit-presets" role="group" aria-label="Presets">
        <button type="button" onClick={() => onChange({ ...draft, fx: presetFx('voice') })}>
          Clean up voice
        </button>
        <button type="button" onClick={() => onChange({ ...draft, fx: presetFx('levels') })}>
          Levels only
        </button>
        <button type="button" onClick={() => onChange({ ...draft, fx: presetFx('none') })}>
          None
        </button>
      </div>

      <ul className="squisq-media-edit-stages">
        {STAGES.map((stage) => {
          const s = draft.fx[stage.id];
          const inputId = `${idPrefix}-${stage.id}`;
          return (
            <li
              key={stage.id}
              className="squisq-media-edit-stage"
              data-enabled={s.enabled ? 'true' : 'false'}
            >
              <label className="squisq-media-edit-stage__toggle">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => setStage(stage.id, { enabled: e.target.checked })}
                />
                <span className="squisq-media-edit-stage__label">{stage.label}</span>
              </label>
              <input
                id={inputId}
                type="range"
                className="squisq-media-edit-stage__slider"
                aria-label={`${stage.label} amount`}
                aria-valuetext={stage.format(s.value)}
                min={stage.min}
                max={stage.max}
                step={stage.step}
                value={stage.toSlider(s.value)}
                disabled={!s.enabled}
                onChange={(e) =>
                  setStage(stage.id, { value: stage.toValue(Number(e.target.value)) })
                }
              />
              <output className="squisq-media-edit-stage__value" htmlFor={inputId}>
                {stage.format(s.value)}
              </output>
              <p className="squisq-media-edit-stage__hint">{stage.hint}</p>
              {stage.id === 'loudness' && s.enabled && (
                <div className="squisq-media-edit-chips" role="group" aria-label="Targets">
                  {LOUDNESS_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      aria-pressed={Math.round(s.value) === preset.value}
                      onClick={() => setStage('loudness', { value: preset.value })}
                    >
                      {preset.label} ({preset.value})
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="squisq-media-edit-preview" aria-label="Preview">
        {duration != null && windowMax > windowMin && (
          <label className="squisq-media-edit-preview__from">
            <span>Preview from {previewFrom.toFixed(0)} s</span>
            <input
              type="range"
              min={windowMin}
              max={windowMax}
              step={1}
              value={previewFrom}
              onChange={(e) => setPreviewFrom(Number(e.target.value))}
            />
          </label>
        )}
        <div className="squisq-media-edit-preview__actions">
          <button
            type="button"
            onClick={runPreview}
            disabled={previewing || draftFx.ops.length === 0}
          >
            {previewing ? 'Rendering preview…' : preview ? 'Update preview' : 'Create preview'}
          </button>
        </div>
        {preview != null && player.duration > 0 && (
          <>
            <div className="squisq-media-edit-playback" data-playing={player.playing ?? undefined}>
              <span className="squisq-media-edit-playback__label">
                {player.playing
                  ? `${player.playing === 'original' ? 'Original' : 'Processed'} from ${Math.round(preview.startSec)} s`
                  : 'Stopped'}
              </span>
              <input
                type="range"
                aria-label="Playback position"
                aria-valuetext={`${formatClock(player.position)} of ${formatClock(player.duration)}`}
                min={0}
                max={player.duration}
                step={0.05}
                value={player.position}
                disabled={previewing}
                onChange={(e) => player.seek(Number(e.target.value))}
              />
              <span className="squisq-media-edit-playback__time">
                {formatClock(player.position)} / {formatClock(player.duration)}
              </span>
            </div>
            <div className="squisq-media-edit-preview__actions">
              <button
                type="button"
                aria-pressed={player.playing === 'original'}
                disabled={previewing}
                onClick={() => player.play('original')}
              >
                <PlayIcon />
                Original
              </button>
              <button
                type="button"
                aria-pressed={player.playing === 'processed'}
                disabled={previewing}
                onClick={() => player.play('processed')}
              >
                <PlayIcon />
                Processed
              </button>
              <button type="button" disabled={!player.playing} onClick={player.stop}>
                <StopIcon />
                Stop
              </button>
            </div>
          </>
        )}
        {preview != null && previewedFx !== knownFx && (
          <p className="squisq-media-edit-note">
            Settings changed — update the preview to hear them.
          </p>
        )}
        {previewError && (
          <p className="squisq-media-edit-note squisq-media-edit-note--error" role="alert">
            {previewError}
          </p>
        )}
      </div>
    </div>
  );
}
