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

import { createContext, useContext, useState, useMemo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DisplayMode, CaptionStyle } from '@bendyline/squisq-react';
import type { ViewportPreset, ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS, getThemeSummaries, resolveTheme } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import type { Doc } from '@bendyline/squisq/schemas';

// ── Context ──────────────────────────────────────────────────────

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
  activeCaptionStyle: CaptionStyle;
  setSelectedCaptionStyle: (style: CaptionStyle | null) => void;
}

const PreviewSettingsContext = createContext<PreviewSettings | null>(null);

export function usePreviewSettings(): PreviewSettings {
  const ctx = useContext(PreviewSettingsContext);
  if (!ctx) throw new Error('usePreviewSettings must be used within PreviewSettingsProvider');
  return ctx;
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
  if (v === 'video' || v === 'slideshow' || v === 'linear') return v;
  if (v === 'slides' || v === 'presentation' || v === 'deck') return 'slideshow';
  if (v === 'document' || v === 'scroll' || v === 'page') return 'linear';
  return null;
}

const VALID_THEME_IDS = new Set(getThemeSummaries().map((s) => s.id));

function resolveFrontmatterTheme(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (VALID_THEME_IDS.has(v)) return v;
  const normalized = v.replace(/\s+/g, '-');
  if (VALID_THEME_IDS.has(normalized)) return normalized;
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

function resolveFrontmatterCaptionStyle(value: unknown): CaptionStyle | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'standard' || v === 'social') return v;
  if (v === 'instagram' || v === 'tiktok' || v === 'reels') return 'social';
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

export function PreviewSettingsProvider({ doc, children, themeOverride }: PreviewSettingsProviderProps) {
  const frontmatter = doc?.frontmatter;

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

  // Theme
  const fmTheme = useMemo(() => resolveFrontmatterTheme(frontmatter?.['theme']), [frontmatter]);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  useEffect(() => setSelectedThemeId(null), [fmTheme]);
  const resolvedThemeId = selectedThemeId ?? fmTheme ?? 'standard';
  const resolvedTheme = useMemo(() => resolveTheme(resolvedThemeId), [resolvedThemeId]);
  // themeOverride wins over both dropdown selection and frontmatter
  const activeThemeId = themeOverride?.id ?? resolvedThemeId;
  const activeTheme = themeOverride ?? resolvedTheme;

  // Transform
  const fmTransform = useMemo(
    () => resolveFrontmatterTransform(frontmatter?.['transform-style']),
    [frontmatter],
  );
  const [selectedTransformStyle, setSelectedTransformStyle] = useState<string | null>(null);
  useEffect(() => setSelectedTransformStyle(null), [fmTransform]);
  const activeTransformStyle = selectedTransformStyle ?? fmTransform ?? '';

  // Caption style
  const fmCaption = useMemo(
    () => resolveFrontmatterCaptionStyle(frontmatter?.['caption-style']),
    [frontmatter],
  );
  const [selectedCaptionStyle, setSelectedCaptionStyle] = useState<CaptionStyle | null>(null);
  useEffect(() => setSelectedCaptionStyle(null), [fmCaption]);
  const activeCaptionStyle = selectedCaptionStyle ?? fmCaption ?? 'standard';

  const value = useMemo<PreviewSettings>(
    () => ({
      activePreset,
      setSelectedPreset,
      activeViewport,
      activeDisplayMode,
      setSelectedDisplayMode,
      activeThemeId,
      setSelectedThemeId,
      activeTheme,
      activeTransformStyle,
      setSelectedTransformStyle,
      activeCaptionStyle,
      setSelectedCaptionStyle,
    }),
    [
      activePreset,
      activeViewport,
      activeDisplayMode,
      activeThemeId,
      activeTheme,
      activeTransformStyle,
      activeCaptionStyle,
    ],
  );

  return (
    <PreviewSettingsContext.Provider value={value}>{children}</PreviewSettingsContext.Provider>
  );
}

// ── Dropdown options ─────────────────────────────────────────────

const VIEWPORT_OPTIONS: { key: ViewportPreset; label: string }[] = [
  { key: 'landscape', label: '16:9' },
  { key: 'portrait', label: '9:16' },
  { key: 'square', label: '1:1' },
  { key: 'standard', label: '4:3' },
];

const DISPLAY_MODE_OPTIONS: { key: DisplayMode; label: string }[] = [
  { key: 'video', label: 'Video' },
  { key: 'slideshow', label: 'Slideshow' },
  { key: 'linear', label: 'Document' },
];

const THEME_OPTIONS = getThemeSummaries().map((s) => ({ key: s.id, label: s.name }));

const TRANSFORM_STYLE_OPTIONS = [
  { key: '', label: 'None' },
  ...getTransformStyleSummaries().map((s) => ({ key: s.id, label: s.name })),
];

const CAPTION_STYLE_OPTIONS: { key: CaptionStyle; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'social', label: 'Social' },
];

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

/** Hook to track whether the viewport is narrow. */
function useIsNarrow(breakpoint = 600): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return narrow;
}

/**
 * Inline preview controls rendered in the main toolbar row.
 * On narrow viewports, collapses into a single settings button with a dropdown.
 */
export function PreviewToolbarControls() {
  const s = usePreviewSettings();
  const isNarrow = useIsNarrow(768);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  const controls = (
    <>
      <PreviewSelect
        label="Format"
        value={s.activePreset}
        options={VIEWPORT_OPTIONS}
        onChange={(v) => s.setSelectedPreset(v as ViewportPreset)}
        compact={isNarrow}
      />
      <PreviewSelect
        label="Mode"
        value={s.activeDisplayMode}
        options={DISPLAY_MODE_OPTIONS}
        onChange={(v) => s.setSelectedDisplayMode(v as DisplayMode)}
        compact={isNarrow}
      />
      <PreviewSelect
        label="Theme"
        value={s.activeThemeId}
        options={THEME_OPTIONS}
        onChange={(v) => s.setSelectedThemeId(v)}
        compact={isNarrow}
      />
      <PreviewSelect
        label="Transform"
        value={s.activeTransformStyle}
        options={TRANSFORM_STYLE_OPTIONS}
        onChange={(v) => s.setSelectedTransformStyle(v)}
        compact={isNarrow}
      />
      <PreviewSelect
        label="Captions"
        value={s.activeCaptionStyle}
        options={CAPTION_STYLE_OPTIONS}
        onChange={(v) => s.setSelectedCaptionStyle(v as CaptionStyle)}
        compact={isNarrow}
      />
    </>
  );

  if (isNarrow) {
    return (
      <div className="squisq-preview-controls-compact" ref={popoverRef}>
        <button
          className="squisq-toolbar-button"
          onClick={() => setPopoverOpen((v) => !v)}
          aria-label="Preview settings"
          title="Preview settings"
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
        {popoverOpen && <div className="squisq-preview-controls-popover">{controls}</div>}
      </div>
    );
  }

  return <div className="squisq-preview-controls-inline">{controls}</div>;
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
