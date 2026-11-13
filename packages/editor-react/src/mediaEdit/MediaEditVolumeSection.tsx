/**
 * Volume & fades: clip gain and the fades at its two ends. Nothing here
 * re-encodes media — gain and fades are applied at playback and export.
 */

import type { RecipeDraft } from './mediaEditDraft';

export interface MediaEditVolumeSectionProps {
  draft: RecipeDraft;
  onChange: (next: RecipeDraft) => void;
  idPrefix: string;
}

function formatDb(value: number): string {
  if (value === 0) return '0 dB';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(0)} dB`;
}

export function MediaEditVolumeSection({ draft, onChange, idPrefix }: MediaEditVolumeSectionProps) {
  return (
    <div className="squisq-media-edit-section">
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
    </div>
  );
}
