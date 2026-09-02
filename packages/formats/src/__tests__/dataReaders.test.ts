/**
 * Sidecar data readers (`@bendyline/squisq-formats/data`) — the format
 * implementations behind core's `resolveDataReferences` seam.
 *
 * The XLSX cases go through a real workbook built by `markdownDocToXlsx`, so
 * anchor addressing is tested against the same bytes the exporter produces.
 * Parquet reads go through the checked-in `fixtures/data-sample.parquet`,
 * generated (reproducibly) by `scripts/generate-parquet-fixture.mjs` with
 * hyparquet-writer.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  csvDataReader,
  xlsxDataReader,
  parquetDataReader,
  defaultDataReaders,
} from '../data/readers';
import { markdownDocToXlsx } from '../xlsx/export';

const enc = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('csvDataReader', () => {
  it('reads a bounded window with header and totals', async () => {
    const lines = ['Region,Revenue'];
    for (let i = 0; i < 120; i++) lines.push(`R${i},${i * 10}`);
    const table = await csvDataReader.read(enc(lines.join('\n')), { maxRows: 50 });

    expect(table.headers).toEqual(['Region', 'Revenue']);
    expect(table.rows.length).toBe(50);
    expect(table.rows[0]).toEqual(['R0', '0']);
    expect(table.totalRows).toBe(120);
    expect(table.totalCols).toBe(2);
  });

  it('treats headerRow=false as all-data with lettered columns', async () => {
    const table = await csvDataReader.read(enc('a,b\nc,d\n'), { maxRows: 10, headerRow: false });

    expect(table.headers).toEqual(['A', 'B']);
    expect(table.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(table.totalRows).toBe(2);
  });

  it('sniffs tab delimiters for .tsv content', async () => {
    const table = await csvDataReader.read(enc('Name\tQty\nWidget\t3\n'), { maxRows: 10 });

    expect(table.headers).toEqual(['Name', 'Qty']);
    expect(table.rows).toEqual([['Widget', '3']]);
  });

  it('pads ragged rows to the widest width', async () => {
    const table = await csvDataReader.read(enc('A,B,C\n1\n2,3\n'), { maxRows: 10 });

    expect(table.rows).toEqual([
      ['1', '', ''],
      ['2', '3', ''],
    ]);
    expect(table.totalCols).toBe(3);
  });
});

describe('xlsxDataReader', () => {
  const fixtureMarkdown = [
    '# Sales',
    '',
    '## Q3 Revenue {[dataTable sheet=Sales anchor=B4]}',
    '',
    '| Region | Revenue |',
    '| ------ | ------- |',
    '| North  | 1200    |',
    '| South  | 900     |',
    '',
    '## Side table {[dataTable sheet=Sales anchor=F4]}',
    '',
    '| Item   | Qty |',
    '| ------ | --- |',
    '| Widget | 3   |',
    '',
  ].join('\n');

  async function fixture(): Promise<ArrayBuffer> {
    return markdownDocToXlsx(parseMarkdown(fixtureMarkdown));
  }

  it('addresses a region by sheet + exact anchor', async () => {
    const table = await xlsxDataReader.read(await fixture(), {
      sheet: 'Sales',
      anchor: 'B4',
      maxRows: 50,
    });

    expect(table.headers).toEqual(['Region', 'Revenue']);
    expect(table.rows).toEqual([
      ['North', '1200'],
      ['South', '900'],
    ]);
    expect(table.totalRows).toBe(2);
    expect(table.totalCols).toBe(2);
  });

  it('addresses the second region on the same sheet', async () => {
    const table = await xlsxDataReader.read(await fixture(), {
      sheet: 'Sales',
      anchor: 'F4',
      maxRows: 50,
    });

    expect(table.headers).toEqual(['Item', 'Qty']);
    expect(table.rows).toEqual([['Widget', '3']]);
  });

  it('falls back to the region containing a drifted anchor', async () => {
    const table = await xlsxDataReader.read(await fixture(), {
      sheet: 'Sales',
      anchor: 'C5',
      maxRows: 50,
    });

    expect(table.headers).toEqual(['Region', 'Revenue']);
  });

  it('falls back to the largest region when no anchor is given', async () => {
    const table = await xlsxDataReader.read(await fixture(), { sheet: 'Sales', maxRows: 50 });

    expect(table.headers).toEqual(['Region', 'Revenue']);
  });

  it('throws a worksheet-naming error for a missing sheet', async () => {
    await expect(
      xlsxDataReader.read(await fixture(), { sheet: 'Nope', maxRows: 50 }),
    ).rejects.toThrow(/worksheet/i);
  });

  it('demotes an inferred header when headerRow=false', async () => {
    const table = await xlsxDataReader.read(await fixture(), {
      sheet: 'Sales',
      anchor: 'B4',
      headerRow: false,
      maxRows: 50,
    });

    expect(table.headers).toEqual(['B', 'C']);
    expect(table.rows[0]).toEqual(['Region', 'Revenue']);
    expect(table.rows[1]).toEqual(['North', '1200']);
    expect(table.totalRows).toBe(3);
  });

  it('bounds the preview window', async () => {
    const table = await xlsxDataReader.read(await fixture(), {
      sheet: 'Sales',
      anchor: 'B4',
      maxRows: 1,
    });

    expect(table.rows).toEqual([['North', '1200']]);
    expect(table.totalRows).toBe(2);
  });
});

describe('view-state application (sort/filter before windowing)', () => {
  it('sorts the FULL body before the window — not just the preview', async () => {
    // 120 rows with descending values; ascending sort must surface the LAST
    // source rows first, which a window-then-sort would never show.
    const lines = ['Id,Amount'];
    for (let i = 0; i < 120; i++) lines.push(`T${i},${1000 - i}`);
    const table = await csvDataReader.read(enc(lines.join('\n')), {
      maxRows: 3,
      sort: 'Amount',
    });

    expect(table.rows.map((r) => r[1])).toEqual(['881', '882', '883']);
    expect(table.totalRows).toBe(120);
    expect(table.unfilteredTotalRows).toBeUndefined();
    expect(table.viewIssues).toBeUndefined();
  });

  it('filters before windowing and reports both counts', async () => {
    const lines = ['Region,Amount'];
    for (let i = 0; i < 50; i++) lines.push(`${i % 2 ? 'West' : 'East'},${i}`);
    const table = await csvDataReader.read(enc(lines.join('\n')), {
      maxRows: 10,
      filter: 'Region=West',
    });

    expect(table.rows.every((r) => r[0] === 'West')).toBe(true);
    expect(table.totalRows).toBe(25);
    expect(table.unfilteredTotalRows).toBe(50);
  });

  it('applies the extended text ops through the reader path', async () => {
    const csv = enc('Name,Amount\nNorth,1\nNorthwest,2\nSouth,3\nnorthern,4\n');

    const starts = await csvDataReader.read(csv, { maxRows: 10, filter: 'Name^~No' });
    expect(starts.rows.map((r) => r[0])).toEqual(['North', 'Northwest', 'northern']);

    const ends = await csvDataReader.read(csv, { maxRows: 10, filter: 'Name$~west' });
    expect(ends.rows.map((r) => r[0])).toEqual(['Northwest']);

    // `*` = case-sensitive: equals now distinguishes 'North' from 'north…'.
    const cs = await csvDataReader.read(csv, { maxRows: 10, filter: 'Name^~*No' });
    expect(cs.rows.map((r) => r[0])).toEqual(['North', 'Northwest']);

    const notContains = await csvDataReader.read(csv, { maxRows: 10, filter: 'Name!~north' });
    expect(notContains.rows.map((r) => r[0])).toEqual(['South']);
  });

  it('combines multi-term sort with an AND filter', async () => {
    const csv = enc(
      'Region,Rep,Amount\nWest,Ann,5\nWest,Bo,9\nEast,Cy,9\nWest,Ann,1\nEast,Dee,2\n',
    );
    const table = await csvDataReader.read(csv, {
      maxRows: 10,
      sort: 'Amount:desc,Rep',
      filter: 'Region=West;Amount>1',
    });
    expect(table.rows).toEqual([
      ['West', 'Bo', '9'],
      ['West', 'Ann', '5'],
    ]);
    expect(table.totalRows).toBe(2);
    expect(table.unfilteredTotalRows).toBe(5);
  });

  it('surfaces view issues instead of throwing', async () => {
    const table = await csvDataReader.read(enc('A,B\n1,2\n'), {
      maxRows: 10,
      sort: 'Nope:desc',
    });

    expect(table.viewIssues?.map((i) => i.code)).toEqual(['data-view-unknown-column']);
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('applies view state to XLSX regions', async () => {
    const markdown = [
      '## Data {[dataTable sheet=Data anchor=A1]}',
      '',
      '| Region | Revenue |',
      '| ------ | ------- |',
      '| West   | 100     |',
      '| East   | 900     |',
      '| West   | 500     |',
      '',
    ].join('\n');
    const bytes = await markdownDocToXlsx(parseMarkdown(markdown));

    const table = await xlsxDataReader.read(bytes, {
      sheet: 'Data',
      anchor: 'A1',
      maxRows: 10,
      sort: 'Revenue:desc',
      filter: 'Region=West',
    });

    expect(table.rows).toEqual([
      ['West', '500'],
      ['West', '100'],
    ]);
    expect(table.unfilteredTotalRows).toBe(3);
  });

  it('applies view state to parquet (full read when view active)', async () => {
    const path = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'fixtures',
      'data-sample.parquet',
    );
    const buf = readFileSync(path);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

    const table = await parquetDataReader.read(bytes, { maxRows: 2, sort: 'revenue:desc' });

    expect(table.rows.map((r) => r[0])).toEqual(['East', 'North']);
    expect(table.totalRows).toBe(6);
  });
});

describe('parquetDataReader', () => {
  function fixtureBytes(): ArrayBuffer {
    const path = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'fixtures',
      'data-sample.parquet',
    );
    const buf = readFileSync(path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  it('reads headers, typed values, and totals from a real file', async () => {
    const table = await parquetDataReader.read(fixtureBytes(), { maxRows: 50 });

    expect(table.headers).toEqual(['region', 'revenue', 'units', 'active']);
    expect(table.totalRows).toBe(6);
    expect(table.totalCols).toBe(4);
    expect(table.rows[0]).toEqual(['North', '1200.5', '12', 'true']);
    // A null cell stringifies to the empty string, like every other reader.
    expect(table.rows[4]).toEqual(['Central', '1010', '10', '']);
  });

  it('bounds the preview window while totalRows reports the full count', async () => {
    const table = await parquetDataReader.read(fixtureBytes(), { maxRows: 2 });

    expect(table.rows).toHaveLength(2);
    expect(table.totalRows).toBe(6);
  });

  it('rejects non-parquet bytes with a parse error', async () => {
    await expect(
      parquetDataReader.read(enc('not parquet at all'), { maxRows: 10 }),
    ).rejects.toThrow();
  });
});

describe('defaultDataReaders', () => {
  it('covers every planned extension exactly once', () => {
    const extensions = defaultDataReaders().flatMap((r) => r.extensions);
    expect([...extensions].sort()).toEqual(['csv', 'parquet', 'tsv', 'xlsx']);
  });
});
