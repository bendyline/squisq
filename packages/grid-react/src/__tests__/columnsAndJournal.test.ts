import { describe, expect, it } from 'vitest';
import { buildColumnarTable, columnCellValue } from '../store/columns';
import { EditJournal, discardJournal, journalFor } from '../store/journal';

describe('buildColumnarTable typing', () => {
  it('types columns by the shared inference rule', () => {
    const table = buildColumnarTable({
      headers: ['Num', 'LeadZero', 'Bool', 'Text', 'Mixed'],
      cells: [
        ['1', '007', 'true', 'a', '1'],
        ['-2.5', '12', 'FALSE', 'b', 'x'],
        ['', '', '', '', ''],
      ],
    });
    expect(table.columns.map((column) => column.kind)).toEqual([
      'number',
      'string', // leading zero keeps text
      'boolean',
      'string',
      'string', // mixed degrades
    ]);
  });

  it('keeps typed ingest values and blank masks', () => {
    const table = buildColumnarTable({
      headers: ['N', 'B', 'S'],
      cells: [
        [1.5, true, 'x'],
        [null, null, null],
      ],
    });
    expect(columnCellValue(table.columns[0], 0)).toBe(1.5);
    expect(columnCellValue(table.columns[0], 1)).toBeNull();
    expect(columnCellValue(table.columns[1], 0)).toBe(true);
    expect(columnCellValue(table.columns[1], 1)).toBeNull();
    expect(columnCellValue(table.columns[2], 0)).toBe('x');
    expect(columnCellValue(table.columns[2], 1)).toBeNull();
  });

  it('dictionary-encodes repeated strings', () => {
    const table = buildColumnarTable({
      headers: ['Region'],
      cells: [['West'], ['East'], ['West'], ['West']],
    });
    const column = table.columns[0];
    if (column.kind !== 'string') throw new Error('expected dict column');
    expect(column.dict).toEqual(['West', 'East']);
    expect([...column.codes]).toEqual([0, 1, 0, 0]);
  });

  it('honors kind hints (XLSX adapters know better than inference)', () => {
    const table = buildColumnarTable({
      headers: ['D'],
      cells: [['2026-01-02'], ['2026-01-03']],
      hints: [{ kind: 'date' }],
    });
    expect(table.columns[0].kind).toBe('date');
  });
});

describe('EditJournal', () => {
  it('tracks latest per cell, merges chains, and drops no-op round-trips', () => {
    const journal = new EditJournal();
    journal.commit([{ rowId: 1, col: 0, prev: 'a', next: 'b' }]);
    journal.commit([{ rowId: 1, col: 0, prev: 'b', next: 'c' }]);
    expect(journal.dirtyCount).toBe(1);
    expect(journal.entries()).toEqual([{ rowId: 1, col: 0, prev: 'a', next: 'c' }]);

    journal.commit([{ rowId: 1, col: 0, prev: 'c', next: 'a' }]);
    expect(journal.dirtyCount).toBe(0); // back to original = clean
    expect(journal.canUndo).toBe(true); // but still undoable history
  });

  it('undo returns inverse edits; redo replays; dirty state follows', () => {
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 5, next: 9 }]);
    journal.commit([{ rowId: 2, col: 1, prev: null, next: 4 }]);

    expect(journal.undo()).toEqual([{ rowId: 2, col: 1, value: null }]);
    expect(journal.dirtyCount).toBe(1);
    expect(journal.redo()).toEqual([{ rowId: 2, col: 1, value: 4 }]);
    expect(journal.dirtyCount).toBe(2);

    journal.commit([{ rowId: 3, col: 0, prev: 'x', next: 'y' }]);
    expect(journal.canRedo).toBe(false); // new commit clears redo
  });

  it('survives remounts via the module cache and dies on revision bumps', () => {
    discardJournal('a.csv');
    const first = journalFor('a.csv', 1);
    first.commit([{ rowId: 0, col: 0, prev: 'a', next: 'b' }]);

    expect(journalFor('a.csv', 1)).toBe(first); // remount keeps edits
    const bumped = journalFor('a.csv', 2); // save/re-upload discards
    expect(bumped).not.toBe(first);
    expect(bumped.dirtyCount).toBe(0);
    discardJournal('a.csv');
  });
});
