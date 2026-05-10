/**
 * LinkDialog — modal for inserting or editing a markdown link.
 *
 * Used by both the WYSIWYG and Raw markdown toolbars so the link-editing
 * UX is identical regardless of view. Shows separate fields for the link
 * text (caption) and the URL target so the user can see and edit both.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface LinkDialogProps {
  /** Whether this is a brand-new link (Insert) or an existing one (Update). */
  mode: 'insert' | 'update';
  /** Initial value for the caption field. */
  initialText: string;
  /** Initial value for the URL field. */
  initialUrl: string;
  /**
   * Confirm — `text` may be empty if the caller wants to fall back to URL
   * as the visible text. Empty `url` means the user cleared it; callers
   * should treat that as "remove link" when in update mode.
   */
  onConfirm: (text: string, url: string) => void;
  /** Dismiss without applying changes. */
  onClose: () => void;
}

/**
 * Centered modal with Text and URL inputs. Submits on Enter, dismisses
 * on Escape or backdrop click. Auto-focuses URL when the text field is
 * already populated; otherwise focuses Text.
 */
export function LinkDialog({
  mode,
  initialText,
  initialUrl,
  onConfirm,
  onClose,
}: LinkDialogProps) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const textRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // If we have a caption already, the URL is what the user is most
    // likely here to edit; otherwise focus the caption field first.
    const target = initialText ? urlRef.current : textRef.current;
    target?.focus();
    target?.select();
  }, [initialText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onConfirm(text, url);
    },
    [text, url, onConfirm],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const isUpdate = mode === 'update';
  const submitLabel = isUpdate ? 'Update' : 'Insert';
  const heading = isUpdate ? 'Edit link' : 'Insert link';

  return (
    <div className="squisq-link-dialog-overlay" onMouseDown={handleBackdropClick}>
      <form className="squisq-link-dialog" onSubmit={handleSubmit}>
        <div className="squisq-link-dialog-header">
          <h2 className="squisq-link-dialog-title">{heading}</h2>
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
            <span className="squisq-link-dialog-label">Text</span>
            <input
              ref={textRef}
              type="text"
              className="squisq-link-dialog-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Link caption"
            />
          </label>
          <label className="squisq-link-dialog-field">
            <span className="squisq-link-dialog-label">URL</span>
            <input
              ref={urlRef}
              type="text"
              className="squisq-link-dialog-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              spellCheck={false}
              autoComplete="off"
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
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
