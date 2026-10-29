/**
 * Export behavior for `{[dataTable src=…]}` sidecar references:
 *
 * - XLSX export materializes the FULL source table at the recorded
 *   sheet/anchor (via `materializeDataReferences`) instead of silently
 *   dropping the tables-only block, warning that sidecar formulas were
 *   not carried.
 * - HTML bundle exports carry the linked sidecar file at its authored
 *   path so the body link resolves after unzip.
 * - Formats that cannot carry the file show its first rows: Word, PDF and
 *   EPUB in their Markdown, HTML and PPTX in the player's preview.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { materializeDataReferences } from '../data/materialize';
import { convert } from '../registry/convert';
import { markdownDocToXlsx } from '../xlsx/export';
import { xlsxToContainer, xlsxToTables } from '../xlsx/import';
import { markdownDocsToPlainHtmlBundle } from '../html/plainHtmlBundle';

function bigTableMarkdown(rows: number): string {
  const lines = [
    '## Transactions {[dataTable sheet=Data anchor=B2]}',
    '',
    '| Id | Amount |',
    '| -- | ------ |',
  ];
  for (let i = 0; i < rows; i++) lines.push(`| T${i} | ${i * 3} |`);
  lines.push('');
  return lines.join('\n');
}

describe('materializeDataReferences → XLSX export', () => {
  it('re-embeds a spilled region as full values at its recorded anchor', async () => {
    const original = await markdownDocToXlsx(parseMarkdown(bigTableMarkdown(120)));
    const container = await xlsxToContainer(original, { sourceName: 'big.xlsx' });
    const markdown = await container.readDocument();
    expect(markdown).toContain('{[dataTable src=');

    const warnings: string[] = [];
    const materialized = await materializeDataReferences(
      parseMarkdown(markdown!),
      container,
      (message) => warnings.push(message),
    );

    const rebuilt = await markdownDocToXlsx(materialized);
    const tables = await xlsxToTables(rebuilt);
    const data = tables.find((t) => t.sheet === 'Data' && t.anchor === 'B2');
    expect(data).toBeDefined();
    expect(data!.rows).toHaveLength(120);
    expect(data!.columns.map((c) => c.name)).toEqual(['Id', 'Amount']);
    expect(warnings.some((w) => /formulas/i.test(w))).toBe(true);
  });

  it('degrades to a warning without a container', async () => {
    const markdownDoc = parseMarkdown(
      '## T {[dataTable src=big_files/data/big.xlsx sheet=Data anchor=B2]}\n\n[big.xlsx](big_files/data/big.xlsx)\n',
    );
    const warnings: string[] = [];

    const result = await materializeDataReferences(markdownDoc, null, (m) => warnings.push(m));

    expect(result).toBe(markdownDoc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no source container');
  });
});

describe('plain HTML bundle sidecar carry', () => {
  it('writes a linked data sidecar at its authored path', async () => {
    // Built via the environment's own Uint8Array (not Node's TextEncoder):
    // jszip type-sniffs with instanceof, which fails across jsdom/Node realms.
    const csvBytes = Uint8Array.from('Region,Revenue\nNorth,1200\n', (c) => c.charCodeAt(0))
      .buffer as ArrayBuffer;
    const docs: Record<string, string> = {
      'report.md': [
        '# Report',
        '',
        '## Q3 {[dataTable src=report_files/data/q3.csv]}',
        '',
        '[q3.csv](report_files/data/q3.csv)',
        '',
      ].join('\n'),
    };
    const binaries: Record<string, ArrayBuffer> = { 'report_files/data/q3.csv': csvBytes };

    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'report.md',
      readDocument: async (p: string) => docs[p] ?? null,
      readBinary: async (p: string) => binaries[p] ?? null,
    });
    // jsdom's Blob has no arrayBuffer(); read via FileReader like the
    // sibling bundle tests do.
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const zip = await JSZip.loadAsync(bytes);

    const entry = zip.file('report_files/data/q3.csv');
    expect(entry).not.toBeNull();
    expect(await entry!.async('string')).toContain('North,1200');
    expect(zip.file('report.html')).not.toBeNull();
  });
});

describe('data references in converted documents', () => {
  async function source() {
    const rows = ['Item,Qty', ...Array.from({ length: 150 }, (_, i) => `Row ${i + 1},${i}`)];
    const container = new MemoryContentContainer();
    await container.writeFile(
      'report_files/data/q3.csv',
      Uint8Array.from(`${rows.join('\n')}\n`, (c) => c.charCodeAt(0)),
    );
    return {
      kind: 'markdown' as const,
      markdown: [
        '# Report',
        '',
        '## Q3 {[dataTable src=report_files/data/q3.csv]}',
        '',
        '[q3.csv](report_files/data/q3.csv)',
        '',
      ].join('\n'),
      container,
      baseName: 'report',
    };
  }

  async function partsOf(bytes: Uint8Array, pattern: RegExp): Promise<string> {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) => pattern.test(name));
    return (await Promise.all(names.map((name) => zip.file(name)!.async('string')))).join('\n');
  }

  it('Word, PDF and EPUB show the first rows and how many there are', async () => {
    const docx = await convert(await source(), 'docx');
    const xml = await partsOf(docx.bytes, /^word\/document\.xml$/);
    expect(xml).toContain('Row 100');
    expect(xml).not.toContain('Row 101');
    expect(xml).toContain('Showing 100 of 150 rows.');

    const epub = await convert(await source(), 'epub');
    const xhtml = await partsOf(epub.bytes, /\.xhtml$/);
    expect(xhtml).toContain('Row 100');
    expect(xhtml).not.toContain('Row 101');
    expect(epub.warnings.join('\n')).toContain('shows its first rows');

    const pdf = await convert(await source(), 'pdf');
    expect(pdf.warnings.join('\n')).not.toContain('could not be embedded');
  });

  it("single-file HTML fills the player's preview", async () => {
    const html = await convert(await source(), 'html', {
      resolvePlayerScript: async () => '/* stub */',
    });
    const text = new TextDecoder().decode(html.bytes);
    expect(text).toContain('Row 50');
    expect(text).not.toContain('Row 51');
    expect(html.warnings.join('\n')).toContain('shows its first rows');
  });

  it('warns when the data file is missing', async () => {
    const missing = { ...(await source()), container: new MemoryContentContainer() };
    const docx = await convert(missing, 'docx');
    expect(docx.warnings.join('\n')).toContain('file not found in container');
  });
});
