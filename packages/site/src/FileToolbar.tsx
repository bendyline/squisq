/**
 * FileToolbar — Download and Upload controls for the dev site.
 *
 * Download: Exports the current markdown source as .md, .docx, .pdf, .txt, or .zip.
 * Upload:   Ingests a .md, .docx, .txt, .pdf, or .zip file and replaces the editor content.
 *           When a storage slot is active, also accepts images (.jpg, .png, .gif,
 *           .webp, .svg) which are stored in the slot and inserted as markdown.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { VideoExportModal } from '@bendyline/squisq-video-react';
import { markdownDocToDocx, docxToMarkdownDoc } from '@bendyline/squisq-formats/docx';
import {
  markdownDocToPdf,
  pdfToMarkdownDoc,
  configurePdfWorker,
} from '@bendyline/squisq-formats/pdf';
import { containerToZip, zipToContainer } from '@bendyline/squisq-formats/container';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { addSlotMedia } from './slotStorage';

// Configure pdfjs-dist worker for the browser.
// Vite's ?url suffix returns a resolved asset URL at build time.
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
configurePdfWorker(pdfjsWorkerUrl);

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
  /** Whether the site is in dark mode */
  isDark: boolean;
  /** Currently active storage slot (null = none). Images require a slot. */
  activeSlot: number | null;
}

type DownloadFormat = 'md' | 'docx' | 'pdf' | 'txt' | 'zip';

/** File extensions treated as images (stored in slot media, not imported as docs) */
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);

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

function filenameForFormat(format: DownloadFormat): string {
  const ts = new Date().toISOString().slice(0, 10);
  return `document-${ts}.${format}`;
}

// ============================================
// Component
// ============================================

export function FileToolbar({
  currentSource,
  onImport,
  onZipImport,
  mediaProvider,
  isDark,
  activeSlot,
}: FileToolbarProps) {
  const [showDownload, setShowDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const playerScriptRef = useRef<string | null>(null);

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
        const filename = filenameForFormat(format);

        if (format === 'md' || format === 'txt') {
          const blob = new Blob([currentSource], { type: 'text/plain;charset=utf-8' });
          downloadBlob(blob, filename);
        } else if (format === 'docx') {
          const mdDoc = parseMarkdown(currentSource);
          const buffer = await markdownDocToDocx(mdDoc);
          const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
          downloadBlob(blob, filename);
        } else if (format === 'pdf') {
          const mdDoc = parseMarkdown(currentSource);
          const buffer = await markdownDocToPdf(mdDoc);
          const blob = new Blob([buffer], { type: 'application/pdf' });
          downloadBlob(blob, filename);
        } else if (format === 'zip') {
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
        }
      } catch (err: unknown) {
        console.error('Download failed:', err);
        alert('Download failed — see console for details.');
      } finally {
        setBusy(false);
      }
    },
    [currentSource, mediaProvider],
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
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

        if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
          const text = await file.text();
          onImport(text);
        } else if (ext === 'docx') {
          const buffer = await file.arrayBuffer();
          const mdDoc = await docxToMarkdownDoc(buffer);
          const markdown = stringifyMarkdown(mdDoc);
          onImport(markdown);
        } else if (ext === 'pdf') {
          const buffer = await file.arrayBuffer();
          const mdDoc = await pdfToMarkdownDoc(buffer);
          const markdown = stringifyMarkdown(mdDoc);
          onImport(markdown);
        } else if (ext === 'zip') {
          const buffer = await file.arrayBuffer();
          const container = await zipToContainer(buffer);
          const markdown = (await container.readDocument()) ?? '';
          onZipImport(markdown, container);
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
          alert(
            `Unsupported file type: .${ext}\nSupported: .md, .txt, .docx, .pdf, .zip, .jpg, .png, .gif, .webp, .svg`,
          );
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
              onClick={async () => {
                setShowDownload(false);
                // Lazy-load the player bundle on first use
                if (!playerScriptRef.current) {
                  const { PLAYER_BUNDLE } = await import(
                    '@bendyline/squisq-react/standalone-source'
                  );
                  playerScriptRef.current = PLAYER_BUNDLE;
                }
                setShowVideoModal(true);
              }}
            >
              Video (.mp4)
            </button>
          </div>
        )}
      </div>

      {/* Upload button */}
      <button
        onClick={handleUploadClick}
        disabled={busy}
        style={buttonStyle(isDark)}
        title="Upload .md, .txt, .docx, .pdf, .zip, or image file"
      >
        ↑ Upload
      </button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,.docx,.pdf,.zip,.jpg,.jpeg,.png,.gif,.webp,.svg"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Video export modal */}
      {showVideoModal &&
        playerScriptRef.current &&
        createPortal(
          <VideoExportModal
            doc={markdownToDoc(parseMarkdown(currentSource))}
            playerScript={playerScriptRef.current}
            mediaProvider={mediaProvider ?? undefined}
            onClose={() => setShowVideoModal(false)}
          />,
          document.body,
        )}
    </>
  );
}
