/** @vitest-environment jsdom */

/**
 * DataGrid interaction paths beyond the base component-contract suite:
 * keyboard navigation and the edit lifecycle (type-to-edit, Enter commit +
 * move, Escape cancel, Ctrl+A, Ctrl+Z journal undo), the copy handler's
 * TSV + HTML payloads, and the staleView refresh affordance.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DataGrid } from '../DataGrid';
import { TableStoreClient } from '../store/client';
import { EditJournal } from '../store/journal';
import type { TableViewState } from '@bendyline/squisq/table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const EMPTY_VIEW: TableViewState = { sort: [], filter: [] };

async function mount(ui: React.ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function selectFirstCell(host: HTMLElement): HTMLElement {
  const cell = host.querySelector('[role="gridcell"]') as HTMLElement;
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return cell;
}

function pressKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

const focusedCell = (host: HTMLElement): HTMLElement | null =>
  host.querySelector('[role="gridcell"][tabindex="0"]');

describe('DataGrid interactions', () => {
  it('arrow keys move focus; Ctrl jumps to edges; Ctrl+A selects all', async () => {
    const provider = makeProvider();
    const { host, root } = await mount(<DataGrid provider={provider} view={EMPTY_VIEW} />);
    const cell = selectFirstCell(host);
    await settle();
    expect(focusedCell(host)?.getAttribute('aria-colindex')).toBe('1');

    await act(async () => pressKey(cell, 'ArrowRight'));
    expect(focusedCell(host)?.getAttribute('aria-colindex')).toBe('2');

    await act(async () => pressKey(cell, 'ArrowDown', { ctrlKey: true }));
    expect(focusedCell(host)?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('4');

    await act(async () => pressKey(cell, 'a', { ctrlKey: true }));
    expect(host.querySelectorAll('[role="gridcell"][aria-selected="true"]').length).toBe(6);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('type-to-edit seeds the editor; Enter commits and moves down; Ctrl+Z undoes', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} />,
    );
    const cell = selectFirstCell(host);
    await settle();

    await act(async () => pressKey(cell, 'S'));
    const editor = host.querySelector(
      '.squisq-grid-celleditor input, input.squisq-grid-celleditor',
    );
    const input = (editor ?? host.querySelector('[role="gridcell"] input')) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('S');

    // Commit via Enter (bubbles from the input to the grid handler).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'South');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => pressKey(input, 'Enter'));
    await settle();

    expect(journal.dirtyCount).toBe(1);
    const rows = host.querySelectorAll('.squisq-grid-body [role="row"]');
    expect(rows[0]!.textContent).toContain('South');
    // Focus moved down a row after the commit.
    expect(focusedCell(host)?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('3');

    await act(async () => pressKey(cell, 'z', { ctrlKey: true }));
    await settle();
    expect(journal.dirtyCount).toBe(0);
    expect(host.querySelectorAll('.squisq-grid-body [role="row"]')[0]!.textContent).toContain(
      'West',
    );

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('Escape cancels the editor without committing', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} />,
    );
    const cell = selectFirstCell(host);
    await settle();

    await act(async () => pressKey(cell, 'F2'));
    const input = host.querySelector('[role="gridcell"] input') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => pressKey(input, 'Escape'));
    expect(host.querySelector('[role="gridcell"] input')).toBeNull();
    expect(journal.dirtyCount).toBe(0);

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('an uncoercible number is rejected in place — the editor stays open', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={EMPTY_VIEW} />,
    );
    const cell = selectFirstCell(host);
    await settle();
    // Move to the Revenue (numeric) column and edit.
    await act(async () => pressKey(cell, 'ArrowRight'));
    await act(async () => pressKey(cell, 'F2'));
    const input = host.querySelector('[role="gridcell"] input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'not-a-number');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => pressKey(input, 'Enter'));
    await settle();

    expect(journal.dirtyCount).toBe(0);
    const stillOpen = host.querySelector('[role="gridcell"] input') as HTMLInputElement;
    expect(stillOpen).toBeTruthy();
    expect(stillOpen.className).toContain('squisq-grid-editor--error');
    expect(stillOpen.title).toBe('not a number');

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('copy writes TSV text/plain and an HTML table for the selection', async () => {
    const provider = makeProvider();
    const { host, root } = await mount(<DataGrid provider={provider} view={EMPTY_VIEW} />);
    const cell = selectFirstCell(host);
    await settle();
    // Extend the selection to the full 3×2 grid, then let prefetch settle.
    await act(async () => pressKey(cell, 'End', { ctrlKey: true, shiftKey: true }));
    await settle();

    const payload = new Map<string, string>();
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', {
      value: { setData: (type: string, data: string) => payload.set(type, data) },
    });
    await act(async () => cell.dispatchEvent(copy));

    expect(copy.defaultPrevented).toBe(true);
    expect(payload.get('text/plain')).toBe('West\t100\nEast\t2000\nNorth\t30');
    expect(payload.get('text/html')).toBe(
      '<table><tr><td>West</td><td>100</td></tr><tr><td>East</td><td>2000</td></tr><tr><td>North</td><td>30</td></tr></table>',
    );
    expect(host.querySelector('.squisq-grid-status')?.textContent).toContain('Copied 3×2 cells.');

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });

  it('editing a sorted column raises the refresh affordance; clicking re-sorts', async () => {
    const provider = makeProvider();
    const journal = new EditJournal();
    const view: TableViewState = { sort: [{ column: 'Revenue', dir: 'desc' }], filter: [] };
    const { host, root } = await mount(
      <DataGrid provider={provider} journal={journal} view={view} />,
    );
    await settle();
    let rows = host.querySelectorAll('.squisq-grid-body [role="row"]');
    expect(rows[0]!.textContent).toContain('East'); // 2000 first

    // Edit the top row's Revenue to a tiny value — order is now stale.
    const cell = selectFirstCell(host);
    await settle();
    await act(async () => pressKey(cell, 'ArrowRight'));
    await act(async () => pressKey(cell, 'F2'));
    const input = host.querySelector('[role="gridcell"] input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => pressKey(input, 'Enter'));
    await settle();

    // Never auto re-sorted: the edited row stays where it was.
    rows = host.querySelectorAll('.squisq-grid-body [role="row"]');
    expect(rows[0]!.textContent).toContain('East');
    const refresh = host.querySelector('.squisq-grid-refresh') as HTMLButtonElement;
    expect(refresh?.textContent).toMatch(/refresh/);

    await act(async () => refresh.click());
    await settle();
    rows = host.querySelectorAll('.squisq-grid-body [role="row"]');
    expect(rows[0]!.textContent).toContain('West'); // 100 now tops the desc sort
    expect(host.querySelector('.squisq-grid-refresh')).toBeNull();

    await act(async () => root.unmount());
    provider.dispose();
    host.remove();
  });
});
