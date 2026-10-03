/**
 * Grid save orchestration for CSV/TSV sidecars: journal → serialized bytes
 * → in-place overwrite, with a `.versions/data/` pre-save backup.
 *
 * Order of operations and their whys:
 *  1. BACKUP the original bytes first (`buildDataBackupPath`, pruned to the
 *     newest 3 per sidecar) — the only cross-save undo the grid offers.
 *     No container = no backup; the result says so rather than hiding it.
 *  2. Serialize from the latest persisted bytes with a snapshot of this
 *     region's journal, preserving saves made by other regions of the file.
 *     Formula neutralization applies ONLY to journal-edited, non-numeric
 *     cells (`serializeCsvRows` defaults `preserve`; blanket escaping would
 *     corrupt every negative number in a re-saved file).
 *  3. `addMedia(samePath)` with FORK DETECTION: `addMedia` returns the path
 *     the host actually used, and a collision-renaming provider would
 *     silently fork the document's reference — surface it instead.
 *  4. Acknowledge only the saved snapshot. The caller refreshes the formula
 *     baseline and bumps mediaRevision so previews re-resolve on success.
 */

import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { DATA_BACKUP_PREFIX, buildDataBackupPath } from '@bendyline/squisq/versions';
import type { EditJournal } from '@bendyline/squisq-grid-react';
import type { CsvSourceMeta, XlsxSourceMeta } from './ingestAdapters';
import type { FormulaEditRecord } from './formulaSupport';
import { withDataSave } from './saveSession';

const BACKUPS_KEPT_PER_SIDECAR = 3;
const FORMULA_PREFIX = /^[\t\r\n \uFEFF]*[=+\-@]/;

export interface GridSaveResult {
  ok: boolean;
  /** Path actually written (differs from requested on a host fork). */
  savedPath?: string;
  /** Human-readable caveats: fork detected, backup skipped, … */
  notices: string[];
  error?: string;
  /** Persisted baseline for subsequent saves, including other regions' edits. */
  bytes?: ArrayBuffer;
}

function renderCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Neutralize a formula-looking EDITED cell unless it's really a number. */
function neutralizeEdited(text: string): string {
  if (!FORMULA_PREFIX.test(text)) return text;
  if (text.trim() !== '' && Number.isFinite(Number(text.trim()))) return text;
  return `'${text}`;
}

async function backupOriginal(
  container: ContentContainer,
  path: string,
  original: ArrayBuffer,
  mime: string,
): Promise<void> {
  const backupPath = buildDataBackupPath(path, new Date());
  await container.writeFile(backupPath, original, mime);
  // Prune: keep the newest N backups for this sidecar. Backup names embed a
  // sortable timestamp, so lexicographic order is chronological.
  const flattenedPrefix = `${DATA_BACKUP_PREFIX}${path.replace(/\.[^.]+$/, '').replace(/\//g, '__')}.`;
  const entries = (await container.listFiles(DATA_BACKUP_PREFIX))
    .filter((entry) => entry.path.startsWith(flattenedPrefix))
    .map((entry) => entry.path)
    .sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - BACKUPS_KEPT_PER_SIDECAR))) {
    await container.removeFile(stale);
  }
}

export interface SaveCsvEditsOptions {
  path: string;
  originalBytes: ArrayBuffer;
  csv: CsvSourceMeta;
  journal: EditJournal;
  mediaProvider: MediaProvider;
  container: ContentContainer | null;
}

