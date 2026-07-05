/* eslint-disable react-refresh/only-export-components */
/**
 * PreviewControls
 *
 * Shared context and inline toolbar component for preview settings
 * (viewport format, display mode, theme, transform, caption style).
 *
 * The context is provided by EditorShell and consumed by both:
 * - PreviewControls (toolbar dropdowns, rendered in the main toolbar)
 * - PreviewPanel (the actual player, which reads the selected values)
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import type { DisplayMode, CaptionStyle } from '@bendyline/squisq-react';
import type { ViewportPreset, ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS, getThemeSummaries } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { ThemePicker } from './ThemePicker';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import type { Doc } from '@bendyline/squisq/schemas';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';
import {
  resolveThemeForDoc,
  writeCustomThemesToFrontmatter,
  FRONTMATTER_CUSTOM_THEMES_KEY,
} from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';
import { useCustomThemes, CustomThemeDialog, type ThemeSaveTarget } from './customThemes';
import { Icon } from './Icon';

// ── Context ──────────────────────────────────────────────────────

/** Caption selection: off, or one of the two enabled styles. */
export type CaptionMode = 'off' | CaptionStyle;

export interface PreviewSettings {
  activePreset: ViewportPreset;
  setSelectedPreset: (preset: ViewportPreset | null) => void;
  activeViewport: ViewportConfig;
  activeDisplayMode: DisplayMode;
  setSelectedDisplayMode: (mode: DisplayMode | null) => void;
  activeThemeId: string;
  setSelectedThemeId: (id: string | null) => void;
  activeTheme: Theme;
  activeTransformStyle: string;
  setSelectedTransformStyle: (id: string | null) => void;
  /** The caption style used when captions are enabled. */
  activeCaptionStyle: CaptionStyle;
  /** Whether captions are shown at all (the 'off' arm of the tri-state). */
  activeCaptionsEnabled: boolean;
  /** Set the caption mode: 'off' hides captions, 'standard'/'social' enable
   *  that style. The single entry point so the toggle buttons persist in one
   *  frontmatter write. */
  setCaptionMode: (mode: CaptionMode) => void;
  /** User-authored themes (doc + browser library) for the picker's "Custom" group. */
  customThemes: Theme[];
  /** Open the custom-theme designer for a theme (or null to create a new one). */
  openThemeDesigner: (theme: Theme | null) => void;
  /** Remove a custom theme from the doc and the library. */
  deleteCustomTheme: (id: string) => void;
  /** Config for the docked theme designer, or null when closed. Rendered by
   *  `<ThemeDesignerDock>` in the editor's content row. */
  themeDesigner: ThemeDesignerConfig | null;
}

/** Everything `<ThemeDesignerDock>` needs to render the designer pane. */
export interface ThemeDesignerConfig {
  value: Theme | null;
  onChange: (theme: Theme) => void;
  onSave: (theme: Theme, target: ThemeSaveTarget) => void;
  onClose: () => void;
}

const PreviewSettingsContext = createContext<PreviewSettings | null>(null);

export function usePreviewSettings(): PreviewSettings {
  const ctx = useContext(PreviewSettingsContext);
  if (!ctx) throw new Error('usePreviewSettings must be used within PreviewSettingsProvider');
  return ctx;
}

/**
 * Like {@link usePreviewSettings} but returns `null` when no provider is
 * mounted. For consumers (e.g. WysiwygEditor) that want to react to the
 * active theme when available without forcing every test harness to
 * wrap them in a PreviewSettingsProvider.
 */
export function usePreviewSettingsOptional(): PreviewSettings | null {
  return useContext(PreviewSettingsContext);
}

// ── Frontmatter resolvers ────────────────────────────────────────

function resolveRenderAs(value: unknown): ViewportPreset | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const mapping: Record<string, ViewportPreset> = {
    landscape: 'landscape',
    '16:9': 'landscape',
    widescreen: 'landscape',
    portrait: 'portrait',
    '9:16': 'portrait',
    vertical: 'portrait',
    stories: 'portrait',
    square: 'square',
    '1:1': 'square',
    standard: 'standard',
    '4:3': 'standard',
  };
  return mapping[v] ?? null;
}

