import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import type { TableCellEdit } from '@bendyline/squisq/table';
import { DataGrid, type FormulaSupport } from '../DataGrid';
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
        .querySelector('[role="gridcell"]')!
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

it('opens no editor on a row whose values have not loaded yet', async () => {
  const store = new TableStoreClient({ headers: ['Value'], cells: [[100]] }, { forceLocal: true });
  const journal = new EditJournal();
  let releaseRows!: () => void;
  const rowsGate = new Promise<void>((resolve) => (releaseRows = resolve));
  const rows = store.rows.bind(store);
  store.rows = async (start, count) => {
    await rowsGate;
    return rows(start, count);
  };
  const ui = render(
    <DataGrid provider={store} journal={journal} view={{ sort: [], filter: [] }} />,
  );
  const cell = () => ui.container.querySelector<HTMLElement>('[role="gridcell"]');
  try {
    // The row renders, blank, while its page is still in flight. An editor
    // opened now would have no row to commit against and drop the value.
    await waitFor(() => expect(cell()).not.toBeNull());
    fireEvent.doubleClick(cell()!);
    expect(ui.container.querySelector('.squisq-grid-editor')).toBeNull();

    await act(async () => releaseRows());
    await waitFor(() => expect(cell()?.textContent).toBe('100'));
    fireEvent.doubleClick(cell()!);
    expect(ui.container.querySelector<HTMLInputElement>('.squisq-grid-editor')?.value).toBe('100');
  } finally {
    ui.unmount();
    store.dispose();
  }
});

