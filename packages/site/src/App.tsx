/**
 * Dev Site App
 *
 * Provides a sample document picker, the EditorShell, and a DebugPanel
 * for inspecting the parsed MarkdownDocument and Doc.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorShell, ThemeCustomizerPanel } from '@bendyline/squisq-editor-react';
import type { EditorColorScheme, WriteCanvasSettings } from '@bendyline/squisq-editor-react';
import '@bendyline/squisq-editor-react/styles';
import { MediaContext } from '@bendyline/squisq-react';
import {
  createMediaProviderFromContainer,
  MemoryContentContainer,
} from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { SAMPLES, SAMPLE_LABELS, CONTENT_SAMPLES } from './samples';
import { DebugPanel } from './DebugPanel';
import { FileToolbar } from './FileToolbar';
import { StorageToolbar } from './StorageToolbar';
import { JsonEditorDemo } from './JsonEditorDemo';
import { ImageEditorDemo } from './ImageEditorDemo';
import { CodeContextDemo } from './CodeContextDemo';
import { createSlotMediaProvider } from './slotStorage';
import type { MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { parseTheme } from '@bendyline/squisq/schemas';

const CUSTOM_THEME_STORAGE_KEY = 'squisq-site:customTheme';
const COLOR_MODE_STORAGE_KEY = 'squisq-site:colorMode';
const WRITE_CANVAS_STORAGE_KEY = 'squisq-site:writeCanvasSettings';
const DEFAULT_SAMPLE_KEY = 'about-squisq';
const SAMPLE_KEYS = [
  DEFAULT_SAMPLE_KEY,
  ...Object.keys(SAMPLES).filter((key) => key !== DEFAULT_SAMPLE_KEY),
];

type DemoColorMode = 'auto' | EditorColorScheme;
type DemoWriteCanvasSettings = Required<WriteCanvasSettings>;

const DEFAULT_WRITE_CANVAS_SETTINGS: DemoWriteCanvasSettings = {
  textSize: 16,
  lineSpacing: 1.7,
};

const WRITE_TEXT_SIZE_OPTIONS = [12, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32] as const;
const WRITE_LINE_SPACING_OPTIONS = [1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 2, 2.2, 2.4] as const;

const COLOR_MODE_OPTIONS: ReadonlyArray<{ label: string; value: DemoColorMode }> = [
  { label: 'Auto', value: 'auto' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

function isDemoColorMode(value: string | null): value is DemoColorMode {
  return value === 'auto' || value === 'light' || value === 'dark';
}

function resolveSystemColorScheme(): EditorColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialColorMode(): DemoColorMode {
  if (typeof window === 'undefined') return 'auto';

  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get('colorMode') ?? params.get('colorScheme');
  if (isDemoColorMode(requestedMode)) return requestedMode;

  try {
    const storedMode = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (isDemoColorMode(storedMode)) return storedMode;
  } catch {
    // Ignore unavailable storage; the in-memory selection still works.
  }

  return 'auto';
}

function getInitialWriteCanvasSettings(): DemoWriteCanvasSettings {
  if (typeof window === 'undefined') return DEFAULT_WRITE_CANVAS_SETTINGS;
  try {
    const stored = window.localStorage.getItem(WRITE_CANVAS_STORAGE_KEY);
    if (!stored) return DEFAULT_WRITE_CANVAS_SETTINGS;
    const parsed = JSON.parse(stored) as Partial<WriteCanvasSettings>;
    return {
      textSize: isNumberInRange(parsed.textSize, 10, 32)
        ? parsed.textSize
        : DEFAULT_WRITE_CANVAS_SETTINGS.textSize,
      lineSpacing: isNumberInRange(parsed.lineSpacing, 1, 3)
        ? parsed.lineSpacing
        : DEFAULT_WRITE_CANVAS_SETTINGS.lineSpacing,
    };
  } catch {
    return DEFAULT_WRITE_CANVAS_SETTINGS;
  }
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Resolve the initial sample from a `?sample=<key>` URL param when one
 * is present and points at an inline `SAMPLES` entry. Used by the E2E
 * suite to load a tiny single-block fixture for the video export test
 * without having to drive the sample picker. Anything outside the
 * inline map (content zip samples, garbage values) falls back to the
 * default, since this path is sync — content zips need their own
 * fetch/unpack pipeline that runs from `handleSampleChange`.
 */