function resolveDisplayMode(value: unknown): DisplayMode | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'video' || v === 'slideshow' || v === 'linear' || v === 'page') return v;
  if (v === 'slides' || v === 'presentation' || v === 'deck') return 'slideshow';
  if (v === 'document' || v === 'scroll') return 'linear';
  if (v === 'html' || v === 'plain' || v === 'reader') return 'page';
  return null;
}

const VALID_THEME_IDS = new Set(getThemeSummaries().map((s) => s.id));

function resolveFrontmatterTheme(value: unknown, customIds?: Set<string>): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const v = raw.toLowerCase();
  if (VALID_THEME_IDS.has(v)) return v;
  const normalized = v.replace(/\s+/g, '-');
  if (VALID_THEME_IDS.has(normalized)) return normalized;
  // Custom theme ids are doc-defined slugs (lowercase from the customizer).
  // Admit them so an inline theme selection isn't rejected back to 'standard'.
  if (customIds?.has(raw)) return raw;
  if (customIds?.has(v)) return v;
  return null;
}

const VALID_TRANSFORM_IDS = new Set(getTransformStyleSummaries().map((s) => s.id));

function resolveFrontmatterTransform(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (VALID_TRANSFORM_IDS.has(v)) return v;
  const normalized = v.replace(/\s+/g, '-');
  if (VALID_TRANSFORM_IDS.has(normalized)) return normalized;
  return null;
}

function resolveFrontmatterCaptionMode(value: unknown): CaptionMode | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'off' || v === 'none' || v === 'hidden' || v === 'false' || v === 'no') return 'off';
  if (v === 'standard' || v === 'cc' || v === 'captions') return 'standard';
  if (v === 'social' || v === 'instagram' || v === 'tiktok' || v === 'reels') return 'social';
  return null;
}

// ── Provider ─────────────────────────────────────────────────────

export interface PreviewSettingsProviderProps {
  doc: Doc | null;
  children: ReactNode;
  /**
   * Optional Theme to use for the preview, regardless of `Doc.themeId` or
   * the user's theme dropdown selection. Used by the theme customizer to
   * preview an in-progress theme without mutating the document. When
   * present, `activeTheme` is this value and `activeThemeId` is its `id`.
   */
  themeOverride?: Theme | null;
}

/** Frontmatter keys we read/write for preview settings. The squisq-prefixed
 *  keys are the canonical names; the legacy keys are still read so existing
 *  documents keep working. Persistence (writes) uses only the squisq names. */
const FM_KEYS = {
  theme: { canonical: 'squisq-theme', legacy: 'theme' as const },
  transform: { canonical: 'squisq-transform', legacy: 'transform-style' as const },
  captions: { canonical: 'squisq-captions', legacy: 'caption-style' as const },
} as const;

function readFrontmatterKey(
  fm: Record<string, unknown> | undefined,
  canonical: string,
  legacy: string,
): unknown {
  if (!fm) return undefined;
  return Object.prototype.hasOwnProperty.call(fm, canonical) ? fm[canonical] : fm[legacy];
}

