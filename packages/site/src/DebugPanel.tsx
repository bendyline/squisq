/**
 * DebugPanel
 *
 * Shows the parsed MarkdownDocument, generated Doc, and optionally
 * a transformed Doc as formatted JSON. Includes its own transform
 * style selector for inspecting transform output.
 */

import { useState, useMemo } from 'react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  applyTransform,
  getTransformStyleSummaries,
} from '@bendyline/squisq/transform';

type Tab = 'markdown' | 'doc' | 'transformed';

const TRANSFORM_OPTIONS = [
  { key: '', label: '-- none --' },
  ...getTransformStyleSummaries().map((s) => ({ key: s.id, label: s.name })),
];

export interface DebugPanelProps {
  /** Current markdown source */
  source: string;
  /** Light or dark theme */
  theme?: 'light' | 'dark';
}

export function DebugPanel({ source, theme = 'light' }: DebugPanelProps) {
  const [tab, setTab] = useState<Tab>('markdown');
  const [transformStyleId, setTransformStyleId] = useState('');
  const isDark = theme === 'dark';

  const { markdownDoc, doc, transformedDoc, error } = useMemo(() => {
    try {
      const markdownDoc = parseMarkdown(source);
      let doc = null;
      let transformedDoc = null;
      try {
        doc = markdownToDoc(markdownDoc, { articleId: 'debug' });
        if (doc && transformStyleId) {
          const result = applyTransform(doc, transformStyleId);
          transformedDoc = result.doc;
        }
      } catch {
        // Doc generation may fail
      }
      return { markdownDoc, doc, transformedDoc, error: null };
    } catch (err: unknown) {
      return {
        markdownDoc: null,
        doc: null,
        transformedDoc: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [source, transformStyleId]);

  const jsonContent = useMemo(() => {
    if (error) return `Parse error:\n${error}`;
    const data = tab === 'markdown' ? markdownDoc : tab === 'transformed' ? transformedDoc : doc;
    if (!data) return tab === 'transformed' ? 'Select a transform style above' : 'No data';
    return JSON.stringify(data, null, 2);
  }, [tab, markdownDoc, doc, transformedDoc, error]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
          background: isDark ? '#1e293b' : '#f9fafb',
          flexShrink: 0,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        {(['markdown', 'doc', 'transformed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#3b82f6' : isDark ? '#9ca3af' : '#6b7280',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
            }}
          >
            {t === 'markdown' ? 'MarkdownDocument' : t === 'transformed' ? 'Transformed' : 'Doc'}
          </button>
        ))}
      </div>

      {/* Transform style selector (shown on Transformed tab) */}
      {tab === 'transformed' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderBottom: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
            background: isDark ? '#1e293b' : '#f3f4f6',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <label
            htmlFor="debug-transform"
            style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
          >
            Style:
          </label>
          <select
            id="debug-transform"
            value={transformStyleId}
            onChange={(e) => setTransformStyleId(e.target.value)}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
              background: isDark ? '#0f172a' : '#fff',
              color: isDark ? '#e2e8f0' : '#1f2937',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {TRANSFORM_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

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
