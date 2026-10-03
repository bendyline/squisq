import { describe, expect, it } from 'vitest';
import { EditJournal, journalFor } from '../store/journal';

describe('journal save baselines', () => {
  it.each([null, 7, 1])('retains a concurrent edit to %s against the persisted value', (next) => {
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 0, prev: 1, next: 5 }]);
    const saved = journal.entries();
    journal.commit([{ rowId: 0, col: 0, prev: 5, next }]);
    journal.acknowledge(saved);
    expect(journal.entries()).toEqual([{ rowId: 0, col: 0, prev: 5, next }]);
    expect(journal.undo()).toEqual([{ rowId: 0, col: 0, value: 5 }]);
  });

  it('retains an undo made while the original edit is saving', () => {
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 0, prev: 1, next: 5 }]);
    const saved = journal.entries();
    journal.undo();
    journal.acknowledge(saved);
    expect(journal.entries()).toEqual([{ rowId: 0, col: 0, prev: 5, next: 1 }]);
  });

  it('isolates container/region identities and retains scoped edits across unrelated revisions', () => {
    const scope = { owner: {}, region: 'Sales:A1:true' };
    const journal = journalFor('book.xlsx', 1, scope);
    journal.commit([{ rowId: 0, col: 0, prev: 1, next: 5 }]);
    expect(journalFor('book.xlsx', 2, scope)).toBe(journal);
    expect(journalFor('book.xlsx', 1, { ...scope, owner: {} })).not.toBe(journal);
    expect(journalFor('book.xlsx', 1, { ...scope, region: 'Rates:A1:true' })).not.toBe(journal);
    expect(journalFor('book.xlsx', 1, { ...scope, region: 'Sales:A1:false' })).not.toBe(journal);
  });
});
