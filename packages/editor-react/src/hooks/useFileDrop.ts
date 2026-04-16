/**
 * useFileDrop
 *
 * React hook that manages HTML5 drag-and-drop state for file uploads.
 * Tracks whether files are being dragged over the target element,
 * classifies dragged file types (media vs text), and dispatches
 * drop events to callers.
 */

import { useCallback, useRef, useState } from 'react';

// ─── File classification ────────────────────────────────

const MEDIA_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'ico',
  'mp4',
  'webm',
  'mov',
  'avi',
  'mp3',
  'wav',
  'ogg',
  'aac',
  'm4a',
  'flac',
]);

const TEXT_EXTENSIONS = new Set(['md', 'txt', 'docx']);

export type FileCategory = 'media' | 'text' | 'unknown';
export type DragContentType = 'media' | 'text' | 'mixed' | null;
export type DropTarget = 'media' | 'insert' | 'replace';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function classifyFile(file: { name: string; type: string }): FileCategory {
  const ext = extensionOf(file.name);
  if (MEDIA_EXTENSIONS.has(ext)) return 'media';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';

  // Fallback to MIME type
  if (
    file.type.startsWith('image/') ||
    file.type.startsWith('video/') ||
    file.type.startsWith('audio/')
  ) {
    return 'media';
  }
  if (file.type === 'text/plain' || file.type === 'text/markdown') {
    return 'text';
  }
  return 'unknown';
}

/**
 * Classify dragged items from a DataTransfer during dragenter/dragover.
 * Browsers restrict full file access during drag — only MIME types are
 * available via DataTransferItem.type.
 */
function classifyDataTransferItems(items: DataTransferItemList): DragContentType {
  let hasMedia = false;
  let hasText = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;

    const mime = item.type.toLowerCase();
    if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) {
      hasMedia = true;
    } else if (
      mime === 'text/plain' ||
      mime === 'text/markdown' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      hasText = true;
    } else {
      // Unknown MIME — browsers often report '' for many file types during drag.
      // We can't classify, so assume mixed to show all drop zones.
      hasMedia = true;
      hasText = true;
    }
  }

  if (hasMedia && hasText) return 'mixed';
  if (hasMedia) return 'media';
  if (hasText) return 'text';
  return null;
}

// ─── Hook ────────────────────────────────────────────────

export interface UseFileDropOptions {
  /** Called when files are dropped on a specific target zone. */
  onDrop: (files: File[], target: DropTarget) => void;
  /** Whether drop is enabled (default: true) */
  enabled?: boolean;
}

export interface UseFileDropResult {
  /** Whether a drag-with-files is currently hovering over the container */
  isDragging: boolean;
  /** Classification of the dragged content */
  dragContentType: DragContentType;
  /** Attach these to the container element */
  containerProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** Create props for an individual drop zone target */
  zoneProps: (target: DropTarget) => {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export function useFileDrop({ onDrop, enabled = true }: UseFileDropOptions): UseFileDropResult {
  const [isDragging, setIsDragging] = useState(false);
  const [dragContentType, setDragContentType] = useState<DragContentType>(null);

  // Counter-based tracking: dragenter/dragleave fire on child elements,
  // so we track a count rather than a boolean.
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;

      // Only react to OS file drags. In-app drags (e.g. dragging a thumbnail
      // out of the MediaBin) don't carry file-kind items and must pass
      // through to the editors without showing the drop overlay.
      const classification = e.dataTransfer.items
        ? classifyDataTransferItems(e.dataTransfer.items)
        : 'mixed';
      if (!classification) return;

      e.preventDefault();
      dragCounterRef.current++;

      if (dragCounterRef.current === 1) {
        setIsDragging(true);
        setDragContentType(classification);
      }
    },
    [enabled],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      // Required to allow drop
      e.dataTransfer.dropEffect = 'copy';
    },
    [enabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);

      if (dragCounterRef.current === 0) {
        setIsDragging(false);
        setDragContentType(null);
      }
    },
    [enabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      setDragContentType(null);
      // Actual file handling is done by zone-specific onDrop
    },
    [enabled],
  );

  const zoneProps = useCallback(
    (target: DropTarget) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);
        setDragContentType(null);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          onDrop(files, target);
        }
      },
    }),
    [onDrop],
  );

  return {
    isDragging,
    dragContentType,
    containerProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    zoneProps,
  };
}
