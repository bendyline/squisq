/**
 * ExportConfigModal — Modal for configuring theme, transform, format,
 * rendering mode, and aspect ratio before exporting a document.
 *
 * Inline styles match the cream/gold palette from VideoExportModal / FileToolbar.
 */

import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import { VideoExportModal } from '@bendyline/squisq-video-react';
import { buildPreviewDoc } from '@bendyline/squisq-editor-react';

// ── Types ──────────────────────────────────────────────────────────

export interface ExportConfigModalProps {
  currentSource: string;
  mediaProvider: MediaProvider | null;
  onClose: () => void;
}

type ExportFormat = 'docx' | 'pptx' | 'pdf' | 'html' | 'htmlzip' | 'zip' | 'video';
type RenderMode = 'document' | 'slideshow';
type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3';

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

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8a7a5a',
  marginTop: -8,
  marginBottom: 12,
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
  html: 'Standalone HTML (.html)',
  htmlzip: 'HTML + Assets (.zip)',
  zip: 'Content Zip (.zip)',
  video: 'Video (.mp4)',
};

/** Formats that support render mode selection */
const VISUAL_FORMATS: ExportFormat[] = ['html', 'htmlzip', 'video'];

/** Formats that support aspect ratio selection */
const ASPECT_FORMATS: ExportFormat[] = ['video'];

// ── Component ──────────────────────────────────────────────────────

