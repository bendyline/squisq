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
 * - **Shared editing model** — the draft model, `compileDraft`, and the
 *   form rows live in `customThemes/themeDraft` + `customThemes/themeControls`,
 *   shared with the fuller `CustomThemeDialog` (which adds a base-theme
 *   picker and the N-accent editor).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Theme, ThemeSeedColors } from '@bendyline/squisq/schemas';
import { deriveScale, isHex, serializeTheme } from '@bendyline/squisq/schemas';
import {
  type Draft,
  DEFAULT_DRAFT,
  themeToDraft,
  compileDraft,
  BORDER_RADIUS_PRESETS,
  ANIMATION_SPEED_PRESETS,
  TEXT_SHADOW_PRESETS,
  CONTRAST_PRESETS,
  IMAGE_TREATMENT_PRESETS,
  type BorderRadiusPreset,
  type AnimationSpeedPreset,
  type TextShadowPreset,
  type ContrastPreset,
  type ImageTreatmentPreset,
} from './customThemes/themeDraft';
import { Section, SeedColorRow, FontPicker, PresetRow } from './customThemes/themeControls';
import { ImportThemeSection } from './customThemes/ImportThemeSection';
import { useEscapeDismissal } from './useEscapeDismissal';

const POPOVER_WIDTH = 360;
const POPOVER_GUTTER = 8;
const POPOVER_GAP = 4;

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
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
  /** Optional text trigger. Omit to use the compact icon trigger. */
  triggerLabel?: string;
}

export function ThemeCustomizerPanel({
  value,
  onChange,
  onSave,
  onReset,
  triggerLabel,
}: ThemeCustomizerPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => themeToDraft(value));
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEscapeDismissal(open, close, triggerRef);

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

  // Keep the popover inside the viewport even when its trigger is near an
  // edge (for example, when the demo site is shown in a narrow side pane).
  useLayoutEffect(() => {
    if (!open) return;

    const positionPopover = () => {
      const container = containerRef.current;
      if (!container) return;

      const anchor = container.getBoundingClientRect();
      const width = Math.max(0, Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_GUTTER * 2));
      const maxLeft = Math.max(POPOVER_GUTTER, window.innerWidth - width - POPOVER_GUTTER);
      const left = Math.min(Math.max(POPOVER_GUTTER, anchor.right - width), maxLeft);
      const top = anchor.bottom;

      setPopoverPosition({
        left,
        top,
        width,
        maxHeight: Math.max(0, window.innerHeight - top - POPOVER_GAP - POPOVER_GUTTER),
      });
    };

    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [open]);

  const updateDraft = useCallback(
    (patch: Partial<Draft> | ((d: Draft) => Draft)) => {
      setDraft((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        try {
          const compiled = compileDraft(next, { existingId: value?.id });
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
      const compiled = compileDraft(draft, { existingId: value?.id });
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
        ref={triggerRef}
        type="button"
        className={`squisq-toolbar-button squisq-theme-customizer-trigger${
          triggerLabel ? ' squisq-theme-customizer-trigger--label' : ''
        }${open ? ' squisq-toolbar-button--active' : ''}`}
        data-tooltip="Customize theme"
        aria-label="Customize theme"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerLabel ? (
          <span className="squisq-theme-customizer-trigger-label">{triggerLabel}</span>
        ) : (
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
        )}
      </button>
      {open && (
        <div
          className="squisq-theme-customizer-popover"
          role="dialog"
          aria-label="Customize theme"
          style={
            popoverPosition
              ? ({
                  ...popoverPosition,
                  position: 'fixed',
                  right: 'auto',
                } satisfies CSSProperties)
              : undefined
          }
        >
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

            <Section
              title="Import from file"
              hint="Pull colors and fonts from a Word, PowerPoint, or Excel file."
            >
              <ImportThemeSection onImported={(patch) => updateDraft(patch)} />
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
              <PresetRow
                label="Image grade"
                value={draft.imageTreatment}
                options={IMAGE_TREATMENT_PRESETS as readonly ImageTreatmentPreset[]}
                onChange={(v) => updateDraft({ imageTreatment: v })}
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
