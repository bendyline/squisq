/**
 * Timing: shorten long pauses (proposed cuts from the take's own silences),
 * clip volume, and fades. Nothing here re-encodes media — cuts, gain and
 * fades are applied at playback and export.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaEditRenderManager } from '@bendyline/squisq-video-react/media-edit';
import { cutSeconds, formatClock, type RecipeDraft } from './mediaEditDraft';
import type { EditableMedia } from './mediaEditTargets';

const DEFAULT_MAX_PAUSE = 0.8;

export interface MediaEditTimingSectionProps {
  item: EditableMedia;
  draft: RecipeDraft;
  onChange: (next: RecipeDraft) => void;
  manager: MediaEditRenderManager;
  idPrefix: string;
}

function formatDb(value: number): string {
  if (value === 0) return '0 dB';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(0)} dB`;
}

export function MediaEditTimingSection({
  item,
  draft,
  onChange,
  manager,
  idPrefix,
}: MediaEditTimingSectionProps) {
  const [maxPause, setMaxPause] = useState(DEFAULT_MAX_PAUSE);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const findPauses = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFinding(true);
    setError(null);
    try {
      const source = await manager.loadSource(item.src);
      const result = await manager.renderer.pauses(
        { source, options: { maxPauseSec: maxPause, keepSec: Math.min(0.4, maxPause / 2) } },
        { signal: controller.signal },
      );
      onChange({ ...draft, cuts: result.cuts });
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setFinding(false);
    }
  }, [manager, item.src, maxPause, draft, onChange]);

  const saved = cutSeconds(draft.cuts);
  return (
    <section className="squisq-media-edit-section" aria-labelledby={`${idPrefix}-timing`}>
      <h3 id={`${idPrefix}-timing`} className="squisq-media-edit-section__title">
        Timing
      </h3>

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
      <div className="squisq-media-edit-preview__actions">
        <button type="button" onClick={findPauses} disabled={finding}>
          {finding ? 'Finding pauses…' : 'Find pauses'}
        </button>
        <button
          type="button"
          disabled={draft.cuts.length === 0}
          onClick={() => onChange({ ...draft, cuts: [] })}
        >
          Keep all pauses
        </button>
      </div>
      <p className="squisq-media-edit-note" role="status" aria-live="polite">
        {draft.cuts.length === 0
          ? 'No pauses shortened.'
          : `${draft.cuts.length} ${draft.cuts.length === 1 ? 'pause' : 'pauses'} shortened, saving ${formatClock(saved)}.`}
      </p>
      {error && (
        <p className="squisq-media-edit-note squisq-media-edit-note--error" role="alert">
          {error}
        </p>
      )}

      <div className="squisq-media-edit-row">
        <label className="squisq-media-edit-row__label" htmlFor={`${idPrefix}-gain`}>
          Volume
        </label>
        <input
          id={`${idPrefix}-gain`}
          type="range"
          min={-24}
          max={12}
          step={1}
          value={draft.gain}
          aria-valuetext={formatDb(draft.gain)}
          onChange={(e) => onChange({ ...draft, gain: Number(e.target.value) })}
        />
        <output htmlFor={`${idPrefix}-gain`}>{formatDb(draft.gain)}</output>
      </div>
      {(['fadeIn', 'fadeOut'] as const).map((key) => (
        <div className="squisq-media-edit-row" key={key}>
          <label className="squisq-media-edit-row__label" htmlFor={`${idPrefix}-${key}`}>
            {key === 'fadeIn' ? 'Fade in' : 'Fade out'}
          </label>
          <input
            id={`${idPrefix}-${key}`}
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={draft[key]}
            aria-valuetext={`${draft[key].toFixed(1)} seconds`}
            onChange={(e) => onChange({ ...draft, [key]: Number(e.target.value) })}
          />
          <output htmlFor={`${idPrefix}-${key}`}>
            {draft[key] === 0 ? 'Off' : `${draft[key].toFixed(1)} s`}
          </output>
        </div>
      ))}
    </section>
  );
}
