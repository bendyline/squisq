/**
 * DataCardWidget — the Write-view surface for a data sidecar reference.
 *
 * ALWAYS-GRID contract: every `{[dataTable src=…]}` block mounts the real
 * virtualized grid (`@bendyline/squisq-grid-react`, lazily imported), with
 * the summary card's identity strip (icon, name, size, rows×cols,
 * Show-in-Files) as the grid's header. The compact preview card remains
 * ONLY as the runtime fallback when the grid module fails to load — plus
 * the unchanged missing/metadata error states.
 *
 * View state (sort/filter) binds to the OWNING heading's annotation params
 * when the heading really owns this sidecar (see viewStateBinding.ts);
 * otherwise it is session-only and the grid footer says so. CSV/TSV edits
 * save in place through gridSave.ts; XLSX edits (values, and formulas when
 * the calc-engine session boots within budget) save through in-place
 * patching; parquet mounts read-only with a reason chip.
 *
 * The underlying PM paragraph is still never touched by the widget itself —
 * only the heading's `dataTemplateParams` attribute changes, through the
 * ordinary PM-undoable transaction path.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { TableViewState } from '@bendyline/squisq/table';
import { EMPTY_TABLE_VIEW_STATE } from '@bendyline/squisq/table';
import { DATA_CARD_KEY, dataLinkHrefOf } from './DataCardExtension';
import {
  dataExtensionOf,
  loadDataPreview,
  loadDataPreviewCached,
  type DataPreview,
} from './dataPreview';
import { XLSX_LOCKED_REASON, ingestSidecarBytes, type IngestedSidecar } from './ingestAdapters';

/** Lock tooltip when the calc engine IS active (formulas edit; these don't). */
const XLSX_SESSION_LOCKED_REASON =
  'Date cells and shared-formula masters stay locked; other formulas are editable';
import {
  readHeadingViewBinding,
  viewStateFromBinding,
  writeHeadingViewState,
} from './viewStateBinding';
import { saveCsvEdits, saveXlsxEdits } from './gridSave';
import {
  createXlsxFormulaSession,
  type CalcEngineFactory,
  type XlsxFormulaSession,
} from './formulaSupport';

type GridModule = typeof import('@bendyline/squisq-grid-react');

let gridModulePromise: Promise<GridModule | null> | null = null;
function loadGridModule(): Promise<GridModule | null> {
  // A FAILED load is not cached: a dev server mid-reoptimize (or any
  // transient fetch failure) rejects one dynamic import, and pinning that
  // null forever would lock every data card onto the fallback preview until
  // a hard reload. Success is cached; failure retries on the next mount.
  gridModulePromise ??= import('@bendyline/squisq-grid-react').catch(() => {
    gridModulePromise = null;
    return null;
  });
  return gridModulePromise;
}

export interface DataCardWidgetProps {
  editor: Editor;
  blockId: string;
  getMediaProvider: () => MediaProvider | null | undefined;
  getMediaRevision: () => number;
  getContainer?: (() => ContentContainer | null | undefined) | undefined;
  onOpenFiles?: ((relativePath: string) => void) | undefined;
  onMediaSaved?: (() => void) | undefined;
  /** Calc backend for formula sessions (default: the in-house tier). */
  getCalcEngineFactory?: (() => CalcEngineFactory | null | undefined) | undefined;
}

interface CardLink {
  href: string;
  label: string;
  pos: number;
}

/** Resolve the claimed paragraph's link, re-reading on every transaction. */
function useCardLink(editor: Editor, blockId: string): CardLink | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('transaction', bump);
    return () => {
      editor.off('transaction', bump);
    };
  }, [editor]);

  return useMemo(() => {
    void version;
    const pos = DATA_CARD_KEY.getState(editor.state)?.entries.find((e) => e.id === blockId)?.pos;
    if (pos === undefined) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return null;
    const href = dataLinkHrefOf(node);
    if (!href) return null;
    return { href, label: node.textContent, pos };
  }, [editor, blockId, version]);
}

/** Watch the media revision getter without re-rendering per keystroke. */
function useMediaRevision(getMediaRevision: () => number): number {
  const [revision, setRevision] = useState(() => getMediaRevision());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getMediaRevision();
      setRevision((prev) => (prev === next ? prev : next));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [getMediaRevision]);
  return revision;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface GridState {
  module: GridModule;
  provider: InstanceType<GridModule['TableStoreClient']>;
  journal: InstanceType<GridModule['EditJournal']>;
  ingested: IngestedSidecar;
  bytes: ArrayBuffer;
  headers: string[];
  /** Calc-engine session for XLSX formula editing (null = values only). */
  formulaSession: XlsxFormulaSession | null;
}

type CardState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  /** `reason` = why the grid (and preview) could not load — always rendered,
   * because a silent bare strip reads as "stuck" to the user. */
  | { kind: 'meta'; size: number | null; preview: DataPreview | null; reason?: string }
  | { kind: 'grid'; size: number | null; grid: GridState };

