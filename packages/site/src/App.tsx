/**
 * Dev Site App
 *
 * Provides a sample document picker, the EditorShell, and a DebugPanel
 * for inspecting the parsed MarkdownDocument and Doc.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorShell } from '@bendyline/prodcore-editor-react';
import type { EditorTheme } from '@bendyline/prodcore-editor-react';
import '@bendyline/prodcore-editor-react/styles';
import { MediaContext } from '@bendyline/prodcore-react';
import { SAMPLES } from './samples';
import { DebugPanel } from './DebugPanel';
import { FileToolbar } from './FileToolbar';
import { StorageToolbar } from './StorageToolbar';
import { createSlotMediaProvider } from './slotStorage';
import type { MediaProvider } from '@bendyline/prodcore/schemas';

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
    setSelectedSample('');          // deselect sample dropdown
    setEditorKey((k) => k + 1);    // remount editor with new content
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
          borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
          background: isDark ? '#1e293b' : '#f3f4f6',
          flexShrink: 0,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        <strong style={{ fontSize: 14 }}>Prodcore Editor</strong>

        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Sample:
          <select
            value={selectedSample}
            onChange={handleSampleChange}
            style={{
              fontSize: 13,
              padding: '2px 8px',
              background: isDark ? '#374151' : '#fff',
              color: isDark ? '#e5e7eb' : '#1f2937',
              border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
              borderRadius: 4,
            }}
          >
            {Object.keys(SAMPLES).map((key) => (
              <option key={key} value={key}>
                {key.replace(/-/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Theme:
          <select
            value={theme}
            onChange={handleThemeChange}
            style={{
              fontSize: 13,
              padding: '2px 8px',
              background: isDark ? '#374151' : '#fff',
              color: isDark ? '#e5e7eb' : '#1f2937',
              border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
              borderRadius: 4,
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
            padding: '2px 10px',
            cursor: 'pointer',
            background: showDebug
              ? (isDark ? '#2563eb' : '#2563eb')
              : (isDark ? '#374151' : '#e5e7eb'),
            color: showDebug
              ? '#fff'
              : (isDark ? '#d1d5db' : '#374151'),
            border: 'none',
            borderRadius: 4,
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
