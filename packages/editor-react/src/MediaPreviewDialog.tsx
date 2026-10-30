/**
 * MediaPreviewDialog
 *
 * Opened by clicking a picture, video, or audio file in the MediaBin.
 * Pictures open in the shared `ImageViewer` (fit / 100% / zoom / pan);
 * video and audio play in the browser's native player.
 *
 * The `src` URL belongs to the MediaProvider that resolved it — the dialog
 * never revokes it.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { ownsContextMenuProps } from './EditorContextMenu';
import { ImageViewer } from './ImageViewer';
import { useModalDialog } from './modal/useModalDialog';

export interface MediaPreviewDialogProps {
  kind: 'image' | 'video' | 'audio';
  /** File name shown in the header. */
  name: string;
  /** Secondary header text, e.g. size and MIME type. */
  detail: string;
  /** Resolved URL; `null` while it resolves. */
  src: string | null;
  /** The URL could not be resolved. */
  failed?: boolean;
  isDark: boolean;
  onClose: () => void;
}

export function MediaPreviewDialog({
  kind,
  name,
  detail,
  src,
  failed = false,
  isDark,
  onClose,
}: MediaPreviewDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [playbackFailed, setPlaybackFailed] = useState(false);
  useModalDialog({ rootRef: overlayRef, dialogRef, onClose });

  useEffect(() => setPlaybackFailed(false), [src]);

  let body: React.ReactNode;
  if (failed || playbackFailed || src === '') {
    body = <div className="squisq-media-preview-message">This file can’t be previewed.</div>;
  } else if (src === null) {
    body = <div className="squisq-media-preview-message">Loading…</div>;
  } else if (kind === 'image') {
    body = <ImageViewer src={src} alt={name} theme={isDark ? 'dark' : 'light'} />;
  } else if (kind === 'video') {
    body = (
      <video
        className="squisq-media-preview-video"
        src={src}
        controls
        autoPlay
        playsInline
        onError={() => setPlaybackFailed(true)}
      />
    );
  } else {
    body = (
      <div className="squisq-media-preview-audio">
        <span className="squisq-media-preview-audio-icon" aria-hidden="true">
          {'\u{1F50A}'}
        </span>
        <audio src={src} controls autoPlay onError={() => setPlaybackFailed(true)} />
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="squisq-media-preview"
      data-theme={isDark ? 'dark' : 'light'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      {...ownsContextMenuProps}
    >
      <div
        ref={dialogRef}
        className={`squisq-media-preview-surface squisq-media-preview-surface--${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="media-preview-dialog"
      >
        <header className="squisq-media-preview-header">
          <span id={titleId} className="squisq-media-preview-title" title={name}>
            {name}
          </span>
          <span className="squisq-media-preview-detail">{detail}</span>
          <button
            type="button"
            className="squisq-media-preview-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </header>
        <div className="squisq-media-preview-body">{body}</div>
      </div>
    </div>
  );
}
