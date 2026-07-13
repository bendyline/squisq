/**
 * Per-format theme extraction: locate the theme part of an already-opened
 * OOXML package, parse it, and resolve the document's background/text color
 * mapping. Returns null when the file has no theme part at all.
 */

import type { OoxmlPackage } from '../ooxml/types.js';
import { getPartRelationships, getPartXml } from '../ooxml/reader.js';
import { CONTENT_TYPE_PPTX_THEME, NS_PML, NS_WML, REL_SLIDE_MASTER } from '../ooxml/namespaces.js';
import { findRelByType, resolveTarget } from '../ooxml/readUtils.js';
import type { OoxmlTheme } from '../ooxml/themeReader.js';
import { parseThemeXml, readThemePart } from '../ooxml/themeReader.js';
import type { ExtractedFileTheme, SchemeSlot } from './types.js';

const DEFAULT_COLOR_MAP: { bg1: SchemeSlot; tx1: SchemeSlot } = { bg1: 'lt1', tx1: 'dk1' };

const SCHEME_SLOTS: readonly SchemeSlot[] = ['dk1', 'lt1', 'dk2', 'lt2'];

function asSchemeSlot(value: string | null | undefined): SchemeSlot | undefined {
  return SCHEME_SLOTS.includes(value as SchemeSlot) ? (value as SchemeSlot) : undefined;
}

/**
 * Fallback theme lookup for packages whose theme relationship is missing or
 * unconventional: scan `[Content_Types].xml` overrides for the theme content
 * type (shared by all three formats) and parse the first match.
 */
async function readThemeByContentType(pkg: OoxmlPackage): Promise<OoxmlTheme | null> {
  for (const [partPath, contentType] of pkg.contentTypes.overrides) {
    if (contentType !== CONTENT_TYPE_PPTX_THEME) continue;
    const doc = await getPartXml(pkg, partPath);
    if (doc) return parseThemeXml(doc);
  }
  return null;
}

function toExtracted(
  sourceFormat: ExtractedFileTheme['sourceFormat'],
  theme: OoxmlTheme,
  colorMap: { bg1: SchemeSlot; tx1: SchemeSlot },
  extraWarnings: string[] = [],
): ExtractedFileTheme {
  return {
    sourceFormat,
    ...(theme.name ? { themeName: theme.name } : {}),
    ...(theme.colors ? { colors: theme.colors } : {}),
    colorMap,
    ...(theme.fonts ? { fonts: theme.fonts } : {}),
    warnings: [...theme.warnings, ...extraWarnings],
  };
}

/**
 * DOCX: theme hangs off `word/document.xml`; an optional
 * `w:clrSchemeMapping` in `word/settings.xml` remaps bg1/t1 slots
 * (values `light1`/`dark1`/`light2`/`dark2`).
 */
export async function extractDocxTheme(pkg: OoxmlPackage): Promise<ExtractedFileTheme | null> {
  const theme =
    (await readThemePart(pkg, 'word/document.xml')) ?? (await readThemeByContentType(pkg));
  if (!theme) return null;

  let colorMap = DEFAULT_COLOR_MAP;
  const settings = await getPartXml(pkg, 'word/settings.xml');
  const mappingEls = settings?.getElementsByTagNameNS(NS_WML, 'clrSchemeMapping');
  const mapping = mappingEls && mappingEls.length > 0 ? mappingEls[0]! : null;
  if (mapping) {
    const wordSlotToScheme: Record<string, SchemeSlot> = {
      light1: 'lt1',
      dark1: 'dk1',
      light2: 'lt2',
      dark2: 'dk2',
    };
    const bg1 =
      wordSlotToScheme[
        mapping.getAttributeNS(NS_WML, 'bg1') ?? mapping.getAttribute('w:bg1') ?? ''
      ];
    const tx1 =
      wordSlotToScheme[mapping.getAttributeNS(NS_WML, 't1') ?? mapping.getAttribute('w:t1') ?? ''];
    if (bg1 && tx1) colorMap = { bg1, tx1 };
  }

  return toExtracted('docx', theme, colorMap);
}

/**
 * PPTX: theme hangs off the first slide master, whose `<p:clrMap>` records
 * which scheme slots back the deck's background/text (dark decks set
 * `bg1="dk1" tx1="lt1"`).
 */
export async function extractPptxTheme(pkg: OoxmlPackage): Promise<ExtractedFileTheme | null> {
  const presRels = await getPartRelationships(pkg, 'ppt/presentation.xml');
  const masterRel = findRelByType(presRels, REL_SLIDE_MASTER);
  const masterPath = masterRel ? resolveTarget('ppt', masterRel.target) : undefined;

  const warnings: string[] = [];
  let theme: OoxmlTheme | null = null;
  let colorMap = DEFAULT_COLOR_MAP;

  if (masterPath) {
    theme = await readThemePart(pkg, masterPath);
    const masterDoc = await getPartXml(pkg, masterPath);
    const clrMaps = masterDoc?.getElementsByTagNameNS(NS_PML, 'clrMap');
    const clrMap = clrMaps && clrMaps.length > 0 ? clrMaps[0]! : null;
    if (clrMap) {
      const bg1 = asSchemeSlot(clrMap.getAttribute('bg1'));
      const tx1 = asSchemeSlot(clrMap.getAttribute('tx1'));
      if (bg1 && tx1) {
        colorMap = { bg1, tx1 };
      } else if (clrMap.getAttribute('bg1') || clrMap.getAttribute('tx1')) {
        warnings.push('theme: unsupported clrMap slot mapping; using default bg1/tx1');
      }
    }
  }
  if (!theme) theme = await readThemeByContentType(pkg);
  if (!theme) return null;

  return toExtracted('pptx', theme, colorMap, warnings);
}

/** XLSX: theme hangs off `xl/workbook.xml`; no color remapping exists. */
export async function extractXlsxTheme(pkg: OoxmlPackage): Promise<ExtractedFileTheme | null> {
  const theme =
    (await readThemePart(pkg, 'xl/workbook.xml')) ?? (await readThemeByContentType(pkg));
  if (!theme) return null;
  return toExtracted('xlsx', theme, DEFAULT_COLOR_MAP);
}
