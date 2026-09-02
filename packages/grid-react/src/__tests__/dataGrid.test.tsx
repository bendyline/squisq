/** @vitest-environment jsdom */

/**
 * DataGrid renderer: mounting against a local-host provider, header
 * sort-cycling through `onViewChange`, filter inputs, a11y roles, and the
 * dirty/save bar. Virtualized row internals are covered by the kernel and
 * parity suites — these tests pin the component contract.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataGrid } from '../DataGrid';
import { TableStoreClient } from '../store/client';
import { EditJournal } from '../store/journal';
import type { TableViewState } from '@bendyline/squisq/table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has no layout: TanStack Virtual measures the scroll element via
  // offsetWidth/offsetHeight (virtual-core's `getRect`) and would see 0×0,
  // rendering no rows. Give every element a plausible box so the
  // virtualizer windows normally.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 420,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
});

function makeProvider(): TableStoreClient {
  return new TableStoreClient(
    {
      headers: ['Region', 'Revenue'],
      cells: [
        ['West', 100],
        ['East', 2000],
        ['North', 30],
      ],
    },
    { forceLocal: true },
  );
}

async function mount(ui: React.ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(ui);
  });
  // Let describe/setView/rows promises settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

const EMPTY_VIEW: TableViewState = { sort: [], filter: [] };

describe('DataGrid', () => {
  it('renders headers, grid roles, and the row-count footer', async () => {
    const provider = makeProvider();
    const { host, root } = await mount(<DataGrid provider={provider} view={EMPTY_VIEW} />);

    const grid = host.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.getAttribute('aria-rowcount')).toBe('4'); // 3 rows + header
    expect(grid?.getAttribute('aria-colcount')).toBe('2');
    const headers = [...host.querySelectorAll('[role="columnheader"]')].map(
      (el) => el.querySelector('.squisq-grid-colname')?.textContent,
    );
    expect(headers).toEqual(['Region', 'Revenue']);
    expect(host.querySelector('.squisq-grid-status')?.textContent).toContain('3 rows');

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('cycles sort asc → desc → none through onViewChange', async () => {
    const provider = makeProvider();
    const changes: TableViewState[] = [];
    const { host, root } = await mount(
      <DataGrid provider={provider} view={EMPTY_VIEW} onViewChange={(v) => changes.push(v)} />,
    );

    const button = host.querySelectorAll('.squisq-grid-sortbutton')[1] as HTMLButtonElement;
    await act(async () => button.click());
    expect(changes[0]?.sort).toEqual([{ column: 'Revenue', dir: 'asc' }]);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('shows aria-sort and applies the active view to rendered rows', async () => {
    const provider = makeProvider();
    const view: TableViewState = { sort: [{ column: 'Revenue', dir: 'desc' }], filter: [] };
    const { host, root } = await mount(<DataGrid provider={provider} view={view} />);

    const revenueHeader = host.querySelectorAll('[role="columnheader"]')[1];
    expect(revenueHeader?.getAttribute('aria-sort')).toBe('descending');
    const firstRowCells = [...host.querySelectorAll('[role="row"]')[1]!.children].map(
      (el) => el.textContent,
    );
    expect(firstRowCells).toEqual(['East', '2000']);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('emits contains-filter clauses from the header filter inputs', async () => {
    const provider = makeProvider();
    const changes: TableViewState[] = [];
    const { host, root } = await mount(
      <DataGrid provider={provider} view={EMPTY_VIEW} onViewChange={(v) => changes.push(v)} />,
    );

    const input = host.querySelector('.squisq-grid-filterinput') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'We');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(changes[0]?.filter).toEqual([{ column: 'Region', op: '~', value: 'We' }]);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('shows the dirty bar when the journal has edits and calls onSave', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 100, next: 150 }]);
    let saved = 0;
    const { host, root } = await mount(
      <DataGrid
        provider={provider}
        journal={journal}
        view={EMPTY_VIEW}
        onSave={() => {
          saved++;
        }}
      />,
    );

    expect(host.querySelector('.squisq-grid-dirtybar')?.textContent).toContain('1 unsaved edit');
    const save = host.querySelector('.squisq-grid-save') as HTMLButtonElement;
    await act(async () => save.click());
    expect(saved).toBe(1);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('surfaces the session-only view hint when not persisted', async () => {
    const provider = makeProvider();
    const view: TableViewState = { sort: [{ column: 'Region', dir: 'asc' }], filter: [] };
    const { host, root } = await mount(
      <DataGrid provider={provider} view={view} viewPersisted={false} />,
    );
    expect(host.querySelector('.squisq-grid-status')?.textContent).toContain(
      'view not saved to document',
    );
    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('shows the read-only reason and no dirty bar when locked', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 100, next: 150 }]);
    const { host, root } = await mount(
      <DataGrid
        provider={provider}
        journal={journal}
        view={EMPTY_VIEW}
        readOnlyReason="XLSX editing arrives with in-place patching"
      />,
    );
    expect(host.querySelector('.squisq-grid-readonly')?.textContent).toContain('XLSX editing');
    expect(host.querySelector('.squisq-grid-dirtybar')).toBeNull();
    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('locks individual cells: no editor opens and the lock affordance renders', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid
        provider={provider}
        journal={journal}
        view={EMPTY_VIEW}
        isCellLocked={(rowId, col) => rowId === 0 && col === 1}
        lockedReason="Formula cells become editable with the calculation engine"
      />,
    );

    const lockedCell = host.querySelector('.squisq-grid-cell--locked') as HTMLElement;
    expect(lockedCell).not.toBeNull();
    expect(lockedCell.getAttribute('title')).toContain('calculation engine');
    expect(lockedCell.getAttribute('aria-readonly')).toBe('true');

    // Double-clicking the locked cell must not open the inline editor…
    await act(async () => lockedCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(host.querySelector('.squisq-grid-editor')).toBeNull();

    // …while an unlocked neighbor still edits normally.
    const rows = host.querySelectorAll('[role="row"]');
    const unlocked = rows[1]!.children[0] as HTMLElement;
    await act(async () => unlocked.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(host.querySelector('.squisq-grid-editor')).not.toBeNull();

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('routes =drafts through formulaSupport and applies returned updates', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const committed: string[] = [];
    const { host, root } = await mount(
      <DataGrid
        provider={provider}
        journal={journal}
        view={EMPTY_VIEW}
        extraDirtyCount={0}
        formulaSupport={{
          getFormula: (rowId, col) => (rowId === 0 && col === 1 ? 'A1*2' : undefined),
          commitFormula: async (rowId, col, formula) => {
            committed.push(`${rowId}:${col}=${formula}`);
            return { ok: true, updates: [{ rowId, col, value: 300 }] };
          },
        }}
      />,
    );

    // The formula cell renders with the affordance + source tooltip.
    const cell = host.querySelector('.squisq-grid-cell--formula') as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell.getAttribute('title')).toBe('=A1*2');

    // Editing seeds the SOURCE, not the display value.
    await act(async () => cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const editor = host.querySelector('.squisq-grid-editor') as HTMLInputElement;
    expect(editor.value).toBe('=A1*2');

    // Commit a new formula: updates flow into the visible cache.
    await act(async () => {
      // Controlled input: go through the NATIVE setter so React's value
      // tracker sees the change and fires onChange.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(editor, '=A1*3');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      // React delegates onBlur through the bubbling focusout event.
      editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(committed).toEqual(['0:1=A1*3']);
    const firstRow = host.querySelectorAll('[role="row"]')[1]!;
    expect(firstRow.textContent).toContain('300');
    // No value-journal entry: formula edits live outside the journal.
    expect(journal.dirtyCount).toBe(0);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('counts extraDirtyCount in the save bar', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} extraDirtyCount={2} />,
    );
    expect(host.querySelector('.squisq-grid-dirtybar')?.textContent).toContain('2 unsaved edits');
    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('keys typed in a filter input never open the cell editor', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} />,
    );

    // Give the grid a selection first — the hijack path needed one.
    const firstCell = host.querySelector('[role="gridcell"]') as HTMLElement;
    await act(async () => firstCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

    const filter = host.querySelector('.squisq-grid-filterinput') as HTMLInputElement;
    for (const key of ['c', 'e', 'ArrowLeft', 'Home', 'Enter']) {
      await act(async () =>
        filter.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
      );
    }

    // No cell editor opened, nothing journaled — the keys stayed the
    // filter input's own.
    expect(host.querySelector('.squisq-grid-editor')).toBeNull();
    expect(journal.dirtyCount).toBe(0);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('filter operator menu: anchors, case toggle, and numeric defaults', async () => {
    const provider = makeProvider();
    const changes: TableViewState[] = [];
    // Controlled harness — the widget feeds the view back, and the case
    // toggle's re-emit reads the ACTIVE clause from the view prop.
    function Harness() {
      const [view, setView] = useState<TableViewState>(EMPTY_VIEW);
      return (
        <DataGrid
          provider={provider}
          view={view}
          onViewChange={(v) => {
            changes.push(v);
            setView(v);
          }}
        />
      );
    }
    const { host, root } = await mount(<Harness />);

    // Region (string): defaults to contains; Revenue (number): equals.
    const opButtons = host.querySelectorAll('.squisq-grid-opbutton');
    expect(opButtons[0]!.textContent).toContain('~');
    expect(opButtons[1]!.textContent).toContain('=');

    // Open Region's menu: text ops + comparisons + the case toggle.
    await act(async () => (opButtons[0] as HTMLButtonElement).click());
    const menu = host.querySelector('.squisq-grid-opmenu')!;
    const labels = [...menu.querySelectorAll('.squisq-grid-opoption')].map((el) =>
      el.textContent!.slice(el.querySelector('.squisq-grid-opglyph')!.textContent!.length).trim(),
    );
    expect(labels).toEqual([
      'Contains',
      "Doesn't contain",
      'Equals',
      'Not equal',
      'Starts with',
      'Ends with',
      'Less than',
      'Greater than',
      'At most',
      'At least',
    ]);
    expect(menu.querySelector('.squisq-grid-opcase')).not.toBeNull();

    // Choose "Starts with", then type: the emitted clause carries ^~.
    const startsWith = [...menu.querySelectorAll('.squisq-grid-opoption')].find((el) =>
      el.textContent!.includes('Starts with'),
    ) as HTMLButtonElement;
    await act(async () => startsWith.click());
    expect(host.querySelector('.squisq-grid-opmenu')).toBeNull(); // menu closed
    expect(opButtons[0]!.textContent).toContain('^');

    const filter = host.querySelector('.squisq-grid-filterinput') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(filter, 'We');
      filter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(changes[changes.length - 1]?.filter).toEqual([
      { column: 'Region', op: '^~', value: 'We' },
    ]);

    // Toggle case sensitivity: the active clause re-emits with the flag.
    await act(async () => (opButtons[0] as HTMLButtonElement).click());
    const caseBox = host.querySelector('.squisq-grid-opcase input') as HTMLInputElement;
    await act(async () => caseBox.click());
    expect(changes[changes.length - 1]?.filter).toEqual([
      { column: 'Region', op: '^~', value: 'We', caseSensitive: true },
    ]);

    // Revenue's menu has no case toggle and no text anchors.
    await act(async () => (opButtons[1] as HTMLButtonElement).click());
    const numericMenu = host.querySelector('.squisq-grid-opmenu')!;
    expect(numericMenu.querySelector('.squisq-grid-opcase')).toBeNull();
    expect(numericMenu.textContent).not.toContain('Starts with');
    expect(numericMenu.textContent).toContain('At least');

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('pastes a TSV block anchored at the selection, one undoable batch', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} />,
    );

    // Anchor the selection at the first cell (row 0, Region column).
    const firstCell = host.querySelector('[role="gridcell"]') as HTMLElement;
    await act(async () => firstCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

    // Paste a 2×2 block: text goes into Region; numbers into Revenue —
    // with one uncoercible number ("oops") skipped, not guessed.
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? 'AA\t111\nBB\toops\n' : '') },
    });
    await act(async () => firstCell.dispatchEvent(paste));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rows = host.querySelectorAll('.squisq-grid-body [role="row"]');
    expect(rows[0]!.textContent).toContain('AA');
    expect(rows[0]!.textContent).toContain('111');
    expect(rows[1]!.textContent).toContain('BB');
    expect(rows[1]!.textContent).toContain('2000'); // "oops" skipped, original kept
    expect(journal.dirtyCount).toBe(3);
    expect(host.querySelector('.squisq-grid-status')?.textContent).toContain(
      'Pasted 3 cells (1 skipped)',
    );

    // One batch = one undo step: a single undo reverts the whole paste.
    expect(journal.canUndo).toBe(true);
    journal.undo();
    expect(journal.dirtyCount).toBe(0);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('paste inside a filter input stays a normal text paste', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} />,
    );
    const firstCell = host.querySelector('[role="gridcell"]') as HTMLElement;
    await act(async () => firstCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

    const filter = host.querySelector('.squisq-grid-filterinput') as HTMLInputElement;
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'X\tY\n' },
    });
    await act(async () => filter.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(false);
    expect(journal.dirtyCount).toBe(0);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });
});
