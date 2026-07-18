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
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DisplayMode, CaptionStyle } from '@bendyline/squisq-react';
import type { ViewportPreset, ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS, getThemeSummaries } from '@bendyline/squisq/schemas';
import type { CustomTemplateDefinition, Theme } from '@bendyline/squisq/schemas';
import { ThemePicker } from './ThemePicker';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import type { Doc } from '@bendyline/squisq/schemas';
import {
  parseMarkdown,
  readFrontmatterThemeId,
  setFrontmatterValues,
} from '@bendyline/squisq/markdown';
import {
  resolveThemeForDoc,
  readCustomThemesFromFrontmatter,
  readCustomTemplatesFromFrontmatter,
  writeCustomThemesToFrontmatter,
  writeCustomTemplatesToFrontmatter,
  FRONTMATTER_CUSTOM_THEMES_KEY,
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
} from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';
import {
  useCustomThemes,
  CustomThemeDialog,
  type ThemeSaveTarget,
  type ThemeSaveExtras,
} from './customThemes';
import { Icon } from './Icon';
import { resolvePersistedTransformStyleId } from './transformStyleId';
import {
  FRONTMATTER_SETTING_DEFAULTS,
  FRONTMATTER_SETTING_KEYS,
  omitFrontmatterDefault,
} from './frontmatterSettings';

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
  /** Whether Squisq should synthesize and show its managed cover slide. */
  activeCoverSlide: boolean;
  /** Enable/disable the managed cover slide. */
  setCoverSlideEnabled: (enabled: boolean) => void;
  /** User-authored themes (doc + browser library) for the picker's "Custom" group. */
  customThemes: Theme[];
  /** Open the custom-theme designer for a theme (or null to create a new one). */
  openThemeDesigner: (theme: Theme | null) => void;
  /** Remove a custom theme from the doc and the library. */
  deleteCustomTheme: (id: string) => void;
  /** Config for the docked theme designer, or null when closed. Rendered by
   *  `<ThemeDesignerDock>` in the editor's content row. */
  themeDesigner: ThemeDesignerConfig | null;
  /**
   * Set when a theme write was ABORTED because the document source could not
   * be read. The write is skipped rather than merged onto an empty list (which
   * would erase the doc's other custom themes/templates), so this must be
   * shown — otherwise the save looks like a silent no-op.
   */
  themeSaveError: string | null;
}

/** Everything `<ThemeDesignerDock>` needs to render the designer pane. */
export interface ThemeDesignerConfig {
  value: Theme | null;
  onChange: (theme: Theme) => void;
  onSave: (theme: Theme, target: ThemeSaveTarget, extras?: ThemeSaveExtras) => void;
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
  if (v === 'video' || v === 'slideshow' || v === 'linear' || v === 'narrate') return v;
  if (v === 'slides' || v === 'presentation' || v === 'deck') return 'slideshow';
  if (v === 'teleprompter' || v === 'prompter') return 'narrate';
  // Frontmatter uses product-facing names: Document is the plain text/HTML
  // preview, Page is the styled Squisq page view. The raw DisplayMode values
  // are older and remain stable for the public React API.
  if (v === 'page' || v === 'paged') return 'linear';
  if (v === 'document' || v === 'scroll' || v === 'html' || v === 'plain' || v === 'reader') {
    return 'page';
  }
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

function resolveFrontmatterCaptionMode(value: unknown): CaptionMode | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'off' || v === 'none' || v === 'hidden' || v === 'false' || v === 'no') return 'off';
  if (v === 'standard' || v === 'cc' || v === 'captions') return 'standard';
  if (v === 'social' || v === 'instagram' || v === 'tiktok' || v === 'reels') return 'social';
  return null;
}

function resolveFrontmatterBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'on' || v === 'show' || v === 'visible') return true;
  if (v === 'false' || v === 'no' || v === 'off' || v === 'hide' || v === 'hidden') return false;
  return null;
}

// ── Provider ─────────────────────────────────────────────────────

