import type { CSSProperties } from 'react';
import type { RecorderScreenDeviceSettings } from './deviceSettings.js';

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  font: 'inherit',
  color: 'var(--squisq-recorder-text)',
  background: 'var(--squisq-recorder-input)',
  border: '1px solid var(--squisq-recorder-border)',
};

export function RecorderScreenSettings({
  value,
  onChange,
  disabled,
  onChoose,
  hasPreview,
}: {
  value: RecorderScreenDeviceSettings;
  onChange: (value: RecorderScreenDeviceSettings) => void;
  disabled: boolean;
  onChoose: () => void;
  hasPreview: boolean;
}) {
  const crop = value.crop;
  return (
    <fieldset
      disabled={disabled}
      style={{
        margin: '0 0 12px',
        padding: 12,
        border: '1px solid var(--squisq-recorder-border)',
        fontSize: 13,
      }}
    >
      <legend>What to record</legend>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
        }}
      >
        <label style={field}>
          Preferred surface
          <select
            style={input}
            value={value.displaySurface ?? ''}
            onChange={(event) =>
              onChange({ ...value, displaySurface: event.target.value || undefined })
            }
          >
            <option value="">Any available surface</option>
            <option value="monitor">Entire screen</option>
            <option value="window">Application window</option>
            <option value="browser">Browser tab (when available)</option>
          </select>
        </label>
        <label style={field}>
          Capture area
          <select
            style={input}
            value={value.crop ? 'region' : 'full'}
            onChange={(event) =>
              onChange({
                ...value,
                crop:
                  event.target.value === 'region'
                    ? { x: 0, y: 0, width: 1280, height: 720 }
                    : undefined,
              })
            }
          >
            <option value="full">Whole selected surface</option>
            <option value="region">Region by coordinates</option>
          </select>
        </label>
        {crop && (
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <label key={key} style={field}>
                {
                  {
                    x: 'Left (px)',
                    y: 'Top (px)',
                    width: 'Region width (px)',
                    height: 'Region height (px)',
                  }[key]
                }
                <input
                  style={input}
                  type="number"
                  min={key === 'x' || key === 'y' ? 0 : 1}
                  max={16384}
                  step={1}
                  value={Number.isFinite(crop[key]) ? crop[key] : ''}
                  onChange={(event) =>
                    onChange({ ...value, crop: { ...crop, [key]: event.target.valueAsNumber } })
                  }
                />
              </label>
            ))}
          </div>
        )}
      </div>
      <p style={{ margin: '8px 0 0', color: 'var(--squisq-recorder-muted)' }}>
        Choose a screen, window or tab in the picker, then check the preview. Available choices
        depend on your browser or app.
        {value.crop &&
          ' Coordinates start at the selected surface’s top-left, in captured pixels. Only this region is saved; audio is unchanged.'}
      </p>
      <button
        type="button"
        style={{ ...input, marginTop: 10, width: 'auto', cursor: 'pointer' }}
        onClick={onChoose}
      >
        {hasPreview ? 'Change screen or window' : 'Choose screen or window'}
      </button>
    </fieldset>
  );
}
