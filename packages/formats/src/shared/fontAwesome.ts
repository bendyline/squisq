/**
 * Portable Font Awesome assets used by non-HTML exporters.
 *
 * Markdown icons are private-use Unicode characters. They only remain visible
 * when the matching Font Awesome face travels with the exported document, so
 * the Office and PDF writers share these exact desktop fonts and family names.
 */

import { iconGlyph, resolveIcon, type IconFamily } from '@bendyline/squisq/icons';

import {
  fontAwesomeBrandsData,
  fontAwesomeRegularData,
  fontAwesomeSolidData,
} from '../assets/fontAwesomeFontData.generated.js';

export interface FontAwesomeFontFace {
  family: IconFamily;
  /** Exact OpenType family name referenced by DOCX/PPTX text runs. */
  typeface: string;
  /** Stable package filename stem. */
  fileStem: string;
  /** OpenType font bytes. */
  data: Uint8Array;
  /** Stable key used by Word's mandated font-obfuscation algorithm. */
  docxFontKey: string;
}

const FONT_FACES: Record<IconFamily, FontAwesomeFontFace> = {
  brands: {
    family: 'brands',
    typeface: 'Font Awesome 7 Brands',
    fileStem: 'fontAwesomeBrands',
    data: fontAwesomeBrandsData,
    docxFontKey: '5CA45A89-66E2-4CA9-9998-39E484E429AD',
  },
  regular: {
    family: 'regular',
    typeface: 'Font Awesome 7 Free',
    fileStem: 'fontAwesomeRegular',
    data: fontAwesomeRegularData,
    docxFontKey: 'C6265CA5-8399-4862-9A3C-8C37A00CDCB2',
  },
  solid: {
    family: 'solid',
    typeface: 'Font Awesome 7 Free Solid',
    fileStem: 'fontAwesomeSolid',
    data: fontAwesomeSolidData,
    docxFontKey: 'C1091147-299A-4461-95BB-CA8B26528DE6',
  },
};

export function fontAwesomeFace(family: IconFamily): FontAwesomeFontFace {
  return FONT_FACES[family];
}

/** Return used faces in stable family order for deterministic archives/tests. */
export function fontAwesomeFaces(families: ReadonlySet<IconFamily>): FontAwesomeFontFace[] {
  const order: IconFamily[] = ['brands', 'regular', 'solid'];
  return order.filter((family) => families.has(family)).map((family) => FONT_FACES[family]);
}

/** Resolve a typed inline icon to the private-use glyph stored in its face. */
export function fontAwesomeGlyph(family: IconFamily, name: string): string {
  const entry = resolveIcon(`fa-${family}:${name}`);
  return entry ? iconGlyph(entry) : '';
}

/** Walk any Markdown-shaped tree and collect the icon families it uses. */
export function collectInlineIconFamilies(root: unknown): Set<IconFamily> {
  const families = new Set<IconFamily>();

  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }

    const node = value as { type?: unknown; family?: unknown; children?: unknown };
    if (
      node.type === 'inlineIcon' &&
      (node.family === 'brands' || node.family === 'regular' || node.family === 'solid')
    ) {
      families.add(node.family);
    }
    if (Array.isArray(node.children)) visit(node.children);
  }

  visit(root);
  return families;
}

/**
 * Apply ECMA-376's DOCX embedded-font obfuscation to the first 32 bytes.
 * The 16 font-key bytes are traversed in reverse order twice.
 */
export function obfuscateDocxFont(face: FontAwesomeFontFace): Uint8Array {
  const keyHex = face.docxFontKey.replace(/-/g, '');
  const keyBytes = keyHex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16));
  if (!keyBytes || keyBytes.length !== 16) {
    throw new Error(`Invalid DOCX font key for ${face.typeface}`);
  }

  const obfuscated = new Uint8Array(face.data);
  for (let index = 0; index < Math.min(32, obfuscated.length); index++) {
    obfuscated[index] ^= keyBytes[15 - (index % 16)]!;
  }
  return obfuscated;
}

export type { IconFamily };
