/**
 * Shared types for file-import theme inference.
 */

import type { OoxmlColorScheme, OoxmlFontScheme } from '../ooxml/themeReader.js';

/** Source formats theme inference supports. PDF carries no theme tables. */
export type InferSourceFormat = 'docx' | 'pptx' | 'xlsx';

/** The four surface/text scheme slots a color map can point at. */
export type SchemeSlot = 'dk1' | 'lt1' | 'dk2' | 'lt2';

/**
 * Raw theme extraction from one office file, before mapping onto a Squisq
 * `Theme`. `colorMap` records which scheme slots back the document's
 * background/text — PPTX masters carry `<p:clrMap bg1=… tx1=…>` and DOCX may
 * carry `w:clrSchemeMapping`; dark decks map `bg1="dk1"` and invert here.
 */
export interface ExtractedFileTheme {
  sourceFormat: InferSourceFormat;
  /** `a:theme@name` when present (e.g. "Office Theme", "Ion"). */
  themeName?: string;
  colors?: OoxmlColorScheme;
  colorMap: { bg1: SchemeSlot; tx1: SchemeSlot };
  fonts?: OoxmlFontScheme;
  warnings: string[];
}
