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

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  inferDocumentTitle,
  parseMarkdown,
  readFrontmatterThemeId,
  setFrontmatterValues,
} from '@bendyline/squisq/markdown';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import { ThemePicker } from './ThemePicker';
import { resolvePersistedTransformStyleId } from './transformStyleId';
import {
  FRONTMATTER_SETTING_DEFAULTS,
  FRONTMATTER_SETTING_KEYS,
  omitFrontmatterDefault,
} from './frontmatterSettings';
import { useModalDialog } from './modal/useModalDialog';

// ── Frontmatter key constants ─────────────────────────────────────

function readFm(
  fm: Record<string, unknown> | undefined,
  canonical: string,
  legacy: string,
): string {
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

  const currentTitle = typeof frontmatter?.title === 'string' ? (frontmatter.title as string) : '';
  const currentTheme = readFrontmatterThemeId(frontmatter) ?? '';
  const currentTransform =
    resolvePersistedTransformStyleId(
      readFm(
        frontmatter,
        FRONTMATTER_SETTING_KEYS.transform.canonical,
        FRONTMATTER_SETTING_KEYS.transform.legacy,
      ),
    ) ?? '';
  const currentCaptions = readFm(
    frontmatter,
    FRONTMATTER_SETTING_KEYS.captions.canonical,
    FRONTMATTER_SETTING_KEYS.captions.legacy,
  );

  const [title, setTitle] = useState(currentTitle);
  const [theme, setTheme] = useState(currentTheme);
  const [transform, setTransform] = useState(currentTransform);
  const [captions, setCaptions] = useState(currentCaptions);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  useModalDialog({ rootRef: overlayRef, dialogRef, initialFocusRef: titleRef, onClose });

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
        [FRONTMATTER_SETTING_KEYS.theme.canonical]: omitFrontmatterDefault(
          theme || FRONTMATTER_SETTING_DEFAULTS.theme,
          FRONTMATTER_SETTING_DEFAULTS.theme,
        ),
        // Saving settings canonicalizes all older theme spellings.
        [FRONTMATTER_SETTING_KEYS.theme.legacy[0]]: null,
        [FRONTMATTER_SETTING_KEYS.theme.legacy[1]]: null,
        [FRONTMATTER_SETTING_KEYS.transform.canonical]: omitFrontmatterDefault(
          transform,
          FRONTMATTER_SETTING_DEFAULTS.transform,
        ),
        [FRONTMATTER_SETTING_KEYS.transform.legacy]: null,
        [FRONTMATTER_SETTING_KEYS.captions.canonical]: omitFrontmatterDefault(
          captions || FRONTMATTER_SETTING_DEFAULTS.captions,
          FRONTMATTER_SETTING_DEFAULTS.captions,
        ),
        [FRONTMATTER_SETTING_KEYS.captions.legacy]: null,
      };

      const nextSource = setFrontmatterValues(markdownSource, updates);
      onSave(nextSource);
    },
    [title, theme, transform, captions, inferredTitle, markdownSource, onSave],
  );

  return (
    <div ref={overlayRef} className="squisq-doc-settings-overlay" onMouseDown={handleBackdrop}>
      <form
        ref={dialogRef}
        className="squisq-doc-settings-dialog"
        onSubmit={handleSave}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <div className="squisq-doc-settings-header">
          <h2 id={headingId} className="squisq-doc-settings-title">
            Document settings
          </h2>
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
