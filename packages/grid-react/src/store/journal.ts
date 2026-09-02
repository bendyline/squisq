/**
 * EditJournal — unsaved cell edits, keyed by immutable source row id.
 *
 * Lives on the MAIN thread beside the store client. Row identity is the
 * source row index assigned at ingest, so an entry is unambiguous under any
 * sort/filter permutation and unaffected by edits changing sort keys —
 * identity was never derived from values.
 *
 * Batches are the undo unit (one commit = one batch). The journal is
 * additionally cached module-level by `(cacheKey)` — conventionally
 * `${path}@${mediaRevision}` — so a widget unmount/remount (ProseMirror
 * re-decoration) does not lose unsaved edits; a revision bump (save or
 * re-upload) naturally misses the cache and starts clean.
 */

import type { TableCellEdit, TableCellValue } from '@bendyline/squisq/table';

export interface JournalEntry {
  rowId: number;
  col: number;
  prev: TableCellValue;
  next: TableCellValue;
}

export class EditJournal {
  /** Latest value per cell, keyed `rowId:col`. */
  private readonly latest = new Map<string, JournalEntry>();
  private readonly undoStack: JournalEntry[][] = [];
  private readonly redoStack: JournalEntry[][] = [];

  get dirtyCount(): number {
    return this.latest.size;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  isDirty(rowId: number, col: number): boolean {
    return this.latest.has(`${rowId}:${col}`);
  }

  /** Record one committed batch of edits. Clears the redo stack. */
  commit(entries: JournalEntry[]): void {
    if (entries.length === 0) return;
    this.undoStack.push(entries);
    this.redoStack.length = 0;
    for (const entry of entries) this.applyLatest(entry);
  }

  /** Pop the latest batch; returns the INVERSE edits to apply to the store. */
  undo(): TableCellEdit[] {
    const batch = this.undoStack.pop();
    if (!batch) return [];
    this.redoStack.push(batch);
    const inverse = batch.map((entry) => ({
      rowId: entry.rowId,
      col: entry.col,
      value: entry.prev,
    }));
    this.rebuildLatest();
    return inverse;
  }

  /** Re-apply the most recently undone batch. */
  redo(): TableCellEdit[] {
    const batch = this.redoStack.pop();
    if (!batch) return [];
    this.undoStack.push(batch);
    this.rebuildLatest();
    return batch.map((entry) => ({ rowId: entry.rowId, col: entry.col, value: entry.next }));
  }

  /** Net outstanding edits (what a Save must persist). */
  entries(): JournalEntry[] {
    return [...this.latest.values()];
  }

  clear(): void {
    this.latest.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private applyLatest(entry: JournalEntry): void {
    const key = `${entry.rowId}:${entry.col}`;
    const existing = this.latest.get(key);
    const merged: JournalEntry = existing ? { ...entry, prev: existing.prev } : { ...entry };
    if (merged.prev === merged.next) this.latest.delete(key);
    else this.latest.set(key, merged);
  }

  private rebuildLatest(): void {
    this.latest.clear();
    for (const batch of this.undoStack) {
      for (const entry of batch) this.applyLatest(entry);
    }
  }
}

// ── Module-level survival cache ──────────────────────────────────────

const journalCache = new Map<string, EditJournal>();

/**
 * Get (or create) the journal for a cache key. Any entry for the same path
 * at a DIFFERENT revision is discarded — a revision bump means the bytes
 * changed underneath the edits.
 */
export function journalFor(path: string, revision: number): EditJournal {
  const key = `${revision} ${path}`;
  let journal = journalCache.get(key);
  if (!journal) {
    for (const existing of journalCache.keys()) {
      if (existing.endsWith(` ${path}`) && existing !== key) journalCache.delete(existing);
    }
    journal = new EditJournal();
    journalCache.set(key, journal);
  }
  return journal;
}

export function discardJournal(path: string): void {
  for (const existing of [...journalCache.keys()]) {
    if (existing.endsWith(` ${path}`)) journalCache.delete(existing);
  }
}
