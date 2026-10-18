/**
 * Unicode text for PDF export.
 *
 * The 14 standard PDF fonts encode only WinAnsi (see `winAnsi.ts`), so Greek,
 * Cyrillic, Vietnamese, arrows, math, box drawing and most symbols used to
 * reach the page as `?` or an ASCII stand-in. When a document holds such text,
 * the writer embeds a Unicode font beside the standard ones — by default the
 * bundled DejaVu Sans faces — and draws those characters with it.
 *
 * Text is split into runs, each with the font that draws it:
 * - characters WinAnsi encodes keep the standard font, so ordinary Latin text
 *   looks exactly as it did before;
 * - a word that needs the Unicode font is drawn in it whole, so its letters and
 *   punctuation match rather than alternating faces mid-word;
 * - a character neither font can draw (CJK and emoji, with the bundled faces)
 *   still goes through the WinAnsi sanitizer, which replaces it and counts it
 *   toward the export's one warning.
 */

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import { isInvisibleOrSpace, isWinAnsiEncodable, type WinAnsiTracker } from './winAnsi.js';

/**
 * TrueType or OpenType bytes for the faces that draw what the standard fonts
 * cannot. Bold falls back to `regular`, and `mono` (used for code) to
 * `regular` as well.
 */
export interface PdfUnicodeFonts {
  regular: Uint8Array | ArrayBuffer;
  bold?: Uint8Array | ArrayBuffer;
  mono?: Uint8Array | ArrayBuffer;
}

/** The bundled DejaVu Sans faces, loaded only when a document needs them. */
export async function loadBundledUnicodeFonts(): Promise<PdfUnicodeFonts> {
  const { dejaVuFontData } = await import('../assets/unicodeFontData.generated.js');
  return dejaVuFontData();
}

function hasUnencodableText(value: string): boolean {
  for (const ch of value) {
    const codePoint = ch.codePointAt(0) as number;
    if (!isWinAnsiEncodable(codePoint) && !isInvisibleOrSpace(codePoint)) return true;
  }
  return false;
}

/**
 * Whether any string in a Markdown-shaped tree has a visible character the
 * standard fonts cannot encode. Most documents have none, and skip the font.
 */
export function needsUnicodeFont(root: unknown): boolean {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (hasUnencodableText(value)) return true;
    } else if (Array.isArray(value)) {
      pending.push(...value);
    } else if (value && typeof value === 'object') {
      pending.push(...Object.values(value as Record<string, unknown>));
    }
  }
  return false;
}

/** A Unicode face: the embedded font, and which code points it can draw. */
export interface UnicodeFace {
  font: PDFFont;
  covers(codePoint: number): boolean;
}

/** The standard fonts a document is set in, keyed by the role they play. */
export interface StandardFonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

function asBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Embed the Unicode faces and pair each standard font with the one that
 * stands in for it. Italic shares the upright face: drawing a fallback word
 * upright inside italic text reads better than dropping it.
 */
export async function embedUnicodeFaces(
  pdfDoc: PDFDocument,
  fonts: PdfUnicodeFonts,
  standard: StandardFonts,
): Promise<Map<PDFFont, UnicodeFace>> {
  pdfDoc.registerFontkit(fontkit);
  const faces = new Map<Uint8Array | ArrayBuffer, Promise<UnicodeFace>>();
  const faceFor = (data: Uint8Array | ArrayBuffer): Promise<UnicodeFace> => {
    let face = faces.get(data);
    if (!face) {
      const bytes = asBytes(data);
      const metrics = fontkit.create(bytes);
      face = pdfDoc.embedFont(bytes, { subset: true }).then((font) => ({
        font,
        covers: (codePoint: number) => metrics.hasGlyphForCodePoint(codePoint),
      }));
      faces.set(data, face);
    }
    return face;
  };
  const [regular, bold, mono] = await Promise.all([
    faceFor(fonts.regular),
    faceFor(fonts.bold ?? fonts.regular),
    faceFor(fonts.mono ?? fonts.regular),
  ]);
  return new Map<PDFFont, UnicodeFace>([
    [standard.regular, regular],
    [standard.italic, regular],
    [standard.bold, bold],
    [standard.boldItalic, bold],
    [standard.mono, mono],
    [standard.monoBold, mono],
  ]);
}

/** A stretch of text and the font that draws it. */
export interface TextRun {
  text: string;
  font: PDFFont;
}

/**
 * Splits text into runs pdf-lib can draw. With no Unicode faces this is the
 * WinAnsi sanitizer alone, exactly as before.
 */
export class PdfTextRuns {
  constructor(
    private readonly tracker: WinAnsiTracker,
    private readonly faces: ReadonlyMap<PDFFont, UnicodeFace> = new Map(),
  ) {}

  split(text: string, font: PDFFont): TextRun[] {
    const face = this.faces.get(font);
    if (!face || !hasUnencodableText(text)) return [{ text: this.tracker.clean(text), font }];

    const runs: TextRun[] = [];
    const push = (value: string, runFont: PDFFont): void => {
      if (value.length === 0) return;
      const last = runs[runs.length - 1];
      if (last && last.font === runFont) last.text += value;
      else runs.push({ text: value, font: runFont });
    };
    const drawable = (codePoint: number): boolean =>
      !isInvisibleOrSpace(codePoint) && face.covers(codePoint);

    for (const word of text.normalize('NFC').split(/(\s+)/u)) {
      if (word.length === 0) continue;
      const codePoints = Array.from(word, (ch) => ch.codePointAt(0) as number);
      if (codePoints.every(isWinAnsiEncodable)) {
        push(word, font);
      } else if (codePoints.every(drawable)) {
        push(word, face.font);
      } else {
        for (const ch of word) {
          const codePoint = ch.codePointAt(0) as number;
          if (isWinAnsiEncodable(codePoint)) push(ch, font);
          else if (drawable(codePoint)) push(ch, face.font);
          else push(this.tracker.clean(ch), font);
        }
      }
    }
    return runs.length > 0 ? runs : [{ text: '', font }];
  }
}
