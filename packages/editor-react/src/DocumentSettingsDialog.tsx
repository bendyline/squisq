/**
 * DocumentSettingsDialog
 *
 * Modal editor for the frontmatter values that Squisq currently
 * understands: document title and cover subtitle plus the persisted preview keys
 * (`squisq-theme`, `squisq-transform`, `squisq-captions`), and — when the
 * host renders the document through page templates — its page template
 * (`squisq-output-template`). Writes back
 * to the same `setFrontmatterValues` channel that `PreviewControls`
 * uses, so any change made here is reflected in the play-mode controls
 * (and vice versa).
 *
 * Title behavior: the placeholder shows the title that
 * `inferDocumentTitle()` would derive from frontmatter or headings.
 * When the user-entered title is empty or equal to the inferred title,
 * the `title:` key is removed from frontmatter — there's no point
 * storing a redundant value.
 *
 * Properties: the document's own frontmatter keys (`author`, `tags`,
 * `description`, …) are edited as name/value rows beneath the settings and
 * written in the same Save. Rows left untouched keep their exact text.
 *
 * Editor: when the host passes `onEditorStylingChange`, a last section sets
 * how much of the theme the Write view takes on. That is the person's own
 * editor preference, applied on Save and never written into the document.
 *
 * Layout: one column, until the dialog is wide enough for two (desktop
 * windows). Then Title, Subtitle and the sections keep the full width
 * (`--wide`, sections always), the short pickers pair up, and the two
 * proofing fields start a row together (`--row-start`).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  inferDocumentTitle,
  parseMarkdown,
  readFrontmatterThemeId,
  setFrontmatterValues,
} from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { getTransformStyleSummaries } from '@bendyline/squisq/transform';
import { ThemePicker } from './ThemePicker';
import { resolvePersistedTransformStyleId } from './transformStyleId';
import {
  FRONTMATTER_SETTING_DEFAULTS,
  FRONTMATTER_SETTING_KEYS,
  omitFrontmatterDefault,
  themeFrontmatterValue,
} from './frontmatterSettings';
import { useModalDialog } from './modal/useModalDialog';
import type { ThemeInheritance } from './EditorContext';
import { FrontmatterPropertiesGrid } from './FrontmatterPropertiesGrid';
import {
  applyPropertyEdits,
  planPropertyEdits,
  readCustomProperties,
  rowsFromProperties,
  validatePropertyRows,
  type PropertyRow,
} from './frontmatterProperties';
import { PROOF_DIALECTS, PROOF_FRONTMATTER_KEYS } from '@bendyline/squisq/proof';
import { useProofingState } from './proofing/ProofingContext';
import { OUTSIDE_IN_OUTPUT_TEMPLATE_KEY } from '@bendyline/squisq-formats/outside-in-layout';
import {
  usePageTemplateSettings,
  type PageTemplateChoice,
  type PageTemplateSettings,
} from './pageTemplates';

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

const EDITOR_STYLING_OPTIONS: readonly { value: ThemeInheritance; label: string }[] = [
  { value: 'none', label: "Don't inherit" },
  { value: 'fonts', label: 'Fonts only' },
  { value: 'fonts-colors', label: 'Fonts & colors' },
];

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
  /**
   * Host default theme a document without its own theme inherits (see
   * `EditorShell`'s `defaultThemeId`). When set, the Theme picker's default
   * entry names it, and choosing any concrete theme — the built-in default
   * included — is saved explicitly; only the default entry removes the key.
   * Omitted: choosing the built-in default removes the key, as before.
   */
  defaultThemeId?: string;
  /** Label for the Theme picker's default entry. Defaults to `'Default'`. */
  defaultThemeLabel?: string;
  /**
   * Page template capability. Defaults to the one `EditorShell` received as
   * `pageTemplates`; the Page template field appears only when one is set.
   */
  pageTemplates?: PageTemplateSettings | null;
  /** How much of the theme the Write view takes on now (`EditorShell`'s `themeInheritance`). */
  editorStyling?: ThemeInheritance;
  /**
   * Applies a new Write-view styling on Save. The Editor section — a personal
   * preference, not part of the document — appears only when this is set.
   */
  onEditorStylingChange?: (styling: ThemeInheritance) => void;
}

/** The authored template choice: a path, `'none'`, or `''` for the default. */
function readPageTemplate(fm: Record<string, unknown> | undefined): string {
  const value = fm?.[OUTSIDE_IN_OUTPUT_TEMPLATE_KEY];
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.toLowerCase() === 'none' ? 'none' : trimmed;
}

