/**
 * DebugPanel
 *
 * Shows the parsed MarkdownDocument and generated Doc as formatted JSON.
 * Useful for inspecting the internal data structures during development.
 */

import { useState, useMemo } from 'react';
import { parseMarkdown } from '@bendyline/prodcore/markdown';
import { markdownToDoc } from '@bendyline/prodcore/doc';

type Tab = 'markdown' | 'doc';

export interface DebugPanelProps {
  /** Current markdown source */
  source: string;
  /** Light or dark theme */
  theme?: 'light' | 'dark';
}

export function DebugPanel({ source, theme = 'light' }: DebugPanelProps) {
  const [tab, setTab] = useState<Tab>('markdown');
  const isDark = theme === 'dark';

  const { markdownDoc, doc, error } = useMemo(() => {
    try {
      const markdownDoc = parseMarkdown(source);
      let doc = null;
      try {
        doc = markdownToDoc(markdownDoc, { articleId: 'debug' });
      } catch {
        // Doc generation may fail
      }
      return { markdownDoc, doc, error: null };
    } catch (err: any) {
      return { markdownDoc: null, doc: null, error: err.message };
    }
  }, [source]);

  const jsonContent = useMemo(() => {
    if (error) return `Parse error:\n${error}`;
    const data = tab === 'markdown' ? markdownDoc : doc;
    if (!data) return 'No data';
    return JSON.stringify(data, null, 2);
  }, [tab, markdownDoc, doc, error]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
          background: isDark ? '#1e293b' : '#f9fafb',
          flexShrink: 0,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        {(['markdown', 'doc'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 16px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#3b82f6' : (isDark ? '#9ca3af' : '#6b7280'),
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
            }}
          >
            {t === 'markdown' ? 'MarkdownDocument' : 'Doc'}
          </button>
        ))}
      </div>

      {/* JSON viewer */}
      <pre
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          fontSize: 11,
          lineHeight: 1.4,
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          background: isDark ? '#0f172a' : '#1e293b',
          color: '#e2e8f0',
          margin: 0,
          transition: 'background 0.2s',
        }}
      >
        {jsonContent}
      </pre>
    </div>
  );
}