it.each([undefined, 'Unknown function'])(
  'keeps a rejected formula editable and allows a corrected retry (error: %s)',
  async (error) => {
    const store = new TableStoreClient(
      { headers: ['Formula', 'Other'], cells: [[40, 7]] },
      { forceLocal: true },
    );
    const journal = new EditJournal();
    const commitFormula = vi
      .fn<FormulaSupport['commitFormula']>()
      .mockResolvedValueOnce({ ok: false, error })
      .mockResolvedValue({ ok: true, updates: [{ rowId: 0, col: 0, value: 42 }] });
    const ui = render(
      <DataGrid
        provider={store}
        journal={journal}
        view={{ sort: [], filter: [] }}
        formulaSupport={{
          getFormula: (_rowId, col) => (col === 0 ? '20*2' : undefined),
          commitFormula,
        }}
      />,
    );
    try {
      const cell = await ui.findByRole('gridcell', { name: '40' });
      fireEvent.mouseDown(cell);
      fireEvent.doubleClick(cell);
      const input = ui.getByRole('textbox', { name: 'Edit Formula, row 1' }) as HTMLInputElement;
      expect(input.value).toBe('=20*2');
      fireEvent.change(input, { target: { value: '=BAD(' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
      expect(input.title).toBe(error ?? 'formula rejected');
      expect(input.value).toBe('=BAD(');
      expect(document.activeElement).toBe(input);
      expect(commitFormula).toHaveBeenNthCalledWith(1, 0, 0, 'BAD(');
      expect((await store.rows(0, 1)).cells).toEqual([[40, 7]]);
      expect(journal.dirtyCount).toBe(0);

      fireEvent.change(input, { target: { value: '=21*2' } });
      expect(input.hasAttribute('aria-invalid')).toBe(false);
      fireEvent.keyDown(input, { key: 'Tab' });
      await waitFor(() => expect(cell.textContent).toBe('42'));
      expect(commitFormula).toHaveBeenNthCalledWith(2, 0, 0, '21*2');
      expect((await store.rows(0, 1)).cells).toEqual([[42, 7]]);
      expect(journal.dirtyCount).toBe(0);
      expect(document.activeElement).toBe(ui.getByRole('gridcell', { name: '7' }));
    } finally {
      ui.unmount();
      store.dispose();
    }
  },
);

it.each(['typing', 'paste'] as const)(
  'updates calculated dependents after %s into a sorted row without silently reordering',
  async (method) => {
    const store = new TableStoreClient(
      {
        headers: ['Input', 'Double'],
        cells: [
          [100, 200],
          [200, 400],
        ],
      },
      { forceLocal: true },
    );
    const journal = new EditJournal();
    const onCellEdited = vi.fn(async (edit: TableCellEdit): Promise<TableCellEdit[]> => [
      { rowId: edit.rowId, col: 1, value: Number(edit.value) * 2 },
    ]);
    const ui = render(
      <DataGrid
        provider={store}
        journal={journal}
        view={{ sort: [{ column: 'Double', dir: 'desc' }], filter: [] }}
        onCellEdited={onCellEdited}
      />,
    );
    try {
      await ui.findByRole('gridcell', { name: '400' });
      const cell = ui.getAllByRole('gridcell')[0]!;
      expect(cell.textContent).toBe('200');
      fireEvent.mouseDown(cell);
      if (method === 'typing') {
        fireEvent.doubleClick(cell);
        const input = ui.getByRole('textbox', { name: 'Edit Input, row 1' });
        fireEvent.change(input, { target: { value: '25' } });
        fireEvent.keyDown(input, { key: 'Enter' });
      } else {
        fireEvent.paste(cell, {
          clipboardData: { getData: (type: string) => (type === 'text/plain' ? '25' : '') },
        });
      }

      await waitFor(() =>
        expect(ui.getAllByRole('gridcell').map((el) => el.textContent)).toEqual([
          '25',
          '50',
          '100',
          '200',
        ]),
      );
      expect(onCellEdited).toHaveBeenCalledExactlyOnceWith({ rowId: 1, col: 0, value: 25 });
      expect(journal.entries()).toEqual([{ rowId: 1, col: 0, prev: 200, next: 25 }]);
      expect((await store.rows(0, 2)).cells).toEqual([
        [25, 50],
        [100, 200],
      ]);

      fireEvent.click(ui.getByRole('button', { name: 'order may be outdated — refresh' }));
      await waitFor(() =>
        expect(ui.getAllByRole('gridcell').map((el) => el.textContent)).toEqual([
          '100',
          '200',
          '25',
          '50',
        ]),
      );
      expect(ui.queryByRole('button', { name: /refresh/ })).toBeNull();
    } finally {
      ui.unmount();
      store.dispose();
    }
  },
);

it('discards every value-edit batch and refetches after the host discards formula edits', async () => {
  const store = new TableStoreClient(
    { headers: ['Input', 'Formula'], cells: [[100, 600]] },
    { forceLocal: true },
  );
  const journal = new EditJournal();
  journal.commit([{ rowId: 0, col: 0, prev: 100, next: 150 }]);
  journal.commit([{ rowId: 0, col: 0, prev: 150, next: 200 }]);
  let releaseDiscard!: () => void;
  const discardGate = new Promise<void>((resolve) => (releaseDiscard = resolve));
  const onDiscardExtra = vi.fn(async () => {
    await discardGate;
    await store.applyEdits([{ rowId: 0, col: 1, value: 200 }]);
  });
  function Harness(): React.ReactElement {
    const [extraDirtyCount, setExtraDirtyCount] = React.useState(1);
    return (
      <DataGrid
        provider={store}
        journal={journal}
        view={{ sort: [], filter: [] }}
        extraDirtyCount={extraDirtyCount}
        onDiscardExtra={async () => {
          await onDiscardExtra();
          setExtraDirtyCount(0);
        }}
      />
    );
  }
  const ui = render(<Harness />);
  try {
    await ui.findByRole('gridcell', { name: '200' });
    expect(ui.container.querySelector('.squisq-grid-dirtybar')?.textContent).toContain(
      '2 unsaved edits',
    );
    fireEvent.click(ui.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onDiscardExtra).toHaveBeenCalledOnce());
    expect(journal.dirtyCount).toBe(0);
    expect(journal.canUndo).toBe(false);
    expect((await store.rows(0, 1)).cells).toEqual([[100, 600]]);

    await act(async () => releaseDiscard());
    await waitFor(() =>
      expect(ui.getAllByRole('gridcell').map((el) => el.textContent)).toEqual(['100', '200']),
    );
    expect((await store.rows(0, 1)).cells).toEqual([[100, 200]]);
    expect(ui.queryByRole('button', { name: 'Discard' })).toBeNull();
  } finally {
    releaseDiscard();
    ui.unmount();
    store.dispose();
  }
});