export async function saveCsvEdits(options: SaveCsvEditsOptions): Promise<GridSaveResult> {
  const { path, csv, journal, mediaProvider, container } = options;
  const snapshot = journal.entries();
  return withDataSave(options, async (originalBytes): Promise<GridSaveResult> => {
    const notices: string[] = [];
    const mime = path.toLowerCase().endsWith('.tsv') ? 'text/tab-separated-values' : 'text/csv';

    try {
      if (container) {
        await backupOriginal(container, path, originalBytes, mime);
      } else {
        notices.push('no workspace container — saved without a backup copy');
      }

      // Copy the parse baseline; splat journal edits (journal rowIds are BODY
      // row indices — offset past the header row when present).
      const { parseCsv, serializeCsvRows } = await import('@bendyline/squisq-formats/csv');
      const rows = parseCsv(new TextDecoder().decode(originalBytes), csv.delimiter);
      const offset = csv.hasHeader ? 1 : 0;
      for (const entry of snapshot) {
        const targetRow = entry.rowId + offset;
        while (rows.length <= targetRow) rows.push([]);
        const row = rows[targetRow]!;
        while (row.length <= entry.col) row.push('');
        row[entry.col] = neutralizeEdited(renderCell(entry.next));
      }

      const text = serializeCsvRows(rows, {
        delimiter: csv.delimiter,
        newline: csv.newline,
        trailingNewline: csv.trailingNewline,
        formulaHandling: 'preserve',
      });
      const bytes = new TextEncoder().encode(csv.bom ? `\uFEFF${text}` : text)
        .buffer as ArrayBuffer;

      const savedPath = await mediaProvider.addMedia(path, bytes, mime);
      if (savedPath !== path) {
        return {
          ok: false,
          savedPath,
          notices,
          error: `the host saved a copy at "${savedPath}" instead of overwriting "${path}" — the document still references the original`,
        };
      }

      journal.acknowledge(snapshot);
      return { ok: true, savedPath, notices, bytes };
    } catch (err: unknown) {
      return {
        ok: false,
        notices,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }).catch((error: unknown) => ({
    ok: false,
    notices: [],
    error: error instanceof Error ? error.message : String(error),
  }));
}

export interface SaveXlsxEditsOptions {
  path: string;
  originalBytes: ArrayBuffer;
  xlsx: XlsxSourceMeta;
  journal: EditJournal;
  /** Formula edits from the calc-engine session, keyed `"row:col"`. */
  formulaEdits?: ReadonlyMap<string, FormulaEditRecord>;
  mediaProvider: MediaProvider;
  container: ContentContainer | null;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Save journal edits into an XLSX sidecar via in-place cell patching.
 *
 * Journal rowIds are BODY row indices within the region; the region's
 * anchor (+ header offset) maps them back to sheet addresses. The patcher
 * is all-or-nothing — a refused cell (formula/date, which the grid's lock
 * predicate should have prevented) fails the whole save with its reason.
 */
export async function saveXlsxEdits(options: SaveXlsxEditsOptions): Promise<GridSaveResult> {
  const { path, xlsx, journal, mediaProvider, container } = options;
  const snapshot = journal.entries();
  const formulaEdits = new Map(options.formulaEdits);
  return withDataSave(options, async (originalBytes): Promise<GridSaveResult> => {
    const notices: string[] = [];

    try {
      if (container) {
        await backupOriginal(container, path, originalBytes, XLSX_MIME);
      } else {
        notices.push('no workspace container — saved without a backup copy');
      }

      const { patchXlsxCellValues, formatCellRef } = await import('@bendyline/squisq-formats/xlsx');
      const bodyTop = xlsx.anchorRow + (xlsx.hasHeader ? 1 : 0);
      const patches: import('@bendyline/squisq-formats/xlsx').XlsxCellPatch[] = snapshot
        .filter((entry) => !formulaEdits.has(`${entry.rowId}:${entry.col}`))
        .map((entry) => ({
          sheet: xlsx.sheet,
          ref: formatCellRef(bodyTop + entry.rowId, xlsx.anchorCol + entry.col),
          value: entry.next,
        }));
      for (const [key, record] of formulaEdits ?? []) {
        const [row, col] = key.split(':').map(Number) as [number, number];
        patches.push({
          sheet: xlsx.sheet,
          ref: formatCellRef(bodyTop + row, xlsx.anchorCol + col),
          ...(record.formula === null
            ? { value: record.value ?? null, removeFormula: true }
            : { formula: record.formula }),
          ...(record.cachedValue !== undefined ? { cachedValue: record.cachedValue } : {}),
        });
      }
      const bytes = await patchXlsxCellValues(originalBytes, patches);

      const savedPath = await mediaProvider.addMedia(path, bytes, XLSX_MIME);
      if (savedPath !== path) {
        return {
          ok: false,
          savedPath,
          notices,
          error: `the host saved a copy at "${savedPath}" instead of overwriting "${path}" — the document still references the original`,
        };
      }

      journal.acknowledge(snapshot);
      return { ok: true, savedPath, notices, bytes };
    } catch (err: unknown) {
      return {
        ok: false,
        notices,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }).catch((error: unknown) => ({
    ok: false,
    notices: [],
    error: error instanceof Error ? error.message : String(error),
  }));
}
