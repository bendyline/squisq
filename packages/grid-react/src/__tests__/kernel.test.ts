/**
 * Kernel protocol + the two guards that keep the toString() shipping trick
 * honest: the isolation guard (the kernel must close over NOTHING from
 * module scope — evaluated from source in a bare Function scope) and the
 * minify guard (tsup must never minify this package).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildKernelSource,
  tableKernel,
  type KernelColumnPayload,
  type KernelResponse,
  type KernelScope,
} from '../store/kernel';
import { buildColumnarTable } from '../store/columns';
import { TableStoreClient } from '../store/client';

function drive(kernelFactory: (scope: KernelScope) => void) {
  const responses: KernelResponse[] = [];
  const scope: KernelScope = {
    onmessage: null,
    postMessage: (message) => responses.push(message),
  };
  kernelFactory(scope);
  return {
    responses,
    send(message: Parameters<NonNullable<KernelScope['onmessage']>>[0]['data']): KernelResponse {
      scope.onmessage?.({ data: message });
      return responses[responses.length - 1]!;
    },
  };
}

function initPayload() {
  const columnar = buildColumnarTable({
    headers: ['Region', 'Revenue'],
    cells: [
      ['West', 100],
      ['East', 2000],
      ['West', null],
      ['North', 30],
    ],
  });
  return columnar.columns.map((column): KernelColumnPayload => {
    if (column.kind === 'number' || column.kind === 'boolean') {
      return { name: column.name, kind: column.kind, data: column.data, valid: column.valid };
    }
    return { name: column.name, kind: column.kind, data: column.codes, dict: column.dict };
  });
}

describe('tableKernel protocol', () => {
  it('init → setView → rows returns sorted, windowed typed values', () => {
    const host = drive(tableKernel);
    host.send({ type: 'init', seq: 1, columns: initPayload(), rowCount: 4 });

    const viewResult = host.send({
      type: 'setView',
      seq: 2,
      sort: [{ col: 1, dir: 'asc' }],
      filter: [],
    });
    expect(viewResult).toMatchObject({ type: 'viewResult', viewRowCount: 4 });

    const rows = host.send({ type: 'rows', seq: 3, start: 0, count: 10 });
    expect(rows.type).toBe('rowsResult');
    if (rows.type === 'rowsResult') {
      // Numeric asc with the blank LAST; values come back typed.
      expect(rows.cells.map((row) => row[1])).toEqual([30, 100, 2000, null]);
      expect(rows.rowIds).toEqual([3, 0, 1, 2]);
    }
  });

  it('filters with numeric compare and reports view count', () => {
    const host = drive(tableKernel);
    host.send({ type: 'init', seq: 1, columns: initPayload(), rowCount: 4 });
    const viewResult = host.send({
      type: 'setView',
      seq: 2,
      sort: [],
      filter: [{ col: 1, op: '>=', value: '100' }],
    });
    expect(viewResult).toMatchObject({ viewRowCount: 2 });
  });

  it('edits mutate in place, never re-permute, and flag staleView', () => {
    const host = drive(tableKernel);
    host.send({ type: 'init', seq: 1, columns: initPayload(), rowCount: 4 });
    host.send({ type: 'setView', seq: 2, sort: [{ col: 1, dir: 'asc' }], filter: [] });

    const edit = host.send({
      type: 'applyEdits',
      seq: 3,
      edits: [{ rowId: 3, col: 1, value: 999999 }],
    });
    expect(edit).toMatchObject({ type: 'editResult', staleView: true });

    // Order unchanged (row 3 still first) but the value is updated.
    const rows = host.send({ type: 'rows', seq: 4, start: 0, count: 1 });
    if (rows.type === 'rowsResult') {
      expect(rows.rowIds[0]).toBe(3);
      expect(rows.cells[0][1]).toBe(999999);
    }

    const calm = host.send({
      type: 'applyEdits',
      seq: 5,
      edits: [{ rowId: 0, col: 0, value: 'Northwest' }],
    });
    expect(calm).toMatchObject({ staleView: false }); // col 0 not in the sort
  });

  it('dictionary edits with NEW values re-rank correctly on next setView', () => {
    const host = drive(tableKernel);
    host.send({ type: 'init', seq: 1, columns: initPayload(), rowCount: 4 });
    host.send({
      type: 'applyEdits',
      seq: 2,
      edits: [{ rowId: 0, col: 0, value: 'Aardvark' }],
    });
    host.send({ type: 'setView', seq: 3, sort: [{ col: 0, dir: 'asc' }], filter: [] });
    const rows = host.send({ type: 'rows', seq: 4, start: 0, count: 1 });
    if (rows.type === 'rowsResult') expect(rows.cells[0][0]).toBe('Aardvark');
  });
});

describe('toString() shipping guards', () => {
  it('isolation: the kernel source runs in a bare scope with no module closure', () => {
    const source = buildKernelSource();
    const responses: unknown[] = [];
    const fakeSelf: KernelScope = {
      onmessage: null,
      postMessage: (message) => responses.push(message),
    };
    // Evaluate the SOURCE (not the reference) against a mock self. Any
    // accidental closure over module scope throws ReferenceError here.
    const run = new Function('self', source);
    run(fakeSelf);
    fakeSelf.onmessage?.({ data: { type: 'init', seq: 1, columns: [], rowCount: 0 } });
    expect(responses).toMatchObject([{ type: 'ready', seq: 1 }]);
  });

  it('minify guard: identifiers survive in the embedded source', () => {
    // tsup must never minify this package — mangled toString() output would
    // pass runtime but break the isolation contract silently.
    const source = tableKernel.toString();
    for (const marker of ['setView', 'applyEdits', 'recomputeView', 'staleView']) {
      expect(source).toContain(marker);
    }
  });

  it('tsup config carries the do-not-minify comment pin', () => {
    const config = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../tsup.config.ts'),
      'utf8',
    );
    expect(config).toContain('never enable `minify`');
    expect(config).not.toMatch(/minify:\s*true/);
  });
});

describe('TableStoreClient (local host end-to-end)', () => {
  it('describe/setView/rows/applyEdits round-trip through the provider contract', async () => {
    const client = new TableStoreClient(
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

    const schema = await client.describe();
    expect(schema.columns).toEqual([
      { name: 'Region', kind: 'string' },
      { name: 'Revenue', kind: 'number' },
    ]);
    expect(schema.rowCount).toBe(3);

    const viewResult = await client.setView({
      sort: [{ column: 'Revenue', dir: 'desc' }],
      filter: [{ column: 'Region', op: '!=', value: 'North' }],
    });
    expect(viewResult.viewRowCount).toBe(2);
    expect(viewResult.issues).toEqual([]);

    const page = await client.rows(0, 10);
    expect(page.cells.map((row) => row[1])).toEqual([2000, 100]);

    const edited = await client.applyEdits([{ rowId: 1, col: 1, value: 5 }]);
    expect(edited.staleView).toBe(true);
    client.dispose();
  });

  it('reports unknown view columns as issues without failing', async () => {
    const client = new TableStoreClient({ headers: ['A'], cells: [['x']] }, { forceLocal: true });
    const result = await client.setView({
      sort: [{ column: 'Nope', dir: 'asc' }],
      filter: [],
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(['data-view-unknown-column']);
    expect(result.viewRowCount).toBe(1);
    client.dispose();
  });
});
