/**
 * Inline icons as SVG, for pages that should not depend on a font.
 *
 * A Font Awesome icon in the plain renderer is `<i class="fa-solid fa-star">`,
 * which draws only where Font Awesome's stylesheet and fonts load — a CDN the
 * page may not be allowed to reach, or a bundle it doesn't ship. Each icon's
 * outline is read here from the same Font Awesome faces the DOCX, PDF and
 * EPUB exporters embed, and drawn as a small inline `<svg>` instead: no font,
 * no network, and it takes the text color like the glyph would.
 *
 * This module is its own entry, `@bendyline/squisq-formats/html-icons`, and
 * nothing under `/html` may import it: the faces and their parser are ~2.5 MB,
 * and a one-file bundle of `/html` would carry them even if it never drew an
 * icon. Hosts pass `plainHtmlIcons` to `prepareMarkdownDocForPlainHtml`
 * (`@bendyline/squisq-formats/html-prepare`) as `outlineIcons`.
 */

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { IconFamily } from '@bendyline/squisq/icons';
import type { PlainHtmlIcon } from './plainHtml.js';

interface IconFont {
  unitsPerEm: number;
  ascent: number;
  glyphForCodePoint(codePoint: number): {
    advanceWidth: number;
    path: { toFunction(): unknown };
  };
}

/** Parsed faces, kept: a live preview prepares the same document many times. */
const fonts = new Map<IconFamily, Promise<IconFont>>();

function loadFont(family: IconFamily): Promise<IconFont> {
  let font = fonts.get(family);
  if (!font) {
    font = Promise.all([import('@pdf-lib/fontkit'), import('../shared/fontAwesome.js')]).then(
      ([fontkit, { fontAwesomeFace }]) =>
        fontkit.default.create(fontAwesomeFace(family).data) as unknown as IconFont,
    );
    font.catch(() => fonts.delete(family));
    fonts.set(family, font);
  }
  return font;
}

/** The icons a document uses, as `family:name` → [family, name]. */
function usedIcons(doc: MarkdownDocument): Map<string, [IconFamily, string]> {
  const used = new Map<string, [IconFamily, string]>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; family?: IconFamily; name?: string; children?: unknown };
    if (n.type === 'inlineIcon' && n.family && n.name) {
      used.set(`${n.family}:${n.name}`, [n.family, n.name]);
    }
    if (Array.isArray(n.children)) n.children.forEach(visit);
  };
  visit(doc);
  return used;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * A glyph's outline as SVG path data in a box `unitsPerEm` tall, flipped from
 * the font's y-up coordinates to SVG's y-down — the box Font Awesome's own
 * SVGs use.
 */
function glyphPath(font: IconFont, glyph: ReturnType<IconFont['glyphForCodePoint']>): string {
  const y = (value: number) => round(font.ascent - value);
  const parts: string[] = [];
  const sink = {
    moveTo: (x: number, py: number) => parts.push(`M${round(x)} ${y(py)}`),
    lineTo: (x: number, py: number) => parts.push(`L${round(x)} ${y(py)}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, py: number) =>
      parts.push(`Q${round(cx)} ${y(cy)} ${round(x)} ${y(py)}`),
    bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, py: number) =>
      parts.push(`C${round(c1x)} ${y(c1y)} ${round(c2x)} ${y(c2y)} ${round(x)} ${y(py)}`),
    closePath: () => parts.push('Z'),
  };
  (glyph.path.toFunction() as (context: typeof sink) => void)(sink);
  return parts.join('');
}

/**
 * The outline of every icon `doc` uses, keyed `family:name` — the `icons`
 * option of `markdownDocToPlainHtml`. An icon the catalog doesn't know is left
 * out and keeps its Font Awesome markup.
 */
export async function plainHtmlIcons(doc: MarkdownDocument): Promise<Map<string, PlainHtmlIcon>> {
  const icons = new Map<string, PlainHtmlIcon>();
  const used = usedIcons(doc);
  if (used.size === 0) return icons;
  const { fontAwesomeGlyph } = await import('../shared/fontAwesome.js');
  for (const [key, [family, name]] of used) {
    const glyph = fontAwesomeGlyph(family, name);
    if (!glyph) continue;
    const font = await loadFont(family);
    const outline = font.glyphForCodePoint(glyph.codePointAt(0)!);
    if (!outline || outline.advanceWidth <= 0) continue;
    icons.set(key, {
      width: outline.advanceWidth,
      height: font.unitsPerEm,
      path: glyphPath(font, outline),
    });
  }
  return icons;
}
