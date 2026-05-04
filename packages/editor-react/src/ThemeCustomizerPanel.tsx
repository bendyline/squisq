/**
 * ThemeCustomizerPanel
 *
 * Drop-in toolbar button + popover that lets the user author a custom
 * Theme by picking seed colors, fonts, and a few thematic presets.
 *
 * Design:
 * - **Controlled component** — host owns the `value` and forwards
 *   `onChange` whenever the user edits anything. This avoids coupling
 *   the panel to any specific preview wiring; the host decides whether
 *   to register the theme, set it as the preview theme, persist it, etc.
 * - **Subset of the Theme schema** — the panel exposes seed colors,
 *   curated/free-text fonts, and a handful of preset groups. Everything
 *   else (templateHints, layoutOverrides, persistentLayers, individual
 *   colorSchemes, animation defaults) inherits from the compiler's
 *   STARTER_THEME and can only be edited by hand-modifying the JSON.
 * - **Industry-standard mental model** — primary / secondary / accent +
 *   derived lighter/darker variants, like Material UI / Tailwind / Radix.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Theme, FontFamily, ThemeSeedColors } from '@bendyline/squisq/schemas';
import {
  AVAILABLE_FONT_STACKS,
  compileTheme,
  deriveScale,
  isHex,
  serializeTheme,
} from '@bendyline/squisq/schemas';

// ── Preset → schema-value tables ────────────────────────────────────

const BORDER_RADIUS_PRESETS = {
  sharp: 0,
  soft: 6,
  rounded: 16,
} as const;
type BorderRadiusPreset = keyof typeof BORDER_RADIUS_PRESETS;

const ANIMATION_SPEED_PRESETS = {
  static: 0,
  subtle: 1.4,
  normal: 1.0,
  expressive: 0.7,
} as const;
type AnimationSpeedPreset = keyof typeof ANIMATION_SPEED_PRESETS;

const TEXT_SHADOW_PRESETS = {
  off: false,
  on: true,
} as const;
type TextShadowPreset = keyof typeof TEXT_SHADOW_PRESETS;

const CONTRAST_PRESETS = ['subtle', 'balanced', 'high'] as const;
type ContrastPreset = (typeof CONTRAST_PRESETS)[number];

const FALLBACK_OPTIONS = ['sans-serif', 'serif', 'monospace', 'system-ui'] as const;
type FallbackOption = (typeof FALLBACK_OPTIONS)[number];

// ── Draft state — reflects the editable subset of the schema ────────

interface CustomFontInput {
  kind: 'curated' | 'custom';
  stackId?: string;
  customName?: string;
  customFallback?: FallbackOption;
}

interface Draft {
  name: string;
  seeds: ThemeSeedColors;
  titleFont: CustomFontInput;
  bodyFont: CustomFontInput;
  borderRadius: BorderRadiusPreset;
  animationSpeed: AnimationSpeedPreset;
  textShadow: TextShadowPreset;
  contrast: ContrastPreset;
}

const DEFAULT_DRAFT: Draft = {
  name: 'My Theme',
  seeds: {
    primary: '#3182ce',
    secondary: '#4a5568',
    accent: '#63b3ed',
    background: '#1a202c',
    text: '#f7fafc',
  },
  titleFont: { kind: 'curated', stackId: 'system-serif' },
  bodyFont: { kind: 'curated', stackId: 'system-sans' },
  borderRadius: 'soft',
  animationSpeed: 'normal',
  textShadow: 'on',
  contrast: 'balanced',
};

function findRadiusPreset(value: number | undefined): BorderRadiusPreset {
  if (value === undefined) return 'soft';
  let best: BorderRadiusPreset = 'soft';
  let bestDist = Infinity;
  (Object.entries(BORDER_RADIUS_PRESETS) as [BorderRadiusPreset, number][]).forEach(([k, v]) => {
    const d = Math.abs(v - value);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  });
  return best;
}

function findAnimationPreset(value: number | undefined): AnimationSpeedPreset {
  if (value === undefined || value === 0) return value === 0 ? 'static' : 'normal';
  let best: AnimationSpeedPreset = 'normal';
  let bestDist = Infinity;
  (Object.entries(ANIMATION_SPEED_PRESETS) as [AnimationSpeedPreset, number][]).forEach(
    ([k, v]) => {
      if (v === 0) return; // 'static' handled above
      const d = Math.abs(v - value);
      if (d < bestDist) {
        best = k;
        bestDist = d;
      }
    },
  );
  return best;
}

function fontFamilyToInput(f: FontFamily | undefined, fallbackStackId: string): CustomFontInput {
  if (!f) return { kind: 'curated', stackId: fallbackStackId };
  if ('stackId' in f) return { kind: 'curated', stackId: f.stackId };
  if ('custom' in f)
    return {
      kind: 'custom',
      customName: f.custom.name,
      customFallback: f.custom.fallback,
    };
  return { kind: 'curated', stackId: fallbackStackId };
}

function inputToFontFamily(input: CustomFontInput): FontFamily {
  if (input.kind === 'curated') {
    return { stackId: input.stackId ?? 'system-sans' };
  }
  return {
    custom: {
      name: input.customName ?? 'Sans',
      fallback: input.customFallback ?? 'sans-serif',
    },
  };
}

function themeToDraft(theme: Theme | null): Draft {
  if (!theme) return { ...DEFAULT_DRAFT };
  const seeds: ThemeSeedColors = theme.seedColors ?? {
    primary: theme.colors.primary,
    secondary: theme.colors.secondary,
    accent: theme.colors.highlight,
    background: theme.colors.background,
    text: theme.colors.text,
  };
  return {
    name: theme.name,
    seeds: {
      primary: seeds.primary,
      secondary: seeds.secondary,
      accent: seeds.accent,
      background: seeds.background,
      text: seeds.text,
    },
    titleFont: fontFamilyToInput(theme.typography.titleFont, 'system-serif'),
    bodyFont: fontFamilyToInput(theme.typography.bodyFont, 'system-sans'),
    borderRadius: findRadiusPreset(theme.style.borderRadius),
    animationSpeed: findAnimationPreset(theme.style.animationSpeed),
    textShadow: theme.style.textShadow === false ? 'off' : 'on',
    contrast: 'balanced',
  };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  );
}

function compileDraft(draft: Draft, baseId?: string): Theme {
  const id = baseId && baseId.startsWith('custom-') ? baseId : `custom-${slugify(draft.name)}`;
  return compileTheme(
    {
      id,
      name: draft.name,
      seedColors: draft.seeds,
      typography: {
        titleFont: inputToFontFamily(draft.titleFont),
        bodyFont: inputToFontFamily(draft.bodyFont),
      },
      style: {
        borderRadius: BORDER_RADIUS_PRESETS[draft.borderRadius],
        animationSpeed: ANIMATION_SPEED_PRESETS[draft.animationSpeed],
        textShadow: TEXT_SHADOW_PRESETS[draft.textShadow],
      },
    },
    { contrast: draft.contrast },
  );
}

// ── Component ───────────────────────────────────────────────────────

export interface ThemeCustomizerPanelProps {
  /** Current custom theme (or null to start from defaults). */
  value: Theme | null;
  /** Fired on every edit. Host typically registers the theme + previews it. */
  onChange: (theme: Theme) => void;
  /** Fired when the user clicks Save. Host typically persists the theme JSON. */
  onSave?: (theme: Theme, json: string) => void;
  /** Fired when the user clicks Reset. Host typically clears its persistent storage. */
  onReset?: () => void;
}