export function PreviewSettingsProvider({
  doc,
  children,
  themeOverride,
}: PreviewSettingsProviderProps) {
  const frontmatter = doc?.frontmatter;
  const { markdownSource, setMarkdownSource } = useEditorContext();

  const persistFrontmatter = useCallback(
    (updates: Record<string, string | null>) => {
      const next = setFrontmatterValues(markdownSource, updates);
      if (next !== markdownSource) {
        setMarkdownSource(next);
      }
    },
    [markdownSource, setMarkdownSource],
  );

  // Viewport
  const fmPreset = useMemo(
    () => resolveRenderAs(frontmatter?.['document-render-as']),
    [frontmatter],
  );
  const [selectedPreset, setSelectedPreset] = useState<ViewportPreset | null>(null);
  useEffect(() => setSelectedPreset(null), [fmPreset]);
  const activePreset = selectedPreset ?? fmPreset ?? 'landscape';
  const activeViewport = VIEWPORT_PRESETS[activePreset];

  // Display mode
  const fmMode = useMemo(() => resolveDisplayMode(frontmatter?.['display-mode']), [frontmatter]);
  const [selectedDisplayMode, setSelectedDisplayMode] = useState<DisplayMode | null>(null);
  useEffect(() => setSelectedDisplayMode(null), [fmMode]);
  const activeDisplayMode = selectedDisplayMode ?? fmMode ?? 'video';

  // Custom themes (doc + browser library). `useCustomThemes` returns null when
  // no provider is mounted; the picker then just shows built-ins.
  const custom = useCustomThemes();
  const customThemes = useMemo(() => custom?.allThemes ?? [], [custom]);
  const customIds = useMemo(() => new Set(customThemes.map((t) => t.id)), [customThemes]);

  // Theme — persisted to `squisq-theme` (legacy `theme` still read for compat)
  const fmTheme = useMemo(
    () =>
      resolveFrontmatterTheme(
        readFrontmatterKey(frontmatter, FM_KEYS.theme.canonical, FM_KEYS.theme.legacy),
        customIds,
      ),
    [frontmatter, customIds],
  );
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  useEffect(() => setSelectedThemeId(null), [fmTheme]);
  const resolvedThemeId = selectedThemeId ?? fmTheme ?? 'standard';
  // Doc-scoped resolution: an inline custom theme id resolves from the doc's
  // own `customThemes` before built-ins — no global registration needed.
  const resolvedTheme = useMemo(
    () => resolveThemeForDoc(doc, resolvedThemeId),
    [doc, resolvedThemeId],
  );

  // In-progress theme from the designer dialog; previews live without mutating
  // the doc until the user saves.
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);
  const [designer, setDesigner] = useState<{ open: boolean; editing: Theme | null }>({
    open: false,
    editing: null,
  });

  // Precedence: an active designer preview > external themeOverride > the
  // dropdown/frontmatter selection.
  const activeThemeId = previewTheme?.id ?? themeOverride?.id ?? resolvedThemeId;
  const activeTheme = previewTheme ?? themeOverride ?? resolvedTheme;
  const handleSetThemeId = useCallback(
    (id: string | null) => {
      setSelectedThemeId(id);
      if (id !== null) persistFrontmatter({ [FM_KEYS.theme.canonical]: id });
    },
    [persistFrontmatter],
  );

  const openThemeDesigner = useCallback((theme: Theme | null) => {
    setDesigner({ open: true, editing: theme });
    setPreviewTheme(theme);
  }, []);
  const closeThemeDesigner = useCallback(() => {
    setDesigner({ open: false, editing: null });
    setPreviewTheme(null);
  }, []);
  const handleDesignerSave = useCallback(
    (theme: Theme, target: ThemeSaveTarget) => {
      if (target === 'library') {
        custom?.upsertLibraryTheme(theme);
      } else {
        // Write the theme payload AND select it in a SINGLE frontmatter update.
        // Two separate `setMarkdownSource` calls (upsertDocTheme + a squisq-theme
        // write) would each derive from the same stale source, so the second
        // would clobber the first and drop the custom-themes payload.
        const docThemes = custom?.docThemes ?? [];
        const idx = docThemes.findIndex((t) => t.id === theme.id);
        const nextThemes =
          idx >= 0 ? docThemes.map((t, i) => (i === idx ? theme : t)) : [...docThemes, theme];
        persistFrontmatter({
          [FRONTMATTER_CUSTOM_THEMES_KEY]: writeCustomThemesToFrontmatter(nextThemes) ?? null,
          [FM_KEYS.theme.canonical]: theme.id,
        });
        setSelectedThemeId(theme.id);
      }
      closeThemeDesigner();
    },
    [custom, persistFrontmatter, closeThemeDesigner],
  );
  const deleteCustomTheme = useCallback(
    (id: string) => {
      custom?.removeDocTheme(id);
      custom?.removeLibraryTheme(id);
    },
    [custom],
  );

  // Transform — persisted to `squisq-transform` (legacy `transform-style` read for compat)
  const fmTransform = useMemo(
    () =>
      resolveFrontmatterTransform(
        readFrontmatterKey(frontmatter, FM_KEYS.transform.canonical, FM_KEYS.transform.legacy),
      ),
    [frontmatter],
  );
  const [selectedTransformStyle, setSelectedTransformStyle] = useState<string | null>(null);
  useEffect(() => setSelectedTransformStyle(null), [fmTransform]);
  const activeTransformStyle = selectedTransformStyle ?? fmTransform ?? '';
  const handleSetTransformStyle = useCallback(
    (id: string | null) => {
      setSelectedTransformStyle(id);
      if (id !== null) {
        // Empty string = "None" — remove the key rather than writing a blank value.
        persistFrontmatter({ [FM_KEYS.transform.canonical]: id === '' ? null : id });
      }
    },
    [persistFrontmatter],
  );

  // Caption mode — 'off' | 'standard' | 'social'. Persisted to `squisq-captions`
  // (legacy `caption-style` read for compat). `activeCaptionStyle` is the style
  // used when enabled; `activeCaptionsEnabled` is the off/on split.
  const fmCaptionMode = useMemo(
    () =>
      resolveFrontmatterCaptionMode(
        readFrontmatterKey(frontmatter, FM_KEYS.captions.canonical, FM_KEYS.captions.legacy),
      ),
    [frontmatter],
  );
  const [selectedCaptionMode, setSelectedCaptionMode] = useState<CaptionMode | null>(null);
  useEffect(() => setSelectedCaptionMode(null), [fmCaptionMode]);
  const activeCaptionMode = selectedCaptionMode ?? fmCaptionMode ?? 'standard';
  const activeCaptionsEnabled = activeCaptionMode !== 'off';
  const activeCaptionStyle: CaptionStyle = activeCaptionMode === 'social' ? 'social' : 'standard';
  const handleSetCaptionMode = useCallback(
    (mode: CaptionMode) => {
      setSelectedCaptionMode(mode);
      persistFrontmatter({ [FM_KEYS.captions.canonical]: mode });
    },
    [persistFrontmatter],
  );

  // Config for the docked designer (rendered by `<ThemeDesignerDock>` in the
  // editor content row). Null when closed. setPreviewTheme is a stable setter.
  const themeDesigner = useMemo<ThemeDesignerConfig | null>(
    () =>
      designer.open
        ? {
            value: designer.editing,
            onChange: setPreviewTheme,
            onSave: handleDesignerSave,
            onClose: closeThemeDesigner,
          }
        : null,
    [designer.open, designer.editing, handleDesignerSave, closeThemeDesigner],
  );

  const value = useMemo<PreviewSettings>(
    () => ({
      activePreset,
      setSelectedPreset,
      activeViewport,
      activeDisplayMode,
      setSelectedDisplayMode,
      activeThemeId,
      setSelectedThemeId: handleSetThemeId,
      activeTheme,
      activeTransformStyle,
      setSelectedTransformStyle: handleSetTransformStyle,
      activeCaptionStyle,
      activeCaptionsEnabled,
      setCaptionMode: handleSetCaptionMode,
      customThemes,
      openThemeDesigner,
      deleteCustomTheme,
      themeDesigner,
    }),
    [
      activePreset,
      activeViewport,
      activeDisplayMode,
      activeThemeId,
      activeTheme,
      activeTransformStyle,
      activeCaptionStyle,
      activeCaptionsEnabled,
      handleSetThemeId,
      handleSetTransformStyle,
      handleSetCaptionMode,
      customThemes,
      openThemeDesigner,
      deleteCustomTheme,
      themeDesigner,
    ],
  );

  return (
    <PreviewSettingsContext.Provider value={value}>{children}</PreviewSettingsContext.Provider>
  );
}

