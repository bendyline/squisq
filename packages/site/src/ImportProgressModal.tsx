/**
 * ImportProgressModal — progress (and failure) dialog for document uploads.
 *
 * Converting a DOCX/PPTX/XLSX/PDF to markdown takes long enough to look like a
 * hang, so uploads of those formats put this dialog up for the duration. It has
 * no percentage to report — the converters are single opaque awaits — so it
 * shows the named stage plus an indeterminate bar, which is honest about not
 * knowing how far along the work is.
 *
 * The dialog is also where an import failure lands: an `alert()` loses the
 * context of which file was being converted, and can't be styled to match the
 * host's color scheme.
 */

import type { DocumentImportProgress, DocumentImportStage } from './documentImport';

// ── Types ──────────────────────────────────────────────────────────

export type ImportProgressState =
  | { phase: 'working'; progress: DocumentImportProgress }
  | { phase: 'error'; fileName: string; message: string };

export interface ImportProgressModalProps {
  state: ImportProgressState;
  /** Resolved host color scheme, so the portaled dialog matches the page. */
  colorScheme: 'light' | 'dark';
  /** Dismiss. Only offered in the error phase — conversion isn't cancellable. */
  onClose: () => void;
}

// ── Stages ─────────────────────────────────────────────────────────

const STAGES: readonly { id: DocumentImportStage; label: string }[] = [
  { id: 'reading', label: 'Reading file' },
  { id: 'converting', label: 'Converting to Markdown' },
  { id: 'finishing', label: 'Preparing the editor' },
];

function stageIndex(stage: DocumentImportStage): number {
  return STAGES.findIndex((s) => s.id === stage);
}

// ── Styles ─────────────────────────────────────────────────────────

interface ImportDialogPalette {
  overlay: string;
  surface: string;
  border: string;
  text: string;
  heading: string;
  muted: string;
  track: string;
  bar: string;
  secondary: string;
  danger: string;
}

const PALETTES: Record<'light' | 'dark', ImportDialogPalette> = {
  light: {
    overlay: 'rgba(0, 0, 0, 0.5)',
    surface: '#FFFDF7',
    border: '#c9b98a',
    text: '#4a3c1f',
    heading: '#2d2310',
    muted: '#8a7a5a',
    track: '#E8DFC6',
    bar: '#8B6914',
    secondary: '#E8DFC6',
    danger: '#c53030',
  },
  dark: {
    overlay: 'rgba(2, 6, 23, 0.72)',
    surface: '#111827',
    border: '#475569',
    text: '#e5e7eb',
    heading: '#f8fafc',
    muted: '#94a3b8',
    track: '#1e293b',
    bar: '#d1a73b',
    secondary: '#1e293b',
    danger: '#fca5a5',
  },
};

/**
 * The sliding-bar keyframes. Scoped to this dialog and frozen under
 * `prefers-reduced-motion` — an indeterminate bar is decoration, and the stage
 * list already carries the information.
 */
const KEYFRAMES = [
  '@keyframes squisq-site-import-slide {',
  '  0% { transform: translateX(-100%); }',
  '  100% { transform: translateX(300%); }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .squisq-site-import-bar { animation: none !important; transform: none !important; width: 100% !important; }',
  '}',
].join('\n');

// ── Component ──────────────────────────────────────────────────────

export function ImportProgressModal({ state, colorScheme, onClose }: ImportProgressModalProps) {
  const palette = PALETTES[colorScheme];
  const failed = state.phase === 'error';
  const fileName = failed ? state.fileName : state.progress.fileName;
  const current = failed ? -1 : stageIndex(state.progress.stage);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: palette.overlay,
        zIndex: 10000,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="squisq-site-import-title"
      data-testid="import-progress-dialog"
    >
      <style>{KEYFRAMES}</style>
      <div
        style={{
          background: palette.surface,
          border: `1px solid ${palette.border}`,
          borderRadius: 0,
          padding: '24px 28px',
          minWidth: 380,
          maxWidth: 460,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: palette.text,
        }}
      >
        <h2
          id="squisq-site-import-title"
          style={{
            margin: '0 0 6px 0',
            fontSize: 18,
            fontWeight: 600,
            color: failed ? palette.danger : palette.heading,
          }}
        >
          {failed ? 'Import failed' : 'Importing…'}
        </h2>

        <p
          style={{
            margin: '0 0 16px 0',
            fontSize: 13,
            color: palette.muted,
            overflowWrap: 'anywhere',
          }}
          data-testid="import-progress-subject"
        >
          {failed ? fileName : `${fileName} · ${state.progress.formatLabel}`}
        </p>

        {failed ? (
          <>
            <p
              style={{ margin: '0 0 20px 0', fontSize: 13, lineHeight: 1.5 }}
              data-testid="import-error-message"
            >
              {state.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                autoFocus
                style={{
                  padding: '8px 20px',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  fontWeight: 500,
                  cursor: 'pointer',
                  borderRadius: 0,
                  background: palette.secondary,
                  color: palette.text,
                  border: `1px solid ${palette.border}`,
                }}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <ol
              style={{ listStyle: 'none', margin: '0 0 18px 0', padding: 0, fontSize: 13 }}
              aria-live="polite"
            >
              {STAGES.map((stage, index) => {
                const done = index < current;
                const active = index === current;
                return (
                  <li
                    key={stage.id}
                    data-stage={stage.id}
                    data-state={done ? 'done' : active ? 'active' : 'pending'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '3px 0',
                      color: done || active ? palette.text : palette.muted,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span aria-hidden="true" style={{ width: 14, textAlign: 'center' }}>
                      {done ? '✓' : active ? '›' : '·'}
                    </span>
                    {stage.label}
                  </li>
                );
              })}
            </ol>

            <div
              style={{ height: 4, background: palette.track, overflow: 'hidden' }}
              role="progressbar"
              aria-label="Import progress"
            >
              <div
                className="squisq-site-import-bar"
                style={{
                  height: '100%',
                  width: '33%',
                  background: palette.bar,
                  animation: 'squisq-site-import-slide 1.1s ease-in-out infinite',
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
