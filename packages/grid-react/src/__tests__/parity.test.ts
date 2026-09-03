/**
 * Parity contract: the worker kernel and core's `applyTableViewState`
 * reference implementation must order and filter identically. The kernel
 * copies the typing/collation rules by necessity (zero-import constraint);
 * this suite is what keeps the copies honest.
 *
 * Fixtures run through BOTH paths as STRING matrices (the reference works
 * on strings; the client ingests the same strings so column typing follows
 * the shared inference rule on both sides).
 */

import { describe, expect, it } from 'vitest';
import { applyTableViewState, parseTableViewState } from '@bendyline/squisq/table';
import { TableStoreClient } from '../store/client';

const HEADERS = ['Region', 'Revenue', 'Tag', 'Code'];
const ROWS: string[][] = [
  ['West', '100', 'v2', '007'],
  ['East', '2000', 'v10', '12'],
  ['West', '', 'v1', '9'],
  ['North', '30', 'v10', ''],
  ['South', '-5.5', 'V2', '007'],
  ['East', '100', '', '0'],
];

const CASES: { sort?: string; filter?: string }[] = [
  { sort: 'Revenue' },
  { sort: 'Revenue:desc' },
  { sort: 'Tag' },
  { sort: 'Code' }, // leading-zero column stays text
  { sort: 'Region,Revenue:desc' },
  { filter: 'Region=West' },
  { filter: 'Revenue>=100' },
  { filter: 'Revenue<100' },
  { filter: 'Tag~v1' },
  { filter: 'Tag!~v1' },
  { filter: 'Revenue=' },
  { sort: 'Revenue:desc', filter: 'Region!=North' },
  { sort: 'Tag,Region', filter: 'Revenue!=' },
  // Operator extensions: anchors + the case-sensitivity modifier.
  { filter: 'Region^~w' },
  { filter: 'Region^~*W' },
  { filter: 'Region$~st' },
  { filter: 'Region$~*ST' },
  { filter: 'Region=west' },
  { filter: 'Region=*west' },
  { filter: 'Tag~*V' },
  { filter: 'Tag!~*V' },
  { sort: 'Revenue:desc', filter: 'Region^~s;Revenue>50' },
];

async function kernelOrder(sort?: string, filter?: string): Promise<number[]> {
  const client = new TableStoreClient(
    { headers: HEADERS, cells: ROWS.map((row) => [...row]) },
    { forceLocal: true },
  );
  const { view } = parseTableViewState(sort, filter, HEADERS);
  await client.setView(view);
  const page = await client.rows(0, ROWS.length);
  client.dispose();
  return page.rowIds;
}

describe('kernel vs applyTableViewState parity', () => {
  for (const testCase of CASES) {
    it(`agrees on sort=${testCase.sort ?? '∅'} filter=${testCase.filter ?? '∅'}`, async () => {
      const { view } = parseTableViewState(testCase.sort, testCase.filter, HEADERS);
      const reference = applyTableViewState(HEADERS, ROWS, view);
      const kernel = await kernelOrder(testCase.sort, testCase.filter);
      expect(kernel).toEqual(reference.rowIds);
    });
  }
});
