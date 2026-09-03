/**
 * Generates `data-sample.parquet`, the checked-in fixture for the parquet
 * data-reader tests. Kept beside the fixture so it is reproducible and the
 * binary reviewable: re-run with
 *
 *   node packages/formats/src/__tests__/fixtures/generate-parquet-fixture.mjs
 *
 * Deliberately tiny (6 rows, 4 mixed-type columns, one null) — the reader
 * tests assert headers, typed values stringified, totalRows from metadata,
 * and the bounded preview window.
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parquetWriteBuffer } from 'hyparquet-writer';

const buffer = parquetWriteBuffer({
  columnData: [
    { name: 'region', data: ['North', 'South', 'East', 'West', 'Central', 'Overseas'] },
    { name: 'revenue', data: [1200.5, 980, 1425.25, 660, 1010, 305.75], type: 'DOUBLE' },
    { name: 'units', data: [12, 9, 14, 6, 10, 3], type: 'INT32' },
    { name: 'active', data: [true, true, false, true, null, false], type: 'BOOLEAN' },
  ],
});

const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/formats/src/__tests__/fixtures/data-sample.parquet',
);
writeFileSync(out, Buffer.from(buffer));
console.log(`wrote ${out} (${buffer.byteLength} bytes)`);
