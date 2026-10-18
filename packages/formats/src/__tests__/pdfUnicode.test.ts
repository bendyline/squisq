/**
 * Unicode text in PDF export: what the standard fonts cannot encode is drawn
 * with an embedded Unicode font (the bundled DejaVu Sans faces by default)
 * and comes back out of the PDF as the same text.
 */

import { describe, it, expect } from 'vitest';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import type {
  MarkdownCodeBlock,
  MarkdownDocument,
  MarkdownParagraph,
  MarkdownText,
} from '@bendyline/squisq/markdown';
import { markdownDocToPdf } from '../pdf/export';
import { pdfToMarkdownDoc } from '../pdf/import';
import {
  PdfTextRuns,
  embedUnicodeFaces,
  loadBundledUnicodeFonts,
  needsUnicodeFont,
} from '../pdf/unicodeText';
import { WinAnsiTracker } from '../pdf/winAnsi';

function text(value: string): MarkdownText {
  return { type: 'text', value };
}

function paragraph(value: string): MarkdownParagraph {
  return { type: 'paragraph', children: [text(value)] } as MarkdownParagraph;
}

function documentOf(...children: MarkdownDocument['children']): MarkdownDocument {
  return { type: 'document', children };
}

/** Every string an imported document holds, joined. */
function allText(root: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(root);
  return parts.join(' ');
}

/** Whether the PDF embeds a DejaVu face (font dictionaries live in object streams). */
async function embedsDejaVu(buffer: ArrayBuffer): Promise<boolean> {
  const pdf = await PDFDocument.load(buffer);
  return pdf.context.enumerateIndirectObjects().some(([, object]) => {
    if (!(object instanceof PDFDict)) return false;
    const baseFont = object.get(PDFName.of('BaseFont'));
    return baseFont instanceof PDFName && baseFont.asString().includes('DejaVuSans');
  });
}

async function exportAndRead(doc: MarkdownDocument, warnings: string[] = []) {
  const buffer = await markdownDocToPdf(doc, { onWarning: (m) => warnings.push(m) });
  return {
    text: allText(await pdfToMarkdownDoc(buffer)),
    usesDejaVu: await embedsDejaVu(buffer),
  };
}

describe('PDF export of text the standard fonts cannot encode', () => {
  it('draws Greek, Cyrillic, arrows, math and box drawing as themselves', async () => {
    const warnings: string[] = [];
    const doc = documentOf(paragraph('Привет мир → готово. Ελληνικά: αβγ ≤ ∞ ≠ ±'), {
      type: 'code',
      value: '├── ключ\n└── ✓ done',
    } as MarkdownCodeBlock);

    const result = await exportAndRead(doc, warnings);

    expect(warnings).toEqual([]);
    expect(result.usesDejaVu).toBe(true);
    for (const expected of ['Привет', 'мир', '→', 'готово', 'αβγ', '≤', '∞', 'ключ', '├', '✓']) {
      expect(result.text, expected).toContain(expected);
    }
  });

  it('keeps the standard fonts alone for a document that needs nothing more', async () => {
    const result = await exportAndRead(
      documentOf(paragraph('Café — “smart quotes”, en–dash, ellipsis… €5 ™')),
    );

    expect(result.usesDejaVu).toBe(false);
    expect(result.text).toContain('Café');
  });

  it('still replaces, and reports, what the Unicode font cannot draw either', async () => {
    const warnings: string[] = [];
    const result = await exportAndRead(documentOf(paragraph('Жизнь 中文 \u{1F600}')), warnings);

    expect(result.text).toContain('Жизнь');
    expect(result.text).not.toContain('中文');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('CJK and emoji');
  });

  it('replaces as before when the caller turns the Unicode font off', async () => {
    const warnings: string[] = [];
    const buffer = await markdownDocToPdf(documentOf(paragraph('Привет')), {
      unicodeFonts: false,
      onWarning: (m) => warnings.push(m),
    });

    expect(await embedsDejaVu(buffer)).toBe(false);
    expect(allText(await pdfToMarkdownDoc(buffer))).not.toContain('Привет');
    expect(warnings).toHaveLength(1);
  });

  it('uses fonts the caller supplies in place of the bundled ones', async () => {
    const { regular } = await loadBundledUnicodeFonts();
    const buffer = await markdownDocToPdf(documentOf(paragraph('Ωmega')), {
      unicodeFonts: { regular },
    });

    expect(allText(await pdfToMarkdownDoc(buffer))).toContain('Ωmega');
  });
});

describe('needsUnicodeFont', () => {
  it('ignores text the standard fonts encode, and invisible characters', () => {
    expect(needsUnicodeFont(documentOf(paragraph('Plain “quoted” — text €')))).toBe(false);
    expect(needsUnicodeFont(documentOf(paragraph('tab\tzero​width nbsp')))).toBe(false);
  });

  it('finds a visible character anywhere in the tree', () => {
    expect(needsUnicodeFont(documentOf(paragraph('arrow →')))).toBe(true);
    expect(needsUnicodeFont({ nested: [{ deeper: { value: 'Ж' } }] })).toBe(true);
  });
});

describe('PdfTextRuns', () => {
  async function runsFor(value: string) {
    const pdfDoc = await PDFDocument.create();
    const [regular, bold, italic, boldItalic, mono, monoBold] = await Promise.all(
      [
        StandardFonts.Helvetica,
        StandardFonts.HelveticaBold,
        StandardFonts.HelveticaOblique,
        StandardFonts.HelveticaBoldOblique,
        StandardFonts.Courier,
        StandardFonts.CourierBold,
      ].map((name) => pdfDoc.embedFont(name)),
    );
    const faces = await embedUnicodeFaces(pdfDoc, await loadBundledUnicodeFonts(), {
      regular: regular!,
      bold: bold!,
      italic: italic!,
      boldItalic: boldItalic!,
      mono: mono!,
      monoBold: monoBold!,
    });
    const tracker = new WinAnsiTracker();
    const runs = new PdfTextRuns(tracker, faces).split(value, regular!);
    return {
      runs: runs.map((run) => ({ text: run.text, unicode: run.font !== regular })),
      tracker,
    };
  }

  it('keeps Latin in the standard font and draws a word that needs Unicode whole', async () => {
    const { runs, tracker } = await runsFor('Hello Привет, world →x');

    expect(runs).toEqual([
      { text: 'Hello ', unicode: false },
      { text: 'Привет,', unicode: true },
      { text: ' world ', unicode: false },
      { text: '→x', unicode: true },
    ]);
    expect(tracker.substitutions).toBe(0);
  });

  it('replaces only the characters neither font can draw', async () => {
    const { runs, tracker } = await runsFor('ok 中Ж');

    expect(runs).toEqual([
      { text: 'ok ?', unicode: false },
      { text: 'Ж', unicode: true },
    ]);
    expect(tracker.substitutions).toBe(1);
  });

  it('turns a tab into spaces rather than drawing it', async () => {
    const { runs } = await runsFor('a\tЖ');

    expect(runs.map((run) => run.text).join('')).toBe('a    Ж');
  });
});
