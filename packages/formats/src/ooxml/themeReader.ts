/**
 * OOXML theme reader — parses a `theme1.xml` part (DrawingML `a:theme`)
 * into normalized color and font schemes.
 *
 * Shared by DOCX/PPTX/XLSX theme inference: all three formats carry the same
 * theme part shape, differing only in where the part hangs (document/master/
 * workbook relationships). This module never fails hard — unreadable slots
 * degrade to fallbacks or absence, with a warning per degradation.
 */

import type { OoxmlPackage } from './types.js';
import { getPartRelationships, getPartXml } from './reader.js';
import { NS_DRAWINGML, REL_THEME } from './namespaces.js';
import { baseDirOf, findRelByType, resolveTarget } from './readUtils.js';

/**
 * The clrScheme slots as normalized `#rrggbb` strings. The four surface/text
 * slots always resolve (falling back to black/white when degraded); accent and
 * hyperlink slots are omitted when unresolvable.
 */
export interface OoxmlColorScheme {
  dk1: string;
  lt1: string;
  dk2: string;
  lt2: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
  accent4?: string;
  accent5?: string;
  accent6?: string;
  hlink?: string;
  folHlink?: string;
}

export interface OoxmlFontScheme {
  /** `a:fontScheme > a:majorFont > a:latin@typeface` (headings). */
  majorLatin?: string;
  /** `a:fontScheme > a:minorFont > a:latin@typeface` (body). */
  minorLatin?: string;
}

export interface OoxmlTheme {
  /** `a:theme@name` (e.g. "Office Theme", "Ion"). */
  name?: string;
  /** Absent when the theme carries no parseable `a:clrScheme`. */
  colors?: OoxmlColorScheme;
  /** Absent when the theme carries no `a:fontScheme` latin typefaces. */
  fonts?: OoxmlFontScheme;
  warnings: string[];
}

const HEX6_RE = /^[0-9a-fA-F]{6}$/;

/** Well-known sysClr values that resolve without a `lastClr` hint. */
const SYS_COLOR_DEFAULTS: Record<string, string> = {
  windowText: '000000',
  window: 'ffffff',
};

/**
 * Resolve one clrScheme slot element to a `#rrggbb` string, or null.
 * Only the base color matters for theming — trailing transform children
 * (`a:lumMod`, `a:tint`, …) are ignored.
 */
function resolveSchemeColor(slot: Element): string | null {
  for (let i = 0; i < slot.childNodes.length; i++) {
    const child = slot.childNodes[i];
    if (!child || child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.localName === 'srgbClr') {
      const val = el.getAttribute('val');
      return val && HEX6_RE.test(val) ? `#${val.toLowerCase()}` : null;
    }
    if (el.localName === 'sysClr') {
      const lastClr = el.getAttribute('lastClr');
      if (lastClr && HEX6_RE.test(lastClr)) return `#${lastClr.toLowerCase()}`;
      const val = el.getAttribute('val');
      const known = val ? SYS_COLOR_DEFAULTS[val] : undefined;
      return known ? `#${known}` : null;
    }
    // Any other color form (schemeClr self-reference, prstClr, …) is
    // unresolvable without a full DrawingML color pipeline.
    return null;
  }
  return null;
}

function firstNS(parent: Element | Document, local: string): Element | null {
  const els = parent.getElementsByTagNameNS(NS_DRAWINGML, local);
  return els.length > 0 ? els[0]! : null;
}

function parseColorScheme(clrScheme: Element, warnings: string[]): OoxmlColorScheme {
  const resolve = (slotName: string): string | null => {
    const slot = firstNS(clrScheme, slotName);
    if (!slot) return null;
    return resolveSchemeColor(slot);
  };

  const dk1 = resolve('dk1');
  const lt1 = resolve('lt1');
  if (!dk1) warnings.push('theme: dk1 color could not be resolved; using #000000');
  if (!lt1) warnings.push('theme: lt1 color could not be resolved; using #ffffff');

  const dk2 = resolve('dk2');
  const lt2 = resolve('lt2');

  const colors: OoxmlColorScheme = {
    dk1: dk1 ?? '#000000',
    lt1: lt1 ?? '#ffffff',
    dk2: dk2 ?? dk1 ?? '#000000',
    lt2: lt2 ?? lt1 ?? '#ffffff',
  };

  for (const slot of ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const) {
    const hex = resolve(slot);
    if (hex) colors[slot] = hex;
    else warnings.push(`theme: ${slot} color could not be resolved; dropped`);
  }
  for (const slot of ['hlink', 'folHlink'] as const) {
    const hex = resolve(slot);
    if (hex) colors[slot] = hex;
  }
  return colors;
}

function parseFontScheme(fontScheme: Element, warnings: string[]): OoxmlFontScheme | undefined {
  const readLatin = (fontName: 'majorFont' | 'minorFont'): string | undefined => {
    const font = firstNS(fontScheme, fontName);
    if (!font) return undefined;
    const latin = firstNS(font, 'latin');
    const typeface = latin?.getAttribute('typeface')?.trim();
    if (!typeface) {
      warnings.push(`theme: ${fontName} has no latin typeface`);
      return undefined;
    }
    return typeface;
  };

  const majorLatin = readLatin('majorFont');
  const minorLatin = readLatin('minorFont');
  if (!majorLatin && !minorLatin) return undefined;
  return {
    ...(majorLatin ? { majorLatin } : {}),
    ...(minorLatin ? { minorLatin } : {}),
  };
}

/** Parse an already-loaded theme part Document. */
export function parseThemeXml(themeDoc: Document): OoxmlTheme {
  const warnings: string[] = [];

  const root = firstNS(themeDoc, 'theme');
  const name = root?.getAttribute('name')?.trim() || undefined;

  const clrScheme = firstNS(themeDoc, 'clrScheme');
  let colors: OoxmlColorScheme | undefined;
  if (clrScheme) {
    colors = parseColorScheme(clrScheme, warnings);
  } else {
    warnings.push('theme: no clrScheme found');
  }

  const fontScheme = firstNS(themeDoc, 'fontScheme');
  let fonts: OoxmlFontScheme | undefined;
  if (fontScheme) {
    fonts = parseFontScheme(fontScheme, warnings);
  } else {
    warnings.push('theme: no fontScheme found');
  }

  return {
    ...(name ? { name } : {}),
    ...(colors ? { colors } : {}),
    ...(fonts ? { fonts } : {}),
    warnings,
  };
}

/**
 * Resolve the theme part related from `fromPartPath` (via `REL_THEME`) and
 * parse it. Returns null when the part has no theme relationship or the
 * target part is missing — callers decide whether that's an error.
 */
export async function readThemePart(
  pkg: OoxmlPackage,
  fromPartPath: string,
): Promise<OoxmlTheme | null> {
  const rels = await getPartRelationships(pkg, fromPartPath);
  const rel = findRelByType(rels, REL_THEME);
  if (!rel) return null;
  const themePath = resolveTarget(baseDirOf(fromPartPath), rel.target);
  const doc = await getPartXml(pkg, themePath);
  if (!doc) return null;
  return parseThemeXml(doc);
}
