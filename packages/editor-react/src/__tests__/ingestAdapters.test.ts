/**
 * ingestSidecarBytes — sidecar bytes → the grid's neutral IngestTable, with
 * the CSV source conventions the save path must reproduce, XLSX
 * sheet/anchor region selection (which the summary card used to ignore),
 * and the read-only reasons for the not-yet-editable formats.
 */

import { describe, expect, it } from 'vitest';
import { markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { ingestSidecarBytes } from '../dataCard/ingestAdapters';

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('ingestSidecarBytes — csv/tsv', () => {
  it('parses a plain CSV with header into headers + nullable cells', async () => {
    const result = await ingestSidecarBytes(encode('Item,Qty\nwidget,2\n,\n'), 'csv', {});
    expect(result.ingest.headers).toEqual(['Item', 'Qty']);
    expect(result.ingest.cells).toEqual([
      ['widget', '2'],
      [null, null],
    ]);
    expect(result.readOnlyReason).toBeUndefined();
    expect(result.csv).toMatchObject({
      delimiter: ',',
      newline: '\n',
      trailingNewline: true,
      bom: false,
      hasHeader: true,
    });
    // The save baseline keeps the header row and raw strings.
    expect(result.csv!.rows[0]).toEqual(['Item', 'Qty']);
  });

  it('honors headerRow=false with generated column names', async () => {
    const result = await ingestSidecarBytes(encode('1,2\n3,4\n'), 'csv', { headerRow: false });
    expect(result.ingest.headers).toEqual(['Column 1', 'Column 2']);
    expect(result.ingest.cells).toHaveLength(2);
    expect(result.csv!.hasHeader).toBe(false);
  });

  it('sniffs BOM + CRLF and strips the BOM from parsed content', async () => {
    const result = await ingestSidecarBytes(encode('\uFEFFA,B\r\nx,1\r\n'), 'csv', {});
    expect(result.csv).toMatchObject({ bom: true, newline: '\r\n' });
    expect(result.ingest.headers).toEqual(['A', 'B']);
  });

  it('detects tab delimiters in a .csv and always in .tsv', async () => {
    const sniffed = await ingestSidecarBytes(encode('A\tB\nx\t1\n'), 'csv', {});
    expect(sniffed.csv!.delimiter).toBe('\t');
    const tsv = await ingestSidecarBytes(encode('A\tB\nx\t1\n'), 'tsv', {});
    expect(tsv.csv!.delimiter).toBe('\t');
  });

  it('pads ragged rows and names blank headers', async () => {
    const result = await ingestSidecarBytes(encode('A,,C\nx\ny,2,3\n'), 'csv', {});
    expect(result.ingest.headers).toEqual(['A', 'Column 2', 'C']);
    expect(result.ingest.cells[0]).toEqual(['x', null, null]);
  });
});

describe('ingestSidecarBytes — xlsx', () => {
  async function workbookBytes(): Promise<ArrayBuffer> {
    const markdown = [
      '## Sales',
      '',
      '| Region | Revenue |',
      '| --- | --- |',
      '| West | 100 |',
      '| East | 250 |',
      '',
      '## Costs',
      '',
      '| Line | Amount |',
      '| --- | --- |',
      '| Ops | 40 |',
    ].join('\n');
    return markdownDocToXlsx(parseMarkdown(markdown));
  }

  it('selects the named sheet region and carries the save address map', async () => {
    const bytes = await workbookBytes();
    const result = await ingestSidecarBytes(bytes, 'xlsx', { sheet: 'Costs' });
    expect(result.ingest.headers).toEqual(['Line', 'Amount']);
    expect(result.ingest.cells).toHaveLength(1);
    expect(result.csv).toBeUndefined();
    // Editable via in-place patching: address meta instead of a read-only chip.
    expect(result.readOnlyReason).toBeUndefined();
    expect(result.xlsx).toMatchObject({ sheet: 'Costs', hasHeader: true });
  });

  it('falls back to the largest region when no sheet/anchor is given', async () => {
    const bytes = await workbookBytes();
    const result = await ingestSidecarBytes(bytes, 'xlsx', {});
    expect(result.ingest.headers).toEqual(['Region', 'Revenue']);
    expect(result.ingest.cells).toHaveLength(2);
    expect(result.xlsx?.sheet).toBe('Sales');
  });
});

describe('ingestSidecarBytes — unsupported', () => {
  it('throws on an unknown extension', async () => {
    await expect(ingestSidecarBytes(encode('x'), 'exe', {})).rejects.toThrow(/unsupported/);
  });
});
