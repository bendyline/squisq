/**
 * Unicode text in PDF export: what the standard fonts cannot encode is drawn
 * with embedded Unicode fonts (by default the bundled DejaVu Sans faces, and
 * Noto Emoji, Noto Sans SC and Noto Sans KR for text in their scripts) and
 * comes back out of the PDF as the same text.
 */

import { describe, it, expect } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib';
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
  characterClusters,
  embedUnicodeFaces,
  loadBundledUnicodeFonts,
  needsUnicodeFont,
} from '../pdf/unicodeText';
import { WinAnsiTracker } from '../pdf/winAnsi';
import { breakBetweenCjk } from '../pdf/lineBreaks';

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

/** The names of the fonts a PDF embeds (font dictionaries live in object streams). */
async function embeddedFontNames(buffer: ArrayBuffer): Promise<string[]> {
  const pdf = await PDFDocument.load(buffer);
  return pdf.context.enumerateIndirectObjects().flatMap(([, object]) => {
    if (!(object instanceof PDFDict)) return [];
    const baseFont = object.get(PDFName.of('BaseFont'));
    return baseFont instanceof PDFName ? [baseFont.asString()] : [];
  });
}

/** Whether the PDF embeds a DejaVu face. */
async function embedsDejaVu(buffer: ArrayBuffer): Promise<boolean> {
  return (await embeddedFontNames(buffer)).some((name) => name.includes('DejaVuSans'));
}

/** Each TrueType font file the PDF embeds, parsed, keyed by its font name. */
async function embeddedTrueTypeFonts(buffer: ArrayBuffer) {
  const pdf = await PDFDocument.load(buffer);
  const fonts = new Map<string, ReturnType<typeof fontkit.create>>();
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const name = object.get(PDFName.of('FontName'));
    const file = object.get(PDFName.of('FontFile2'));
    if (!(name instanceof PDFName) || !(file instanceof PDFRef)) continue;
    const stream = pdf.context.lookup(file);
    if (!(stream instanceof PDFRawStream)) continue;
    fonts.set(name.asString(), fontkit.create(decodePDFRawStream(stream).decode()));
  }
  return fonts;
}

