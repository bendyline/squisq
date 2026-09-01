/**
 * Import spill-over: `xlsxToContainer` / `csvToContainer` keep small data
 * inline byte-identically to the doc-only importers, and spill oversized
 * regions to a `<docbasename>_files/data/<source>` sidecar referenced via
 * `{[dataTable src=…]}` plus a body link.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveDataReferences } from '@bendyline/squisq/doc';
import { csvToContainer, csvToMarkdownDoc } from '../csv/index';
import { xlsxToContainer, xlsxToMarkdownDoc } from '../xlsx/import';
import { markdownDocToXlsx } from '../xlsx/export';
import { defaultDataReaders } from '../data/readers';

function bigTableMarkdown(rows: number): string {
  const lines = [
    '## Transactions {[dataTable sheet=Data anchor=B2]}',
    '',
    '| Id | Amount |',
    '| -- | ------ |',
  ];
  for (let i = 0; i < rows; i++) lines.push(`| T${i} | ${i * 3} |`);
  lines.push('', '## Summary {[dataTable sheet=Data anchor=F2]}', '');
  lines.push('| Metric | Value |', '| ------ | ----- |', '| Total  | 42    |', '');
  return lines.join('\n');
}

async function bigWorkbook(rows = 120): Promise<ArrayBuffer> {
  return markdownDocToXlsx(parseMarkdown(bigTableMarkdown(rows)));
}

async function readDoc(container: Awaited<ReturnType<typeof xlsxToContainer>>): Promise<string> {
  const markdown = await container.readDocument();
  expect(markdown).not.toBeNull();
  return markdown!;
}

describe('xlsxToContainer', () => {
  it('spills an oversized region to a workbook sidecar and keeps small regions inline', async () => {
    const bytes = await bigWorkbook();
    const container = await xlsxToContainer(bytes, { sourceName: 'Q3 Report.xlsx' });

    expect(await container.getDocumentPath()).toBe('q3-report.md');
    const markdown = await readDoc(container);

    // The oversized region is a reference; the small one is still a table.
    const doc = markdownToDoc(parseMarkdown(markdown));
    const flat = [doc.blocks, doc.blocks.flatMap((b) => b.children ?? [])].flat();
    const spilled = flat.find((b) => b.templateOverrides?.src);
    expect(spilled?.templateOverrides?.src).toBe('q3-report_files/data/Q3 Report.xlsx');
    expect(spilled?.templateOverrides?.sheet).toBe('Data');
    expect(spilled?.templateOverrides?.anchor).toBe('B2');
    expect(markdown).toContain('<q3-report_files/data/Q3 Report.xlsx>');
    expect(markdown).toContain('| Metric | Value |');

    // A spilled region keeps its formulas in the sidecar — no companion table.
    expect(markdown).not.toContain('role=formulas');

    // The sidecar holds the original bytes.
    const sidecar = await container.readFile('q3-report_files/data/Q3 Report.xlsx');
    expect(sidecar?.byteLength).toBe(bytes.byteLength);
  });

  it('is byte-identical to the doc-only import below the thresholds', async () => {
    const bytes = await bigWorkbook(5);
    const container = await xlsxToContainer(bytes, { sourceName: 'small.xlsx' });

    const viaContainer = await readDoc(container);
    const viaDoc = stringifyMarkdown(await xlsxToMarkdownDoc(bytes));
    expect(viaContainer).toBe(viaDoc);

    const files = await container.listFiles();
    expect(files.map((f) => f.path)).toEqual(['small.md']);
  });

  it('honors sidecar mode: never keeps everything inline, always spills everything', async () => {
    const bytes = await bigWorkbook();

    const never = await xlsxToContainer(bytes, { sourceName: 'big.xlsx', sidecar: 'never' });
    expect((await never.listFiles()).map((f) => f.path)).toEqual(['big.md']);
    expect(await readDoc(never)).toMatch(/\| Id\s+\| Amount \|/);

    const always = await xlsxToContainer(bytes, { sourceName: 'big.xlsx', sidecar: 'always' });
    const markdown = await readDoc(always);
    expect(markdown).not.toContain('| Metric | Value |');
    expect(await always.exists('big_files/data/big.xlsx')).toBe(true);
  });

  it('resolves a spilled reference end-to-end through the data readers', async () => {
    const container = await xlsxToContainer(await bigWorkbook(), {
      sourceName: 'Q3 Report.xlsx',
    });
    const doc = markdownToDoc(parseMarkdown(await readDoc(container)));

    const { doc: resolved, diagnostics } = await resolveDataReferences(doc, container, {
      readers: defaultDataReaders(),
    });

    expect(diagnostics).toEqual([]);
    const flat = [resolved.blocks, resolved.blocks.flatMap((b) => b.children ?? [])].flat();
    const block = flat.find((b) => b.templateOverrides?.src);
    expect(block?.templateData?.headers).toEqual(['Id', 'Amount']);
    expect((block?.templateData?.rows as string[][]).length).toBe(50);
    expect(block?.templateData?.srcStats).toMatchObject({ totalRows: 120, truncated: true });
  });
});

describe('csvToContainer', () => {
  const smallCsv = 'Region,Revenue\nNorth,1200\nSouth,900\n';

  function bigCsv(rows = 150): string {
    const lines = ['Id,Amount'];
    for (let i = 0; i < rows; i++) lines.push(`T${i},${i}`);
    return `${lines.join('\n')}\n`;
  }

  it('keeps a small CSV inline, byte-identical to the doc-only import', async () => {
    const container = await csvToContainer(smallCsv, { sourceName: 'sales.csv' });

    expect(await container.getDocumentPath()).toBe('sales.md');
    expect(await readDoc(container)).toBe(stringifyMarkdown(await csvToMarkdownDoc(smallCsv)));
    expect((await container.listFiles()).map((f) => f.path)).toEqual(['sales.md']);
  });

  it('spills an oversized CSV to a verbatim sidecar reference', async () => {
    const source = bigCsv();
    const container = await csvToContainer(source, { sourceName: 'Q3 Transactions.csv' });

    const markdown = await readDoc(container);
    const doc = markdownToDoc(parseMarkdown(markdown));
    expect(doc.blocks[0].templateOverrides?.src).toBe(
      'q3-transactions_files/data/Q3 Transactions.csv',
    );
    expect(markdown).not.toContain('| Id | Amount |');

    const sidecar = await container.readFile('q3-transactions_files/data/Q3 Transactions.csv');
    expect(new TextDecoder().decode(sidecar!)).toBe(source);
  });

  it('sidecars unconditionally in always mode (CSV-open-as-document)', async () => {
    const container = await csvToContainer(smallCsv, {
      sourceName: 'sales.csv',
      sidecar: 'always',
    });

    const markdown = await readDoc(container);
    expect(markdown).toContain('sales\\_files/data/sales.csv');
    expect(await container.exists('sales_files/data/sales.csv')).toBe(true);

    const { doc: resolved } = await resolveDataReferences(
      markdownToDoc(parseMarkdown(markdown)),
      container,
      { readers: defaultDataReaders() },
    );
    expect(resolved.blocks[0].templateData?.headers).toEqual(['Region', 'Revenue']);
    expect(resolved.blocks[0].templateData?.rows).toEqual([
      ['North', '1200'],
      ['South', '900'],
    ]);
  });
});