/**
 * ThemeDesignerDock — renders the docked custom-theme designer pane when open.
 * Placed as a flex sibling of the preview in `EditorShell`'s content row so the
 * preview reflows narrower beside it. Renders nothing when the designer is
 * closed. Must be mounted inside a `PreviewSettingsProvider`.
 */
export function ThemeDesignerDock() {
  const { themeDesigner } = usePreviewSettings();
  if (!themeDesigner) return null;
  return (
    <CustomThemeDialog
      value={themeDesigner.value}
      onChange={themeDesigner.onChange}
      onSave={themeDesigner.onSave}
      onClose={themeDesigner.onClose}
    />
  );
}

// ── Dropdown options ─────────────────────────────────────────────

/**
 * Aspect-ratio presets surfaced as the segmented {@link PreviewFormatSwitch}
 * on the left of the toolbar. `w`/`h` are the glyph rectangle dimensions (in a
 * 16×16 viewBox) drawn by {@link AspectIcon} to depict each ratio.
 */
const FORMAT_SWITCH_OPTIONS: { key: ViewportPreset; label: string; w: number; h: number }[] = [
  { key: 'landscape', label: '16:9', w: 13, h: 7 },
  { key: 'square', label: '1:1', w: 10, h: 10 },
  { key: 'portrait', label: '9:16', w: 7, h: 12 },
  { key: 'standard', label: '4:3', w: 12, h: 9 },
];

