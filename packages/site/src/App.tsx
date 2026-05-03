/**
 * Dev Site App
 *
 * Provides a sample document picker, the EditorShell, and a DebugPanel
 * for inspecting the parsed MarkdownDocument and Doc.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorShell, ThemeCustomizerPanel } from '@bendyline/squisq-editor-react';
import type { EditorTheme } from '@bendyline/squisq-editor-react';
import '@bendyline/squisq-editor-react/styles';
import { MediaContext } from '@bendyline/squisq-react';
import {
  createMediaProviderFromContainer,
  MemoryContentContainer,
} from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { zipToContainer } from '@bendyline/squisq-formats/container';
import { SAMPLES, CONTENT_SAMPLES } from './samples';
import { DebugPanel } from './DebugPanel';
import { FileToolbar } from './FileToolbar';
import { StorageToolbar } from './StorageToolbar';
import { createSlotMediaProvider } from './slotStorage';
import type { MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { parseTheme, registerTheme, unregisterTheme } from '@bendyline/squisq/schemas';

const CUSTOM_THEME_STORAGE_KEY = 'squisq-site:customTheme';

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
  const [selectedSample, setSelectedSample] = useState('hello-world');
  const [showDebug, setShowDebug] = useState(false);
  const [currentSource, setCurrentSource] = useState(SAMPLES['hello-world']);
  const [theme, setTheme] = useState<EditorTheme>('light');
  const [customTheme, setCustomThemeState] = useState<Theme | null>(() => loadStoredCustomTheme());
  // Re-register the loaded theme on mount so `Doc.themeId` lookups resolve to it.
  // Subsequent edits go through handleCustomThemeChange which also registers.
  useEffect(() => {
    if (customTheme) registerTheme(customTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleCustomThemeChange = useCallback((next: Theme) => {
    registerTheme(next);
    setCustomThemeState(next);
  }, []);
  const handleCustomThemeSave = useCallback((next: Theme, json: string) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, json);
    }
    registerTheme(next);
    setCustomThemeState(next);
  }, []);
  const handleCustomThemeReset = useCallback(() => {
    if (customTheme) unregisterTheme(customTheme.id);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
    }
    setCustomThemeState(null);
  }, [customTheme]);
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

  // Create/dispose MediaProvider when active slot changes
  useEffect(() => {
    if (activeSlot !== null) {
      replaceMediaProvider(createSlotMediaProvider(activeSlot));
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

  const isDark = theme === 'dark';

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
          .then((buf) => zipToContainer(buf))
          .then(async (container) => {
            const markdown = (await container.readDocument()) ?? '';
            setCurrentSource(markdown);
            replaceMediaProvider(createMediaProviderFromContainer(container));
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
      setActiveSlot(null);
    },
    [replaceMediaProvider, createEmptyProvider],
  );

  const handleThemeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(e.target.value as EditorTheme);
  }, []);

  const handleChange = useCallback((source: string) => {
    setCurrentSource(source);
  }, []);

  const handleImport = useCallback((markdown: string) => {
    setCurrentSource(markdown);
    setSelectedSample(''); // deselect sample dropdown
    setEditorKey((k) => k + 1); // remount editor with new content
  }, []);

  const handleZipImport = useCallback(
    (markdown: string, container: ContentContainer) => {
      setCurrentSource(markdown);
      setSelectedSample('');
      setActiveSlot(null);
      replaceMediaProvider(createMediaProviderFromContainer(container));
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
            {Object.keys(SAMPLES).map((key) => (
              <option key={key} value={key}>
                {key.replace(/-/g, ' ')}
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
          Theme:
          <select
            value={theme}
            onChange={handleThemeChange}
            style={{
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              padding: '4px 8px',
              background: '#FFFDF7',
              color: '#4a3c1f',
              border: '1px solid #c9b98a',
              borderRadius: 0,
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
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

        {/* Theme customizer — wrapped in editor-shell to inherit BEM dark-theme styles. */}
        <div className="squisq-editor-shell" data-theme={theme} style={{ position: 'relative' }}>
          <ThemeCustomizerPanel
            value={customTheme}
            onChange={handleCustomThemeChange}
            onSave={handleCustomThemeSave}
            onReset={handleCustomThemeReset}
          />
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        <FileToolbar
          currentSource={currentSource}
          onImport={handleImport}
          onZipImport={handleZipImport}
          mediaProvider={mediaProvider}
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
      </div>

      {/* Main area */}
      <MediaContext.Provider value={mediaProvider}>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <EditorShell
              key={`${selectedSample}-${editorKey}`}
              initialMarkdown={currentSource}
              articleId={selectedSample || 'uploaded'}
              onChange={handleChange}
              theme={theme}
              height="100%"
              mediaProvider={mediaProvider}
              inlinePreview
              themeOverride={customTheme}
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
              <DebugPanel source={currentSource} theme={theme} />
            </div>
          )}
        </div>
      </MediaContext.Provider>
    </div>
  );
}
