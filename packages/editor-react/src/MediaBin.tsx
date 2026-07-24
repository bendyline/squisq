/**
 * MediaBin
 *
 * Toggleable side panel that displays files associated with the current
 * content. Shows image thumbnails, icons for other types, file sizes,
 * and provides an upload button to add new media.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MediaProvider, MediaEntry } from '@bendyline/squisq/schemas';
import { SQUISQ_MEDIA_MIME, buildSquisqMediaReference } from './mediaDragMime';
import { filterVisibleMediaEntries } from './mediaEntries';

// ============================================
// Types
// ============================================

export interface MediaBinProps {
  /** The active MediaProvider (null when no media context is available) */
  mediaProvider: MediaProvider | null;
  /** Whether the editor is in dark mode */
  isDark: boolean;
  /** Incremented externally to signal a re-scan of the media list */
  refreshKey?: number;
  /** Relative media paths currently referenced by the document. */
  usedMediaPaths?: ReadonlySet<string>;
  /**
   * Fired after a successful upload via the MediaBin's "+ Upload"
   * button or image drop target. `relativePath` is what the provider returned (the same
   * value embedded in markdown refs, e.g. `attachments/xyz.png`);
   * `name` is the uploader-chosen filename before storage renamed
   * it. Consumers typically use this to insert a markdown image ref
   * at the editor's cursor so the file actually participates in the
   * outgoing message — previously files went to the bin and nowhere
   * else, leaving the message body empty when the user hit Send.
   */
  onMediaUploaded?: (relativePath: string, name: string, mimeType: string) => void | Promise<void>;
  /**
   * Fired after a file is removed through the MediaBin context menu.
   * Hosts use this to remove matching markdown refs from the document.
   */
  onMediaRemoved?: (relativePath: string, entry: MediaEntry) => void | Promise<void>;
  /** Fired whenever the panel scans media and knows the current entry count. */
  onCountChange?: (count: number) => void;
  /**
   * Opens the host's media recorder. When provided, the Files header shows a
   * compact Record button beside Upload.
   */
  onRecord?: () => void;
  /** Whether the recorder dialog opened by `onRecord` is currently visible. */
  isRecorderOpen?: boolean;
  /**
   * Whether files expose a browser download action. Defaults to true. This
   * controls the built-in affordance only; it cannot prevent access to media
   * URLs that the host otherwise exposes to the browser.
   */
  allowBinaryDownloads?: boolean;
}

// ============================================
// Helpers
// ============================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '\u{1F5BC}';
  if (mimeType.startsWith('audio/')) return '\u{1F50A}';
  if (mimeType.startsWith('video/')) return '\u{1F3AC}';
  if (mimeType.includes('json')) return '{ }';
  if (mimeType.includes('xml') || mimeType.includes('ssml')) return '\u{2329}/\u{232A}';
  return '\u{1F4C4}';
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico']);

function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (isImageMime(file.type)) return true;
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

/** During drag-over browsers expose item MIME types but often not filenames. */
function dataTransferMayContainImage(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.items.length > 0) {
    return Array.from(dataTransfer.items).some(
      (item) => item.kind === 'file' && (item.type === '' || isImageMime(item.type)),
    );
  }
  return Array.from(dataTransfer.files).some(isImageFile);
}

function sortMediaEntries(entries: MediaEntry[]): MediaEntry[] {
  return entries.sort((a, b) => {
    const aImg = isImageMime(a.mimeType) ? 0 : 1;
    const bImg = isImageMime(b.mimeType) ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;
    return a.name.localeCompare(b.name);
  });
}

function basenameForPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function triggerBrowserDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// ============================================
// Component
// ============================================