const DISPLAY_MODE_OPTIONS: { key: DisplayMode; label: string }[] = [
  { key: 'video', label: 'Video' },
  { key: 'slideshow', label: 'Slideshow' },
  { key: 'linear', label: 'Document' },
  { key: 'page', label: 'Page' },
];

const TRANSFORM_STYLE_OPTIONS = [
  { key: '', label: 'None' },
  ...getTransformStyleSummaries().map((s) => ({ key: s.id, label: s.name })),
];

/**
 * Left-to-right priority order for the preview controls. As the toolbar
 * narrows, controls drop into the overflow menu from the END of this list
 * first (Captions, then Transform, …), so the higher-priority control (Theme)
 * stays inline the longest.
 *
 * Display mode and aspect ratio are not here — they're surfaced separately as
 * the segmented {@link PreviewModeSwitch} / {@link PreviewFormatSwitch} on the
 * left of the toolbar.
 */
type ControlKey = 'theme' | 'transform' | 'captions';
const CONTROL_KEYS: ControlKey[] = ['theme', 'transform', 'captions'];

// ── Shared styles ────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  color: 'var(--squisq-text-muted, #6b7280)',
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: '4px',
  border: '1px solid var(--squisq-border, #d1d5db)',
  background: 'var(--squisq-input-bg, #fff)',
  color: 'var(--squisq-text, #1f2937)',
  fontSize: '12px',
  cursor: 'pointer',
};

// ── Toolbar Controls Component ───────────────────────────────────

/**
 * Inline preview controls rendered in the main toolbar row.
 *
 * Collapse is *progressive* (a priority-plus pattern): rather than switch the
 * whole row in and out at a fixed window-width breakpoint, the controls
 * measure how many of them actually fit in the width the toolbar gives them
 * and keep that many inline, folding the rest — from the low-priority end of
 * {@link CONTROL_KEYS} — into a single settings (gear) button's popover. As
 * the toolbar widens or narrows, controls migrate one at a time between the
 * inline row and the menu, so the available space is always well used and the
 * row never wraps onto a second line.
 */
