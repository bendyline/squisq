/**
 * Unicode text for PDF export.
 *
 * The 14 standard PDF fonts encode only WinAnsi (see `winAnsi.ts`), so Greek,
 * Cyrillic, Vietnamese, arrows, math, box drawing, CJK, emoji and most symbols
 * used to reach the page as `?` or an ASCII stand-in. When a document holds
 * such text, the writer embeds Unicode fonts beside the standard ones and
 * draws those characters with them. The bundled faces are DejaVu Sans for
 * alphabets and symbols, monochrome Noto Emoji, Noto Sans SC for Chinese and
 * Japanese, and Noto Sans KR for Korean; each of the last three loads only for
 * a document with text in its scripts.
 *
 * Text is split into runs, each with the font that draws it:
 * - characters WinAnsi encodes keep the standard font, so ordinary Latin text
 *   looks exactly as it did before;
 * - a word the main Unicode face can draw is drawn in it whole, so its letters
 *   and punctuation match rather than alternating faces mid-word;
 * - otherwise each character (a letter with its marks, a whole emoji sequence)
 *   takes the first face that draws it: the emoji face first for one shown as
 *   emoji, last for one the other faces draw as text;
 * - a character no face can draw still goes through the WinAnsi sanitizer,
 *   which replaces it and counts it toward the export's one warning.
 */

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import { subsetSafeFontkit } from './fontkitSubset.js';
import { isInvisibleOrSpace, isWinAnsiEncodable, type WinAnsiTracker } from './winAnsi.js';

type FontBytes = Uint8Array | ArrayBuffer;

/**
 * TrueType or OpenType bytes for the faces that draw what the standard fonts
 * cannot. Bold falls back to `regular`, and `mono` (used for code) to
 * `regular` as well.
 */
export interface PdfUnicodeFonts {
  regular: FontBytes;
  bold?: FontBytes;
  mono?: FontBytes;
  /**
   * Draws emoji: tried first for a character shown as emoji (🙂, or a heart
   * with the emoji variation selector), and last for one the other faces draw
   * as text (♥).
   */
  emoji?: FontBytes;
  /**
   * Further faces, tried in order for what none of the faces above can draw.
   * Every style shares them. The bundled set puts CJK here.
   */
  fallbacks?: readonly FontBytes[];
}

/** Text the bundled emoji face is for. */
const EMOJI_TEXT = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
/** Text the bundled Chinese face is for: Han, kana, and CJK punctuation. */
const HAN_OR_KANA_TEXT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]/u;
/** Text the bundled Korean face is for. */
const HANGUL_TEXT = /\p{Script=Hangul}/u;

/**
 * The bundled faces for a document: DejaVu Sans always, and Noto Emoji, Noto
 * Sans SC and Noto Sans KR only when `root` has text in their scripts. Each
 * is a separate module, imported only when it is needed.
 */
export async function loadBundledUnicodeFonts(root?: unknown): Promise<PdfUnicodeFonts> {
  const text = root === undefined ? '' : unencodableCharacters(root);
  const [{ dejaVuFontData }, emoji, cjk, hangul] = await Promise.all([
    import('../assets/unicodeFontData.generated.js'),
    EMOJI_TEXT.test(text)
      ? import('../assets/emojiFontData.generated.js').then((m) => m.notoEmojiFontData())
      : undefined,
    HAN_OR_KANA_TEXT.test(text)
      ? import('../assets/cjkFontData.generated.js').then((m) => m.notoSansScFontData())
      : undefined,
    HANGUL_TEXT.test(text)
      ? import('../assets/hangulFontData.generated.js').then((m) => m.notoSansKrFontData())
      : undefined,
  ]);
  return {
    ...dejaVuFontData(),
    emoji,
    fallbacks: [cjk, hangul].filter((face): face is Uint8Array => face !== undefined),
  };
}

function isUnencodable(codePoint: number): boolean {
  return !isWinAnsiEncodable(codePoint) && !isInvisibleOrSpace(codePoint);
}

