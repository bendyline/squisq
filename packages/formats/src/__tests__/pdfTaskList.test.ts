import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPdf } from '../pdf/export';

/** The first page's decoded content stream. */
async function pageContent(markdown: string): Promise<string> {
  const pdf = await PDFDocument.load(await markdownDocToPdf(parseMarkdown(markdown)));
  const page = pdf.getPage(0);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((ref) => {
      const stream = page.doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('Expected a saved PDF stream');
      return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    })
    .join('\n');
}

const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;
/** pdf-lib draws a rectangle as a closed stroked path: `m … l … h S`. */
const CLOSED_STROKE = /\bh\s+S\b/g;
/** …and a line as an open one: `m … l S`. */
const OPEN_STROKE = /\bl\s+S\b/g;

describe('PDF task lists', () => {
  // A task list printed as "• Book the venue": the standard fonts have no
  // ballot box, so the box is drawn as lines instead.
  it('draws a box for each task, ticked when done, instead of a bullet', async () => {
    const tasks = await pageContent('- [ ] Book the venue\n- [x] Pay the deposit\n');
    const plain = await pageContent('- Book the venue\n- Pay the deposit\n');
    // One box per task; the done task's tick is two strokes.
    expect(count(tasks, CLOSED_STROKE)).toBe(2);
    expect(count(tasks, OPEN_STROKE)).toBe(2);
    // An ordinary list draws no boxes.
    expect(count(plain, CLOSED_STROKE)).toBe(0);
  });
});
