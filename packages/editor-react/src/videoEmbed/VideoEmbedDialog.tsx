/**
 * VideoEmbedDialog — Insert → Online Video.
 *
 * One field takes whatever the author has: a page URL in any of the forms
 * people copy (`youtu.be/…`, `…/watch?v=…&t=90`, `vimeo.com/…`, Shorts, a
 * playlist) or a provider's `<iframe>` embed code. It is recognized as it is
 * typed, a live player previews it, and confirming hands back the normalized
 * video — the caller writes its canonical watch URL, never the raw input.
 *
 * Shares the link dialog's frame and modal contract (`useModalDialog`).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  VIDEO_EMBED_PROVIDERS,
  parseVideoEmbedInput,
  type VideoEmbed,
} from '@bendyline/squisq/markdown';
import { VideoEmbedFrame } from '@bendyline/squisq-react';
import { useModalDialog } from '../modal/useModalDialog';

export interface VideoEmbedDialogProps {
  /** A new video (Insert) or the one under the caret (Update). */
  mode: 'insert' | 'update';
  /** Initial URL / embed code. */
  initialInput: string;
  /** Initial title. */
  initialTitle: string;
  /** Confirm with the recognized video and the (trimmed, possibly empty) title. */
  onConfirm: (embed: VideoEmbed, title: string) => void;
  /** Dismiss without changes. */
  onClose: () => void;
}

const PROVIDER_LIST = (() => {
  const names = VIDEO_EMBED_PROVIDERS.map((p) => p.name);
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
})();

/** `90` → `1:30`, `3723` → `1:02:03`. */
function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** What the dialog recognized, in a few words. */
function describe(embed: VideoEmbed): string {
  const playlistOnly = embed.playlistId === embed.id;
  const parts = [`${embed.providerName} ${playlistOnly ? 'playlist' : 'video'}`];
  if (embed.playlistId && !playlistOnly) parts.push('plays within its playlist');
  if (embed.startSeconds) parts.push(`starts at ${formatClock(embed.startSeconds)}`);
  if (embed.aspectRatio < 1) parts.push('portrait');
  return parts.join(' · ');
}

export function VideoEmbedDialog({
  mode,
  initialInput,
  initialTitle,
  onConfirm,
  onClose,
}: VideoEmbedDialogProps) {
  const [input, setInput] = useState(initialInput);
  const [title, setTitle] = useState(initialTitle);
  // Once the author has typed a title, embed code never overwrites it.
  const titleTouched = useRef(initialTitle.trim() !== '');
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const statusId = useId();
  useModalDialog({ rootRef: overlayRef, dialogRef, initialFocusRef: inputRef, onClose });

  const parsed = useMemo(() => parseVideoEmbedInput(input), [input]);
  const hasInput = input.trim() !== '';

  // Pasted embed code often names the video (`title="Product tour"`).
  useEffect(() => {
    if (!titleTouched.current && parsed?.title) setTitle(parsed.title);
  }, [parsed]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!parsed) {
        inputRef.current?.focus();
        return;
      }
      onConfirm(parsed.embed, title.trim());
    },
    [parsed, title, onConfirm],
  );

  const isUpdate = mode === 'update';
  const invalid = hasInput && !parsed;

  return (
    <div
      ref={overlayRef}
      className="squisq-link-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        className="squisq-link-dialog squisq-video-dialog"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        data-testid="video-embed-dialog"
      >
        <div className="squisq-link-dialog-header">
          <h2 id={headingId} className="squisq-link-dialog-title">
            {isUpdate ? 'Edit video' : 'Insert video'}
          </h2>
          <button
            type="button"
            className="squisq-link-dialog-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="squisq-link-dialog-body">
          <label className="squisq-link-dialog-field">
            <span className="squisq-link-dialog-label">Video link or embed code</span>
            <input
              ref={inputRef}
              type="text"
              className={`squisq-link-dialog-input${invalid ? ' squisq-link-dialog-input--invalid' : ''}`}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={VIDEO_EMBED_PROVIDERS[0]!.example}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid ? true : undefined}
              aria-describedby={statusId}
            />
            {parsed ? (
              <span
                id={statusId}
                className="squisq-video-dialog-status squisq-video-dialog-status--ok"
              >
                ✓ {describe(parsed.embed)}
              </span>
            ) : invalid ? (
              <span id={statusId} className="squisq-link-dialog-error">
                That isn’t a link to a video that can play here. Use a {PROVIDER_LIST} link, or the
                embed code from the video’s Share menu.
              </span>
            ) : (
              <span id={statusId} className="squisq-video-dialog-hint">
                Paste a link from {PROVIDER_LIST} — or the video’s embed code.
              </span>
            )}
          </label>
          {parsed ? (
            <div className="squisq-video-dialog-preview">
              <VideoEmbedFrame
                key={parsed.embed.embedUrl}
                embed={parsed.embed}
                title={title.trim() || null}
                showCaption={false}
              />
            </div>
          ) : null}
          <label className="squisq-link-dialog-field">
            <span className="squisq-link-dialog-label">Title (optional)</span>
            <input
              type="text"
              className="squisq-link-dialog-input"
              value={title}
              onChange={(event) => {
                titleTouched.current = true;
                setTitle(event.target.value);
              }}
              placeholder="Shown under the video, and as the link text elsewhere"
            />
          </label>
        </div>
        <div className="squisq-link-dialog-footer">
          <button
            type="button"
            className="squisq-link-dialog-btn squisq-link-dialog-btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="squisq-link-dialog-btn squisq-link-dialog-btn--primary"
            disabled={!parsed}
          >
            {isUpdate ? 'Update' : 'Insert'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default VideoEmbedDialog;