export function DataCardWidget({
  editor,
  blockId,
  getMediaProvider,
  getMediaRevision,
  getContainer,
  onOpenFiles,
  onMediaSaved,
  getCalcEngineFactory,
}: DataCardWidgetProps): ReactElement | null {
  const link = useCardLink(editor, blockId);
  const revision = useMediaRevision(getMediaRevision);
  const [state, setState] = useState<CardState>({ kind: 'loading' });
  const [view, setView] = useState<TableViewState>(EMPTY_TABLE_VIEW_STATE);
  const [viewPersisted, setViewPersisted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [formulaDirty, setFormulaDirty] = useState(0);
  const gridRef = useRef<GridState | null>(null);

  const href = link?.href ?? null;
  const cardPos = link?.pos ?? null;

  useEffect(() => {
    if (!href || cardPos === null) return;
    const provider = getMediaProvider();
    if (!provider) {
      setState({ kind: 'meta', size: null, preview: null });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      let size: number | null = null;
      try {
        const entries = await provider.listMedia();
        const entry = entries.find((e) => e.name === href);
        if (!entry) {
          if (!cancelled) setState({ kind: 'missing' });
          return;
        }
        size = entry.size;

        const url = await provider.resolveUrl(href);
        if (url === href) {
          if (!cancelled) {
            setState({
              kind: 'meta',
              size,
              preview: null,
              reason: 'the host did not provide the file bytes',
            });
          }
          return;
        }
        const response = await fetch(url);
        if (!response.ok) {
          if (!cancelled) {
            setState({
              kind: 'meta',
              size,
              preview: null,
              reason: `the file could not be fetched (${response.status})`,
            });
          }
          return;
        }
        const bytes = await response.arrayBuffer();
        const ext = dataExtensionOf(href);

        const module = await loadGridModule();
        if (module) {
          const binding = readHeadingViewBinding(editor, cardPos, href);
          const ingested = await ingestSidecarBytes(bytes, ext, {
            ...(binding.params.sheet ? { sheet: binding.params.sheet } : {}),
            ...(binding.params.anchor ? { anchor: binding.params.anchor } : {}),
            ...(binding.params.headerRow !== undefined
              ? { headerRow: binding.params.headerRow !== 'false' }
              : {}),
          });
          if (cancelled) return;
          // Formula editing rides a calc-engine session; a load failure or
          // an over-budget workbook degrades to value-only editing.
          let formulaSession: XlsxFormulaSession | null = null;
          if (ingested.xlsx) {
            try {
              const engineFactory = getCalcEngineFactory?.();
              formulaSession = await createXlsxFormulaSession(
                ingested.xlsx,
                engineFactory ? { engineFactory } : {},
              );
            } catch {
              formulaSession = null;
            }
          }
          if (cancelled) {
            formulaSession?.dispose();
            return;
          }
          gridRef.current?.formulaSession?.dispose();
          gridRef.current?.provider.dispose();
          const storeProvider = new module.TableStoreClient(ingested.ingest);
          const journal = module.journalFor(href, revision);
          const grid: GridState = {
            module,
            provider: storeProvider,
            journal,
            ingested,
            bytes,
            headers: ingested.ingest.headers,
            formulaSession,
          };
          gridRef.current = grid;
          setView(viewStateFromBinding(binding, ingested.ingest.headers));
          setViewPersisted(binding.persisted);
          setSaveNotice(null);
          setFormulaDirty(0);
          setState({ kind: 'grid', size, grid });
          return;
        }

        // Grid module unavailable — the compact preview card is the fallback.
        const preview = await loadDataPreviewCached(href, revision, () =>
          loadDataPreview(bytes, ext),
        );
        if (cancelled) return;
        setState({ kind: 'meta', size, preview });
      } catch (err: unknown) {
        if (!cancelled) {
          setState({
            kind: 'meta',
            size,
            preview: null,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // cardPos intentionally excluded: position churn must not re-ingest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, revision, getMediaProvider, editor]);

  useEffect(
    () => () => {
      gridRef.current?.formulaSession?.dispose();
      gridRef.current?.provider.dispose();
      gridRef.current = null;
    },
    [],
  );

  const handleViewChange = useCallback(
    (next: TableViewState) => {
      setView(next);
      if (href !== null && cardPos !== null && viewPersisted) {
        writeHeadingViewState(editor, cardPos, href, next);
      }
    },
    [editor, cardPos, href, viewPersisted],
  );

  const handleSave = useCallback(async () => {
    const grid = gridRef.current;
    const provider = getMediaProvider();
    if (!grid || !provider || !href || (!grid.ingested.csv && !grid.ingested.xlsx)) return;
    setSaving(true);
    try {
      const shared = {
        path: href,
        originalBytes: grid.bytes,
        journal: grid.journal,
        mediaProvider: provider,
        container: getContainer?.() ?? null,
      };
      const result = grid.ingested.csv
        ? await saveCsvEdits({ ...shared, csv: grid.ingested.csv })
        : await saveXlsxEdits({
            ...shared,
            xlsx: grid.ingested.xlsx!,
            ...(grid.formulaSession ? { formulaEdits: grid.formulaSession.formulaEdits() } : {}),
          });
      setSaveNotice(
        result.ok
          ? result.notices.length > 0
            ? `saved (${result.notices.join('; ')})`
            : null
          : (result.error ?? 'save failed'),
      );
      if (result.ok) {
        gridRef.current?.formulaSession?.markSaved();
        setFormulaDirty(0);
        onMediaSaved?.();
      }
    } finally {
      setSaving(false);
    }
  }, [getContainer, getMediaProvider, href, onMediaSaved]);

  if (!link || !href) return null;
  const fileName = href.split('/').pop() ?? href;
  const size = state.kind === 'meta' || state.kind === 'grid' ? state.size : null;
  const grid = state.kind === 'grid' ? state.grid : null;
  const xlsxMeta = grid?.ingested.xlsx;
  const editableGrid = Boolean(grid?.ingested.csv || xlsxMeta) && editor.isEditable;
  const readOnlyReason = grid?.ingested.readOnlyReason;

  return (
    <div
      className={`squisq-data-card${state.kind === 'missing' ? ' squisq-data-card--missing' : ''}`}
      data-proof-exempt="true"
    >
      <div className="squisq-data-card-header">
        <span className="squisq-data-card-icon" aria-hidden="true">
          {'\u{1F4CA}'}
        </span>
        <span className="squisq-data-card-name" title={href}>
          {fileName}
        </span>
        <span className="squisq-data-card-meta">
          {/* The strip is the file's IDENTITY, not its stats. Whenever data
              renders below — the grid (its status bar reports rows +
              columns) or the compact preview table (its footer reports the
              window) — the strip stays clean. Size shows only in the
              data-less states, where nothing else describes the file. */}
          {[
            state.kind === 'missing' ? 'not found in this document’s files' : null,
            state.kind === 'loading' ? 'loading…' : null,
            state.kind === 'meta' && !state.preview && size !== null ? formatBytes(size) : null,
            saveNotice,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {onOpenFiles && state.kind !== 'missing' && (
          <button
            type="button"
            className="squisq-data-card-action"
            onClick={() => onOpenFiles(href)}
          >
            Show in Files
          </button>
        )}
      </div>

      {grid && (
        <grid.module.DataGrid
          provider={grid.provider}
          journal={editableGrid ? grid.journal : undefined}
          view={view}
          onViewChange={handleViewChange}
          viewPersisted={viewPersisted}
          onSave={editableGrid ? handleSave : undefined}
          saving={saving}
          readOnlyReason={editor.isEditable ? readOnlyReason : undefined}
          isCellLocked={
            grid.formulaSession
              ? grid.formulaSession.isCellLocked
              : xlsxMeta
                ? (rowId, col) => xlsxMeta.locked.has(`${rowId}:${col}`)
                : undefined
          }
          lockedReason={
            grid.formulaSession
              ? XLSX_SESSION_LOCKED_REASON
              : xlsxMeta
                ? XLSX_LOCKED_REASON
                : undefined
          }
          formulaSupport={
            grid.formulaSession
              ? {
                  getFormula: grid.formulaSession.getFormula,
                  commitFormula: async (rowId, col, formula) => {
                    const result = await grid.formulaSession!.commitFormula(rowId, col, formula);
                    if (result.ok) setFormulaDirty(grid.formulaSession!.dirtyCount);
                    return result;
                  },
                }
              : undefined
          }
          onCellEdited={
            grid.formulaSession
              ? (edit) => grid.formulaSession!.noteValueEdit(edit.rowId, edit.col, edit.value)
              : undefined
          }
          extraDirtyCount={formulaDirty}
          onDiscardExtra={
            grid.formulaSession
              ? async () => {
                  const updates = await grid.formulaSession!.discard();
                  if (updates.length > 0) await grid.provider.applyEdits?.(updates);
                  setFormulaDirty(0);
                }
              : undefined
          }
          className="squisq-data-card-grid"
        />
      )}

      {state.kind === 'meta' && state.preview && state.preview.rows.length > 0 && (
        <div className="squisq-data-card-preview">
          <table>
            <thead>
              <tr>
                {state.preview.columns.map((column, i) => (
                  <th key={i}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.preview.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {/* With the strip stats gone, this footer is the card's one stats
              line — mirror the grid's status-bar shape (rows, columns). */}
          {state.preview.totalRows !== null && (
            <div className="squisq-data-card-truncation">
              {state.preview.totalRows > state.preview.rows.length
                ? `showing ${state.preview.rows.length} of ${state.preview.totalRows.toLocaleString()} rows`
                : `${state.preview.totalRows.toLocaleString()} row${
                    state.preview.totalRows === 1 ? '' : 's'
                  }`}
              {state.preview.totalCols !== null
                ? `, ${state.preview.totalCols} column${state.preview.totalCols === 1 ? '' : 's'}`
                : ''}
            </div>
          )}
        </div>
      )}
      {state.kind === 'meta' && state.reason && (
        <div className="squisq-data-card-error" role="status">
          data view unavailable — {state.reason}
        </div>
      )}
    </div>
  );
}

export default DataCardWidget;
