/**
 * FileToolbar — Download and Upload controls for the dev site.
 *
 * Download: Exports the current markdown source as .md, .docx, .pdf, .txt, or .zip.
 * Upload:   Ingests markdown/text directly, or converts any format the shared
 *           format registry can import (.docx, .pptx, .xlsx, .pdf, .csv, .html,
 *           .zip/.dbk) to markdown — see `documentImport.ts` — and replaces the
 *           editor content. Conversion runs behind an `ImportProgressModal`,
 *           since an office import is slow enough to look like a hang.
 *           When a storage slot is active, also accepts images (.jpg, .png, .gif,
 *           .webp, .svg) which are stored in the slot and inserted as markdown.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  parseMarkdown,
  inferDocumentTitle,
  readFrontmatterThemeId,
} from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveAudioMapping } from '@bendyline/squisq/doc';
import type { Doc } from '@bendyline/squisq/schemas';
import { VideoExportModal } from '@bendyline/squisq-video-react';
import { ExportConfigModal } from './ExportConfigModal';
import { SITE_FFMPEG_WASM_CONFIG } from './ffmpegWasmConfig';
import { collectAudioForHtmlExport, collectImagesForHtmlExport } from './exportHelpers';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { addSlotMedia } from './slotStorage';
import { buildExportFilename } from './exportFilename';
import {
  IMPORTABLE_DOCUMENT_EXTENSIONS,
  describeImportError,
  extensionOf,
  importDocumentFile,
  isImportableDocument,
} from './documentImport';
import { ImportProgressModal, type ImportProgressState } from './ImportProgressModal';
import { ensurePdfWorker } from './pdfWorker';

// ============================================
// Types
// ============================================

interface FileToolbarProps {
  /** Current markdown source from the editor */
  currentSource: string;
  /** Called when an uploaded file is ingested */
  onImport: (markdown: string) => void;
  /** Called when a zip file is uploaded — provides the container for the caller to create a MediaProvider */
  onZipImport: (markdown: string, container: ContentContainer) => void;
  /** Active MediaProvider (used to include media when downloading as zip) */
  mediaProvider: MediaProvider | null;
  /**
   * Active workspace-scoped ContentContainer — the folder holding the
   * doc, its sibling docs, and asset sidecars. When supplied, the
   * export dialog unlocks the recursive "Export linked documents"
   * option. Without it, only single-doc plain-HTML export is offered.
   */
  workspaceContainer?: ContentContainer | null;
  /** Whether the site is in dark mode */
  isDark: boolean;
  /** Currently active storage slot (null = none). Images require a slot. */
  activeSlot: number | null;
}

type DownloadFormat = 'md' | 'docx' | 'pptx' | 'pdf' | 'txt' | 'zip' | 'html' | 'htmlzip';

/** File extensions treated as images (stored in slot media, not imported as docs) */
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);

/** Text formats the editor loads verbatim, with no conversion pass. */
const TEXT_EXTENSIONS = ['md', 'markdown', 'txt'] as const;

/** Every extension the upload input offers, derived so the three lists can't drift. */
const UPLOAD_EXTENSIONS: readonly string[] = [
  ...TEXT_EXTENSIONS,
  ...IMPORTABLE_DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];

const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',');
const UPLOAD_SUPPORTED_SUMMARY = UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(', ');

// ============================================
// Styles (inline, matching the existing top bar)
// ============================================

function buttonStyle(_isDark: boolean, active = false): React.CSSProperties {
  return {
    fontSize: 13,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '4px 12px',
    cursor: 'pointer',
    background: active ? '#8B6914' : '#E8DFC6',
    color: active ? '#fff' : '#4a3c1f',
    border: `1px solid ${active ? '#7a5c10' : '#c9b98a'}`,
    borderRadius: 0,
    position: 'relative' as const,
  };
}

function dropdownStyle(_isDark: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    minWidth: 160,
    background: '#FFFDF7',
    border: '1px solid #c9b98a',
    borderRadius: 0,
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    zIndex: 100,
    overflow: 'hidden',
  };
}