export function PreviewToolbarControls() {
  const s = usePreviewSettings();
  const [visibleCount, setVisibleCount] = useState(CONTROL_KEYS.length);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // `rootRef` (flex:1) always spans the toolbar's leftover width, so its
  // clientWidth is the budget the controls have to lay out in.
  const rootRef = useRef<HTMLDivElement>(null);
  // Hidden probe rendering every control at natural width; the split between
  // inline and overflow is computed from these per-control measurements.
  const probeRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fit detection: keep as many controls inline as fit, overflow the rest.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const probe = probeRef.current;
    if (!root || !probe) return;
    const GAP = 6; // matches the row's flex `gap`
    const LEAD_PAD = 9; // root's left padding, eaten before any control
    const GEAR_RESERVE = 40; // width kept for the overflow gear button (+ its gap)
    const SAFETY = 2;
    const measure = () => {
      const available = root.clientWidth - LEAD_PAD;
      const widths = Array.from(probe.children).map((el) =>
        (el as HTMLElement).getBoundingClientRect().width,
      );
      // Width of the first `n` controls laid out inline (n-1 inter-control gaps).
      const rowWidth = (n: number) =>
        widths.slice(0, n).reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, n - 1);
      // Everything fits → no overflow button needed.
      if (rowWidth(widths.length) <= available) {
        setVisibleCount(widths.length);
        return;
      }
      // Otherwise reserve room for the gear and fit as many as possible.
      const budget = available - GEAR_RESERVE - GAP - SAFETY;
      let count = 0;
      while (count < widths.length && rowWidth(count + 1) <= budget) count++;
      setVisibleCount(count);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    // Observe the probe too: a control's width can change (e.g. a longer theme
    // name) without the toolbar resizing, and that shifts the split.
    ro.observe(probe);
    measure();
    return () => ro.disconnect();
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverOpen]);

  // "Edit theme" pencil next to the dropdown. A custom theme opens directly in
  // the designer; a built-in seeds a NEW "Modified <name>" custom theme based
  // on it — Cancel leaves the current theme untouched, Save engages the custom.
  const handleEditCurrentTheme = useCallback(() => {
    const existing = s.customThemes.find((t) => t.id === s.activeThemeId);
    if (existing) {
      s.openThemeDesigner(existing);
    } else {
      const base = s.activeTheme;
      s.openThemeDesigner({ ...base, name: `Modified ${base.name}`, basedOn: base.id });
    }
  }, [s]);

  // Render a single control by key. `compact` switches to the stacked
  // label-over-control layout used inside the overflow popover.
  const renderControl = (key: ControlKey, compact: boolean): ReactNode => {
    switch (key) {
      case 'theme':
        return (
          <div
            key="theme"
            className={`squisq-preview-control${compact ? ' squisq-preview-control--compact' : ''}`}
          >
            <label style={labelStyle}>Theme:</label>
            <ThemePicker
              value={s.activeThemeId}
              onChange={(v) => s.setSelectedThemeId(v)}
              ariaLabel="Theme"
              customThemes={s.customThemes}
              onCreateCustom={() => s.openThemeDesigner(null)}
              onEditCustom={(id) =>
                s.openThemeDesigner(s.customThemes.find((t) => t.id === id) ?? null)
              }
              onDeleteCustom={(id) => s.deleteCustomTheme(id)}
            />
            <button
              type="button"
              className="squisq-theme-edit-btn"
              onClick={handleEditCurrentTheme}
              aria-label="Edit theme"
              title="Edit this theme"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 13.5l1-3 7-7 2 2-7 7-3 1z" />
                <path d="M9.5 4.5l2 2" />
              </svg>
            </button>
          </div>
        );
      case 'transform':
        return (
          <PreviewSelect
            key="transform"
            label="Transform"
            value={s.activeTransformStyle}
            options={TRANSFORM_STYLE_OPTIONS}
            onChange={(v) => s.setSelectedTransformStyle(v)}
            compact={compact}
          />
        );
      case 'captions': {
        // Two independent toggles (either can be off): CC = standard captions,
        // share icon = social captions. Clicking the active one turns captions
        // off; clicking the other switches style (and turns captions on).
        const enabled = s.activeCaptionsEnabled;
        const ccActive = enabled && s.activeCaptionStyle === 'standard';
        const socialActive = enabled && s.activeCaptionStyle === 'social';
        return (
          <div
            key="captions"
            className={`squisq-preview-control${compact ? ' squisq-preview-control--compact' : ''}`}
          >
            <label style={labelStyle}>Captions:</label>
            <div className="squisq-preview-seg" role="group" aria-label="Captions">
              <button
                type="button"
                className={`squisq-preview-seg-btn squisq-preview-seg-btn--icon${ccActive ? ' squisq-preview-seg-btn--active' : ''}`}
                aria-pressed={ccActive}
                aria-label="Standard captions"
                title="Standard captions"
                onClick={() => s.setCaptionMode(ccActive ? 'off' : 'standard')}
              >
                <Icon icon="fa-solid fa-closed-captioning" />
              </button>
              <button
                type="button"
                className={`squisq-preview-seg-btn squisq-preview-seg-btn--icon${socialActive ? ' squisq-preview-seg-btn--active' : ''}`}
                aria-pressed={socialActive}
                aria-label="Social captions"
                title="Social captions"
                onClick={() => s.setCaptionMode(socialActive ? 'off' : 'social')}
              >
                <Icon icon="fa-solid fa-share-nodes" />
              </button>
            </div>
          </div>
        );
      }
    }
  };

  const hasOverflow = visibleCount < CONTROL_KEYS.length;
  const visibleKeys = CONTROL_KEYS.slice(0, visibleCount);
  const overflowKeys = CONTROL_KEYS.slice(visibleCount);

  // The root is a flex:1 filler so it always spans the toolbar's leftover
  // width (which is what the fit measurement reads).
  return (
    <div className="squisq-preview-controls" ref={rootRef}>
      {/* Hidden probe — every control at natural width, measured to decide the
          inline/overflow split. Absolutely positioned so it never affects
          layout. */}
      <div className="squisq-preview-controls-probe" ref={probeRef} aria-hidden="true">
        {CONTROL_KEYS.map((key) => renderControl(key, false))}
      </div>

      <div className="squisq-preview-controls-inline">
        {visibleKeys.map((key) => renderControl(key, false))}
      </div>

      {hasOverflow && (
        <div className="squisq-preview-controls-compact" ref={popoverRef}>
          <button
            className={`squisq-toolbar-button${popoverOpen ? ' squisq-toolbar-button--active' : ''}`}
            onClick={() => setPopoverOpen((v) => !v)}
            aria-label="More preview settings"
            title="More preview settings"
            aria-expanded={popoverOpen}
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
              <circle cx="8" cy="8" r="2.5" />
              <path d="M13.5 8a5.5 5.5 0 01-.4 1.8l1.2 1.2-1.6 1.6-1.2-1.2A5.5 5.5 0 018 13.5a5.5 5.5 0 01-3.5-1.3L3.3 13.4 1.7 11.8l1.2-1.2A5.5 5.5 0 012.5 8c0-.6.1-1.2.4-1.8L1.7 5 3.3 3.4l1.2 1.2A5.5 5.5 0 018 2.5c1.3 0 2.5.5 3.5 1.3l1.2-1.2 1.6 1.6-1.2 1.2c.3.6.4 1.2.4 1.6z" />
            </svg>
          </button>
          {popoverOpen && (
            <div className="squisq-preview-controls-popover">
              {overflowKeys.map((key) => renderControl(key, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Segmented display-mode switch (Video / Slideshow / Document / Page) rendered
 * as four connected buttons on the left of the Play toolbar — the prominent,
 * one-click counterpart to the old "Mode:" dropdown. Reads and writes the same
 * `activeDisplayMode` in preview settings.
 */
export function PreviewModeSwitch() {
  const s = usePreviewSettings();
  return (
    <div className="squisq-preview-seg" role="group" aria-label="Display mode">
      {DISPLAY_MODE_OPTIONS.map((opt) => {
        const active = s.activeDisplayMode === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            className={`squisq-preview-seg-btn${active ? ' squisq-preview-seg-btn--active' : ''}`}
            aria-pressed={active}
            onClick={() => s.setSelectedDisplayMode(opt.key)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A simple aspect-ratio glyph: a centered rounded rectangle of `w`×`h` in a
 *  16×16 box, so 16:9 reads as a wide box, 1:1 a square, 9:16 a tall box. */
function AspectIcon({ w, h }: { w: number; h: number }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x={(16 - w) / 2} y={(16 - h) / 2} width={w} height={h} rx="1.5" />
    </svg>
  );
}

/**
 * Segmented aspect-ratio switch (16:9 / 1:1 / 9:16 / 4:3) rendered as connected
 * icon buttons on the left of the Play toolbar, next to the mode switch — the
 * one-click counterpart to the old "Format:" dropdown. Reads and writes the
 * same `activePreset` in preview settings.
 */
export function PreviewFormatSwitch() {
  const s = usePreviewSettings();
  return (
    <div className="squisq-preview-seg" role="group" aria-label="Aspect ratio">
      {FORMAT_SWITCH_OPTIONS.map((opt) => {
        const active = s.activePreset === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            className={`squisq-preview-seg-btn squisq-preview-seg-btn--icon${active ? ' squisq-preview-seg-btn--active' : ''}`}
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => s.setSelectedPreset(opt.key)}
          >
            <AspectIcon w={opt.w} h={opt.h} />
          </button>
        );
      })}
    </div>
  );
}

function PreviewSelect({
  label,
  value,
  options,
  onChange,
  compact,
}: {
  label: string;
  value: string;
  options: { key: string; label: string }[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`squisq-preview-control${compact ? ' squisq-preview-control--compact' : ''}`}>
      <label style={labelStyle}>{label}:</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
