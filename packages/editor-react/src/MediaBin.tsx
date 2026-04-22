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

// ============================================
// Component
// ============================================

export function MediaBin({ mediaProvider, isDark, refreshKey }: MediaBinProps) {
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scan media entries whenever the provider changes or refreshKey bumps
  useEffect(() => {
    if (!mediaProvider) {
      setEntries([]);
      setThumbUrls({});
      return;
    }

    let cancelled = false;

    async function scan() {
      setLoading(true);
      try {
        const list = await mediaProvider!.listMedia();
        if (cancelled) return;

        list.sort((a, b) => {
          const aImg = isImageMime(a.mimeType) ? 0 : 1;
          const bImg = isImageMime(b.mimeType) ? 0 : 1;
          if (aImg !== bImg) return aImg - bImg;
          return a.name.localeCompare(b.name);
        });
        setEntries(list);

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
  }, [mediaProvider, refreshKey]);

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
          const buffer = await file.arrayBuffer();
          const mimeType = file.type || 'application/octet-stream';
          await mediaProvider.addMedia(file.name, buffer, mimeType);
        }
        // Re-scan
        const list = await mediaProvider.listMedia();
        list.sort((a, b) => {
          const aImg = isImageMime(a.mimeType) ? 0 : 1;
          const bImg = isImageMime(b.mimeType) ? 0 : 1;
          if (aImg !== bImg) return aImg - bImg;
          return a.name.localeCompare(b.name);
        });
        setEntries(list);

        const urls: Record<string, string> = {};
        for (const entry of list) {
          if (isImageMime(entry.mimeType)) {
            try {
              urls[entry.name] = await mediaProvider.resolveUrl(entry.name);
            } catch {
              // skip
            }
          }
        }
        setThumbUrls(urls);
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [mediaProvider],
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
              onDragStart={handleDragStart}
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
                <div className="squisq-media-bin-size">{formatSize(entry.size)}</div>
              </div>
            </div>
          );
        })}
      </div>

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
