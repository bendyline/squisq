/**
 * EditJournal — unsaved cell edits, keyed by immutable source row id.
 *
 * Lives on the MAIN thread beside the store client. Row identity is the
 * source row index assigned at ingest, so an entry is unambiguous under any
 * sort/filter permutation and unaffected by edits changing sort keys —
 * identity was never derived from values.
 *
 * Batches are the undo unit (one commit = one batch). The journal is
 * additionally cached by storage owner, path, and region so a widget
 * unmount/remount does not lose unsaved edits. Scoped journals survive
 * revision bumps; saving acknowledges only the persisted snapshot.
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
    return [...this.latest.values()].map((entry) => ({ ...entry }));
  }

  /** Advance the save baseline without losing edits (or undo) made during I/O. */
  acknowledge(saved: readonly JournalEntry[]): void {
    const remaining = new Map(
      this.entries().map((entry) => [`${entry.rowId}:${entry.col}`, entry]),
    );
    for (const entry of saved) {
      const key = `${entry.rowId}:${entry.col}`;
      const current = remaining.get(key);
      const next = current ? current.next : entry.prev;
      if (next === entry.next) remaining.delete(key);
      else remaining.set(key, { ...entry, prev: entry.next, next });
    }
    this.clear();
    this.commit([...remaining.values()]);
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
const scopedCaches = new WeakMap<object, Map<string, EditJournal>>();

export interface JournalScope {
  /** Container or provider that owns the bytes; never a relative file path. */
  owner: object;
  /** Worksheet, region anchor, and header interpretation. */
  region: string;
}

function cacheFor(scope?: JournalScope): Map<string, EditJournal> {
  if (!scope) return journalCache;
  let cache = scopedCaches.get(scope.owner);
  if (!cache) {
    cache = new Map();
    scopedCaches.set(scope.owner, cache);
  }
  return cache;
}

/**
 * Get the journal for an owner/path/region. Scoped edits survive a revision
 * change elsewhere in the container. Legacy unscoped callers start clean
 * at each revision, preserving the original two-argument API.
 */
export function journalFor(path: string, revision: number, scope?: JournalScope): EditJournal {
  const cache = cacheFor(scope);
  const identity = JSON.stringify([path, scope?.region ?? '']);
  const key = `${revision} ${identity}`;
  let journal = cache.get(key);
  if (!journal) {
    for (const [existing, previous] of cache) {
      if (existing.endsWith(` ${identity}`) && existing !== key) {
        // A save elsewhere in the container bumps its revision too. Pending
        // scoped edits must survive; they will be replayed onto the new store.
        if (scope) journal = previous;
        cache.delete(existing);
      }
    }
    journal ??= new EditJournal();
    cache.set(key, journal);
  }
  return journal;
}

export function discardJournal(path: string, scope?: JournalScope): void {
  const cache = cacheFor(scope);
  const identity = JSON.stringify([path, scope?.region ?? '']);
  for (const existing of [...cache.keys()]) {
    if (existing.endsWith(` ${identity}`)) cache.delete(existing);
  }
}
