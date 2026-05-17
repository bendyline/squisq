/**
 * DocumentSettingsDialog
 *
 * Modal editor for the frontmatter values that Squisq currently
 * understands: document title plus the persisted preview keys
 * (`squisq-theme`, `squisq-transform`, `squisq-captions`). Writes back
 * to the same `setFrontmatterValues` channel that `PreviewControls`
 * uses, so any change made here is reflected in the play-mode controls
 * (and vice versa).
 *
 * Title behavior: the placeholder shows the title that
 * `inferDocumentTitle()` would derive from frontmatter or headings.
 * When the user-entered title is empty or equal to the inferred title,
 * the `title:` key is removed from frontmatter — there's no point
 * storing a redundant value.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  inferDocumentTitle,
  parseMarkdown,
  setFrontmatterValues,
} from '@bendyline/squisq/markdown';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import { ThemePicker } from './ThemePicker';

// ── Frontmatter key constants ─────────────────────────────────────

/** Mirror of `FM_KEYS` in PreviewControls.tsx. Canonical names are the
 *  ones we write; legacy aliases are still read so older docs work. */
const FM = {
  theme: { canonical: 'squisq-theme', legacy: 'theme' },
  transform: { canonical: 'squisq-transform', legacy: 'transform-style' },
  captions: { canonical: 'squisq-captions', legacy: 'caption-style' },
} as const;

function readFm(fm: Record<string, unknown> | undefined, canonical: string, legacy: string): string {
  if (!fm) return '';
  const v = Object.prototype.hasOwnProperty.call(fm, canonical) ? fm[canonical] : fm[legacy];
  return typeof v === 'string' ? v : '';
}

const CAPTION_OPTIONS: readonly { key: string; label: string }[] = [
  { key: '', label: 'Default (Standard)' },
  { key: 'standard', label: 'Standard' },
  { key: 'social', label: 'Social' },
];

// ── Props ─────────────────────────────────────────────────────────

export interface DocumentSettingsDialogProps {
  /** Current markdown source string (frontmatter + body). */
  markdownSource: string;
  /** Called with the rewritten source after the user clicks Save. */
  onSave: (nextSource: string) => void;
  /** Called when the dialog is dismissed (Cancel, Escape, backdrop click). */
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────

export function DocumentSettingsDialog({
  markdownSource,
  onSave,
  onClose,
}: DocumentSettingsDialogProps) {
  // Parse once at open; further edits flow through local form state and
  // are committed in a single `setFrontmatterValues` call on Save.
  const parsed = useMemo(() => parseMarkdown(markdownSource), [markdownSource]);
  const frontmatter = parsed.frontmatter;
  const inferredTitle = useMemo(() => inferDocumentTitle(parsed), [parsed]);

  const currentTitle =
    typeof frontmatter?.title === 'string' ? (frontmatter.title as string) : '';
  const currentTheme = readFm(frontmatter, FM.theme.canonical, FM.theme.legacy);
  const currentTransform = readFm(frontmatter, FM.transform.canonical, FM.transform.legacy);
  const currentCaptions = readFm(frontmatter, FM.captions.canonical, FM.captions.legacy);

  const [title, setTitle] = useState(currentTitle);
  const [theme, setTheme] = useState(currentTheme);
  const [transform, setTransform] = useState(currentTransform);
  const [captions, setCaptions] = useState(currentCaptions);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // Esc closes; click on backdrop closes (but not on dialog itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Dropdown options — built once per render; cheap.
  const transformOptions = useMemo(
    () => [
      { key: '', label: 'None' },
      ...getTransformStyleSummaries().map((s) => ({ key: s.id, label: s.name })),
    ],
    [],
  );

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedTitle = title.trim();
      const titleMatchesInferred = !!inferredTitle && trimmedTitle === inferredTitle;
      // Empty input OR matches the value we'd infer otherwise → no
      // explicit title needed in frontmatter.
      const nextTitle = !trimmedTitle || titleMatchesInferred ? null : trimmedTitle;

      const updates: Record<string, string | null> = {
        title: nextTitle,
        [FM.theme.canonical]: theme || null,
        // Legacy `theme` key would shadow our canonical one — clear it
        // when the user changes the theme so the canonical write wins.
        ...(currentTheme && theme !== currentTheme ? { [FM.theme.legacy]: null } : {}),
        [FM.transform.canonical]: transform || null,
        ...(currentTransform && transform !== currentTransform
          ? { [FM.transform.legacy]: null }
          : {}),
        [FM.captions.canonical]: captions || null,
        ...(currentCaptions && captions !== currentCaptions
          ? { [FM.captions.legacy]: null }
          : {}),
      };

      const nextSource = setFrontmatterValues(markdownSource, updates);
      onSave(nextSource);
    },
    [
      title,
      theme,
      transform,
      captions,
      inferredTitle,
      markdownSource,
      currentTheme,
      currentTransform,
      currentCaptions,
      onSave,
    ],
  );

  return (
    <div className="squisq-doc-settings-overlay" onMouseDown={handleBackdrop}>
      <form className="squisq-doc-settings-dialog" onSubmit={handleSave}>
        <div className="squisq-doc-settings-header">
          <h2 className="squisq-doc-settings-title">Document settings</h2>
          <button
            type="button"
            className="squisq-doc-settings-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="squisq-doc-settings-body">
          <div className="squisq-doc-settings-field">
            <label className="squisq-doc-settings-label" htmlFor="squisq-doc-settings-title">
              Title
            </label>
            <input
              ref={titleRef}
              id="squisq-doc-settings-title"
              type="text"
              className="squisq-doc-settings-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={inferredTitle ?? 'Document title'}
              spellCheck
            />
            {inferredTitle ? (
              <span className="squisq-doc-settings-hint">
                Defaults to <strong>{inferredTitle}</strong> — leave blank to use it.
              </span>
            ) : (
              <span className="squisq-doc-settings-hint">
                No title heading found — set one here or add an H1 to the document.
              </span>
            )}
          </div>

          <div className="squisq-doc-settings-field">
            <span className="squisq-doc-settings-label">Theme</span>
            <ThemePicker
              value={theme}
              onChange={setTheme}
              includeDefault
              variant="full"
              ariaLabel="Theme"
            />
          </div>

          <div className="squisq-doc-settings-field">
            <label className="squisq-doc-settings-label" htmlFor="squisq-doc-settings-transform">
              Transform
            </label>
            <select
              id="squisq-doc-settings-transform"
              className="squisq-doc-settings-input"
              value={transform}
              onChange={(e) => setTransform(e.target.value)}
            >
              {transformOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="squisq-doc-settings-field">
            <label className="squisq-doc-settings-label" htmlFor="squisq-doc-settings-captions">
              Captions
            </label>
            <select
              id="squisq-doc-settings-captions"
              className="squisq-doc-settings-input"
              value={captions}
              onChange={(e) => setCaptions(e.target.value)}
            >
              {CAPTION_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="squisq-doc-settings-footer">
          <button
            type="button"
            className="squisq-doc-settings-btn squisq-doc-settings-btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="squisq-doc-settings-btn squisq-doc-settings-btn--primary"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
