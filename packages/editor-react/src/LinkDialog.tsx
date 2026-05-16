/**
 * LinkDialog — modal for inserting or editing a markdown link.
 *
 * Used by both the WYSIWYG and Raw markdown toolbars so the link-editing
 * UX is identical regardless of view. Shows separate fields for the link
 * text (caption) and the URL target so the user can see and edit both.
 *
 * When a `documentLinkProvider` is supplied, the dialog also exposes a
 * second tab — "Browse documents" — that lists neighbor docs from the
 * host's workspace. Selecting one fills the URL with the candidate
 * path (and the caption, if it was still empty), so authors can link
 * `home.md → resume.md` without typing the relative path by hand.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentLinkProvider, DocumentLinkCandidate } from './EditorContext';

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
  /**
   * Optional sibling-document picker. When provided, the dialog shows
   * a "Browse documents" tab that queries the provider as the author
   * types and offers click-to-pick suggestions.
   */
  documentLinkProvider?: DocumentLinkProvider | null;
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
  documentLinkProvider,
}: LinkDialogProps) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const [tab, setTab] = useState<'url' | 'documents'>('url');
  const [docQuery, setDocQuery] = useState('');
  const [docResults, setDocResults] = useState<DocumentLinkCandidate[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const docSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // If we have a caption already, the URL is what the user is most
    // likely here to edit; otherwise focus the caption field first.
    const target = initialText ? urlRef.current : textRef.current;
    target?.focus();
    target?.select();
  }, [initialText]);

  // Refresh the document candidate list whenever the user types into
  // the picker or first opens it. Empty query = initial list.
  useEffect(() => {
    if (!documentLinkProvider || tab !== 'documents') return;
    let cancelled = false;
    setDocLoading(true);
    documentLinkProvider(docQuery)
      .then((results) => {
        if (!cancelled) {
          setDocResults(results);
          setDocLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDocResults([]);
          setDocLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [docQuery, documentLinkProvider, tab]);

  // Auto-focus the search field when the documents tab opens.
  useEffect(() => {
    if (tab === 'documents') {
      const t = setTimeout(() => docSearchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [tab]);

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

  const handlePickCandidate = useCallback((candidate: DocumentLinkCandidate) => {
    // Picking a document fills the URL and the caption (when the
    // caption is still empty — preserve any caption the user already
    // typed). Switch back to the URL tab so the result is immediately
    // visible and editable, and so Enter submits the form.
    setUrl(candidate.path);
    setText((existing) => existing || candidate.label);
    setTab('url');
  }, []);

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
          {documentLinkProvider && (
            <div className="squisq-link-dialog-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'url'}
                className={`squisq-link-dialog-tab${tab === 'url' ? ' squisq-link-dialog-tab--active' : ''}`}
                onClick={() => setTab('url')}
              >
                URL
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'documents'}
                className={`squisq-link-dialog-tab${tab === 'documents' ? ' squisq-link-dialog-tab--active' : ''}`}
                onClick={() => setTab('documents')}
              >
                Browse documents
              </button>
            </div>
          )}
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
          {tab === 'url' ? (
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
          ) : (
            <div className="squisq-link-dialog-doc-picker">
              <label className="squisq-link-dialog-field">
                <span className="squisq-link-dialog-label">Search</span>
                <input
                  ref={docSearchRef}
                  type="text"
                  className="squisq-link-dialog-input"
                  value={docQuery}
                  onChange={(e) => setDocQuery(e.target.value)}
                  placeholder="Type to filter…"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <div
                className="squisq-link-dialog-doc-list"
                role="listbox"
                aria-label="Document candidates"
                aria-busy={docLoading}
              >
                {docLoading && docResults.length === 0 ? (
                  <div className="squisq-link-dialog-doc-empty">Loading…</div>
                ) : docResults.length === 0 ? (
                  <div className="squisq-link-dialog-doc-empty">
                    {docQuery.trim() ? `No matches for "${docQuery.trim()}"` : 'No documents'}
                  </div>
                ) : (
                  docResults.map((c) => (
                    <button
                      key={c.path}
                      type="button"
                      role="option"
                      aria-selected={url === c.path}
                      className={`squisq-link-dialog-doc-item${url === c.path ? ' squisq-link-dialog-doc-item--selected' : ''}`}
                      onClick={() => handlePickCandidate(c)}
                    >
                      <span className="squisq-link-dialog-doc-item-label">{c.label}</span>
                      <span className="squisq-link-dialog-doc-item-path">{c.path}</span>
                      {c.description && (
                        <span className="squisq-link-dialog-doc-item-desc">{c.description}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
              {url && (
                <div className="squisq-link-dialog-doc-current">
                  Selected: <code>{url}</code>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="squisq-link-dialog-footer">
          <button
            type="button"
            className="squisq-link-dialog-btn squisq-link-dialog-btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="squisq-link-dialog-btn squisq-link-dialog-btn--primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