function hasUnencodableText(value: string): boolean {
  for (const ch of value) {
    if (isUnencodable(ch.codePointAt(0) as number)) return true;
  }
  return false;
}

/** Every string in a Markdown-shaped tree. */
function forEachString(root: unknown, visit: (value: string) => boolean | void): void {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (visit(value) === true) return;
    } else if (Array.isArray(value)) {
      pending.push(...value);
    } else if (value && typeof value === 'object') {
      pending.push(...Object.values(value as Record<string, unknown>));
    }
  }
}

/**
 * Whether any string in a Markdown-shaped tree has a visible character the
 * standard fonts cannot encode. Most documents have none, and skip the font.
 */
export function needsUnicodeFont(root: unknown): boolean {
  let found = false;
  forEachString(root, (value) => (found = hasUnencodableText(value)));
  return found;
}

/** The distinct visible characters in a tree that the standard fonts cannot encode. */
function unencodableCharacters(root: unknown): string {
  const characters = new Set<string>();
  forEachString(root, (value) => {
    for (const ch of value) {
      if (isUnencodable(ch.codePointAt(0) as number)) characters.add(ch);
    }
  });
  return [...characters].join('');
}

/** Whether a code point belongs to the character before it. */
function continuesCluster(ch: string, codePoint: number): boolean {
  return (
    /\p{M}/u.test(ch) || // combining marks, variation selectors, the keycap
    codePoint === 0x200d || // zero-width joiner
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) || // emoji skin tones
    (codePoint >= 0xe0020 && codePoint <= 0xe007f) // tags (subdivision flags)
  );
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

/**
 * Text as the characters a reader sees, near enough to draw or break between
 * them: a combining accent, variation selector or skin tone stays with the
 * character it modifies, a zero-width joiner holds an emoji sequence
 * together, and regional indicators pair into flags.
 */
export function characterClusters(text: string): string[] {
  const clusters: string[] = [];
  let loneRegionalIndicator = false;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) as number;
    const last = clusters.length - 1;
    const joins =
      last >= 0 &&
      (continuesCluster(ch, codePoint) ||
        clusters[last]!.endsWith('\u200d') ||
        (loneRegionalIndicator && isRegionalIndicator(codePoint)));
    if (joins) {
      clusters[last] += ch;
      loneRegionalIndicator = false;
    } else {
      clusters.push(ch);
      loneRegionalIndicator = isRegionalIndicator(codePoint);
    }
  }
  return clusters;
}

/**
 * A character shown as emoji rather than as text: one that is emoji by
 * default, or is made one by a variation selector, keycap, skin tone, flag
 * pair or tag sequence.
 */
const EMOJI_STYLE =
  /[\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Regional_Indicator}\u{fe0f}\u{20e3}\u{e0020}-\u{e007f}]/u;

/** A Unicode face: the embedded font, and which code points it can draw. */
export interface UnicodeFace {
  font: PDFFont;
  covers(codePoint: number): boolean;
}