export function ThemeCustomizerPanel({
  value,
  onChange,
  onSave,
  onReset,
}: ThemeCustomizerPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => themeToDraft(value));
  const containerRef = useRef<HTMLDivElement>(null);

  // Whenever an external value lands (e.g., page load with persisted theme),
  // sync the draft. Internal edits update both draft and value via onChange.
  const externalIdRef = useRef<string | null>(value?.id ?? null);
  useEffect(() => {
    const incomingId = value?.id ?? null;
    if (incomingId !== externalIdRef.current) {
      externalIdRef.current = incomingId;
      setDraft(themeToDraft(value));
    }
  }, [value]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const updateDraft = useCallback(
    (patch: Partial<Draft> | ((d: Draft) => Draft)) => {
      setDraft((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        try {
          const compiled = compileDraft(next, value?.id);
          onChange(compiled);
        } catch {
          // Invalid intermediate state (e.g., bad hex while typing) — skip emit.
        }
        return next;
      });
    },
    [onChange, value?.id],
  );

  const updateSeed = useCallback(
    (key: keyof ThemeSeedColors, hex: string) => {
      updateDraft((d) => ({ ...d, seeds: { ...d.seeds, [key]: hex } }));
    },
    [updateDraft],
  );

  const handleSave = useCallback(() => {
    try {
      const compiled = compileDraft(draft, value?.id);
      onSave?.(compiled, serializeTheme(compiled));
    } catch {
      // Validation should already have surfaced via the disabled state.
    }
  }, [draft, onSave, value?.id]);

  const handleReset = useCallback(() => {
    setDraft({ ...DEFAULT_DRAFT });
    try {
      onChange(compileDraft(DEFAULT_DRAFT));
    } catch {
      // ignore
    }
    onReset?.();
  }, [onChange, onReset]);

  const previewSwatches = useMemo(() => {
    const seed = draft.seeds.primary;
    if (!isHex(seed)) return null;
    return deriveScale(
      seed,
      draft.contrast === 'high' ? 0.22 : draft.contrast === 'subtle' ? 0.08 : 0.15,
    );
  }, [draft.seeds.primary, draft.contrast]);

  return (
    <div className="squisq-theme-customizer" ref={containerRef}>
      <button
        type="button"
        className={`squisq-toolbar-button squisq-theme-customizer-trigger${
          open ? ' squisq-toolbar-button--active' : ''
        }`}
        data-tooltip="Customize theme"
        aria-label="Customize theme"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && (
        <div className="squisq-theme-customizer-popover" role="dialog" aria-label="Customize theme">
          <div className="squisq-theme-customizer-header">
            <span className="squisq-theme-customizer-title">Customize theme</span>
          </div>

          <div className="squisq-theme-customizer-body">
            <Section title="Name">
              <input
                type="text"
                className="squisq-theme-customizer-input"
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                aria-label="Theme name"
              />
            </Section>

            <Section title="Colors" hint="Pick seed colors. The rest is derived.">
              <SeedColorRow
                label="Primary"
                value={draft.seeds.primary}
                onChange={(v) => updateSeed('primary', v)}
              />
              <SeedColorRow
                label="Secondary"
                value={draft.seeds.secondary ?? ''}
                onChange={(v) => updateSeed('secondary', v)}
              />
              <SeedColorRow
                label="Accent"
                value={draft.seeds.accent ?? ''}
                onChange={(v) => updateSeed('accent', v)}
              />
              <SeedColorRow
                label="Background"
                value={draft.seeds.background ?? ''}
                onChange={(v) => updateSeed('background', v)}
              />
              <SeedColorRow
                label="Text"
                value={draft.seeds.text ?? ''}
                onChange={(v) => updateSeed('text', v)}
              />
              {previewSwatches && (
                <div className="squisq-theme-customizer-scale" aria-label="Derived primary scale">
                  {(['lighter2', 'lighter1', 'base', 'darker1', 'darker2'] as const).map((k) => (
                    <span
                      key={k}
                      className="squisq-theme-customizer-swatch"
                      style={{ background: previewSwatches[k] }}
                      title={`${k}: ${previewSwatches[k]}`}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Typography">
              <FontPicker
                label="Heading"
                value={draft.titleFont}
                onChange={(next) => updateDraft({ titleFont: next })}
              />
              <FontPicker
                label="Body"
                value={draft.bodyFont}
                onChange={(next) => updateDraft({ bodyFont: next })}
              />
            </Section>

            <Section title="Style">
              <PresetRow
                label="Border radius"
                value={draft.borderRadius}
                options={Object.keys(BORDER_RADIUS_PRESETS) as BorderRadiusPreset[]}
                onChange={(v) => updateDraft({ borderRadius: v })}
              />
              <PresetRow
                label="Animation"
                value={draft.animationSpeed}
                options={Object.keys(ANIMATION_SPEED_PRESETS) as AnimationSpeedPreset[]}
                onChange={(v) => updateDraft({ animationSpeed: v })}
              />
              <PresetRow
                label="Text shadow"
                value={draft.textShadow}
                options={Object.keys(TEXT_SHADOW_PRESETS) as TextShadowPreset[]}
                onChange={(v) => updateDraft({ textShadow: v })}
              />
              <PresetRow
                label="Contrast"
                value={draft.contrast}
                options={CONTRAST_PRESETS as readonly ContrastPreset[]}
                onChange={(v) => updateDraft({ contrast: v })}
              />
            </Section>
          </div>

          <div className="squisq-theme-customizer-footer">
            <button type="button" className="squisq-theme-customizer-button" onClick={handleReset}>
              Reset
            </button>
            {onSave && (
              <button
                type="button"
                className="squisq-theme-customizer-button squisq-theme-customizer-button--primary"
                onClick={handleSave}
              >
                Save
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function Section({
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

function SeedColorRow({
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

function FontPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CustomFontInput;
  onChange: (next: CustomFontInput) => void;
}) {
  return (
    <div className="squisq-theme-customizer-row squisq-theme-customizer-row--font">
      <span className="squisq-theme-customizer-row-label">{label}</span>
      <select
        className="squisq-theme-customizer-input"
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
          <option key={stack.id} value={stack.id}>
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

function PresetRow<T extends string>({
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
