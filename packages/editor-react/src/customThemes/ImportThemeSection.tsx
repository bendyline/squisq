/**
 * ImportThemeSection
 *
 * "Infer theme from a file" affordance shared by the CustomThemeDialog pane
 * and the ThemeCustomizerPanel popover: a Choose-file button plus a local
 * dropzone that accepts a Word/PowerPoint/Excel file, runs
 * `inferThemeFromFile` from `@bendyline/squisq-formats/infer` (loaded
 * lazily), and hands back a `Partial<Draft>` patch for the host's
 * `updateDraft` — so the existing live-preview path applies unchanged.
 *
 * The dropzone handles its own drag events with `stopPropagation` so a file
 * dropped here never reaches EditorShell's document-import drop handling.
 */

import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { CustomTemplateDefinition, Theme } from '@bendyline/squisq/schemas';
import { draftPatchFromImportedTheme, type Draft } from './themeDraft';

export interface ImportedThemeResult {
  theme: Theme;
  /** PPTX only, when `allowLayouts`: custom templates derived from slide layouts. */
  layouts?: CustomTemplateDefinition[];
  warnings: string[];
  fileName: string;
}

export interface ImportThemeSectionProps {
  /** Fired on successful inference with the draft patch + full result. */
  onImported: (patch: Partial<Draft>, result: ImportedThemeResult) => void;
  /** Also derive PPTX slide layouts as custom templates. Default false. */
  allowLayouts?: boolean;
}

const ACCEPT = '.docx,.pptx,.xlsx';
const SUPPORTED_RE = /\.(docx|pptx|xlsx)$/i;
const MAX_VISIBLE_WARNINGS = 4;

/**
 * Read a File's bytes. Prefers the modern `arrayBuffer()`; falls back to
 * FileReader for environments (e.g. some jsdom builds) whose Blob lacks it —
 * same posture as the formats registry's byte normalizer.
 */
function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function ImportThemeSection({ onImported, allowLayouts = false }: ImportThemeSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!SUPPORTED_RE.test(file.name)) {
        setError('Only .docx, .pptx, or .xlsx files carry a theme.');
        return;
      }
      setBusy(true);
      setError(null);
      setStatus(null);
      setWarnings([]);
      try {
        const buffer = await readFileBytes(file);
        const { inferThemeFromFile } = await import('@bendyline/squisq-formats/infer');
        const nameHint = file.name.replace(/\.[^.]+$/, '');
        const result = await inferThemeFromFile(buffer, {
          inferLayouts: allowLayouts,
          nameHint,
        });
        const layouts = result.layouts ?? [];
        onImported(draftPatchFromImportedTheme(result.theme), {
          theme: result.theme,
          ...(layouts.length > 0 ? { layouts } : {}),
          warnings: result.warnings,
          fileName: file.name,
        });
        setStatus(
          layouts.length > 0
            ? `Imported colors and fonts from ${file.name} — ${layouts.length} slide layout${
                layouts.length === 1 ? '' : 's'
              } will be saved with the document.`
            : `Imported colors and fonts from ${file.name}.`,
        );
        setWarnings(result.warnings);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not read a theme from that file.');
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [allowLayouts, onImported],
  );

  // Local drag handling only — never let the editor's global drop routing
  // treat a theme-source file as a document import.
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const visibleWarnings = warnings.slice(0, MAX_VISIBLE_WARNINGS);
  const hiddenWarnings = warnings.length - visibleWarnings.length;

  return (
    <div className="squisq-theme-import">
      <div
        className={`squisq-theme-import-drop${dragOver ? ' squisq-theme-import-drop--active' : ''}${
          busy ? ' squisq-theme-import-drop--busy' : ''
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <button
          type="button"
          className="squisq-theme-customizer-button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Reading…' : 'Choose file…'}
        </button>
        <span className="squisq-theme-import-hint">or drop a .docx / .pptx / .xlsx here</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          aria-label="Import theme from file"
        />
      </div>
      {error && (
        <div className="squisq-theme-import-error" role="alert">
          {error}
        </div>
      )}
      {status && <div className="squisq-theme-import-status">{status}</div>}
      {visibleWarnings.length > 0 && (
        <ul className="squisq-theme-import-warnings">
          {visibleWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {hiddenWarnings > 0 && <li>…and {hiddenWarnings} more</li>}
        </ul>
      )}
    </div>
  );
}