export interface PreviewSettingsProviderProps {
  doc: Doc | null;
  children: ReactNode;
  /**
   * Viewport preset to use when the document does not declare
   * `document-render-as` and the user has not selected a format. Hosts can
   * make this responsive to their available surface. Defaults to landscape.
   */
  defaultViewportPreset?: ViewportPreset;
  /**
   * Optional Theme to use for the preview, regardless of `Doc.themeId` or
   * the user's theme dropdown selection. Used by the theme customizer to
   * preview an in-progress theme without mutating the document. When
   * present, `activeTheme` is this value and `activeThemeId` is its `id`.
   */
  themeOverride?: Theme | null;
}

function readFrontmatterKey(
  fm: Record<string, unknown> | undefined,
  canonical: string,
  legacy: string,
): unknown {
  if (!fm) return undefined;
  return Object.prototype.hasOwnProperty.call(fm, canonical) ? fm[canonical] : fm[legacy];
}

/** The doc's persisted custom themes + templates, read from live markdown. */
interface DocCustoms {
  themes: Theme[];
  templates: CustomTemplateDefinition[];
}

/**
 * Read the document's custom themes + templates from the AUTHORITATIVE
 * markdown source.
 *
 * Any write that REPLACES the whole `squisq-custom-themes` /
 * `squisq-custom-templates` frontmatter key must merge onto what is in the
 * source right now — never onto the parsed `Doc`. `Doc` is 150ms debounced
 * and is set to `null` whenever the source fails to parse, so merging onto
 * it drops every theme/template authored since the last successful parse
 * (or, when `doc === null`, ALL of them). Reading the same source we are
 * about to rewrite closes that window.
 *
 * Returns `null` when the source cannot be read at all (parse failure, size
 * limits) — callers MUST abort rather than fall back to an empty list, which
 * would erase the keys they are merging into.
 */