function dropdownItemStyle(_isDark: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    fontSize: 13,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'left' as const,
    background: 'transparent',
    color: '#4a3c1f',
    border: 'none',
    cursor: 'pointer',
  };
}

// ============================================
// Helpers
// ============================================

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

function filenameForFormat(format: DownloadFormat, currentSource: string): string {
  const ext = format === 'htmlzip' ? 'html.zip' : format;
  return buildExportFilename(currentSource, ext);
}

// ============================================
// Component
// ============================================

export function FileToolbar({
  currentSource,
  onImport,
  onZipImport,
  mediaProvider,
  workspaceContainer,
  isDark,
  activeSlot,
}: FileToolbarProps) {
  const [showDownload, setShowDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  /** Non-null while a document conversion is running, or after one failed. */
  const [importState, setImportState] = useState<ImportProgressState | null>(null);
  const [videoExportDoc, setVideoExportDoc] = useState<Doc | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const playerScriptRef = useRef<string | null>(null);

  // The video exporter needs the audio-resolved doc (narration timing +
  // segment mapping ride the workspace container, asynchronously).
  useEffect(() => {
    if (!showVideoModal) {
      setVideoExportDoc(null);
      return;
    }
    let cancelled = false;
    const parsed = markdownToDoc(parseMarkdown(currentSource));
    if (!workspaceContainer) {
      setVideoExportDoc(parsed);
      return;
    }
    resolveAudioMapping(parsed, workspaceContainer).then(
      (resolved) => {
        if (!cancelled) setVideoExportDoc(resolved);
      },
      () => {
        if (!cancelled) setVideoExportDoc(parsed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [showVideoModal, currentSource, workspaceContainer]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDownload) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDownload(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDownload]);

  // ---- Download ----

  const handleDownload = useCallback(
    async (format: DownloadFormat) => {
      setShowDownload(false);
      setBusy(true);
      try {
        const filename = filenameForFormat(format, currentSource);

        if (format === 'md' || format === 'txt') {
          const blob = new Blob([currentSource], { type: 'text/plain;charset=utf-8' });
          downloadBlob(blob, filename);
        } else if (format === 'docx') {
          const mdDoc = parseMarkdown(currentSource);
          const images = new Map<string, { data: ArrayBuffer; contentType: string }>();
          if (mediaProvider) {
            const entries = await mediaProvider.listMedia();
            for (const entry of entries) {
              const url = await mediaProvider.resolveUrl(entry.name);
              const res = await fetch(url);
              if (res.ok) {
                images.set(entry.name, {
                  data: await res.arrayBuffer(),
                  contentType: entry.mimeType || res.headers.get('content-type') || 'image/png',
                });
              }
            }
          }
          const { markdownDocToDocx } = await import('@bendyline/squisq-formats/docx');
          const buffer = await markdownDocToDocx(mdDoc, { images });
          const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
          downloadBlob(blob, filename);
        } else if (format === 'pptx') {
          const mdDoc = parseMarkdown(currentSource);
          const images = new Map<string, ArrayBuffer>();
          if (mediaProvider) {
            const entries = await mediaProvider.listMedia();
            for (const entry of entries) {
              const url = await mediaProvider.resolveUrl(entry.name);
              const res = await fetch(url);
              if (res.ok) {
                images.set(entry.name, await res.arrayBuffer());
              }
            }
          }
          // The deck is the slideshow rendition — `docToPptx` runs the same
          // projection the preview player does, so every authored block
          // becomes a slide (the markdown path segmented on H1/H2 only).
          const { docToPptx } = await import('@bendyline/squisq-formats/pptx');
          const buffer = await docToPptx(markdownToDoc(mdDoc), { images });
          const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
          downloadBlob(blob, filename);
        } else if (format === 'pdf') {
          const mdDoc = parseMarkdown(currentSource);
          await ensurePdfWorker();
          const { markdownDocToPdf } = await import('@bendyline/squisq-formats/pdf');
          const buffer = await markdownDocToPdf(mdDoc);
          const blob = new Blob([buffer], { type: 'application/pdf' });
          downloadBlob(blob, filename);
        } else if (format === 'zip') {
          const { containerToZip } = await import('@bendyline/squisq-formats/container');
          const container = new MemoryContentContainer();
          await container.writeDocument(currentSource);
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
        } else if (format === 'html' || format === 'htmlzip') {
          if (!playerScriptRef.current) {
            const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
            playerScriptRef.current = PLAYER_BUNDLE;
          }
          const mdDoc = parseMarkdown(currentSource);
          const parsedDoc = markdownToDoc(mdDoc);
          // Narration timing + audio mapping ride the workspace container.
          const doc = workspaceContainer
            ? await resolveAudioMapping(parsedDoc, workspaceContainer)
            : parsedDoc;
          const images = await collectImagesForHtmlExport(doc, mediaProvider);
          const audio = await collectAudioForHtmlExport(doc, workspaceContainer);
          const themeId = readFrontmatterThemeId(mdDoc.frontmatter);
          const title = inferDocumentTitle(mdDoc);
          const options = {
            playerScript: playerScriptRef.current,
            images,
            ...(audio ? { audio } : {}),
            mode: 'static' as const,
            title,
            themeId,
          };
          const { docToHtml, docToHtmlZip } = await import('@bendyline/squisq-formats/html');
          if (format === 'html') {
            const html = docToHtml(doc, options);
            downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
          } else {
            const blob = await docToHtmlZip(doc, options);
            downloadBlob(blob, filename);
          }
        }
      } catch (err: unknown) {
        console.error('Download failed:', err);
        alert('Download failed — see console for details.');
      } finally {
        setBusy(false);
      }
    },
    [currentSource, mediaProvider, workspaceContainer],
  );

  // ---- Upload ----

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setBusy(true);
      try {
        const ext = extensionOf(file.name);

        if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
          const text = await file.text();
          onImport(text);
        } else if (isImportableDocument(file.name)) {
          // Every non-markdown document format converts through one pipeline.
          // The dialog goes up before the first await so a slow converter never
          // leaves the page silently frozen.
          setImportState({
            phase: 'working',
            progress: { stage: 'reading', fileName: file.name, formatLabel: ext.toUpperCase() },
          });
          try {
            const result = await importDocumentFile(file, (progress) =>
              setImportState({ phase: 'working', progress }),
            );
            setImportState(null);
            // A container-backed import (DOCX/PPTX/PDF/zip) also carries the
            // document's extracted media, so it becomes the workspace.
            if (result.container) {
              onZipImport(result.markdown, result.container);
            } else {
              onImport(result.markdown);
            }
            if (!result.markdown.trim()) {
              // Scanned PDFs and image-only decks are the common cause, and an
              // empty editor with no explanation reads as a failed upload.
              alert(
                `${file.name} imported, but no text could be extracted from it. ` +
                  'It may be image-only (a scan) rather than text.',
              );
            }
          } catch (err: unknown) {
            console.error('Import failed:', err);
            setImportState({
              phase: 'error',
              fileName: file.name,
              message: describeImportError(err, file.name),
            });
          }
        } else if (IMAGE_EXTENSIONS.has(ext)) {
          if (activeSlot === null) {
            alert('Select a storage slot first to upload images.');
            return;
          }
          const buffer = await file.arrayBuffer();
          const mimeType = file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const relativePath = await addSlotMedia(activeSlot, file.name, buffer, mimeType);
          // Insert markdown image reference at the end of the current source
          const imageMarkdown = `\n![${file.name}](${relativePath})\n`;
          onImport(currentSource + imageMarkdown);
        } else {
          alert(`Unsupported file type: .${ext}\nSupported: ${UPLOAD_SUPPORTED_SUMMARY}`);
        }
      } catch (err: unknown) {
        console.error('Import failed:', err);
        alert('Import failed — see console for details.');
      } finally {
        setBusy(false);
        // Reset so re-uploading the same file triggers onChange
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [onImport, onZipImport, activeSlot, currentSource],
  );

  return (
    <>
      {/* Direct debug entry point for exercising the full export experience. */}
      <button
        type="button"
        onClick={() => setShowExportModal(true)}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={showExportModal}
        data-testid="open-export-dialog"
        style={buttonStyle(isDark, showExportModal)}
        title="Open export options"
      >
        Export…
      </button>

      {/* Download dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          onClick={() => setShowDownload((v) => !v)}
          disabled={busy}
          style={buttonStyle(isDark, showDownload)}
          title="Download current document"
        >
          {busy ? '…' : '↓ Download'}
        </button>
        {showDownload && (
          <div style={dropdownStyle(isDark)}>
            <button
              style={{ ...dropdownItemStyle(isDark), fontWeight: 500 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => {
                setShowDownload(false);
                setShowExportModal(true);
              }}
            >
              Export with options...
            </button>
            <div style={{ height: 1, background: '#c9b98a', margin: '4px 0' }} />
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('md')}
            >
              Markdown (.md)
            </button>
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('docx')}
            >
              Word (.docx)
            </button>
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('pptx')}
            >
              PowerPoint (.pptx)
            </button>
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('pdf')}
            >
              PDF (.pdf)
            </button>
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('txt')}
            >
              Plain Text (.txt)
            </button>
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('zip')}
            >
              Content Zip (.zip)
            </button>
            <div style={{ height: 1, background: '#c9b98a', margin: '4px 0' }} />
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('html')}
            >
              Standalone HTML (.html)
            </button>
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleDownload('htmlzip')}
            >
              HTML Zip (.zip)
            </button>
            <div style={{ height: 1, background: '#c9b98a', margin: '4px 0' }} />
            <button
              style={dropdownItemStyle(isDark)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F3EBD6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={async () => {
                setShowDownload(false);
                // Lazy-load the player bundle on first use
                if (!playerScriptRef.current) {
                  const { PLAYER_BUNDLE } =
                    await import('@bendyline/squisq-react/standalone-source');
                  playerScriptRef.current = PLAYER_BUNDLE;
                }
                setShowVideoModal(true);
              }}
            >
              Video / Animated GIF
            </button>
          </div>
        )}
      </div>

      {/* Upload button */}
      <button
        onClick={handleUploadClick}
        disabled={busy}
        style={buttonStyle(isDark)}
        title={`Upload a document or image (${UPLOAD_SUPPORTED_SUMMARY})`}
      >
        ↑ Upload
      </button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        data-testid="site-upload-input"
        accept={UPLOAD_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Import progress / failure dialog */}
      {importState &&
        createPortal(
          <ImportProgressModal
            state={importState}
            colorScheme={isDark ? 'dark' : 'light'}
            onClose={() => setImportState(null)}
          />,
          document.body,
        )}

      {/* Video export modal */}
      {showVideoModal &&
        playerScriptRef.current &&
        videoExportDoc &&
        createPortal(
          <VideoExportModal
            doc={videoExportDoc}
            playerScript={playerScriptRef.current}
            mediaProvider={mediaProvider ?? undefined}
            defaultConfig={{ ffmpegWasm: SITE_FFMPEG_WASM_CONFIG }}
            colorScheme={isDark ? 'dark' : 'light'}
            onClose={() => setShowVideoModal(false)}
          />,
          document.body,
        )}

      {/* Export config modal */}
      {showExportModal &&
        createPortal(
          <ExportConfigModal
            currentSource={currentSource}
            mediaProvider={mediaProvider}
            colorScheme={isDark ? 'dark' : 'light'}
            workspaceContainer={workspaceContainer}
            onClose={() => setShowExportModal(false)}
          />,
          document.body,
        )}
    </>
  );
}
