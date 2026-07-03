/**
 * CustomThemeDialog
 *
 * Docked, **non-modal** theme designer pane — the theme analog of
 * `TemplateDesigner`. Because applying theme properties (colors, fonts, …) is
 * WYSIWYG, the designer docks into the editor's content row (below the
 * toolbars, to the right of the preview) rather than covering the canvas with
 * a modal; the preview shrinks to make room, so it stays fully visible and
 * interactive while the user edits. `onChange` fires the compiled theme on
 * every edit so the host can preview it via `PreviewSettingsProvider`'s
 * `themeOverride`; the doc is only mutated on Save.
 *
 * The user picks a base theme to inherit render style / layout from, edits seed
 * colors (primary / secondary / tertiary), an add/remove list of accent colors,
 * fonts and style presets, and saves to the document or the browser-local
 * library (`saveTarget: 'doc' | 'library'`).
 *
 * Rendered as a plain flex-item pane (a fixed-width, full-height column) — the
 * host (`ThemeDesignerDock` inside `EditorShell`'s content row) places it as a
 * sibling of the preview so the flexbox reflows the preview narrower.
 *
 * The editing model (draft + `compileDraft`) and the form rows are shared with
 * the lighter `ThemeCustomizerPanel` popover via `themeDraft` + `themeControls`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Theme, ThemeSeedColors } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { ThemePicker } from '../ThemePicker';
import {
  type Draft,
  type AccentInput,
  themeToDraft,
  compileDraft,
  accentsFromTheme,
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
} from './themeDraft';
import { Section, SeedColorRow, FontPicker, PresetRow, AccentEditor } from './themeControls';

/** Where a saved theme lands — mirrors `DesignerSaveTarget` for templates. */
export type ThemeSaveTarget = 'doc' | 'library';

export interface CustomThemeDialogProps {
  /** Theme being edited, or null to author a new one. */
  value: Theme | null;
  /** Fired on every edit with the compiled theme (host previews via themeOverride). */
  onChange?: (theme: Theme) => void;
  /** Fired when the user saves, with the chosen target. */
  onSave: (theme: Theme, target: ThemeSaveTarget) => void;
  /** Dismiss (Cancel / Esc / close button). */
  onClose: () => void;
}

function initialDraft(value: Theme | null): Draft {
  const d = themeToDraft(value);
  // Re-opening an existing custom theme: treat its accents as authored so a
  // seed-only edit doesn't silently drop them back to the base's schemes.
  if (value) d.accentsEdited = true;
  return d;
}

export function CustomThemeDialog({ value, onChange, onSave, onClose }: CustomThemeDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(value));

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const compile = useCallback(
    (d: Draft): Theme => {
      const base = d.baseId ? resolveTheme(d.baseId) : undefined;
      return compileDraft(d, { existingId: value?.id, base });
    },
    [value?.id],
  );

  const updateDraft = useCallback(
    (patch: Partial<Draft> | ((d: Draft) => Draft)) => {
      setDraft((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        try {
          onChange?.(compile(next));
        } catch {
          // Invalid intermediate state (e.g. bad hex mid-typing) — skip preview.
        }
        return next;
      });
    },
    [onChange, compile],
  );

  const updateSeed = useCallback(
    (key: keyof ThemeSeedColors, hex: string) =>
      updateDraft((d) => ({ ...d, seeds: { ...d.seeds, [key]: hex } })),
    [updateDraft],
  );

  const handleSave = useCallback(
    (target: ThemeSaveTarget) => {
      try {
        onSave(compile(draft), target);
      } catch {
        // A compile failure here means the draft is invalid; leave the dialog open.
      }
    },
    [draft, onSave, compile],
  );

  // Accents show the base's schemes until the user edits them (then the draft's
  // own list wins). Editing any accent flips `accentsEdited` so the compiled
  // theme replaces `colorSchemes` wholesale.
  const base = useMemo(() => (draft.baseId ? resolveTheme(draft.baseId) : null), [draft.baseId]);
  const displayAccents: AccentInput[] = draft.accentsEdited
    ? draft.accents
    : accentsFromTheme(base);
  const onAccentsChange = useCallback(
    (next: AccentInput[]) => updateDraft({ accents: next, accentsEdited: true }),
    [updateDraft],
  );

  return (
    <div className="squisq-custom-theme-pane" role="dialog" aria-label="Design custom theme">
      <div className="squisq-doc-settings-header">
        <h2 className="squisq-doc-settings-title">
          {value ? 'Edit custom theme' : 'New custom theme'}
        </h2>
        <button
          type="button"
          className="squisq-doc-settings-close"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className="squisq-doc-settings-body squisq-theme-customizer-body squisq-custom-theme-pane-body">
        <Section title="Name">
          <input
            ref={nameRef}
            type="text"
            className="squisq-theme-customizer-input"
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            aria-label="Theme name"
          />
        </Section>

        <Section title="Base theme" hint="Inherit render style, motion, and layout from a base.">
          <ThemePicker
            value={draft.baseId ?? ''}
            onChange={(id) => updateDraft({ baseId: id || undefined })}
            includeDefault
            variant="full"
            ariaLabel="Base theme"
          />
        </Section>

        <Section
          title="Colors"
          hint="Primary, secondary, and tertiary (accent). The rest is derived."
        >
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
            label="Tertiary"
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
        </Section>

        <Section title="Accents" hint="Per-block accent colors. Add as many as you like.">
          <AccentEditor accents={displayAccents} onChange={onAccentsChange} />
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

      <div className="squisq-doc-settings-footer squisq-custom-theme-pane-footer">
        <button
          type="button"
          className="squisq-doc-settings-btn squisq-doc-settings-btn--secondary"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="squisq-doc-settings-btn squisq-doc-settings-btn--secondary"
          onClick={() => handleSave('library')}
          title="Save to your browser-local library so other docs can use it"
        >
          Save to library
        </button>
        <button
          type="button"
          className="squisq-doc-settings-btn squisq-doc-settings-btn--primary"
          onClick={() => handleSave('doc')}
        >
          Save to document
        </button>
      </div>
    </div>
  );
}