function readDocCustomsFromSource(source: string): DocCustoms | null {
  try {
    const frontmatter = parseMarkdown(source).frontmatter;
    return {
      themes: readCustomThemesFromFrontmatter(frontmatter) ?? [],
      templates: readCustomTemplatesFromFrontmatter(frontmatter) ?? [],
    };
  } catch (err: unknown) {
    console.error(
      '[squisq-editor] could not read the document source to merge custom themes:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

const THEME_WRITE_ABORTED =
  'Could not read the document, so the theme was not saved (saving would have erased the document’s other custom themes). Fix the document, then try again.';

export function PreviewSettingsProvider({
  doc,
  children,
  defaultViewportPreset = 'landscape',
  themeOverride,
}: PreviewSettingsProviderProps) {
  const frontmatter = doc?.frontmatter;
  const { markdownSource, setMarkdownSource, allowNarrate } = useEditorContext();

  const persistFrontmatter = useCallback(
    (updates: Record<string, string | number | boolean | null | undefined>) => {
      const next = setFrontmatterValues(markdownSource, updates);
      if (next !== markdownSource) {
        setMarkdownSource(next);
      }
    },
    [markdownSource, setMarkdownSource],
  );

  // Display mode. A frontmatter-forced `narrate` clamps back to video when
  // the host disabled the mode, so hostile frontmatter can't turn it on.
  const fmMode = useMemo(() => resolveDisplayMode(frontmatter?.['display-mode']), [frontmatter]);
  const [selectedDisplayMode, setSelectedDisplayMode] = useState<DisplayMode | null>(null);
  useEffect(() => setSelectedDisplayMode(null), [fmMode]);
  const requestedDisplayMode = selectedDisplayMode ?? fmMode ?? 'slideshow';
  const activeDisplayMode =
    requestedDisplayMode === 'narrate' && !allowNarrate ? 'video' : requestedDisplayMode;

  // Viewport. The host default is deliberately limited to the fixed-canvas
  // slideshow/video modes; Page and Document keep their historical landscape
  // fallback unless the document or user explicitly chooses another format.
  const fmPreset = useMemo(
    () => resolveRenderAs(frontmatter?.['document-render-as']),
    [frontmatter],
  );
  const [selectedPreset, setSelectedPreset] = useState<ViewportPreset | null>(null);
  useEffect(() => setSelectedPreset(null), [fmPreset]);
  const playbackDefaultPreset =
    activeDisplayMode === 'slideshow' || activeDisplayMode === 'video'
      ? defaultViewportPreset
      : 'landscape';
  const activePreset = selectedPreset ?? fmPreset ?? playbackDefaultPreset;
  const activeViewport = VIEWPORT_PRESETS[activePreset];

  // Custom themes (doc + browser library). `useCustomThemes` returns null when
  // no provider is mounted; document-scoped themes still remain available.
  const custom = useCustomThemes();
  const docThemes = useMemo(
    () => custom?.docThemes ?? doc?.customThemes ?? [],
    [custom, doc?.customThemes],
  );
  const customThemes = useMemo(() => custom?.allThemes ?? docThemes, [custom, docThemes]);
  const customIds = useMemo(() => new Set(customThemes.map((t) => t.id)), [customThemes]);

  // Theme — persisted to `squisq-theme`; `themeId` / `theme` remain readable.
  const fmTheme = useMemo(
    () => resolveFrontmatterTheme(readFrontmatterThemeId(frontmatter), customIds),
    [frontmatter, customIds],
  );
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  useEffect(() => setSelectedThemeId(null), [fmTheme]);
  const resolvedThemeId = selectedThemeId ?? fmTheme ?? FRONTMATTER_SETTING_DEFAULTS.theme;
  // Doc themes precede browser-library themes in `allThemes`; choosing a
  // library-only entry copies it into the document below for portable export.
  const resolvedTheme = useMemo(
    () =>
      customThemes.find((theme) => theme.id === resolvedThemeId) ??
      resolveThemeForDoc(doc, resolvedThemeId),
    [customThemes, doc, resolvedThemeId],
  );

  // In-progress theme from the designer dialog; previews live without mutating
  // the doc until the user saves.
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);
  const [themeSaveError, setThemeSaveError] = useState<string | null>(null);
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
      if (id === null) {
        setSelectedThemeId(null);
        return;
      }
      const selectedCustom = customThemes.find((theme) => theme.id === id);
      const updates: Record<string, string | null> = {
        [FRONTMATTER_SETTING_KEYS.theme.canonical]: omitFrontmatterDefault(
          id,
          FRONTMATTER_SETTING_DEFAULTS.theme,
        ),
        [FRONTMATTER_SETTING_KEYS.theme.legacy[0]]: null,
        [FRONTMATTER_SETTING_KEYS.theme.legacy[1]]: null,
      };
      // A built-in selection only writes the id — nothing to merge, so it can
      // never clobber the custom-themes key. Copying a library theme into the
      // doc rewrites that key wholesale, so it must merge onto the live source.
      if (selectedCustom) {
        const existing = readDocCustomsFromSource(markdownSource);
        if (!existing) {
          setThemeSaveError(THEME_WRITE_ABORTED);
          return;
        }
        if (!existing.themes.some((theme) => theme.id === id)) {
          updates[FRONTMATTER_CUSTOM_THEMES_KEY] =
            writeCustomThemesToFrontmatter([...existing.themes, selectedCustom]) ?? null;
        }
      }
      setThemeSaveError(null);
      setSelectedThemeId(id);
      persistFrontmatter(updates);
    },
    [customThemes, markdownSource, persistFrontmatter],
  );

  const openThemeDesigner = useCallback((theme: Theme | null) => {
    setDesigner({ open: true, editing: theme });
    setPreviewTheme(theme);
    setThemeSaveError(null);
  }, []);
  const closeThemeDesigner = useCallback(() => {
    setDesigner({ open: false, editing: null });
    setPreviewTheme(null);
    setThemeSaveError(null);
  }, []);
  const handleDesignerSave = useCallback(
    (theme: Theme, target: ThemeSaveTarget, extras?: ThemeSaveExtras) => {
      if (target === 'library') {
        // Imported slide layouts are doc-scoped in v1; the dialog hints at this.
        custom?.upsertLibraryTheme(theme);
      } else {
        // Write the theme payload, its selection, AND any imported layout
        // templates in a SINGLE frontmatter update. Separate
        // `setMarkdownSource` calls would each derive from the same stale
        // source, so later writes would clobber earlier ones.
        //
        // Both keys are REPLACED wholesale, so the lists we merge into must
        // come from the live source: the parsed `doc` lags the source by the
        // parse debounce and is null outright while the source doesn't parse,
        // either of which would silently erase the other themes/templates.
        const existing = readDocCustomsFromSource(markdownSource);
        if (!existing) {
          // Abort with the designer still open: the user's draft survives and
          // nothing destructive reaches the document.
          setThemeSaveError(THEME_WRITE_ABORTED);
          return;
        }
        const idx = existing.themes.findIndex((t) => t.id === theme.id);
        const nextThemes =
          idx >= 0
            ? existing.themes.map((t, i) => (i === idx ? theme : t))
            : [...existing.themes, theme];
        const updates: Record<string, string | null> = {
          [FRONTMATTER_CUSTOM_THEMES_KEY]: writeCustomThemesToFrontmatter(nextThemes) ?? null,
          [FRONTMATTER_SETTING_KEYS.theme.canonical]: theme.id,
        };
        if (extras?.templates && extras.templates.length > 0) {
          const merged = [
            ...existing.templates.filter((t) => !extras.templates!.some((n) => n.name === t.name)),
            ...extras.templates,
          ];
          updates[FRONTMATTER_CUSTOM_TEMPLATES_KEY] =
            writeCustomTemplatesToFrontmatter(merged) ?? null;
        }
        setThemeSaveError(null);
        persistFrontmatter(updates);
        setSelectedThemeId(theme.id);
      }
      closeThemeDesigner();
    },
    [custom, markdownSource, persistFrontmatter, closeThemeDesigner],
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
      resolvePersistedTransformStyleId(
        readFrontmatterKey(
          frontmatter,
          FRONTMATTER_SETTING_KEYS.transform.canonical,
          FRONTMATTER_SETTING_KEYS.transform.legacy,
        ),
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
        persistFrontmatter({
          [FRONTMATTER_SETTING_KEYS.transform.canonical]: omitFrontmatterDefault(
            id,
            FRONTMATTER_SETTING_DEFAULTS.transform,
          ),
          [FRONTMATTER_SETTING_KEYS.transform.legacy]: null,
        });
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
        readFrontmatterKey(
          frontmatter,
          FRONTMATTER_SETTING_KEYS.captions.canonical,
          FRONTMATTER_SETTING_KEYS.captions.legacy,
        ),
      ),
    [frontmatter],
  );
  const [selectedCaptionMode, setSelectedCaptionMode] = useState<CaptionMode | null>(null);
  useEffect(() => setSelectedCaptionMode(null), [fmCaptionMode]);
  const activeCaptionMode =
    selectedCaptionMode ?? fmCaptionMode ?? FRONTMATTER_SETTING_DEFAULTS.captions;
  const activeCaptionsEnabled = activeCaptionMode !== 'off';
  const activeCaptionStyle: CaptionStyle = activeCaptionMode === 'social' ? 'social' : 'standard';
  const handleSetCaptionMode = useCallback(
    (mode: CaptionMode) => {
      setSelectedCaptionMode(mode);
      persistFrontmatter({
        [FRONTMATTER_SETTING_KEYS.captions.canonical]: omitFrontmatterDefault(
          mode,
          FRONTMATTER_SETTING_DEFAULTS.captions,
        ),
        [FRONTMATTER_SETTING_KEYS.captions.legacy]: null,
      });
    },
    [persistFrontmatter],
  );

  // Managed cover slide — generated from the document startBlock. Defaults on
  // for existing documents; authors can persist an explicit off switch.
  const fmCoverSlide = useMemo(
    () =>
      resolveFrontmatterBoolean(
        readFrontmatterKey(
          frontmatter,
          FRONTMATTER_SETTING_KEYS.coverSlide.canonical,
          FRONTMATTER_SETTING_KEYS.coverSlide.legacy,
        ),
      ),
    [frontmatter],
  );
  const [selectedCoverSlide, setSelectedCoverSlide] = useState<boolean | null>(null);
  useEffect(() => setSelectedCoverSlide(null), [fmCoverSlide]);
  const activeCoverSlide =
    selectedCoverSlide ?? fmCoverSlide ?? FRONTMATTER_SETTING_DEFAULTS.coverSlide;
  const handleSetCoverSlideEnabled = useCallback(
    (enabled: boolean) => {
      setSelectedCoverSlide(enabled);
      persistFrontmatter({
        // The cover is enabled by default, so only persist the non-default
        // state. Pass the boolean through so YAML writes `false`, not
        // the string `"false"`.
        [FRONTMATTER_SETTING_KEYS.coverSlide.canonical]: omitFrontmatterDefault(
          enabled,
          FRONTMATTER_SETTING_DEFAULTS.coverSlide,
        ),
        [FRONTMATTER_SETTING_KEYS.coverSlide.legacy]: null,
      });
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
      activeCoverSlide,
      setCoverSlideEnabled: handleSetCoverSlideEnabled,
      customThemes,
      openThemeDesigner,
      deleteCustomTheme,
      themeDesigner,
      themeSaveError,
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
      activeCoverSlide,
      handleSetThemeId,
      handleSetTransformStyle,
      handleSetCaptionMode,
      handleSetCoverSlideEnabled,
      customThemes,
      openThemeDesigner,
      deleteCustomTheme,
      themeDesigner,
      themeSaveError,
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
  const { themeDesigner, themeSaveError } = usePreviewSettings();
  if (!themeDesigner) return null;
  return (
    <>
      {/* An aborted save keeps the designer open with the draft intact; the
          banner explains why nothing was written. */}
      {themeSaveError && (
        <div className="squisq-theme-save-error" role="alert" style={themeSaveErrorStyle}>
          {themeSaveError}
        </div>
      )}
      <CustomThemeDialog
        value={themeDesigner.value}
        onChange={themeDesigner.onChange}
        onSave={themeDesigner.onSave}
        onClose={themeDesigner.onClose}
      />
    </>
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

const DISPLAY_MODE_OPTIONS: {
  key: DisplayMode;
  label: string;
  icon: string;
  summary: string;
}[] = [
  {
    key: 'slideshow',
    label: 'Slideshow',
    icon: 'fa-solid fa-images',
    summary: 'Present designed slides one at a time.',
  },
  {
    key: 'video',
    label: 'Video',
    icon: 'fa-solid fa-circle-play',
    summary: 'Play an automatically timed presentation.',
  },
  {
    key: 'linear',
    label: 'Page',
    icon: 'fa-solid fa-window-maximize',
    summary: 'Scroll through the fully designed page.',
  },
  {
    key: 'page',
    label: 'Document',
    icon: 'fa-solid fa-align-left',
    summary: 'Read a clean, text-first document.',
  },
  {
    key: 'narrate',
    label: 'Narrate',
    icon: 'fa-solid fa-microphone-lines',
    summary: 'Speak with a voice-paced teleprompter.',
  },
];

export function displayModeLabel(mode: DisplayMode): string {
  return DISPLAY_MODE_OPTIONS.find((option) => option.key === mode)?.label ?? 'Slideshow';
}

const TRANSFORM_STYLE_OPTIONS = [
  { key: '', label: 'None' },
  ...getTransformStyleSummaries().map((s) => ({ key: s.id, label: s.name })),
];

const SUMMARIZE_TOOLTIP =
  'Extract and summarize content for presentation with these Use modes. Your underlying content is not changed.';

/**
 * Left-to-right priority order for the preview controls. As the toolbar
 * narrows, controls drop into the overflow menu from the END of this list
 * first (Cover, then Captions, …). Aspect ratio stays inline the longest, but
 * still collapses into the same menu when the toolbar is very constrained.
 */
type ControlKey = 'format' | 'theme' | 'transform' | 'captions' | 'cover';
const CONTROL_KEYS: ControlKey[] = ['format', 'theme', 'transform', 'captions', 'cover'];

/**
 * Controls that apply to the active display mode. Page (`linear`) is a
 * variable-height HTML rendition: the aspect-ratio format switch only
 * affects embedded canvas sections (which default sensibly) and captions
 * never applied, so both are hidden there. Cover, Theme, and Summarize
 * remain live in every mode.
 */
function controlKeysForMode(displayMode: string): ControlKey[] {
  if (displayMode === 'linear') {
    return CONTROL_KEYS.filter((key) => key !== 'format' && key !== 'captions');
  }
  return CONTROL_KEYS;
}

const PREVIEW_POPOVER_GAP = 4;
const PREVIEW_POPOVER_MARGIN = 8;
const PREVIEW_POPOVER_FALLBACK_WIDTH = 220;

function clampPreviewPopoverLeft(
  triggerRect: DOMRect,
  popoverWidth: number,
  viewportWidth: number,
): number {
  const maxLeft = Math.max(
    PREVIEW_POPOVER_MARGIN,
    viewportWidth - popoverWidth - PREVIEW_POPOVER_MARGIN,
  );
  return Math.min(Math.max(PREVIEW_POPOVER_MARGIN, triggerRect.right - popoverWidth), maxLeft);
}

// ── Shared styles ────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  color: 'var(--squisq-text-muted, #6b7280)',
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

const themeSaveErrorStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--squisq-danger-border, #d88a8a)',
  background: 'var(--squisq-danger-bg, #fceeee)',
  color: 'var(--squisq-danger-text, #8c2a2a)',
  fontSize: '12px',
  maxWidth: '320px',
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
 * {@link CONTROL_KEYS} — into a single ellipsis button's popover. As
 * the toolbar widens or narrows, controls migrate one at a time between the
 * inline row and the menu, so the available space is always well used and the
 * row never wraps onto a second line.
 */
export function PreviewToolbarControls() {
  const s = usePreviewSettings();
  const controlKeys = controlKeysForMode(s.activeDisplayMode);
  const [visibleCount, setVisibleCount] = useState(CONTROL_KEYS.length);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // `rootRef` (flex:1) always spans the toolbar's leftover width, so its
  // clientWidth is the budget the controls have to lay out in.
  const rootRef = useRef<HTMLDivElement>(null);
  // Hidden probe rendering every control at natural width; the split between
  // inline and overflow is computed from these per-control measurements.
  const probeRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverTriggerRef = useRef<HTMLButtonElement>(null);
  const popoverPanelRef = useRef<HTMLDivElement>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ top: number; left: number } | null>(null);

  const updatePopoverPosition = useCallback(() => {
    const trigger = popoverTriggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const measuredWidth =
      popoverPanelRef.current?.getBoundingClientRect().width ?? PREVIEW_POPOVER_FALLBACK_WIDTH;
    const popoverWidth = Math.min(measuredWidth, window.innerWidth - PREVIEW_POPOVER_MARGIN * 2);
    setPopoverAnchor({
      top: triggerRect.bottom + PREVIEW_POPOVER_GAP,
      left: clampPreviewPopoverLeft(triggerRect, popoverWidth, window.innerWidth),
    });
  }, []);

  const closePopover = useCallback(() => {
    setPopoverOpen(false);
    setPopoverAnchor(null);
  }, []);

  // Fit detection: keep as many controls inline as fit, overflow the rest.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const probe = probeRef.current;
    if (!root || !probe) return;
    const GAP = 6; // matches the row's flex `gap`
    const LEAD_PAD = 9; // root's left padding, eaten before any control
    const OVERFLOW_TRIGGER_RESERVE = 40; // width kept for the ellipsis button (+ its gap)
    const SAFETY = 2;
    const measure = () => {
      const available = root.clientWidth - LEAD_PAD;
      const widths = Array.from(probe.children).map(
        (el) => (el as HTMLElement).getBoundingClientRect().width,
      );
      // Width of the first `n` controls laid out inline (n-1 inter-control gaps).
      const rowWidth = (n: number) =>
        widths.slice(0, n).reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, n - 1);
      // Everything fits → no overflow button needed.
      if (rowWidth(widths.length) <= available) {
        setVisibleCount(widths.length);
        return;
      }
      // Otherwise reserve room for the ellipsis and fit as many as possible.
      const budget = available - OVERFLOW_TRIGGER_RESERVE - GAP - SAFETY;
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
  }, [controlKeys.length]);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (popoverPanelRef.current?.contains(target)) return;
      closePopover();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closePopover, popoverOpen]);

  useLayoutEffect(() => {
    if (!popoverOpen) return;
    updatePopoverPosition();
  }, [popoverOpen, updatePopoverPosition, visibleCount]);

  useEffect(() => {
    if (!popoverOpen) return;
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [popoverOpen, updatePopoverPosition]);

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
      case 'format':
        return (
          <div
            key="format"
            className={`squisq-preview-control squisq-preview-control--seg${compact ? ' squisq-preview-control--compact' : ''}`}
          >
            {compact && <label style={labelStyle}>Format:</label>}
            <PreviewFormatSwitch />
          </div>
        );
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
            {/* Copying a library theme into the doc can abort (unreadable
                source). Surface it here — the designer isn't open on this path. */}
            {s.themeSaveError && (
              <span
                className="squisq-theme-save-error"
                role="alert"
                title={s.themeSaveError}
                style={{ color: 'var(--squisq-danger-text, #8c2a2a)', fontSize: '12px' }}
              >
                ⚠ Theme not saved
              </span>
            )}
          </div>
        );
      case 'transform':
        return (
          <PreviewSelect
            key="transform"
            label="Summarize"
            labelTooltip={SUMMARIZE_TOOLTIP}
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
      case 'cover':
        return (
          <div
            key="cover"
            className={`squisq-preview-control${compact ? ' squisq-preview-control--compact' : ''}`}
          >
            <label className="squisq-preview-checkbox">
              <input
                type="checkbox"
                checked={s.activeCoverSlide}
                onChange={(e) => s.setCoverSlideEnabled(e.target.checked)}
              />
              <span>Cover slide</span>
            </label>
          </div>
        );
    }
  };

  const hasOverflow = visibleCount < controlKeys.length;
  const visibleKeys = controlKeys.slice(0, visibleCount);
  const overflowKeys = controlKeys.slice(visibleCount);

  useEffect(() => {
    if (!hasOverflow && popoverOpen) closePopover();
  }, [closePopover, hasOverflow, popoverOpen]);

  // The root is a flex:1 filler so it always spans the toolbar's leftover
  // width (which is what the fit measurement reads).
  return (
    <div
      className="squisq-preview-controls"
      data-has-overflow={hasOverflow ? 'true' : undefined}
      ref={rootRef}
    >
      {/* Hidden probe — every control at natural width, measured to decide the
          inline/overflow split. Absolutely positioned so it never affects
          layout. */}
      <div className="squisq-preview-controls-probe" ref={probeRef} aria-hidden="true">
        {controlKeys.map((key) => renderControl(key, false))}
      </div>

      {visibleKeys.length > 0 && (
        <div className="squisq-preview-controls-inline">
          {visibleKeys.map((key) => renderControl(key, false))}
        </div>
      )}

      {hasOverflow && (
        <div className="squisq-preview-controls-compact" ref={popoverRef}>
          <button
            ref={popoverTriggerRef}
            className={`squisq-toolbar-button${popoverOpen ? ' squisq-toolbar-button--active' : ''}`}
            onClick={() => {
              if (popoverOpen) {
                closePopover();
                return;
              }
              updatePopoverPosition();
              setPopoverOpen(true);
            }}
            aria-label="More preview settings"
            title="More preview settings"
            aria-expanded={popoverOpen}
          >
            <Icon icon="fa-solid fa-ellipsis" />
          </button>
          {popoverOpen && popoverAnchor && (
            <div
              ref={popoverPanelRef}
              className="squisq-preview-controls-popover"
              style={{ top: popoverAnchor.top, left: popoverAnchor.left }}
            >
              {overflowKeys.map((key) => renderControl(key, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Segmented display-mode switch retained as a public, embeddable control.
 * The editor shell uses {@link PreviewModeMenu} beside its Use tab instead.
 * Narrate is hidden when the host disables `allowNarrate`.
 */
export function PreviewModeSwitch() {
  const s = usePreviewSettings();
  const { allowNarrate } = useEditorContext();
  const options = DISPLAY_MODE_OPTIONS.filter((opt) => opt.key !== 'narrate' || allowNarrate);
  return (
    <div className="squisq-preview-seg" role="group" aria-label="Display mode">
      {options.map((opt) => {
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

const USE_MODE_MENU_WIDTH = 340;
const USE_MODE_MENU_GAP = 4;
const USE_MODE_MENU_MARGIN = 8;

/**
 * Dropdown trigger rendered directly beside the Use tab. Selecting a mode
 * also enters the Use view, so the menu works from Write and Source as well
 * as from an already-active preview.
 */
export interface PreviewModeMenuProps {
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
}

export function PreviewModeMenu({ openRequest = 0 }: PreviewModeMenuProps) {
  const s = usePreviewSettings();
  const { allowNarrate, colorScheme, setActiveView } = useEditorContext();
  const options = DISPLAY_MODE_OPTIONS.filter((opt) => opt.key !== 'narrate' || allowNarrate);
  const activeLabel = displayModeLabel(s.activeDisplayMode);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemIdPrefix = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(USE_MODE_MENU_WIDTH, window.innerWidth - USE_MODE_MENU_MARGIN * 2);
    const maxLeft = Math.max(
      USE_MODE_MENU_MARGIN,
      window.innerWidth - menuWidth - USE_MODE_MENU_MARGIN,
    );
    setAnchor({
      top: rect.bottom + USE_MODE_MENU_GAP,
      left: Math.min(Math.max(USE_MODE_MENU_MARGIN, rect.right - menuWidth), maxLeft),
    });
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  useEffect(() => {
    if (openRequest > 0) openMenu();
  }, [openMenu, openRequest]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [closeMenu, open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    (selected ?? first)?.focus();
  }, [anchor, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-use-mode-trigger${open ? ' squisq-use-mode-trigger--open' : ''}`}
        aria-label="Choose Use mode"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Use mode: ${activeLabel}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          openMenu();
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="squisq-use-mode-menu"
            data-theme={colorScheme}
            role="menu"
            aria-label="Use mode"
            style={{ top: anchor.top, left: anchor.left }}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
              );
              if (items.length === 0) return;
              const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowUp'
                      ? (currentIndex - 1 + items.length) % items.length
                      : (currentIndex + 1) % items.length;
              items[nextIndex]?.focus();
            }}
          >
            {options.map((option) => {
              const selected = option.key === s.activeDisplayMode;
              const labelId = `${itemIdPrefix}-${option.key}-label`;
              const summaryId = `${itemIdPrefix}-${option.key}-summary`;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`squisq-use-mode-menu-item${selected ? ' squisq-use-mode-menu-item--selected' : ''}`}
                  role="menuitemradio"
                  aria-checked={selected}
                  aria-labelledby={labelId}
                  aria-describedby={summaryId}
                  onClick={() => {
                    s.setSelectedDisplayMode(option.key);
                    setActiveView('preview');
                    closeMenu(true);
                  }}
                >
                  <span className="squisq-use-mode-menu-icon" aria-hidden="true">
                    <Icon icon={option.icon} />
                  </span>
                  <span className="squisq-use-mode-menu-copy">
                    <span id={labelId} className="squisq-use-mode-menu-label">
                      {option.label}
                    </span>
                    <span id={summaryId} className="squisq-use-mode-menu-summary">
                      {option.summary}
                    </span>
                  </span>
                  <span className="squisq-use-mode-menu-check" aria-hidden="true">
                    {selected && <Icon icon="fa-solid fa-check" />}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
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
 * Segmented aspect-ratio switch (16:9 / 1:1 / 9:16 / 4:3), used inline in the
 * Use toolbar and inside its overflow popover. Reads and writes the same
 * `activePreset` in preview settings.
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
  labelTooltip,
  value,
  options,
  onChange,
  compact,
}: {
  label: string;
  labelTooltip?: string;
  value: string;
  options: { key: string; label: string }[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`squisq-preview-control${compact ? ' squisq-preview-control--compact' : ''}`}>
      <label style={labelStyle} title={labelTooltip}>
        {label}:
      </label>
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
