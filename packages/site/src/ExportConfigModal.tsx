/**
 * ExportConfigModal — Modal for configuring theme, transform, and format
 * before exporting a document.
 *
 * Inline styles match the cream/gold palette from VideoExportModal / FileToolbar.
 */

import { useState, useCallback } from 'react';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, docToMarkdown } from '@bendyline/squisq/doc';
import { getThemeSummaries } from '@bendyline/squisq/schemas';
import {
  getTransformStyleSummaries,
  applyTransform,
  extractDocImages,
} from '@bendyline/squisq/transform';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';

// ── Types ──────────────────────────────────────────────────────────

export interface ExportConfigModalProps {
  currentSource: string;
  mediaProvider: MediaProvider | null;
  onClose: () => void;
}

type ExportFormat = 'docx' | 'pptx' | 'pdf' | 'html' | 'zip';

// ── Styles ─────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  background: '#FFFDF7',
  border: '1px solid #c9b98a',
  borderRadius: 0,
  padding: '24px 28px',
  minWidth: 380,
  maxWidth: 480,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#4a3c1f',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
  color: '#2d2310',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
  color: '#5a4a2a',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: '1px solid #c9b98a',
  borderRadius: 0,
  background: '#fff',
  color: '#4a3c1f',
  marginBottom: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  background: '#8B6914',
  color: '#fff',
  border: '1px solid #7a5c10',
  borderRadius: 0,
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  background: '#E8DFC6',
  color: '#4a3c1f',
  border: '1px solid #c9b98a',
  borderRadius: 0,
};

// ── Helpers ────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  docx: 'Word (.docx)',
  pptx: 'PowerPoint (.pptx)',
  pdf: 'PDF (.pdf)',
  html: 'HTML (.html)',
  zip: 'Content Zip (.zip)',
};

const FORMAT_MIME: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  html: 'text/html',
  zip: 'application/zip',
};

// ── Component ──────────────────────────────────────────────────────

export function ExportConfigModal({
  currentSource,
  mediaProvider,
  onClose,
}: ExportConfigModalProps) {
  const [format, setFormat] = useState<ExportFormat>('pptx');
  const [themeId, setThemeId] = useState<string>('');
  const [transformStyle, setTransformStyle] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const themes = getThemeSummaries();
  const transforms = getTransformStyleSummaries();

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let mdDoc: MarkdownDocument = parseMarkdown(currentSource);

      // Apply transform if selected
      if (transformStyle) {
        const doc = markdownToDoc(mdDoc);
        const images = extractDocImages(doc.blocks);
        const result = applyTransform(doc, transformStyle, {
          themeId: themeId || undefined,
          images,
        });
        mdDoc = docToMarkdown(result.doc);
      }

      // Collect images from mediaProvider for formats that embed them
      const images = new Map<string, ArrayBuffer>();
      if (mediaProvider && (format === 'pptx' || format === 'html')) {
        const entries = await mediaProvider.listMedia();
        for (const entry of entries) {
          const url = await mediaProvider.resolveUrl(entry.name);
          const res = await fetch(url);
          if (res.ok) {
            images.set(entry.name, await res.arrayBuffer());
          }
        }
      }

      const ts = new Date().toISOString().slice(0, 10);
      const filename = `document-${ts}.${format}`;
      const exportThemeId = themeId || undefined;

      switch (format) {
        case 'docx': {
          const { markdownDocToDocx } = await import('@bendyline/squisq-formats/docx');
          const buf = await markdownDocToDocx(mdDoc, { themeId: exportThemeId });
          downloadBlob(new Blob([buf], { type: FORMAT_MIME.docx }), filename);
          break;
        }
        case 'pptx': {
          const { markdownDocToPptx } = await import('@bendyline/squisq-formats/pptx');
          const buf = await markdownDocToPptx(mdDoc, { themeId: exportThemeId, images });
          downloadBlob(new Blob([buf], { type: FORMAT_MIME.pptx }), filename);
          break;
        }
        case 'pdf': {
          const { markdownDocToPdf } = await import('@bendyline/squisq-formats/pdf');
          const buf = await markdownDocToPdf(mdDoc, { themeId: exportThemeId });
          downloadBlob(new Blob([buf], { type: FORMAT_MIME.pdf }), filename);
          break;
        }
        case 'html': {
          const { docToHtml } = await import('@bendyline/squisq-formats/html');
          const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
          const doc = markdownToDoc(mdDoc);
          const html = docToHtml(doc, {
            playerScript: PLAYER_BUNDLE,
            images,
            mode: 'slideshow',
            themeId: exportThemeId,
          });
          downloadBlob(new Blob([html], { type: FORMAT_MIME.html }), filename);
          break;
        }
        case 'zip': {
          const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
          const { containerToZip } = await import('@bendyline/squisq-formats/container');
          const container = new MemoryContentContainer();
          // Write the (possibly transformed) markdown
          await container.writeDocument(stringifyMarkdown(mdDoc));
          if (mediaProvider) {
            const entries = await mediaProvider.listMedia();
            for (const entry of entries) {
              const url = await mediaProvider.resolveUrl(entry.name);
              const res = await fetch(url);
              if (res.ok) {
                const data = await res.arrayBuffer();
                await container.writeFile(entry.name, data, entry.mimeType);
              }
            }
          }
          const blob = await containerToZip(container);
          downloadBlob(blob, filename);
          break;
        }
      }

      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [currentSource, format, themeId, transformStyle, mediaProvider, onClose]);

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle}>
        <h2 style={titleStyle}>Export with Options</h2>

        {/* Format */}
        <label style={labelStyle}>Format</label>
        <select
          style={selectStyle}
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          disabled={busy}
        >
          {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </select>

        {/* Theme */}
        <label style={labelStyle}>Theme</label>
        <select
          style={selectStyle}
          value={themeId}
          onChange={(e) => setThemeId(e.target.value)}
          disabled={busy}
        >
          <option value="">Default (no theme)</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {/* Transform */}
        <label style={labelStyle}>Transform</label>
        <select
          style={selectStyle}
          value={transformStyle}
          onChange={(e) => setTransformStyle(e.target.value)}
          disabled={busy}
        >
          <option value="">None</option>
          {transforms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {/* Error */}
        {error && (
          <div style={{ color: '#c53030', fontSize: 13, marginBottom: 12 }}>
            Export failed: {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button style={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button style={btnPrimary} onClick={handleExport} disabled={busy}>
            {busy ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
