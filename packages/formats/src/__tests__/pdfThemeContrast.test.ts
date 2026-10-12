import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import { THEMES, compileTheme, contrastRatio } from '@bendyline/squisq/schemas';
import { writeCustomThemesToFrontmatter } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPdf } from '../pdf/export';

/** Read the actual ink used by text objects in the saved PDF, not export options. */
function textColors(page: PDFPage): string[] {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const source = streams
    .map((ref) => {
      const stream = page.doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('Expected a saved PDF stream');
      return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    })
    .join('\n');
  return [...source.matchAll(/BT\s*([\s\S]*?)ET/g)].map(([, text]) => {
    const fill = text.match(/([\d.]+) ([\d.]+) ([\d.]+) rg/);
    if (!fill) throw new Error('PDF text object has no explicit RGB fill');
    return (
      '#' +
      fill
        .slice(1, 4)
        .map((value) =>
          Math.round(Number(value) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  });
}

const content = [
  '# Heading',
  'Body with **bold**, *italic*, `inline code`, and a [link](https://example.com).',
  '- List item',
  '> Quoted text',
  '```js\nconst answer = 42;\n```',
  '| Table heading | [Linked heading](https://example.com) |\n| --- | --- |\n| Table body | [Link](https://example.com) |',
].join('\n\n');

describe('PDF theme ink on white paper', () => {
  for (const themeId of Object.keys(THEMES)) {
    it(`${themeId}: readable body, headings, lists, code, quotes and tables on every page`, async () => {
      const doc = parseMarkdown(
        `---\nsquisq-theme: ${themeId}\n---\n\n${Array.from({ length: 8 }, () => content).join('\n\n')}`,
      );
      const pdf = await PDFDocument.load(await markdownDocToPdf(doc));
      expect(pdf.getPageCount()).toBeGreaterThan(1);
      for (const page of pdf.getPages()) {
        const colors = textColors(page);
        expect(colors.length).toBeGreaterThan(0);
        for (const color of colors) {
          expect(
            contrastRatio(color, '#ffffff'),
            `${themeId} ink ${color} on paper`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrastRatio(color, '#ededf2'),
            `${themeId} ink ${color} on table header`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it.each(['letter', 'a4'] as const)(
    'retains readable Warm Earth headings on %s paper',
    async (pageSize) => {
      const doc = parseMarkdown(`---\nsquisq-theme: warm-earth\n---\n\n${content}`);
      const pdf = await PDFDocument.load(await markdownDocToPdf(doc, { pageSize }));
      const colors = textColors(pdf.getPage(0));
      expect(colors).toContain('#9c4221');
      expect(colors).not.toContain('#faf5f0');
    },
  );

  it('preserves readable custom ink and respects an explicit theme override', async () => {
    const theme = compileTheme({
      id: 'custom-print',
      name: 'Print',
      seedColors: { primary: '#663322', text: '#123456', background: '#ffffff' },
    });
    const doc = parseMarkdown(
      `---\nsquisq-theme: custom-print\nsquisq-custom-themes: ${writeCustomThemesToFrontmatter([theme])}\n---\n\nBody.`,
    );
    const custom = await PDFDocument.load(await markdownDocToPdf(doc));
    expect(textColors(custom.getPage(0))).toContain('#123456');
    const standard = await PDFDocument.load(await markdownDocToPdf(doc, { themeId: 'standard' }));
    expect(textColors(standard.getPage(0))).not.toContain('#123456');
  });

  it('keeps pale custom theme ink readable without modifying the document', async () => {
    const theme = compileTheme({
      id: 'custom-pale',
      name: 'Pale',
      seedColors: { primary: '#ffffee', text: '#faf5f0', background: '#1c1410' },
    });
    const doc = parseMarkdown(
      `---\nsquisq-theme: custom-pale\nsquisq-custom-themes: ${writeCustomThemesToFrontmatter([theme])}\n---\n\n${content}`,
    );
    const original = JSON.stringify(doc);
    const pdf = await PDFDocument.load(await markdownDocToPdf(doc));
    for (const color of textColors(pdf.getPage(0))) {
      expect(contrastRatio(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
    expect(JSON.stringify(doc)).toBe(original);
  });

  it('keeps unthemed output readable', async () => {
    const pdf = await PDFDocument.load(await markdownDocToPdf(parseMarkdown(content)));
    for (const color of textColors(pdf.getPage(0))) {
      expect(contrastRatio(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
