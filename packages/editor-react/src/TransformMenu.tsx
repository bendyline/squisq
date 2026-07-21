/**
 * TransformMenu
 *
 * Toolbar popover applying one-time, undoable markdown source transforms
 * (unwrap / wrap-at-width / cleanup) from core's
 * `MARKDOWN_SOURCE_TRANSFORMS` registry, plus a readout of the document's
 * detected wrap convention (`detectMarkdownWrapState`).
 *
 * Apply paths keep the operation a single undo step:
 * - Source view: minimal per-paragraph `executeEdits` on the Monaco model
 *   between undo stops — native byte-exact undo, cursor/scroll stay put.
 * - Write view: one `setMarkdownSource` write; the WYSIWYG external-sync
 *   `setContent` lands as one Tiptap history entry.
 * - Use view has no editing surface (no undo), so rows are disabled there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MARKDOWN_SOURCE_TRANSFORMS,
  DEFAULT_WRAP_WIDTH,
  applyMarkdownSourceTransform,
  detectMarkdownWrapState,
} from '@bendyline/squisq/markdown';
import type {
  MarkdownSourceTransformId,
  MarkdownSourceTransformOptions,
} from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';
import { Icon } from './Icon';
import { useEscapeDismissal } from './useEscapeDismissal';

const WIDTH_PRESETS = [60, 80, 100, 120];

export function TransformMenu() {
  const {
    editorMode,
    layoutMode,
    activeView,
    markdownSource,
    setMarkdownSource,
    monacoEditor,
    versioning,
    saveVersion,
  } = useEditorContext();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WRAP_WIDTH);
  const [status, setStatus] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEscapeDismissal(open, close, triggerRef);

  // Click-outside to close, mirroring ViewMenuPanel/VersionHistoryPanel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fresh status per open; the readout below recomputes live via memo.
  useEffect(() => {
    if (open) setStatus('');
  }, [open]);

  const wrapState = useMemo(
    () => (open ? detectMarkdownWrapState(markdownSource) : null),
    [open, markdownSource],
  );

  const inPreview = activeView === 'preview';
  const inBlockLayout = layoutMode !== 'document';
  const disabled = inPreview || inBlockLayout;
  const disabledNote = inBlockLayout
    ? 'Transforms apply to the whole document — switch to the Document layout first.'
    : inPreview
      ? 'Switch to Write or Source view to apply (transforms are undoable there).'
      : null;

  const applyTransform = useCallback(
    (id: MarkdownSourceTransformId) => {
      const options: MarkdownSourceTransformOptions | undefined =
        id === 'wrap' ? { width } : undefined;

      // Best-effort snapshot so a transform is one revert away even beyond
      // the editor's undo horizon (same channel as the idle auto-save).
      if (versioning) {
        saveVersion({ content: markdownSource }).catch(() => {
          /* snapshot is advisory — the transform itself stays undoable */
        });
      }

      const report = (changed: boolean, degraded: boolean): void => {
        if (changed) setStatus('Transformed.');
        else if (degraded) setStatus('Could not safely transform — document left unchanged.');
        else setStatus('No changes needed.');
      };

      // Source view: minimal-diff Monaco edits between undo stops.
      if (activeView === 'raw' && monacoEditor) {
        const model = monacoEditor.getModel();
        if (model) {
          const result = applyMarkdownSourceTransform(id, model.getValue(), options);
          if (result.changed) {
            const ops = result.edits.map((edit) => {
              const start = model.getPositionAt(edit.start);
              const end = model.getPositionAt(edit.end);
              return {
                range: {
                  startLineNumber: start.lineNumber,
                  startColumn: start.column,
                  endLineNumber: end.lineNumber,
                  endColumn: end.column,
                },
                text: edit.text,
              };
            });
            monacoEditor.pushUndoStop();
            monacoEditor.executeEdits('squisq-transform', ops);
            monacoEditor.pushUndoStop();
          }
          report(result.changed, result.degraded);
          return;
        }
      }

      // Write view: one source write → one Tiptap history entry.
      const result = applyMarkdownSourceTransform(id, markdownSource, options);
      if (result.changed) setMarkdownSource(result.output);
      report(result.changed, result.degraded);
    },
    [activeView, markdownSource, monacoEditor, saveVersion, setMarkdownSource, versioning, width],
  );

  if (editorMode !== 'markdown') return null;

  const wrapStateLabel =
    wrapState === null
      ? null
      : wrapState.kind === 'wrapped'
        ? `Detected mode: wrapped at ~${wrapState.width} columns`
        : wrapState.kind === 'unwrapped'
          ? 'Detected mode: unwrapped'
          : wrapState.kind === 'mixed'
            ? 'Detected mode: mixed wrapping'
            : 'Detected mode: no prose to judge';
  const currentMode =
    wrapState?.kind === 'wrapped' ? 'wrap' : wrapState?.kind === 'unwrapped' ? 'unwrap' : null;
  const currentModeLabel =
    wrapState?.kind === 'wrapped' ? `Current (~${wrapState.width} columns)` : 'Current';

  return (
    <div className="squisq-transform-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-toolbar-button squisq-transform-menu-trigger${
          open ? ' squisq-toolbar-button--active' : ''
        }`}
        data-tooltip="Transform"
        aria-label="Transform document"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon="fa-solid fa-wand-magic-sparkles" />
      </button>
      {open && (
        <div
          className="squisq-transform-menu-popover"
          role="dialog"
          aria-label="Transform document"
        >
          {wrapStateLabel && <div className="squisq-transform-menu-state">{wrapStateLabel}</div>}
          {MARKDOWN_SOURCE_TRANSFORMS.map((transform) => {
            const isCurrentMode = transform.id === currentMode;
            return (
              <div key={transform.id} className="squisq-transform-menu-item">
                <button
                  type="button"
                  className={`squisq-transform-menu-action${
                    isCurrentMode ? ' squisq-transform-menu-action--current' : ''
                  }`}
                  aria-current={isCurrentMode ? 'true' : undefined}
                  disabled={disabled}
                  onClick={() => applyTransform(transform.id)}
                >
                  <span className="squisq-transform-menu-action-icon" aria-hidden="true">
                    <Icon icon="fa-solid fa-wand-magic-sparkles" />
                  </span>
                  <span className="squisq-transform-menu-action-copy">
                    <span className="squisq-transform-menu-action-heading">
                      <span className="squisq-transform-menu-action-label">{transform.label}</span>
                      {isCurrentMode && (
                        <span className="squisq-transform-menu-current-badge">
                          {currentModeLabel}
                        </span>
                      )}
                    </span>
                    <span className="squisq-transform-menu-action-desc">
                      {transform.description}
                    </span>
                  </span>
                </button>
                {transform.id === 'wrap' && (
                  <div className="squisq-transform-menu-widths" aria-label="Wrap width">
                    {WIDTH_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`squisq-transform-menu-width${
                          width === preset ? ' squisq-transform-menu-width--active' : ''
                        }`}
                        disabled={disabled}
                        onClick={() => setWidth(preset)}
                      >
                        {preset}
                      </button>
                    ))}
                    <input
                      type="number"
                      className="squisq-transform-menu-width-input"
                      aria-label="Custom wrap width"
                      min={20}
                      max={500}
                      value={width}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isNaN(next)) setWidth(next);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {disabledNote && <div className="squisq-transform-menu-note">{disabledNote}</div>}
          <div className="squisq-transform-menu-status" role="status" aria-live="polite">
            {status}
          </div>
        </div>
      )}
    </div>
  );
}
