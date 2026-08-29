/**
 * Vertical alignment (superscript / subscript) across every format that can
 * carry it. Markdown's source form is inline HTML; core folds `<sup>…</sup>`
 * into a real inline node, and each converter below maps that node to its own
 * native representation rather than flattening it to a bare character.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToDocx, docxToMarkdownDoc } from '../docx/index';
import { markdownDocToPptx } from '../pptx/index';
import { htmlToMarkdownDoc } from '../html/import';
import { markdownDocToPlainHtml } from '../html/plainHtml';

const SRC = 'Fresh<sup>1</sup> and H<sub>2</sub>O';

async function partText(buffer: ArrayBuffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file(path)?.async('string')) ?? '';
}

describe('DOCX', () => {
  it('exports vertical alignment as w:vertAlign', async () => {
    const xml = await partText(await markdownDocToDocx(parseMarkdown(SRC)), 'word/document.xml');
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>');
  });

  it('puts vertAlign last in the rPr, per the EG_RPrBase sequence', async () => {
    const xml = await partText(
      await markdownDocToDocx(parseMarkdown('**<sup>1</sup>**')),
      'word/document.xml',
    );
    // `b` precedes `vertAlign` in the schema sequence; the reverse order is
    // what strict OOXML validators reject.
    expect(xml).toContain('<w:rPr><w:b/><w:vertAlign w:val="superscript"/></w:rPr>');
  });

  it('imports w:vertAlign back into markdown', async () => {
    const doc = await docxToMarkdownDoc(await markdownDocToDocx(parseMarkdown(SRC)));
    expect(stringifyMarkdown(doc).trim()).toBe(SRC);
  });
});

describe('PPTX', () => {
  it('exports vertical alignment as a DrawingML baseline offset', async () => {
    const xml = await partText(
      await markdownDocToPptx(parseMarkdown(`# Slide\n\n${SRC}`)),
      'ppt/slides/slide1.xml',
    );
    // DrawingML uses a per-mille offset, not an enum.
    expect(xml).toContain('baseline="30000"');
    expect(xml).toContain('baseline="-25000"');
  });
});

describe('HTML', () => {
  it('imports <sup> / <sub> instead of flattening them away', async () => {
    const doc = await htmlToMarkdownDoc('<p>Fresh<sup>1</sup> and H<sub>2</sub>O</p>');
    expect(stringifyMarkdown(doc).trim()).toBe(SRC);
  });

  it('exports back to real sup/sub tags', () => {
    const html = markdownDocToPlainHtml(parseMarkdown(SRC));
    expect(html).toContain('<sup>1</sup>');
    expect(html).toContain('<sub>2</sub>');
    // The old unpaired-htmlInline path emitted an EMPTY tag with the content
    // stranded outside it.
    expect(html).not.toContain('<sup></sup>');
  });
});
