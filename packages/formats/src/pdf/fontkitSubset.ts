/**
 * The fontkit the PDF writer gives pdf-lib: `@pdf-lib/fontkit`, with TrueType
 * subsets that keep every glyph intact.
 *
 * Its subsetter copies each glyph's bytes as they are, then writes the
 * subset's `loca` table in the short format whenever the offsets allow. The
 * short format stores offsets halved, so it needs every glyph to start at an
 * even offset. Fonts built without glyph padding (Google's Noto builds among
 * them; DejaVu happens to be padded) have odd-length glyphs, and every glyph
 * after one was read from the wrong place: it drew nothing, or garbage, while
 * its text still copied out of the PDF correctly. Padding each copied glyph to
 * an even length keeps the offsets exact. CFF (OpenType) subsets are encoded
 * differently and are left alone.
 */

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument } from 'pdf-lib';

type Fontkit = Parameters<PDFDocument['registerFontkit']>[0];

/** What `TTFSubset` keeps while it copies glyphs (`@pdf-lib/fontkit` 1.1.1). */
interface TrueTypeSubsetState {
  /** Copied glyph data, one buffer per subset glyph. */
  glyf: Uint8Array[];
  /** Where the next glyph starts in the subset's `glyf` table. */
  offset: number;
}

/** The statics of the Buffer class fontkit copies glyph data into. */
interface BufferClass {
  alloc(size: number): Uint8Array;
  concat(list: readonly Uint8Array[]): Uint8Array;
}

type AddGlyph = (this: TrueTypeSubsetState, glyphId: number) => number;

function padGlyphsToEvenLength(subset: object): void {
  const target = subset as { _addGlyph?: AddGlyph };
  const addGlyph = target._addGlyph;
  if (typeof addGlyph !== 'function') return;
  target._addGlyph = function (this: TrueTypeSubsetState, glyphId: number): number {
    const index = addGlyph.call(this, glyphId);
    const data = this.glyf[index];
    if (data && data.length % 2 === 1) {
      // fontkit's own Buffer class, which its encoder streams accept.
      const Buffer = data.constructor as unknown as BufferClass;
      this.glyf[index] = Buffer.concat([data, Buffer.alloc(1)]);
      this.offset += 1;
    }
    return index;
  };
}

export const subsetSafeFontkit: Fontkit = {
  create(buffer, postscriptName) {
    const font = fontkit.create(buffer, postscriptName);
    if (typeof font.createSubset === 'function') {
      const createSubset = font.createSubset.bind(font);
      font.createSubset = () => {
        const subset = createSubset();
        padGlyphsToEvenLength(subset);
        return subset;
      };
    }
    return font;
  },
};
