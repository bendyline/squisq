/**
 * Dev Site App
 *
 * Provides a sample document picker, the EditorShell, and a DebugPanel
 * for inspecting the parsed MarkdownDocument and Doc.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorShell } from '@bendyline/squisq-editor-react';
import type { EditorTheme } from '@bendyline/squisq-editor-react';
import '@bendyline/squisq-editor-react/styles';
import { MediaContext } from '@bendyline/squisq-react';
import { SAMPLES } from './samples';
import { DebugPanel } from './DebugPanel';
import { FileToolbar } from './FileToolbar';
import { StorageToolbar } from './StorageToolbar';
import { createSlotMediaProvider } from './slotStorage';
import type { MediaProvider } from '@bendyline/squisq/schemas';

export function App() {
  const [selectedSample, setSelectedSample] = useState('hello-world');
  const [showDebug, setShowDebug] = useState(false);
  const [currentSource, setCurrentSource] = useState(SAMPLES['hello-world']);
  const [theme, setTheme] = useState<EditorTheme>('light');
  // Key to force EditorShell remount on upload
  const [editorKey, setEditorKey] = useState(0);
  // Storage slot state
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [mediaProvider, setMediaProvider] = useState<MediaProvider | null>(null);
  const mediaProviderRef = useRef<MediaProvider | null>(null);

  // Create/dispose MediaProvider when active slot changes
  useEffect(() => {
    // Dispose previous provider
    if (mediaProviderRef.current) {
      mediaProviderRef.current.dispose();
      mediaProviderRef.current = null;
    }

    if (activeSlot !== null) {
      const provider = createSlotMediaProvider(activeSlot);
      mediaProviderRef.current = provider;
      setMediaProvider(provider);
    } else {
      setMediaProvider(null);
    }

    return () => {
      if (mediaProviderRef.current) {
        mediaProviderRef.current.dispose();
        mediaProviderRef.current = null;
      }
    };
  }, [activeSlot]);

  const isDark = theme === 'dark';

  const handleSampleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    setSelectedSample(key);
    setCurrentSource(SAMPLES[key] || '');
  }, []);

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
          href="https://github.com/bendyline/squisq/blob/main/docs/SquiggleSquare.md"
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
            {Object.keys(SAMPLES).map((key) => (
              <option key={key} value={key}>
                {key.replace(/-/g, ' ')}
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        <FileToolbar
          currentSource={currentSource}
          onImport={handleImport}
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
