/**
 * Generated data & calc samples — the third sample kind beside inline
 * markdown and fetched content zips. Each factory BUILDS its sidecar
 * container in the browser at load time (deterministic pseudo-data, and
 * the XLSX sample assembles a real workbook through the formats exporter +
 * in-place patcher), so no binary fixtures live in the repo and the demo
 * always exercises the same code paths a real import would.
 */

import { MemoryContentContainer, type ContentContainer } from '@bendyline/squisq/storage';

export interface GeneratedSample {
  label: string;
  build: () => Promise<{ markdown: string; container: ContentContainer }>;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Tiny deterministic LCG so the demo data is stable across loads. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const REGIONS = ['West', 'East', 'North', 'South', 'Central'];
const PRODUCTS = ['Widget', 'Gadget', 'Sprocket', 'Flange', 'Gizmo', 'Doohickey'];
const CHANNELS = ['Direct', 'Retail', 'Online', 'Partner'];
const MONTHS = ['Jul', 'Aug', 'Sep'];

function csvBytes(rows: string[][]): ArrayBuffer {
  const text = rows.map((row) => row.join(',')).join('\n') + '\n';
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** ~90 readable rows: enough to sort/filter meaningfully, small enough to read. */
async function buildCsvSales(): Promise<{ markdown: string; container: ContentContainer }> {
  const random = makeRandom(42);
  const rows: string[][] = [['Region', 'Product', 'Month', 'Units', 'Revenue']];
  for (const month of MONTHS) {
    for (const region of REGIONS) {
      for (const product of PRODUCTS) {
        const units = 5 + Math.floor(random() * 120);
        const price = 8 + Math.floor(random() * 90);
        rows.push([region, product, month, String(units), String(units * price)]);
      }
    }
  }

  const container = new MemoryContentContainer();
  const src = 'report_files/data/q3-transactions.csv';
  await container.writeFile(src, csvBytes(rows), 'text/csv');

  const markdown = [
    '# Regional sales report',
    '',
    'The table below is a **data sidecar** — the CSV lives beside the document',
    `(\`${src}\`), and the markdown carries only a reference. Things to try:`,
    '',
    '- Click a column header to **sort**; type in the header row to **filter**.',
    '  Both persist onto the heading annotation and shape previews and exports.',
    '- **Double-click a cell** to edit it, then **Save** — the CSV rewrites in',
    '  place with a backup under `.versions/data/`.',
    '- Switch to the Source view to see the `{[dataTable …]}` annotation the',
    '  grid reads and writes.',
    '',
    `## Q3 transactions {[dataTable src=${src} sort=Revenue:desc]}`,
    '',
    `[q3-transactions.csv](${src})`,
    '',
    `## Revenue by region {[barChart src=${src} labelColumn=Region valueColumns=Revenue previewRows=100]}`,
    '',
    'The chart is fed by the **same sidecar** — and because the sort/filter',
    'params ride the document, a curated view flows into exports too.',
    '',
  ].join('\n');
  await container.writeDocument(markdown);
  return { markdown, container };
}

/** 8,000 rows: the virtualization + Web-Worker sort/filter showcase. */
async function buildCsvLarge(): Promise<{ markdown: string; container: ContentContainer }> {
  const random = makeRandom(1337);
  const rows: string[][] = [['Order', 'Region', 'Product', 'Channel', 'Units', 'Revenue']];
  for (let i = 1; i <= 8_000; i++) {
    const units = 1 + Math.floor(random() * 500);
    const price = 4 + Math.floor(random() * 240);
    rows.push([
      `SO-${String(100_000 + i)}`,
      REGIONS[Math.floor(random() * REGIONS.length)]!,
      PRODUCTS[Math.floor(random() * PRODUCTS.length)]!,
      CHANNELS[Math.floor(random() * CHANNELS.length)]!,
      String(units),
      String(units * price),
    ]);
  }

  const container = new MemoryContentContainer();
  const src = 'orders_files/data/orders-8k.csv';
  await container.writeFile(src, csvBytes(rows), 'text/csv');

  const markdown = [
    '# Order book (8,000 rows)',
    '',
    'A table this size could never live inline — markdown reparses on every',
    'keystroke, and the corpus benchmarks put the comfort line near 2,000',
    'cells. As a sidecar it is effortless: the grid **virtualizes rows** and',
    'sorts/filters in a **Web Worker**, so try sorting Revenue or filtering',
    'Region and watch it stay instant.',
    '',
    `## Orders {[dataTable src=${src}]}`,
    '',
    `[orders-8k.csv](${src})`,
    '',
  ].join('\n');
  await container.writeDocument(markdown);
  return { markdown, container };
}

/** A real XLSX with live formulas — the calc-engine demo. */
async function buildXlsxFormulas(): Promise<{ markdown: string; container: ContentContainer }> {
  const [{ markdownDocToXlsx, patchXlsxCellValues }, { parseMarkdown }] = await Promise.all([
    import('@bendyline/squisq-formats/xlsx'),
    import('@bendyline/squisq/markdown'),
  ]);

  // Values first (anchored → numerics export as real numbers)…
  const seed = [
    '## Products {[dataTable sheet=Products anchor=A1]}',
    '',
    '| Product | Price | Units |',
    '| --- | --- | --- |',
    '| Widget | 24 | 130 |',
    '| Gadget | 55 | 48 |',
    '| Sprocket | 12 | 310 |',
    '| Flange | 89 | 17 |',
    '| Gizmo | 33 | 96 |',
  ].join('\n');
  const values = await markdownDocToXlsx(parseMarkdown(seed));

  // …then a Revenue formula column + a SUM total, patched in place with
  // cached values so any viewer shows results before recalculating.
  const revenues = [24 * 130, 55 * 48, 12 * 310, 89 * 17, 33 * 96];
  const total = revenues.reduce((a, b) => a + b, 0);
  const bytes = await patchXlsxCellValues(values, [
    { sheet: 'Products', ref: 'D1', value: 'Revenue' },
    ...revenues.map((revenue, i) => ({
      sheet: 'Products',
      ref: `D${i + 2}`,
      formula: `B${i + 2}*C${i + 2}`,
      cachedValue: revenue,
    })),
    { sheet: 'Products', ref: 'A7', value: 'Total' },
    { sheet: 'Products', ref: 'D7', formula: 'SUM(D2:D6)', cachedValue: total },
  ]);

  const container = new MemoryContentContainer();
  const src = 'economics_files/data/products.xlsx';
  await container.writeFile(src, bytes, XLSX_MIME);

  const markdown = [
    '# Product economics (live formulas)',
    '',
    'This sidecar is a real **XLSX workbook with formulas**. The grid boots',
    'the in-house calculation engine, so:',
    '',
    '- *Italic* cells hold formulas — hover to see the source, double-click',
    '  to edit it (try changing a Revenue cell to `=B2*C2*1.1`).',
    '- Edit a **Price or Units** value and watch Revenue and Total recalc',
    '  live.',
    '- **Save** patches only the touched cells in place — charts, styles and',
    '  everything else in the workbook survive byte-for-byte.',
    '',
    `## Products {[dataTable src=${src} sheet=Products anchor=A1]}`,
    '',
    `[products.xlsx](${src})`,
    '',
  ].join('\n');
  await container.writeDocument(markdown);
  return { markdown, container };
}

export const GENERATED_SAMPLES: Record<string, GeneratedSample> = {
  'data-csv-sales': {
    label: 'Sales CSV sidecar (sort · filter · edit)',
    build: buildCsvSales,
  },
  'data-csv-large': {
    label: '8,000-row CSV (virtualized grid)',
    build: buildCsvLarge,
  },
  'data-xlsx-formulas': {
    label: 'XLSX formulas (live calc engine)',
    build: buildXlsxFormulas,
  },
};
