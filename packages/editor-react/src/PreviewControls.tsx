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

import { createContext, useContext, useState, useMemo, useEffect } from 'react';
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
}

export function PreviewSettingsProvider({ doc, children }: PreviewSettingsProviderProps) {
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
  const activeThemeId = selectedThemeId ?? fmTheme ?? 'standard';
  const activeTheme = useMemo(() => resolveTheme(activeThemeId), [activeThemeId]);

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

/**
 * Inline preview controls rendered in the main toolbar row.
 * Reads from PreviewSettingsContext.
 */
export function PreviewToolbarControls() {
  const s = usePreviewSettings();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        padding: '2px 0 2px 9px',
      }}
    >
      <label style={labelStyle}>Format:</label>
      <select
        value={s.activePreset}
        onChange={(e) => s.setSelectedPreset(e.target.value as ViewportPreset)}
        style={selectStyle}
      >
        {VIEWPORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>

      <Divider />

      <label style={labelStyle}>Mode:</label>
      <select
        value={s.activeDisplayMode}
        onChange={(e) => s.setSelectedDisplayMode(e.target.value as DisplayMode)}
        style={selectStyle}
      >
        {DISPLAY_MODE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>

      <Divider />

      <label style={labelStyle}>Theme:</label>
      <select
        value={s.activeThemeId}
        onChange={(e) => s.setSelectedThemeId(e.target.value)}
        style={selectStyle}
      >
        {THEME_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>

      <Divider />

      <label style={labelStyle}>Transform:</label>
      <select
        value={s.activeTransformStyle}
        onChange={(e) => s.setSelectedTransformStyle(e.target.value)}
        style={selectStyle}
      >
        {TRANSFORM_STYLE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>

      <Divider />

      <label style={labelStyle}>Captions:</label>
      <select
        value={s.activeCaptionStyle}
        onChange={(e) => s.setSelectedCaptionStyle(e.target.value as CaptionStyle)}
        style={selectStyle}
      >
        {CAPTION_STYLE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Divider() {
  return (
    <span
      style={{
        width: '1px',
        height: '16px',
        background: 'var(--squisq-border, #d1d5db)',
        margin: '0 2px',
      }}
    />
  );
}