function getInitialSampleKey(): string {
  if (typeof window === 'undefined') return DEFAULT_SAMPLE_KEY;
  const param = new URLSearchParams(window.location.search).get('sample');
  if (param && Object.prototype.hasOwnProperty.call(SAMPLES, param)) return param;
  return DEFAULT_SAMPLE_KEY;
}

/** Load a previously-saved custom theme from localStorage. Returns null on miss / parse failure. */
function loadStoredCustomTheme(): Theme | null {
  if (typeof localStorage === 'undefined') return null;
  const json = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
  if (!json) return null;
  try {
    return parseTheme(json);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Discarding stored custom theme — failed validation:', msg);
    localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
    return null;
  }
}

export function App() {
  const initialSampleKey = getInitialSampleKey();
  const [selectedSample, setSelectedSample] = useState(initialSampleKey);
  const [showDebug, setShowDebug] = useState(false);
  const [showJsonDemo, setShowJsonDemo] = useState(false);
  const [showImageEditorDemo, setShowImageEditorDemo] = useState(false);
  const [showCodeContextDemo, setShowCodeContextDemo] = useState(false);
  const [findMode, setFindMode] = useState(false);
  const [currentSource, setCurrentSource] = useState(SAMPLES[initialSampleKey]);
  const [colorMode, setColorMode] = useState<DemoColorMode>(() => getInitialColorMode());
  const [writeCanvasSettings, setWriteCanvasSettings] = useState<DemoWriteCanvasSettings>(() =>
    getInitialWriteCanvasSettings(),
  );
  const [systemColorScheme, setSystemColorScheme] = useState<EditorColorScheme>(() =>
    resolveSystemColorScheme(),
  );
  const colorScheme: EditorColorScheme = colorMode === 'auto' ? systemColorScheme : colorMode;
  const [customTheme, setCustomThemeState] = useState<Theme | null>(() => loadStoredCustomTheme());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setSystemColorScheme(mediaQuery.matches ? 'dark' : 'light');
    };

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode);
    } catch {
      // Ignore unavailable storage; the current React state is authoritative.
    }
  }, [colorMode]);
  useEffect(() => {
    try {
      window.localStorage.setItem(WRITE_CANVAS_STORAGE_KEY, JSON.stringify(writeCanvasSettings));
    } catch {
      // Ignore unavailable storage; the in-memory selection still works.
    }
  }, [writeCanvasSettings]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = colorScheme;
    document.documentElement.dataset.squisqDemoColorScheme = colorScheme;
    return () => {
      document.documentElement.style.removeProperty('color-scheme');
      delete document.documentElement.dataset.squisqDemoColorScheme;
    };
  }, [colorScheme]);
  const handleCustomThemeChange = useCallback((next: Theme) => {
    setCustomThemeState(next);
  }, []);
  const handleCustomThemeSave = useCallback((next: Theme, json: string) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, json);
    }
    setCustomThemeState(next);
  }, []);
  const handleCustomThemeReset = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
    }
    setCustomThemeState(null);
  }, []);
  // Key to force EditorShell remount on upload
  const [editorKey, setEditorKey] = useState(0);
  // Storage slot state
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  /** Create a fresh empty MediaProvider (for samples with no bundled media). */
  const createEmptyProvider = useCallback(
    () => createMediaProviderFromContainer(new MemoryContentContainer()),
    [],
  );

  const [mediaProvider, setMediaProvider] = useState<MediaProvider | null>(() =>
    createEmptyProvider(),
  );
  const mediaProviderRef = useRef<MediaProvider | null>(mediaProvider);
  // The active workspace-scoped ContentContainer (when the user loaded
  // a zip sample or uploaded a zip). Surfaced to FileToolbar so the
  // export dialog can offer the recursive "Export linked documents"
  // toggle. Null when the editor is running off a slot or a standalone
  // markdown source.
  const [workspaceContainer, setWorkspaceContainer] = useState<ContentContainer | null>(null);
  // Loading state for content zip samples
  const [loadingContent, setLoadingContent] = useState(false);

  /** Replace the active MediaProvider, disposing the previous one. */
  const replaceMediaProvider = useCallback((provider: MediaProvider | null) => {
    if (mediaProviderRef.current) {
      mediaProviderRef.current.dispose();
    }
    mediaProviderRef.current = provider;
    setMediaProvider(provider);
  }, []);

  // Create/dispose MediaProvider when active slot changes. A slot is
  // backed by IndexedDB media storage, not a markdown container, so we
  // also clear any container that may have been left over from a prior
  // zip-sample load.
  useEffect(() => {
    if (activeSlot !== null) {
      replaceMediaProvider(createSlotMediaProvider(activeSlot));
      setWorkspaceContainer(null);
    } else {
      replaceMediaProvider(createEmptyProvider());
    }

    return () => {
      if (mediaProviderRef.current) {
        mediaProviderRef.current.dispose();
        mediaProviderRef.current = null;
      }
    };
  }, [activeSlot, replaceMediaProvider, createEmptyProvider]);

  const isDark = colorScheme === 'dark';

  const handleSampleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const key = e.target.value;
      setSelectedSample(key);

      // Content zip sample — fetch, unzip, extract markdown + media
      const contentSample = CONTENT_SAMPLES[key];
      if (contentSample) {
        setLoadingContent(true);
        setActiveSlot(null);
        fetch(contentSample.url)
          .then((res) => {
            if (!res.ok) throw new Error(`Failed to fetch ${contentSample.url}: ${res.status}`);
            return res.arrayBuffer();
          })
          .then(async (buf) => {
            const { zipToContainer } = await import('@bendyline/squisq-formats/container');
            return zipToContainer(buf);
          })
          .then(async (loaded) => {
            const markdown = (await loaded.readDocument()) ?? '';
            setCurrentSource(markdown);
            replaceMediaProvider(createMediaProviderFromContainer(loaded));
            setWorkspaceContainer(loaded);
            setEditorKey((k) => k + 1);
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Failed to load content sample:', msg);
            setCurrentSource(`# Error\n\nCould not load sample: ${msg}`);
            replaceMediaProvider(createEmptyProvider());
            setEditorKey((k) => k + 1);
          })
          .finally(() => setLoadingContent(false));
        return;
      }

      // Inline markdown sample
      setCurrentSource(SAMPLES[key] || '');
      replaceMediaProvider(createEmptyProvider());
      setWorkspaceContainer(null);
      setActiveSlot(null);
    },
    [replaceMediaProvider, createEmptyProvider],
  );

  const handleChange = useCallback((source: string) => {
    setCurrentSource(source);
  }, []);

  const handleImport = useCallback((markdown: string) => {
    setCurrentSource(markdown);
    setSelectedSample(''); // deselect sample dropdown
    // A bare markdown import has no associated container — drop any
    // container that was previously active so the export dialog stops
    // offering "Export linked documents" (which can't work without one).
    setWorkspaceContainer(null);
    setEditorKey((k) => k + 1); // remount editor with new content
  }, []);

  const handleZipImport = useCallback(
    (markdown: string, imported: ContentContainer) => {
      setCurrentSource(markdown);
      setSelectedSample('');
      setActiveSlot(null);
      replaceMediaProvider(createMediaProviderFromContainer(imported));
      setWorkspaceContainer(imported);
      setEditorKey((k) => k + 1);
    },
    [replaceMediaProvider],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: isDark ? '#0f172a' : '#fff',
        color: isDark ? '#e5e7eb' : '#1f2937',
        transition: 'background 0.2s, color 0.2s',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '8px 16px',
          gap: '8px 16px',
          borderBottom: '1px solid #e5e7eb',
          background: '#F3EBD6',
          flexShrink: 0,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        <a
          href="https://github.com/bendyline/squisq/blob/main/docs/SquigglySquare.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="/res/squisq.jpg"
            alt="Squisq"
            style={{ height: 28, position: 'relative', top: 3 }}
          />
        </a>

        <label
          style={{
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#4a3c1f',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Sample:
          <select
            value={selectedSample}
            onChange={handleSampleChange}
            disabled={loadingContent}
            style={{
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              padding: '4px 8px',
              background: '#FFFDF7',
              color: '#4a3c1f',
              border: '1px solid #c9b98a',
              borderRadius: 0,
              opacity: loadingContent ? 0.6 : 1,
            }}
          >
            {SAMPLE_KEYS.map((key) => (
              <option key={key} value={key}>
                {SAMPLE_LABELS[key] ?? key.replace(/-/g, ' ')}
              </option>
            ))}
            <option disabled>{'\u2500'.repeat(16)}</option>
            {Object.entries(CONTENT_SAMPLES).map(([key, sample]) => (
              <option key={key} value={key}>
                {sample.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => setShowDebug((prev) => !prev)}
          style={{
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '4px 12px',
            cursor: 'pointer',
            background: showDebug ? '#8B6914' : '#E8DFC6',
            color: showDebug ? '#fff' : '#4a3c1f',
            border: `1px solid ${showDebug ? '#7a5c10' : '#c9b98a'}`,
            borderRadius: 0,
          }}
        >
          {showDebug ? 'Hide' : 'Show'} Debug
        </button>

        <button
          type="button"
          data-testid="toggle-find-mode"
          aria-pressed={findMode}
          onClick={() => setFindMode((active) => !active)}
          style={{
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '4px 12px',
            cursor: 'pointer',
            background: findMode ? '#8B6914' : '#E8DFC6',
            color: findMode ? '#fff' : '#4a3c1f',
            border: `1px solid ${findMode ? '#7a5c10' : '#c9b98a'}`,
            borderRadius: 0,
          }}
        >
          Find
        </button>

        <button
          onClick={() => setShowJsonDemo((prev) => !prev)}
          style={{
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '4px 12px',
            cursor: 'pointer',
            background: showJsonDemo ? '#8B6914' : '#E8DFC6',
            color: showJsonDemo ? '#fff' : '#4a3c1f',
            border: `1px solid ${showJsonDemo ? '#7a5c10' : '#c9b98a'}`,
            borderRadius: 0,
          }}
        >
          {showJsonDemo ? 'Close JSON Editor' : 'JSON Editor'}
        </button>

        <button
          onClick={() => setShowImageEditorDemo((prev) => !prev)}
          style={{
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '4px 12px',
            cursor: 'pointer',
            background: showImageEditorDemo ? '#8B6914' : '#E8DFC6',
            color: showImageEditorDemo ? '#fff' : '#4a3c1f',
            border: `1px solid ${showImageEditorDemo ? '#7a5c10' : '#c9b98a'}`,
            borderRadius: 0,
          }}
        >
          {showImageEditorDemo ? 'Close Image Editor' : 'Image Editor'}
        </button>

        <button
          onClick={() => setShowCodeContextDemo((prev) => !prev)}
          data-testid="toggle-code-context"
          style={{
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '4px 12px',
            cursor: 'pointer',
            background: showCodeContextDemo ? '#8B6914' : '#E8DFC6',
            color: showCodeContextDemo ? '#fff' : '#4a3c1f',
            border: `1px solid ${showCodeContextDemo ? '#7a5c10' : '#c9b98a'}`,
            borderRadius: 0,
          }}
        >
          {showCodeContextDemo ? 'Close Code Context' : 'Code Context'}
        </button>

        <div
          role="group"
          aria-label="Demo color mode"
          title={
            colorMode === 'auto'
              ? `Demo color mode: auto (${systemColorScheme})`
              : `Demo color mode: ${colorMode}`
          }
          style={{
            display: 'flex',
            alignItems: 'stretch',
            border: '1px solid #c9b98a',
            background: '#FFFDF7',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {COLOR_MODE_OPTIONS.map((option, index) => {
            const active = colorMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setColorMode(option.value)}
                style={{
                  fontSize: 12,
                  fontFamily: 'inherit',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  background: active ? '#8B6914' : 'transparent',
                  color: active ? '#fff' : '#4a3c1f',
                  border: 'none',
                  borderRight:
                    index === COLOR_MODE_OPTIONS.length - 1 ? 'none' : '1px solid #c9b98a',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {/* Demo-level controls for the host-facing Write canvas settings. */}
        <div
          role="group"
          aria-label="Write canvas settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '3px 7px',
            border: '1px solid #c9b98a',
            background: '#FFFDF7',
            color: '#4a3c1f',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 12,
          }}
        >
          <span style={{ fontWeight: 600 }}>Write</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Text
            <select
              aria-label="Write text size"
              value={writeCanvasSettings.textSize}
              onChange={(event) =>
                setWriteCanvasSettings((current) => ({
                  ...current,
                  textSize: Number(event.target.value),
                }))
              }
              style={{
                border: '1px solid #c9b98a',
                background: '#fff',
                color: '#4a3c1f',
                font: 'inherit',
              }}
            >
              {WRITE_TEXT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Spacing
            <select
              aria-label="Write line spacing"
              value={writeCanvasSettings.lineSpacing}
              onChange={(event) =>
                setWriteCanvasSettings((current) => ({
                  ...current,
                  lineSpacing: Number(event.target.value),
                }))
              }
              style={{
                border: '1px solid #c9b98a',
                background: '#fff',
                color: '#4a3c1f',
                font: 'inherit',
              }}
            >
              {WRITE_LINE_SPACING_OPTIONS.map((spacing) => (
                <option key={spacing} value={spacing}>
                  {spacing}×
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Theme customizer — wrapped in editor-shell to inherit BEM dark-theme styles. */}
        <div
          className="squisq-editor-shell"
          data-theme={colorScheme}
          style={{ position: 'relative' }}
        >
          <ThemeCustomizerPanel
            value={customTheme}
            onChange={handleCustomThemeChange}
            onSave={handleCustomThemeSave}
            onReset={handleCustomThemeReset}
            triggerLabel="Theme..."
          />
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        <FileToolbar
          currentSource={currentSource}
          onImport={handleImport}
          onZipImport={handleZipImport}
          mediaProvider={mediaProvider}
          workspaceContainer={workspaceContainer}
          isDark={isDark}
          activeSlot={activeSlot}
        />

        <StorageToolbar
          currentSource={currentSource}
          onLoad={handleImport}
          isDark={isDark}
          activeSlot={activeSlot}
          onSlotChange={setActiveSlot}
        />

        <a
          href="https://github.com/bendyline/squisq/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#4a3c1f',
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
          }}
        >
          Terms of Use
        </a>
        <a
          href="https://github.com/bendyline/squisq/blob/main/NOTICE.md"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#4a3c1f',
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
          }}
        >
          Built on open source
        </a>
      </div>

      {/* Main area */}
      {showCodeContextDemo ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CodeContextDemo />
        </div>
      ) : showImageEditorDemo ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ImageEditorDemo colorScheme={colorScheme} />
        </div>
      ) : showJsonDemo ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <JsonEditorDemo colorScheme={colorScheme} />
        </div>
      ) : (
        <MediaContext.Provider value={mediaProvider}>
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <EditorShell
                key={`${selectedSample}-${editorKey}`}
                initialMarkdown={currentSource}
                articleId={selectedSample || 'uploaded'}
                onChange={handleChange}
                colorScheme={colorScheme}
                height="100%"
                mediaProvider={mediaProvider}
                themeOverride={customTheme}
                writeCanvasSettings={writeCanvasSettings}
                findMode={findMode}
                onFindModeChange={setFindMode}
              />
            </div>

            {showDebug && (
              <div
                style={{
                  width: 420,
                  borderLeft: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  overflow: 'auto',
                  flexShrink: 0,
                }}
              >
                <DebugPanel source={currentSource} theme={colorScheme} />
              </div>
            )}
          </div>
        </MediaContext.Provider>
      )}
    </div>
  );
}
