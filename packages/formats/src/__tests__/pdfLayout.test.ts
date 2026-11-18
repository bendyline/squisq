import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPdf, type PdfExportOptions } from '../pdf/export';

/** Each page's decoded content stream, in page order. */
async function pageContents(markdown: string, options: PdfExportOptions = {}): Promise<string[]> {
  const pdf = await PDFDocument.load(await markdownDocToPdf(parseMarkdown(markdown), options));
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    return streams
      .map((ref) => {
        const stream = page.doc.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw new Error('Expected a saved PDF stream');
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
      })
      .join('\n');
  });
}

/** The text a content stream draws, in drawing order. */
function drawnText(content: string): string {
  return [...content.matchAll(/<([0-9A-F]*)> Tj/g)]
    .map(([, hex]) =>
      (hex!.match(/../g) ?? []).map((byte) => String.fromCharCode(parseInt(byte, 16))).join(''),
    )
    .join('');
}

/** A real 1×1 PNG; the image map gives it its display size, as a diagram's would. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
/** 600 × 400 CSS px: 450 × 300 pt, a typical rendered diagram. */
const DIAGRAM: PdfExportOptions = {
  images: new Map([['flow.png', { data: PNG, contentType: 'image/png', width: 600, height: 400 }]]),
};

/** `count` one-line paragraphs, enough to push what follows down the page. */
function filler(count: number): string {
  return Array.from({ length: count }, (_unused, i) => `Filler line ${i + 1}.`).join('\n\n');
}

describe('PDF headings', () => {
  // A heading printed alone at the foot of a page, with what it introduces
  // on the next one ("Decision flow" above a diagram, in the 2.8.4 RC pass).
  it('never ends a page with a heading whose picture went to the next page', async () => {
    for (let lines = 14; lines <= 26; lines++) {
      const pages = await pageContents(
        `${filler(lines)}\n\n## Decision flow\n\n![Flow](flow.png)\n\nAfter the picture.`,
        DIAGRAM,
      );
      for (const page of pages) {
        expect(drawnText(page).trimEnd(), `${lines} filler lines`).not.toMatch(/Decision flow$/);
      }
      // The heading shares its page with the picture.
      const headingPage = pages.findIndex((page) => drawnText(page).includes('Decision flow'));
      expect(pages[headingPage], `${lines} filler lines`).toMatch(/\/Image-\d+ Do\b/);
    }
  });

  it('keeps a heading with the first lines of the text under it', async () => {
    for (let lines = 24; lines <= 30; lines++) {
      const pages = await pageContents(
        `${filler(lines)}\n\n## Next steps\n\nThe first line under the heading.\n\nAnother line.`,
      );
      for (const page of pages) {
        expect(drawnText(page).trimEnd(), `${lines} filler lines`).not.toMatch(/Next steps$/);
      }
    }
  });

  it('leaves a heading where it is when what follows fits', async () => {
    const [first, ...rest] = await pageContents(
      `${filler(3)}\n\n## Decision flow\n\n![Flow](flow.png)`,
      DIAGRAM,
    );
    expect(rest).toHaveLength(0);
    expect(drawnText(first!)).toContain('Decision flow');
  });
});

describe('PDF footnotes', () => {
  const DOC = [
    'Ferries carried 1.2 million riders.[^src]',
    '',
    '[^src]: Port Authority annual report.',
    '',
    '- Hire four deckhands',
    '- Publish the summer schedule',
  ].join('\n');

  // A definition printed where it was written, run on from the list after it
  // with nothing to set it apart.
  it('prints footnotes together at the end, under a short rule', async () => {
    const [page] = await pageContents(DOC);
    const text = drawnText(page!);
    expect(text.indexOf('Port Authority')).toBeGreaterThan(text.indexOf('summer schedule'));
    // The rule is a stroked line drawn after the last list item and before the note.
    const lastItem = page!.lastIndexOf('<', page!.indexOf(hex('schedule')));
    const note = page!.indexOf(hex('Port'));
    const rule = page!.slice(lastItem, note).match(/\bl\s+S\b/g) ?? [];
    expect(rule).toHaveLength(1);
  });

  it('prints no rule for a document without footnotes', async () => {
    const [page] = await pageContents('- Hire four deckhands\n- Publish the summer schedule\n');
    expect(page!.match(/\bl\s+S\b/g) ?? []).toHaveLength(0);
  });
});

function hex(text: string): string {
  return [...text].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
}