// ── Component ─────────────────────────────────────────────────────

export function DocumentSettingsDialog({
  markdownSource,
  onSave,
  onClose,
  defaultThemeId,
  defaultThemeLabel,
  pageTemplates: pageTemplatesProp,
  editorStyling: currentEditorStyling = 'fonts',
  onEditorStylingChange,
}: DocumentSettingsDialogProps) {
  const hostDefaultThemeId = defaultThemeId?.trim() || undefined;
  const contextPageTemplates = usePageTemplateSettings();
  const pageTemplates = pageTemplatesProp === undefined ? contextPageTemplates : pageTemplatesProp;
  // Parse once at open; further edits flow through local form state and
  // are committed in a single `setFrontmatterValues` call on Save.
  const parsed = useMemo(() => parseMarkdown(markdownSource), [markdownSource]);
  const frontmatter = parsed.frontmatter;
  const inferredTitle = useMemo(() => inferDocumentTitle(parsed), [parsed]);
  const inferredSubtitle = useMemo(
    () =>
      markdownToDoc({
        ...parsed,
        // Ignore an explicit subtitle while calculating the value the cover
        // would otherwise inherit from document content.
        frontmatter: { ...parsed.frontmatter, subtitle: null },
      }).startBlock?.subtitle,
    [parsed],
  );

  const currentTitle = typeof frontmatter?.title === 'string' ? (frontmatter.title as string) : '';
  const currentSubtitle =
    typeof frontmatter?.subtitle === 'string' ? (frontmatter.subtitle as string) : '';
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
  const [subtitle, setSubtitle] = useState(currentSubtitle);
  const [theme, setTheme] = useState(currentTheme);
  const [transform, setTransform] = useState(currentTransform);
  const [captions, setCaptions] = useState(currentCaptions);
  const [editorStyling, setEditorStyling] = useState<ThemeInheritance>(currentEditorStyling);
  const proofingState = useProofingState();
  const currentProofing = readFm(
    frontmatter,
    PROOF_FRONTMATTER_KEYS.enabled.canonical,
    PROOF_FRONTMATTER_KEYS.enabled.legacy,
  ).toLowerCase();
  const currentProofDialect = readFm(
    frontmatter,
    PROOF_FRONTMATTER_KEYS.dialect.canonical,
    PROOF_FRONTMATTER_KEYS.dialect.legacy,
  );
  const [proofingEnabled, setProofingEnabled] = useState(
    typeof frontmatter?.[PROOF_FRONTMATTER_KEYS.enabled.canonical] === 'boolean'
      ? String(frontmatter[PROOF_FRONTMATTER_KEYS.enabled.canonical])
      : currentProofing === 'true' || currentProofing === 'false'
        ? currentProofing
        : '',
  );
  const [proofDialect, setProofDialect] = useState(currentProofDialect);
  const currentPageTemplate = readPageTemplate(frontmatter);
  const [pageTemplate, setPageTemplate] = useState(currentPageTemplate);
  const [templateChoices, setTemplateChoices] = useState<{
    status: 'loading' | 'ready' | 'error';
    choices: readonly PageTemplateChoice[];
    message?: string;
  }>({ status: 'loading', choices: [] });
  useEffect(() => {
    if (!pageTemplates) return;
    let current = true;
    pageTemplates.listTemplates().then(
      (choices) => {
        if (current) setTemplateChoices({ status: 'ready', choices });
      },
      (error: unknown) => {
        if (current) {
          setTemplateChoices({
            status: 'error',
            choices: [],
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [pageTemplates]);

  const [propertyRows, setPropertyRows] = useState<PropertyRow[]>(() =>
    rowsFromProperties(readCustomProperties(markdownSource)),
  );
  // Until Save is tried, only names actually typed are checked: a row just
  // added shouldn't open with "Give this property a name".
  const [propertiesSubmitted, setPropertiesSubmitted] = useState(false);
  const propertyErrors = useMemo(() => validatePropertyRows(propertyRows), [propertyRows]);
  const shownPropertyErrors = useMemo(
    () =>
      propertiesSubmitted
        ? propertyErrors
        : new Map(
            [...propertyErrors].filter(([id]) =>
              propertyRows.some((row) => row.id === id && row.key.trim() !== ''),
            ),
          ),
    [propertiesSubmitted, propertyErrors, propertyRows],
  );

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const propertiesHeadingId = useId();
  const editorHeadingId = useId();
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

      const firstInvalid = propertyRows.find((row) => propertyErrors.has(row.id));
      if (firstInvalid) {
        setPropertiesSubmitted(true);
        dialogRef.current
          ?.querySelector<HTMLInputElement>(
            `[data-row-id="${firstInvalid.id}"] .squisq-fm-props-name`,
          )
          ?.focus();
        return;
      }

      const trimmedTitle = title.trim();
      const titleMatchesInferred = !!inferredTitle && trimmedTitle === inferredTitle;
      // Empty input OR matches the value we'd infer otherwise → no
      // explicit title needed in frontmatter.
      const nextTitle = !trimmedTitle || titleMatchesInferred ? null : trimmedTitle;
      const trimmedSubtitle = subtitle.trim();
      const subtitleMatchesInferred =
        !!inferredSubtitle && trimmedSubtitle === inferredSubtitle.trim();
      const nextSubtitle = !trimmedSubtitle || subtitleMatchesInferred ? null : trimmedSubtitle;

      const updates: Record<string, string | null> = {
        title: nextTitle,
        subtitle: nextSubtitle,
        [FRONTMATTER_SETTING_KEYS.theme.canonical]: themeFrontmatterValue(
          theme,
          hostDefaultThemeId !== undefined,
        ),
        // Saving settings canonicalizes all older theme spellings.
        [FRONTMATTER_SETTING_KEYS.theme.legacy[0]]: null,
        [FRONTMATTER_SETTING_KEYS.theme.legacy[1]]: null,
        ...(transform !== currentTransform ? { 'squisq-presentation': null } : {}),
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
      // Proofing keys only when a capability exists — a doc edited in a
      // host with no proofing shouldn't have its keys churned.
      const proofingUpdates: Record<string, string | boolean | null> = proofingState
        ? {
            [PROOF_FRONTMATTER_KEYS.enabled.canonical]:
              proofingEnabled === '' ? null : proofingEnabled === 'true',
            [PROOF_FRONTMATTER_KEYS.enabled.legacy]: null,
            [PROOF_FRONTMATTER_KEYS.dialect.canonical]: proofDialect || null,
            [PROOF_FRONTMATTER_KEYS.dialect.legacy]: null,
          }
        : {};

      // Only a host that renders through page templates owns this key.
      const pageTemplateUpdates: Record<string, string | null> =
        pageTemplates && pageTemplate !== currentPageTemplate
          ? { [OUTSIDE_IN_OUTPUT_TEMPLATE_KEY]: pageTemplate || null }
          : {};

      const withSettings = setFrontmatterValues(markdownSource, {
        ...updates,
        ...proofingUpdates,
        ...pageTemplateUpdates,
      });
      // Settings and properties never share a key, so the property edits
      // planned against the source still apply to the rewritten one.
      const nextSource = applyPropertyEdits(
        withSettings,
        planPropertyEdits(readCustomProperties(markdownSource), propertyRows),
      );
      if (onEditorStylingChange && editorStyling !== currentEditorStyling) {
        onEditorStylingChange(editorStyling);
      }
      onSave(nextSource);
    },
    [
      propertyRows,
      propertyErrors,
      title,
      subtitle,
      theme,
      transform,
      currentTransform,
      captions,
      proofingState,
      proofingEnabled,
      proofDialect,
      pageTemplates,
      pageTemplate,
      currentPageTemplate,
      inferredTitle,
      inferredSubtitle,
      hostDefaultThemeId,
      markdownSource,
      onEditorStylingChange,
      editorStyling,
      currentEditorStyling,
      onSave,
    ],
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
          <div className="squisq-doc-settings-field squisq-doc-settings-field--wide">
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

          <div className="squisq-doc-settings-field squisq-doc-settings-field--wide">
            <label className="squisq-doc-settings-label" htmlFor="squisq-doc-settings-subtitle">
              Subtitle
            </label>
            <input
              id="squisq-doc-settings-subtitle"
              type="text"
              className="squisq-doc-settings-input"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={inferredSubtitle ?? 'Cover subtitle'}
              spellCheck
            />
            {inferredSubtitle ? (
              <span className="squisq-doc-settings-hint">
                Defaults to <strong>{inferredSubtitle}</strong> — leave blank to use it.
              </span>
            ) : (
              <span className="squisq-doc-settings-hint">
                Optional supporting text shown on the document cover.
              </span>
            )}
          </div>

          <div className="squisq-doc-settings-field">
            <span className="squisq-doc-settings-label">Theme</span>
            <ThemePicker
              value={theme}
              onChange={setTheme}
              includeDefault
              defaultThemeId={hostDefaultThemeId}
              defaultLabel={defaultThemeLabel}
              variant="full"
              ariaLabel="Theme"
            />
          </div>

          {pageTemplates && (
            <div className="squisq-doc-settings-field">
              <label
                className="squisq-doc-settings-label"
                htmlFor="squisq-doc-settings-page-template"
              >
                Page template
              </label>
              <select
                id="squisq-doc-settings-page-template"
                className="squisq-doc-settings-input"
                value={pageTemplate}
                onChange={(e) => setPageTemplate(e.target.value)}
                aria-describedby="squisq-doc-settings-page-template-hint"
              >
                <option value="">{pageTemplates.defaultLabel ?? 'None'}</option>
                {pageTemplates.defaultLabel && <option value="none">None</option>}
                {templateChoices.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
                {pageTemplate &&
                  pageTemplate !== 'none' &&
                  !templateChoices.choices.some((choice) => choice.value === pageTemplate) && (
                    <option value={pageTemplate}>{pageTemplate}</option>
                  )}
              </select>
              <span
                id="squisq-doc-settings-page-template-hint"
                className="squisq-doc-settings-hint"
                role={templateChoices.status === 'error' ? 'alert' : undefined}
              >
                {templateChoices.status === 'loading'
                  ? 'Looking for page templates…'
                  : templateChoices.status === 'error'
                    ? `Page templates couldn’t be listed: ${templateChoices.message}`
                    : templateChoices.choices.length === 0
                      ? 'No page templates found. A page template is an HTML file with a <slot> where the content goes.'
                      : 'The page this document is generated inside. Its <slot> receives the content.'}
              </span>
            </div>
          )}

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

          {proofingState && (
            <>
              <div className="squisq-doc-settings-field squisq-doc-settings-field--row-start">
                <label className="squisq-doc-settings-label" htmlFor="squisq-doc-settings-proofing">
                  Proofing
                </label>
                <select
                  id="squisq-doc-settings-proofing"
                  className="squisq-doc-settings-input"
                  value={proofingEnabled}
                  onChange={(e) => setProofingEnabled(e.target.value)}
                >
                  <option value="">Default</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </div>

              <div className="squisq-doc-settings-field">
                <label
                  className="squisq-doc-settings-label"
                  htmlFor="squisq-doc-settings-proof-dialect"
                >
                  Proofing dialect
                </label>
                <select
                  id="squisq-doc-settings-proof-dialect"
                  className="squisq-doc-settings-input"
                  value={proofDialect}
                  onChange={(e) => setProofDialect(e.target.value)}
                >
                  <option value="">Default (American)</option>
                  {PROOF_DIALECTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="squisq-doc-settings-section">
            <h3 id={propertiesHeadingId} className="squisq-doc-settings-section-title">
              Properties
            </h3>
            <span className="squisq-doc-settings-hint">
              Your own keys, such as author or tags. They stay in the document for other tools to
              read.
            </span>
            <FrontmatterPropertiesGrid
              rows={propertyRows}
              onRowsChange={setPropertyRows}
              errors={shownPropertyErrors}
              idPrefix={`${propertiesHeadingId}-properties`}
              ariaLabel="Properties"
            />
          </div>

          {onEditorStylingChange && (
            <div
              className="squisq-doc-settings-section"
              role="group"
              aria-labelledby={editorHeadingId}
            >
              <h3 id={editorHeadingId} className="squisq-doc-settings-section-title">
                Editor
              </h3>
              <span className="squisq-doc-settings-hint">
                Your own preference for this editor. It isn’t saved in the document.
              </span>
              <div className="squisq-doc-settings-field">
                <label
                  className="squisq-doc-settings-label"
                  htmlFor="squisq-doc-settings-editor-styling"
                >
                  Editor styling from theme
                </label>
                <select
                  id="squisq-doc-settings-editor-styling"
                  className="squisq-doc-settings-input"
                  value={editorStyling}
                  onChange={(e) => setEditorStyling(e.target.value as ThemeInheritance)}
                  aria-describedby="squisq-doc-settings-editor-styling-hint"
                >
                  {EDITOR_STYLING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span
                  id="squisq-doc-settings-editor-styling-hint"
                  className="squisq-doc-settings-hint"
                >
                  How much the Write view looks like the document’s theme.
                </span>
              </div>
            </div>
          )}
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
