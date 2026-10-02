import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import type { TableCellEdit } from '@bendyline/squisq/table';
import { DataGrid } from '../DataGrid';
import { TableStoreClient } from '../store/client';
import { EditJournal } from '../store/journal';
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 420,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
});

it('replays a surviving journal into the freshly mounted grid store', async () => {
  const store = new TableStoreClient({ headers: ['Value'], cells: [[100]] }, { forceLocal: true });
  const journal = new EditJournal();
  journal.commit([{ rowId: 0, col: 0, prev: 100, next: 150 }]);
  const ui = render(
    <DataGrid provider={store} journal={journal} view={{ sort: [], filter: [] }} />,
  );
  try {
    await waitFor(() =>
      expect(ui.container.querySelector('[role="gridcell"]')?.textContent).toBe('150'),
    );
    expect(ui.container.querySelector('[role="gridcell"]')?.textContent).toBe('150');
  } finally {
    ui.unmount();
    store.dispose();
  }
});

it('recalculates dependents when undo restores an input value', async () => {
  const store = new TableStoreClient(
    { headers: ['Input', 'Double'], cells: [[200, 400]] },
    { forceLocal: true },
  );
  const journal = new EditJournal();
  journal.commit([{ rowId: 0, col: 0, prev: 100, next: 200 }]);
  const onCellEdited = vi.fn(async (edit: TableCellEdit) => [
    { rowId: 0, col: 1, value: Number(edit.value) * 2 },
  ]);
  const ui = render(
    <DataGrid
      provider={store}
      journal={journal}
      view={{ sort: [], filter: [] }}
      onCellEdited={onCellEdited}
    />,
  );
  try {
    await waitFor(() => expect(ui.container.querySelector('[role="gridcell"]')).not.toBeNull());
    await act(async () => {
      ui.container
        .querySelector('[role="grid"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    const page = await store.rows(0, 1);
    expect(page.cells[0]?.[0]).toBe(100);
    expect(page.cells[0]?.[1]).toBe(200);
  } finally {
    ui.unmount();
    store.dispose();
  }
});