export function MediaBin({
  mediaProvider,
  isDark,
  refreshKey,
  usedMediaPaths,
  onMediaUploaded,
  onMediaRemoved,
  onCountChange,
  onRecord,
  isRecorderOpen = false,
  allowBinaryDownloads = true,
}: MediaBinProps) {
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    entry: MediaEntry;
    x: number;
    y: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dropDepthRef = useRef(0);

  const updateEntries = useCallback(
    async (provider: MediaProvider) => {
      const list = sortMediaEntries(filterVisibleMediaEntries(await provider.listMedia()));
      setEntries(list);
      onCountChange?.(list.length);

      const urls: Record<string, string> = {};
      for (const entry of list) {
        if (isImageMime(entry.mimeType)) {
          try {
            urls[entry.name] = await provider.resolveUrl(entry.name);
          } catch {
            // skip failed resolve
          }
        }
      }
      setThumbUrls(urls);
    },
    [onCountChange],
  );

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    const close = () => setContextMenu(null);

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);

  // Scan media entries whenever the provider changes or refreshKey bumps
  useEffect(() => {
    if (!mediaProvider) {
      setEntries([]);
      setThumbUrls({});
      onCountChange?.(0);
      return;
    }

    let cancelled = false;

    async function scan() {
      setLoading(true);
      try {
        const list = filterVisibleMediaEntries(await mediaProvider!.listMedia());
        if (cancelled) return;

        sortMediaEntries(list);
        setEntries(list);
        onCountChange?.(list.length);

        const urls: Record<string, string> = {};
        for (const entry of list) {
          if (isImageMime(entry.mimeType)) {
            try {
              urls[entry.name] = await mediaProvider!.resolveUrl(entry.name);
            } catch {
              // skip failed resolve
            }
          }
        }
        if (!cancelled) setThumbUrls(urls);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    scan();
    return () => {
      cancelled = true;
    };
  }, [mediaProvider, refreshKey, onCountChange]);

  // ---- Upload ----

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0 || !mediaProvider) return;
      setLoading(true);
      try {
        for (const file of files) {
          const buffer = await file.arrayBuffer();
          const mimeType = file.type || 'application/octet-stream';
          const relativePath = await mediaProvider.addMedia(file.name, buffer, mimeType);
          if (onMediaUploaded) {
            try {
              await onMediaUploaded(relativePath, file.name, mimeType);
            } catch {
              /* callback is a nice-to-have; don't abort the upload batch */
            }
          }
        }
        // Re-scan
        await updateEntries(mediaProvider);
      } finally {
        setLoading(false);
      }
    },
    [mediaProvider, onMediaUploaded, updateEntries],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        await uploadFiles(Array.from(e.target.files ?? []));
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [uploadFiles],
  );

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!mediaProvider || loading || !dataTransferMayContainImage(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      dropDepthRef.current += 1;
      setIsDropActive(true);
    },
    [loading, mediaProvider],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!mediaProvider || loading || !dataTransferMayContainImage(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    },
    [loading, mediaProvider],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isDropActive) return;
      event.preventDefault();
      event.stopPropagation();
      dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
      if (dropDepthRef.current === 0) setIsDropActive(false);
    },
    [isDropActive],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const imageFiles = Array.from(event.dataTransfer.files).filter(isImageFile);
      if (!mediaProvider || (!isDropActive && imageFiles.length === 0)) return;
      event.preventDefault();
      event.stopPropagation();
      dropDepthRef.current = 0;
      setIsDropActive(false);
      if (imageFiles.length > 0) void uploadFiles(imageFiles);
    },
    [isDropActive, mediaProvider, uploadFiles],
  );

  const handleRemoveEntry = useCallback(
    async (entry: MediaEntry) => {
      if (!mediaProvider) return;
      setContextMenu(null);
      setLoading(true);
      try {
        await mediaProvider.removeMedia(entry.name);
        if (onMediaRemoved) {
          try {
            await onMediaRemoved(entry.name, entry);
          } catch (err: unknown) {
            console.warn(
              '[squisq-editor] Failed to remove media reference from document:',
              err instanceof Error ? err.message : err,
            );
          }
        }
        await updateEntries(mediaProvider);
      } finally {
        setLoading(false);
      }
    },
    [mediaProvider, onMediaRemoved, updateEntries],
  );

  const handleDownloadEntry = useCallback(
    async (entry: MediaEntry) => {
      if (!mediaProvider || downloadingPath !== null) return;
      setDownloadingPath(entry.name);
      try {
        const url = await mediaProvider.resolveUrl(entry.name);
        triggerBrowserDownload(url, basenameForPath(entry.name));
      } catch (err: unknown) {
        console.warn(
          '[squisq-editor] Failed to download media file:',
          err instanceof Error ? err.message : err,
        );
      } finally {
        setDownloadingPath(null);
      }
    },
    [downloadingPath, mediaProvider],
  );

  const openContextMenu = useCallback((entry: MediaEntry, x: number, y: number) => {
    setContextMenu({ entry, x, y });
  }, []);

  const removeLabel = contextMenu
    ? isImageMime(contextMenu.entry.mimeType)
      ? 'Remove image'
      : 'Remove file'
    : 'Remove file';

  const menuLeft = contextMenu ? Math.min(contextMenu.x, Math.max(8, window.innerWidth - 168)) : 0;
  const menuTop = contextMenu ? Math.min(contextMenu.y, Math.max(8, window.innerHeight - 48)) : 0;

  const contextMenuStyle = {
    left: menuLeft,
    top: menuTop,
  };

  const handleItemKeyDown = useCallback(
    (entry: MediaEntry, event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenu(entry, rect.left + 16, rect.top + 16);
    },
    [openContextMenu],
  );

  return (
    <div
      className={[
        'squisq-media-bin',
        isDark ? 'squisq-media-bin--dark' : '',
        isDropActive ? 'squisq-media-bin--drop-active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-busy={loading}
    >
      {/* Header */}
      <div className="squisq-media-bin-header">
        <span className="squisq-media-bin-title">
          Files {entries.length > 0 && `(${entries.length})`}
        </span>

        <div className="squisq-media-bin-actions">
          {onRecord && (
            <button
              type="button"
              className="squisq-media-bin-record"
              onClick={onRecord}
              disabled={!mediaProvider}
              title={
                mediaProvider ? 'Record media' : 'Load a content zip or select a storage slot first'
              }
              aria-label="Record media"
              aria-haspopup="dialog"
              aria-expanded={isRecorderOpen}
            >
              <span className="squisq-media-bin-record-dot" aria-hidden="true" />
              Record
            </button>
          )}

          <button
            type="button"
            className="squisq-media-bin-upload"
            onClick={handleUploadClick}
            disabled={!mediaProvider || loading}
            title={
              mediaProvider ? 'Upload files' : 'Load a content zip or select a storage slot first'
            }
          >
            + Upload
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="squisq-media-bin-list">
        {!mediaProvider && (
          <div className="squisq-media-bin-empty">
            No media context.
            <br />
            Load a content zip or select a storage slot.
          </div>
        )}

        {mediaProvider && entries.length === 0 && !loading && (
          <div className="squisq-media-bin-empty">No files yet.</div>
        )}

        {entries.map((entry) => {
          const thumb = thumbUrls[entry.name];
          const basename = basenameForPath(entry.name);
          const altText = basename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
          const isUnused = !!usedMediaPaths && !usedMediaPaths.has(entry.name);

          const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
            const payload = {
              name: entry.name,
              mimeType: entry.mimeType,
              alt: altText,
            };
            e.dataTransfer.setData(SQUISQ_MEDIA_MIME, JSON.stringify(payload));
            e.dataTransfer.setData('text/plain', buildSquisqMediaReference(payload));
            e.dataTransfer.effectAllowed = 'copy';
          };

          return (
            <div
              key={entry.name}
              className="squisq-media-bin-item"
              title={`${entry.name}\n${entry.mimeType}\n${formatSize(entry.size)}`}
              draggable
              tabIndex={0}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu(entry, e.clientX, e.clientY);
              }}
              onDragStart={handleDragStart}
              onKeyDown={(e) => handleItemKeyDown(entry, e)}
            >
              {/* Thumbnail or icon */}
              {thumb ? (
                <img
                  src={thumb}
                  alt={basename}
                  className="squisq-media-bin-thumb"
                  draggable={false}
                />
              ) : (
                <span className="squisq-media-bin-icon">{iconForMime(entry.mimeType)}</span>
              )}

              {/* Name + size */}
              <div className="squisq-media-bin-meta">
                <div className="squisq-media-bin-name">{basename}</div>
                <div className="squisq-media-bin-detail-row">
                  <span className="squisq-media-bin-size">{formatSize(entry.size)}</span>
                  {isUnused && (
                    <span className="squisq-media-bin-unused-badge" title="Not used in document">
                      Unused
                    </span>
                  )}
                </div>
              </div>

              {allowBinaryDownloads && (
                <button
                  type="button"
                  className="squisq-media-bin-download"
                  title={`Download ${basename}`}
                  aria-label={`Download ${basename}`}
                  disabled={!mediaProvider || downloadingPath !== null}
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDownloadEntry(entry);
                  }}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <span aria-hidden="true">{downloadingPath === entry.name ? '…' : '↓'}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isDropActive && (
        <div className="squisq-media-bin-drop-target" aria-hidden="true">
          <span className="squisq-media-bin-drop-target-icon">+</span>
          <strong>Drop images here</strong>
          <span>Add to Files</span>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="squisq-media-bin-context-menu"
          role="menu"
          aria-label={`${contextMenu.entry.name} actions`}
          style={contextMenuStyle}
        >
          <button
            type="button"
            role="menuitem"
            className="squisq-media-bin-context-menu-item squisq-media-bin-context-menu-item--danger"
            onClick={() => handleRemoveEntry(contextMenu.entry)}
            disabled={!mediaProvider || loading}
          >
            {removeLabel}
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}
