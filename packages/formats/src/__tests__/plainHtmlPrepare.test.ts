/**
 * A document prepared for a script-free page: data references become tables,
 * diagrams and charts become pictures, and file trees stay text.
 *
 * Drawing needs a browser, so these tests use a stand-in renderer; what they
 * check is where each picture lands and how the page shows it.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { DiagramPicture, ExportDiagram } from '../diagrams/index';
import { materializeDataReferences } from '../data/materialize';
import { markdownDocToPlainHtmlParts } from '../html/plainHtml';
import { plainHtmlIcons } from '../html/plainHtmlIcons';
import {
  needsPlainHtmlPreparation,
  prepareMarkdownDocForPlainHtml,
} from '../html/plainHtmlPrepare';

/** A valid 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);

function bytes(text: string): Uint8Array {
  // The environment's own Uint8Array, as the container stores it.
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function csv(rows: number): string {
  const lines = ['Region,Revenue'];
  for (let i = 1; i <= rows; i++) lines.push(`R${i},${i * 10}`);
  return `${lines.join('\n')}\n`;
}

async function containerWith(files: Record<string, string>): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  for (const [path, text] of Object.entries(files)) await container.writeFile(path, bytes(text));
  return container;
}

const SOURCE = [
  '# Report',
  '',
  '```mermaid',
  'flowchart LR',
  '  a --> b',
  '```',
  '',
  '```tree',
  'src/',
  '└── index.ts',
  '```',
  '',
  '## Sales {[barChart src=report_files/data/sales.csv]}',
  '',
  '[sales.csv](report_files/data/sales.csv)',
  '',
  '## Ledger {[dataTable src=report_files/data/ledger.csv]}',
  '',
  '[ledger.csv](report_files/data/ledger.csv)',
  '',
].join('\n');

describe('materializeDataReferences with a row bound', () => {
  it('embeds a preview window and says how much was left out', async () => {
    const container = await containerWith({ 'data/big.csv': csv(250) });
    const doc = parseMarkdown(
      '## Big {[dataTable src=data/big.csv]}\n\n## Small {[dataTable src=data/big.csv previewRows=3]}\n',
    );
    const result = await materializeDataReferences(doc, container, undefined, { maxRows: 100 });
    const html = markdownDocToPlainHtmlParts(result).bodyHtml;
    expect(html.match(/<tr>/g)).toHaveLength(2 + 100 + 3); // two header rows
    expect(html).toContain('<em>Showing 100 of 250 rows.</em>');
    expect(html).toContain('<em>Showing 3 of 250 rows.</em>');
  });

  it('keeps a table already in place, so a second pass adds nothing', async () => {
    const container = await containerWith({ 'data/big.csv': csv(5) });
    const doc = parseMarkdown('## Big {[dataTable src=data/big.csv]}\n');
    const once = await materializeDataReferences(doc, container, undefined, { maxRows: 100 });
    const twice = await materializeDataReferences(once, container, undefined, { maxRows: 100 });
    expect(twice).toBe(once);
  });

  it('reads each file once per cache', async () => {
    const container = await containerWith({ 'data/big.csv': csv(5) });
    let reads = 0;
    const counting = Object.assign(Object.create(container), {
      readFile: (path: string) => {
        reads++;
        return container.readFile(path);
      },
    }) as MemoryContentContainer;
    const tableCache = new Map();
    const doc = parseMarkdown('## Big {[dataTable src=data/big.csv]}\n');
    await materializeDataReferences(doc, counting, undefined, { maxRows: 100, tableCache });
    await materializeDataReferences(doc, counting, undefined, { maxRows: 100, tableCache });
    expect(reads).toBe(1);
  });

  it('embeds every row, with no note, when unbounded', async () => {
    const container = await containerWith({ 'data/big.csv': csv(250) });
    const doc = parseMarkdown('## Big {[dataTable src=data/big.csv]}\n');
    const html = markdownDocToPlainHtmlParts(
      await materializeDataReferences(doc, container),
    ).bodyHtml;
    expect(html.match(/<tr>/g)).toHaveLength(251);
    expect(html).not.toContain('Showing');
  });
});

describe('prepareMarkdownDocForPlainHtml', () => {
  it('fills data tables, then pictures diagrams and charts — trees stay text', async () => {
    const container = await containerWith({
      'report_files/data/sales.csv': csv(4),
      'report_files/data/ledger.csv': csv(3),
    });
    const drawn: ExportDiagram[] = [];
    const prepared = await prepareMarkdownDocForPlainHtml(parseMarkdown(SOURCE), {
      container,
      renderDiagram: async (diagram): Promise<DiagramPicture> => {
        drawn.push(diagram);
        return { data: PNG, width: 512.4, height: 300 };
      },
    });

    // The chart was drawn from the table its sidecar supplied.
    expect(drawn.map((diagram) => diagram.kind)).toEqual(['mermaid', 'chart']);
    expect(drawn[1].markdown).toMatch(/\| R4 +\| 40 +\|/);
    expect(drawn[1].markdown).toContain('## Sales {[barChart]}');
    expect([...prepared.images.keys()]).toEqual(['squisq-picture-1.png', 'squisq-picture-2.png']);
    expect(prepared.images.get('squisq-picture-1.png')).toMatch(/^data:image\/png;base64,iVBOR/);

    const html = markdownDocToPlainHtmlParts(prepared.markdownDoc, {
      images: prepared.images,
    }).bodyHtml;
    // Width only, so a narrow column scales the picture without distorting it.
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toMatch(/alt="Diagram" width="512" \/>/);
    expect(html).toContain('alt="Sales: bar chart of Revenue by Region" width="512" />');
    expect(html).not.toContain('language-mermaid');
    expect(html).toContain('<code class="language-tree">');
    // The chart's table became its picture; the data table is a table.
    expect(html).toContain('<h2>Sales</h2>');
    expect(html).toContain('<h2>Ledger</h2>\n<table>');
    expect(html).toContain('<td>R3</td><td>30</td>');
    expect(html).toContain('<a href="report_files/data/ledger.csv">ledger.csv</a>');
  });

  it('keeps every diagram as source without a renderer', async () => {
    const doc = parseMarkdown(SOURCE);
    const prepared = await prepareMarkdownDocForPlainHtml(doc);
    expect(prepared.markdownDoc).toBe(doc);
    expect(prepared.images.size).toBe(0);
  });

  it('keeps a diagram the renderer cannot draw, with a warning', async () => {
    const warnings: string[] = [];
    const prepared = await prepareMarkdownDocForPlainHtml(parseMarkdown(SOURCE), {
      renderDiagram: async () => {
        throw new Error('no canvas');
      },
      onWarning: (message) => warnings.push(message),
    });
    const html = markdownDocToPlainHtmlParts(prepared.markdownDoc).bodyHtml;
    expect(html).toContain('language-mermaid');
    expect(warnings).toEqual(['A diagram could not be drawn and was kept as text: no canvas']);
  });

  it('outlines inline icons from the bundled Font Awesome faces', async () => {
    const prepared = await prepareMarkdownDocForPlainHtml(
      parseMarkdown('Rated {[fa-solid:star]} by {[fa-brands:github]}.'),
      { outlineIcons: plainHtmlIcons },
    );
    const star = prepared.icons.get('solid:star');
    // The box Font Awesome's own star.svg uses (viewBox="0 0 576 512"), and
    // its outline, which starts "M309.5-18.9" there and on the font's
    // integer grid here.
    expect(star).toMatchObject({ width: 576, height: 512 });
    expect(star!.path).toMatch(/^M310 -19C/);
    expect(prepared.icons.get('brands:github')?.height).toBe(512);
    const html = markdownDocToPlainHtmlParts(prepared.markdownDoc, { icons: prepared.icons });
    expect(html.bodyHtml).toContain('<svg class="squisq-icon"');
    expect(html.featureHeadHtml).not.toContain('font-awesome');
  });

  it('keeps Font Awesome markup for icons without an outliner', async () => {
    const prepared = await prepareMarkdownDocForPlainHtml(parseMarkdown('Rated {[fa-solid:star]}.'));
    expect(prepared.icons.size).toBe(0);
    const html = markdownDocToPlainHtmlParts(prepared.markdownDoc, { icons: prepared.icons });
    expect(html.bodyHtml).toContain('<i class="fa-solid fa-star"');
    expect(html.bodyHtml).not.toContain('<svg class="squisq-icon"');
  });
});

describe('needsPlainHtmlPreparation', () => {
  const picture = async (): Promise<DiagramPicture> => ({ data: PNG, width: 10, height: 10 });

  it('is true only for what the options can prepare', () => {
    const plain = parseMarkdown('# Notes\n\nJust prose.\n\n```tree\nsrc/\n└── a.ts\n```\n');
    expect(needsPlainHtmlPreparation(plain, { renderDiagram: picture })).toBe(false);

    const mermaid = parseMarkdown('```mermaid\ngraph TD\n  a --> b\n```\n');
    expect(needsPlainHtmlPreparation(mermaid)).toBe(false);
    expect(needsPlainHtmlPreparation(mermaid, { renderDiagram: picture })).toBe(true);

    const data = parseMarkdown('## Q3 {[dataTable src=r_files/data/q3.csv]}\n');
    expect(needsPlainHtmlPreparation(data)).toBe(false);
    expect(needsPlainHtmlPreparation(data, { container: new MemoryContentContainer() })).toBe(true);

    const icon = parseMarkdown('A {[fa-solid:star]}.');
    expect(needsPlainHtmlPreparation(icon)).toBe(false);
    expect(needsPlainHtmlPreparation(icon, { outlineIcons: plainHtmlIcons })).toBe(true);
  });
});