/** The Unicode faces that stand in for one standard font. */
export interface UnicodeFaces {
  /** The face for alphabets and symbols, in the standard font's style. */
  primary: UnicodeFace;
  /** Faces tried after `primary`, in order. */
  fallbacks: readonly UnicodeFace[];
  emoji?: UnicodeFace;
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

function asBytes(data: FontBytes): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Embed the Unicode faces and pair each standard font with the ones that
 * stand in for it. Italic shares the upright face: drawing a fallback word
 * upright inside italic text reads better than dropping it.
 */
export async function embedUnicodeFaces(
  pdfDoc: PDFDocument,
  fonts: PdfUnicodeFonts,
  standard: StandardFonts,
): Promise<Map<PDFFont, UnicodeFaces>> {
  pdfDoc.registerFontkit(subsetSafeFontkit);
  const faces = new Map<FontBytes, Promise<UnicodeFace>>();
  const faceFor = (data: FontBytes): Promise<UnicodeFace> => {
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
  const [regular, bold, mono, emoji, fallbacks] = await Promise.all([
    faceFor(fonts.regular),
    faceFor(fonts.bold ?? fonts.regular),
    faceFor(fonts.mono ?? fonts.regular),
    fonts.emoji ? faceFor(fonts.emoji) : undefined,
    Promise.all((fonts.fallbacks ?? []).map(faceFor)),
  ]);
  const withPrimary = (primary: UnicodeFace): UnicodeFaces => ({ primary, fallbacks, emoji });
  return new Map<PDFFont, UnicodeFaces>([
    [standard.regular, withPrimary(regular)],
    [standard.italic, withPrimary(regular)],
    [standard.bold, withPrimary(bold)],
    [standard.boldItalic, withPrimary(bold)],
    [standard.mono, withPrimary(mono)],
    [standard.monoBold, withPrimary(mono)],
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
    private readonly faces: ReadonlyMap<PDFFont, UnicodeFaces> = new Map(),
  ) {}

  split(text: string, font: PDFFont): TextRun[] {
    const faces = this.faces.get(font);
    if (!faces || !hasUnencodableText(text)) return [{ text: this.tracker.clean(text), font }];

    const runs: TextRun[] = [];
    const push = (value: string, runFont: PDFFont): void => {
      if (value.length === 0) return;
      const last = runs[runs.length - 1];
      if (last && last.font === runFont) last.text += value;
      else runs.push({ text: value, font: runFont });
    };
    const { primary } = faces;
    const drawable = (codePoint: number): boolean =>
      !isInvisibleOrSpace(codePoint) && primary.covers(codePoint);

    for (const word of text.normalize('NFC').split(/(\s+)/u)) {
      if (word.length === 0) continue;
      const codePoints = Array.from(word, (ch) => ch.codePointAt(0) as number);
      if (codePoints.every(isWinAnsiEncodable)) {
        push(word, font);
      } else if (!EMOJI_STYLE.test(word) && codePoints.every(drawable)) {
        push(word, primary.font);
      } else {
        for (const cluster of characterClusters(word))
          this.splitCluster(cluster, font, faces, push);
      }
    }
    return runs.length > 0 ? runs : [{ text: '', font }];
  }

  /** One reader-visible character: drawn whole by one face where one can. */
  private splitCluster(
    cluster: string,
    font: PDFFont,
    faces: UnicodeFaces,
    push: (value: string, runFont: PDFFont) => void,
  ): void {
    const codePoints = Array.from(cluster, (ch) => ch.codePointAt(0) as number);
    if (codePoints.every(isWinAnsiEncodable)) {
      push(cluster, font);
      return;
    }
    const order = EMOJI_STYLE.test(cluster)
      ? [faces.emoji, faces.primary, ...faces.fallbacks]
      : [faces.primary, ...faces.fallbacks, faces.emoji];
    const candidates = order.filter((face): face is UnicodeFace => face !== undefined);
    const visible = codePoints.filter((codePoint) => !isInvisibleOrSpace(codePoint));
    const whole =
      visible.length > 0
        ? candidates.find((face) => visible.every((codePoint) => face.covers(codePoint)))
        : undefined;
    if (whole) {
      // Keep the joiners and selectors the face maps, which its ligatures
      // need (a family emoji is three people and two joiners); drop the rest,
      // which would draw as the face's missing-glyph box.
      push(
        Array.from(cluster)
          .filter((ch) => whole.covers(ch.codePointAt(0) as number))
          .join(''),
        whole.font,
      );
      return;
    }
    for (const ch of cluster) {
      const codePoint = ch.codePointAt(0) as number;
      const face = isInvisibleOrSpace(codePoint)
        ? undefined
        : candidates.find((candidate) => candidate.covers(codePoint));
      if (isWinAnsiEncodable(codePoint)) push(ch, font);
      else if (face) push(ch, face.font);
      else push(this.tracker.clean(ch), font);
    }
  }
}
