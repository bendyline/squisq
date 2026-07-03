/**
 * themeControls — presentational form rows shared by the ThemeCustomizerPanel
 * popover and the CustomThemeDialog. Pure/controlled; they carry the existing
 * `squisq-theme-customizer-*` classes so both surfaces style identically.
 */

import { AVAILABLE_FONT_STACKS, isHex } from '@bendyline/squisq/schemas';
import {
  type CustomFontInput,
  type FallbackOption,
  type AccentInput,
  FALLBACK_OPTIONS,
  nextAccent,
} from './themeDraft';

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="squisq-theme-customizer-section">
      <div className="squisq-theme-customizer-section-title">{title}</div>
      {hint && <div className="squisq-theme-customizer-section-hint">{hint}</div>}
      <div className="squisq-theme-customizer-section-body">{children}</div>
    </div>
  );
}

export function SeedColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const safeValue = isHex(value) ? value : '#000000';
  return (
    <label className="squisq-theme-customizer-row">
      <span className="squisq-theme-customizer-row-label">{label}</span>
      <input
        type="color"
        className="squisq-theme-customizer-color"
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="squisq-theme-customizer-input squisq-theme-customizer-input--hex"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label={`${label} hex value`}
      />
    </label>
  );
}

export function FontPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CustomFontInput;
  onChange: (next: CustomFontInput) => void;
}) {
  // Render the closed <select> (and each option) in the font it names, so the
  // dropdown doubles as a live font preview. Faces are provided by the host
  // (the site links `/fonts/fonts.css`; the same fonts the player renders
  // with) — no external font fetch here. Unloaded faces fall back gracefully.
  const selectedFamily =
    value.kind === 'curated'
      ? AVAILABLE_FONT_STACKS.find((s) => s.id === value.stackId)?.family
      : undefined;

  return (
    <div className="squisq-theme-customizer-row squisq-theme-customizer-row--font">
      <span className="squisq-theme-customizer-row-label">{label}</span>
      <select
        className="squisq-theme-customizer-input"
        style={selectedFamily ? { fontFamily: selectedFamily } : undefined}
        value={value.kind === 'custom' ? '__custom__' : (value.stackId ?? '')}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__custom__') {
            onChange({
              kind: 'custom',
              customName: value.customName ?? '',
              customFallback: value.customFallback ?? 'sans-serif',
            });
          } else {
            onChange({ kind: 'curated', stackId: v });
          }
        }}
        aria-label={`${label} font`}
      >
        {AVAILABLE_FONT_STACKS.map((stack) => (
          <option key={stack.id} value={stack.id} style={{ fontFamily: stack.family }}>
            {stack.label}
          </option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {value.kind === 'custom' && (
        <>
          <input
            type="text"
            className="squisq-theme-customizer-input"
            placeholder="Font name"
            value={value.customName ?? ''}
            onChange={(e) => onChange({ ...value, customName: e.target.value })}
            aria-label={`${label} custom font name`}
          />
          <select
            className="squisq-theme-customizer-input"
            value={value.customFallback ?? 'sans-serif'}
            onChange={(e) =>
              onChange({ ...value, customFallback: e.target.value as FallbackOption })
            }
            aria-label={`${label} custom font fallback`}
          >
            {FALLBACK_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

export function PresetRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="squisq-theme-customizer-row">
      <span className="squisq-theme-customizer-row-label">{label}</span>
      <select
        className="squisq-theme-customizer-input"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * AccentEditor — the "N accent colors" list. Add / edit / remove accent
 * colors; each maps to a per-block color scheme in the compiled theme.
 */
export function AccentEditor({
  accents,
  onChange,
}: {
  accents: AccentInput[];
  onChange: (next: AccentInput[]) => void;
}) {
  const setColor = (idx: number, color: string) =>
    onChange(accents.map((a, i) => (i === idx ? { ...a, color } : a)));
  const remove = (idx: number) => onChange(accents.filter((_, i) => i !== idx));
  const add = () => onChange([...accents, nextAccent(accents)]);

  return (
    <div className="squisq-theme-customizer-accents">
      {accents.map((a, idx) => (
        <div
          key={a.key}
          className="squisq-theme-customizer-row squisq-theme-customizer-row--accent"
        >
          <input
            type="color"
            className="squisq-theme-customizer-color"
            value={isHex(a.color) ? a.color : '#000000'}
            onChange={(e) => setColor(idx, e.target.value)}
            aria-label={`Accent ${idx + 1}`}
          />
          <input
            type="text"
            className="squisq-theme-customizer-input squisq-theme-customizer-input--hex"
            value={a.color}
            onChange={(e) => setColor(idx, e.target.value)}
            spellCheck={false}
            aria-label={`Accent ${idx + 1} hex value`}
          />
          <button
            type="button"
            className="squisq-theme-customizer-accent-remove"
            onClick={() => remove(idx)}
            aria-label={`Remove accent ${idx + 1}`}
            title="Remove accent"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="squisq-theme-customizer-button squisq-theme-customizer-accent-add"
        onClick={add}
      >
        + Add accent
      </button>
    </div>
  );
}
