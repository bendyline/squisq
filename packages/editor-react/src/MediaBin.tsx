/**
 * MediaBin
 *
 * Toggleable side panel that displays files associated with the current
 * content. Shows image thumbnails, icons for other types, file sizes,
 * and provides an upload button to add new media.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { MediaProvider, MediaEntry } from '@bendyline/squisq/schemas';
import { SQUISQ_MEDIA_MIME } from './mediaDragMime';

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
   * Fired after a successful upload via the MediaBin's own "+ Upload"
   * button. `relativePath` is what the provider returned (the same
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

function sortMediaEntries(entries: MediaEntry[]): MediaEntry[] {
  return entries.sort((a, b) => {
    const aImg = isImageMime(a.mimeType) ? 0 : 1;
    const bImg = isImageMime(b.mimeType) ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;
    return a.name.localeCompare(b.name);
  });
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
}: MediaBinProps) {
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    entry: MediaEntry;
    x: number;
    y: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const updateEntries = useCallback(
    async (provider: MediaProvider) => {
      const list = sortMediaEntries(await provider.listMedia());
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
        const list = await mediaProvider!.listMedia();
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

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || !mediaProvider) return;

      setLoading(true);
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file) continue;
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
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [mediaProvider, onMediaUploaded, updateEntries],
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
    <div className={`squisq-media-bin${isDark ? ' squisq-media-bin--dark' : ''}`}>
      {/* Header */}
      <div className="squisq-media-bin-header">
        <span className="squisq-media-bin-title">
          Files {entries.length > 0 && `(${entries.length})`}
        </span>

        <button
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
          const basename = entry.name.includes('/') ? entry.name.split('/').pop()! : entry.name;
          const isImage = isImageMime(entry.mimeType);
          const altText = basename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
          const isUnused = !!usedMediaPaths && !usedMediaPaths.has(entry.name);

          const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
            if (!isImage) return;
            const payload = JSON.stringify({
              name: entry.name,
              mimeType: entry.mimeType,
              alt: altText,
            });
            e.dataTransfer.setData(SQUISQ_MEDIA_MIME, payload);
            e.dataTransfer.setData('text/plain', `![${altText}](${entry.name})`);
            e.dataTransfer.effectAllowed = 'copy';
          };

          return (
            <div
              key={entry.name}
              className="squisq-media-bin-item"
              title={`${entry.name}\n${entry.mimeType}\n${formatSize(entry.size)}`}
              draggable={isImage}
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
            </div>
          );
        })}
      </div>

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