async function exportAndRead(doc: MarkdownDocument, warnings: string[] = []) {
  const buffer = await markdownDocToPdf(doc, { onWarning: (m) => warnings.push(m) });
  return {
    text: allText(await pdfToMarkdownDoc(buffer)),
    usesDejaVu: await embedsDejaVu(buffer),
    fonts: await embeddedFontNames(buffer),
    buffer,
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

  it('draws emoji, Chinese, Japanese and Korean as themselves', async () => {
    const warnings: string[] = [];
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    const result = await exportAndRead(
      documentOf(
        paragraph(
          `Status: ✅ shipped \u{1F680} Thanks \u{1F642} ❤\ufe0f ${family} \u{1F1FA}\u{1F1F8}`,
        ),
        paragraph('中文：你好，世界。繁體中文'),
        paragraph('日本語：こんにちは、カタカナ'),
        paragraph('한국어: 안녕하세요'),
      ),
      warnings,
    );

    expect(warnings).toEqual([]);
    for (const expected of [
      '✅',
      '\u{1F680}',
      '\u{1F642}',
      family,
      '\u{1F1FA}\u{1F1F8}',
      '你好',
      '繁體中文',
      'こんにちは',
      'カタカナ',
      '안녕하세요',
    ]) {
      expect(result.text, expected).toContain(expected);
    }
    expect(result.fonts.some((name) => name.includes('NotoEmoji'))).toBe(true);
    expect(result.fonts.some((name) => name.includes('NotoSansSC'))).toBe(true);
    expect(result.fonts.some((name) => name.includes('NotoSansKR'))).toBe(true);
  });

  it('embeds every glyph of a subset intact', async () => {
    // The Noto faces have odd-length glyphs. Unpadded, each glyph after one
    // came out of the subset garbled or empty while its text still extracted.
    const { buffer } = await exportAndRead(
      documentOf(paragraph('\u{1F642}\u{1F680}✅ 你好世界こんにちは 안녕하세요')),
    );
    const fonts = await embeddedTrueTypeFonts(buffer);

    expect([...fonts.keys()].filter((name) => /Noto/.test(name))).toHaveLength(3);
    for (const [name, font] of fonts) {
      for (let id = 1; id < font.numGlyphs; id++) {
        expect(font.getGlyph(id).path.toSVG(), `${name} glyph ${id}`).not.toBe('');
      }
    }
  });

  it('embeds only the faces for the scripts a document has', async () => {
    const cyrillic = await exportAndRead(documentOf(paragraph('Привет')));
    expect(cyrillic.usesDejaVu).toBe(true);
    expect(cyrillic.fonts.some((name) => name.includes('Noto'))).toBe(false);

    const emoji = await exportAndRead(documentOf(paragraph('Thanks \u{1F642}')));
    expect(emoji.fonts.some((name) => name.includes('NotoEmoji'))).toBe(true);
    expect(emoji.fonts.some((name) => name.includes('NotoSans'))).toBe(false);
  });

  it('wraps a long Chinese paragraph onto the page', async () => {
    const sentence = '这是一个很长的中文句子，用来测试换行。'.repeat(12);
    const result = await exportAndRead(documentOf(paragraph(`Intro ${sentence}`)));

    expect(result.text.replace(/\s+/g, '')).toContain(sentence);
    expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(1);
  });

  it('still replaces, and reports, what no bundled font can draw', async () => {
    const warnings: string[] = [];
    const result = await exportAndRead(documentOf(paragraph('Жизнь ภาษาไทย')), warnings);

    expect(result.text).toContain('Жизнь');
    expect(result.text).not.toContain('ภาษาไทย');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('such as Thai or Devanagari');
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
  /** Runs for `value`, with the bundled faces it needs (DejaVu alone unless `scripts`). */
  async function runsFor(value: string, scripts = false) {
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
    const bundled = await loadBundledUnicodeFonts(
      scripts ? documentOf(paragraph(value)) : undefined,
    );
    const faces = await embedUnicodeFaces(pdfDoc, bundled, {
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
      faces: runs.map((run) => ({
        text: run.text,
        face: run.font === regular ? 'standard' : run.font.name,
      })),
      tracker,
    };
  }

  /** The family of a run's face, without pdf-lib's per-document suffix. */
  function family(face: string): string {
    const known = ['DejaVuSans', 'NotoEmoji', 'NotoSansSC', 'NotoSansKR'];
    return known.find((name) => face.includes(name)) ?? face;
  }

  it('draws an emoji sequence whole in the emoji face', async () => {
    const family3 = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    const { faces, tracker } = await runsFor(`Hi ${family3}\u{1F1FA}\u{1F1F8} 1\ufe0f\u20e3`, true);

    expect(faces.map((run) => ({ text: run.text, face: family(run.face) }))).toEqual([
      { text: 'Hi ', face: 'standard' },
      { text: `${family3}\u{1F1FA}\u{1F1F8}`, face: 'NotoEmoji' },
      { text: ' ', face: 'standard' },
      { text: '1\ufe0f\u20e3', face: 'NotoEmoji' },
    ]);
    expect(tracker.substitutions).toBe(0);
  });

  it('draws a text-style symbol in the text face, and its emoji form in the emoji face', async () => {
    const { faces } = await runsFor('♥ ❤\ufe0f', true);

    expect(faces.map((run) => ({ text: run.text, face: family(run.face) }))).toEqual([
      { text: '♥', face: 'DejaVuSans' },
      { text: ' ', face: 'standard' },
      { text: '❤\ufe0f', face: 'NotoEmoji' },
    ]);
  });

  it('draws Chinese and Korean in their faces, with Latin left standard', async () => {
    const { faces } = await runsFor('DocBlocks导出PDF。한국어', true);

    expect(faces.map((run) => ({ text: run.text, face: family(run.face) }))).toEqual([
      { text: 'DocBlocks', face: 'standard' },
      { text: '导出', face: 'NotoSansSC' },
      { text: 'PDF', face: 'standard' },
      { text: '。', face: 'NotoSansSC' },
      { text: '한국어', face: 'NotoSansKR' },
    ]);
  });

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

describe('characterClusters', () => {
  it('keeps marks, joiners, skin tones, keycaps and flag pairs with their character', () => {
    expect(
      characterClusters(
        'e\u0301\u{1F468}\u200d\u{1F469}\u{1F44D}\u{1F3FD}1\ufe0f\u20e3\u{1F1FA}\u{1F1F8}\u{1F1EF}\u{1F1F5}x',
      ),
    ).toEqual([
      'e\u0301',
      '\u{1F468}\u200d\u{1F469}',
      '\u{1F44D}\u{1F3FD}',
      '1\ufe0f\u20e3',
      '\u{1F1FA}\u{1F1F8}',
      '\u{1F1EF}\u{1F1F5}',
      'x',
    ]);
  });
});

describe('breakBetweenCjk', () => {
  it('leaves a word without Chinese or Japanese whole', () => {
    expect(breakBetweenCjk('DocBlocks')).toEqual(['DocBlocks']);
  });

  it('breaks between characters and at a change to Latin', () => {
    expect(breakBetweenCjk('使用DocBlocks导出')).toEqual(['使', '用', 'DocBlocks', '导', '出']);
  });

  it('keeps closing punctuation and small kana off the start of a line', () => {
    expect(breakBetweenCjk('你好，世界。')).toEqual(['你', '好，', '世', '界。']);
    expect(breakBetweenCjk('ちょっと')).toEqual(['ちょっ', 'と']);
  });

  it('keeps opening punctuation off the end of a line', () => {
    expect(breakBetweenCjk('他说「好」')).toEqual(['他', '说', '「好」']);
  });
});