export function ExportConfigModal({
  currentSource,
  mediaProvider,
  onClose,
}: ExportConfigModalProps) {
  const [format, setFormat] = useState<ExportFormat>('html');
  const [renderMode, setRenderMode] = useState<RenderMode>('document');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [themeId, setThemeId] = useState<string>('');
  const [transformStyle, setTransformStyle] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);

  const playerScriptRef = useRef<string | null>(null);

  const themes = getThemeSummaries();
  const transforms = getTransformStyleSummaries();

  const showModeSelector = VISUAL_FORMATS.includes(format);
  const showAspectRatio = ASPECT_FORMATS.includes(format);

  /** Collect images from mediaProvider */
  const collectImages = useCallback(async () => {
    const images = new Map<string, ArrayBuffer>();
    if (!mediaProvider) return images;
    const entries = await mediaProvider.listMedia();
    for (const entry of entries) {
      const url = await mediaProvider.resolveUrl(entry.name);
      const res = await fetch(url);
      if (res.ok) {
        images.set(entry.name, await res.arrayBuffer());
      }
    }
    return images;
  }, [mediaProvider]);

  /** Apply transform and return final MarkdownDocument */
  const prepareMarkdown = useCallback((): MarkdownDocument => {
    let mdDoc = parseMarkdown(currentSource);
    if (transformStyle) {
      const doc = markdownToDoc(mdDoc);
      const images = extractDocImages(doc.blocks);
      const result = applyTransform(doc, transformStyle, {
        themeId: themeId || undefined,
        images,
      });
      mdDoc = docToMarkdown(result.doc);
    }
    return mdDoc;
  }, [currentSource, transformStyle, themeId]);

  const handleExport = useCallback(async () => {
    // Video format delegates to VideoExportModal
    if (format === 'video') {
      if (!playerScriptRef.current) {
        setBusy(true);
        const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
        playerScriptRef.current = PLAYER_BUNDLE;
        setBusy(false);
      }
      setShowVideoModal(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const mdDoc = prepareMarkdown();
      const ts = new Date().toISOString().slice(0, 10);
      const exportThemeId = themeId || undefined;

      switch (format) {
        case 'docx': {
          const { markdownDocToDocx } = await import('@bendyline/squisq-formats/docx');
          const buf = await markdownDocToDocx(mdDoc, { themeId: exportThemeId });
          downloadBlob(
            new Blob([buf], {
              type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            }),
            `document-${ts}.docx`,
          );
          break;
        }
        case 'pptx': {
          const { markdownDocToPptx } = await import('@bendyline/squisq-formats/pptx');
          const images = await collectImages();
          const buf = await markdownDocToPptx(mdDoc, { themeId: exportThemeId, images });
          downloadBlob(
            new Blob([buf], {
              type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            }),
            `document-${ts}.pptx`,
          );
          break;
        }
        case 'pdf': {
          const { markdownDocToPdf } = await import('@bendyline/squisq-formats/pdf');
          const buf = await markdownDocToPdf(mdDoc, { themeId: exportThemeId });
          downloadBlob(new Blob([buf], { type: 'application/pdf' }), `document-${ts}.pdf`);
          break;
        }
        case 'html': {
          const { docToHtml, collectImagePaths } = await import('@bendyline/squisq-formats/html');
          const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
          const rawDoc = markdownToDoc(mdDoc);
          // For slideshow mode, build proper template blocks with interleaved images
          const doc = renderMode === 'slideshow' ? buildPreviewDoc(rawDoc) : rawDoc;
          const images = await collectImages();
          // Also key by doc-referenced paths
          const docPaths = collectImagePaths(doc);
          const byName = new Map(images);
          for (const p of docPaths) {
            if (!images.has(p)) {
              const fn = p.split('/').pop()!;
              const data = byName.get(fn);
              if (data) images.set(p, data);
            }
          }
          const mode = renderMode === 'slideshow' ? 'slideshow' : 'static';
          const html = docToHtml(doc, {
            playerScript: PLAYER_BUNDLE,
            images,
            mode,
            themeId: exportThemeId,
          });
          downloadBlob(
            new Blob([html], { type: 'text/html;charset=utf-8' }),
            `document-${ts}.html`,
          );
          break;
        }
        case 'htmlzip': {
          const { docToHtmlZip, collectImagePaths } =
            await import('@bendyline/squisq-formats/html');
          const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
          const rawDoc = markdownToDoc(mdDoc);
          const doc = renderMode === 'slideshow' ? buildPreviewDoc(rawDoc) : rawDoc;
          const images = await collectImages();
          const docPaths = collectImagePaths(doc);
          const byName = new Map(images);
          for (const p of docPaths) {
            if (!images.has(p)) {
              const fn = p.split('/').pop()!;
              const data = byName.get(fn);
              if (data) images.set(p, data);
            }
          }
          const mode = renderMode === 'slideshow' ? 'slideshow' : 'static';
          const blob = await docToHtmlZip(doc, {
            playerScript: PLAYER_BUNDLE,
            images,
            mode,
            themeId: exportThemeId,
          });
          downloadBlob(blob, `document-${ts}.html.zip`);
          break;
        }
        case 'zip': {
          const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
          const { containerToZip } = await import('@bendyline/squisq-formats/container');
          const container = new MemoryContentContainer();
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
          downloadBlob(blob, `document-${ts}.zip`);
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
  }, [
    currentSource,
    format,
    renderMode,
    themeId,
    transformStyle,
    mediaProvider,
    onClose,
    collectImages,
    prepareMarkdown,
  ]);

  return (
    <>
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

          {/* Render Mode — for HTML and Video formats */}
          {showModeSelector && (
            <>
              <label style={labelStyle}>Mode</label>
              <select
                style={selectStyle}
                value={renderMode}
                onChange={(e) => setRenderMode(e.target.value as RenderMode)}
                disabled={busy}
              >
                <option value="document">Document (scrollable page)</option>
                <option value="slideshow">Slideshow (interactive player)</option>
              </select>
              <div style={hintStyle}>
                {renderMode === 'document'
                  ? 'Renders as a readable flowing document with embedded images.'
                  : 'Renders as an interactive slideshow with animated block transitions.'}
              </div>
            </>
          )}

          {/* Aspect Ratio — for Video */}
          {showAspectRatio && (
            <>
              <label style={labelStyle}>Aspect Ratio</label>
              <select
                style={selectStyle}
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                disabled={busy}
              >
                <option value="16:9">Landscape (16:9)</option>
                <option value="9:16">Portrait (9:16)</option>
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Classic (4:3)</option>
              </select>
            </>
          )}

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

      {/* Video export modal — opened when format is 'video' */}
      {showVideoModal &&
        playerScriptRef.current &&
        createPortal(
          <VideoExportModal
            doc={markdownToDoc(parseMarkdown(currentSource))}
            playerScript={playerScriptRef.current}
            mediaProvider={mediaProvider ?? undefined}
            onClose={() => {
              setShowVideoModal(false);
              onClose();
            }}
          />,
          document.body,
        )}
    </>
  );
}
