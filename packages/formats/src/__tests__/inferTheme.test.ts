/**
 * Tests for `inferThemeFromFile`: format sniffing, per-format extraction
 * (incl. dark-deck clrMap inversion), theme compilation, and error paths.
 */

import { describe, expect, it } from 'vitest';
import { ConversionError } from '../registry/errors';
import { inferThemeFromFile } from '../infer/index';
import {
  buildThemeXml,
  buildThemedDocx,
  buildThemedPptx,
  buildThemedXlsx,
} from './pptxInferFixtures';

describe('inferThemeFromFile — PPTX', () => {
  it('maps a light deck onto seeds, palette, schemes, and fonts', async () => {
    const data = await buildThemedPptx();
    const result = await inferThemeFromFile(data);

    expect(result.extraction.sourceFormat).toBe('pptx');
    expect(result.extraction.colorMap).toEqual({ bg1: 'lt1', tx1: 'dk1' });

    const { theme } = result;
    expect(theme.seedColors).toMatchObject({
      primary: '#4472c4',
      secondary: '#ed7d31',
      accent: '#a5a5a5',
      background: '#fdfdf8',
      text: '#1a1a2e',
    });
    expect(theme.colors.background).toBe('#fdfdf8');
    expect(theme.colors.text).toBe('#1a1a2e');
    // Companion slot (lt2) becomes backgroundLight; hlink becomes highlight.
    expect(theme.colors.backgroundLight).toBe('#efefe4');
    expect(theme.colors.highlight).toBe('#0563c1');
    // Six accents → six color schemes keyed by slot.
    expect(Object.keys(theme.colorSchemes)).toEqual([
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
    ]);
    // Fonts: curated stack match + custom preservation.
    expect(theme.typography.titleFont).toEqual({ stackId: 'playfair' });
    expect(theme.typography.bodyFont).toEqual({
      custom: { name: 'Aptos', fallback: 'sans-serif' },
    });
    // Compiled + validated, named from the theme part, re-editable via seeds.
    expect(theme.name).toBe('Fixture Theme');
    expect(theme.id).toBe('custom-fixture-theme');
  });

  it('inverts background/text for a dark deck (clrMap bg1="dk1")', async () => {
    const data = await buildThemedPptx({
      clrMapAttrs: 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
    });
    const result = await inferThemeFromFile(data);
    expect(result.theme.seedColors?.background).toBe('#1a1a2e');
    expect(result.theme.seedColors?.text).toBe('#fdfdf8');
    // Dark companion slot backs backgroundLight.
    expect(result.theme.colors.backgroundLight).toBe('#30304a');
  });

  it('respects a nameHint over the file theme name', async () => {
    const result = await inferThemeFromFile(await buildThemedPptx(), { nameHint: 'Q3 Deck' });
    expect(result.theme.name).toBe('Q3 Deck');
    expect(result.theme.id).toBe('custom-q3-deck');
  });

  it('throws invalid-input when the file has no theme part', async () => {
    const data = await buildThemedPptx({ themeXml: null });
    await expect(inferThemeFromFile(data)).rejects.toMatchObject({
      name: 'ConversionError',
      code: 'invalid-input',
    });
  });
});

describe('inferThemeFromFile — DOCX / XLSX', () => {
  it('extracts from a DOCX theme part', async () => {
    const result = await inferThemeFromFile(await buildThemedDocx());
    expect(result.extraction.sourceFormat).toBe('docx');
    expect(result.theme.seedColors?.primary).toBe('#4472c4');
    expect(result.theme.colors.background).toBe('#fdfdf8');
  });

  it('extracts from an XLSX theme part', async () => {
    const result = await inferThemeFromFile(await buildThemedXlsx());
    expect(result.extraction.sourceFormat).toBe('xlsx');
    expect(result.theme.seedColors?.primary).toBe('#4472c4');
  });

  it('ignores inferLayouts for non-PPTX sources with a warning', async () => {
    const result = await inferThemeFromFile(await buildThemedDocx(), { inferLayouts: true });
    expect(result.layouts).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('PowerPoint'))).toBe(true);
  });
});

describe('inferThemeFromFile — rejection paths', () => {
  it('rejects PDF bytes with unsupported-input', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 fake').buffer as ArrayBuffer;
    await expect(inferThemeFromFile(pdf)).rejects.toMatchObject({
      code: 'unsupported-input',
    });
  });

  it('rejects non-zip bytes with invalid-input', async () => {
    const junk = new TextEncoder().encode('definitely not a zip').buffer as ArrayBuffer;
    const err = await inferThemeFromFile(junk).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConversionError);
    expect((err as ConversionError).code).toBe('invalid-input');
  });
});

describe('inferThemeFromFile — degraded themes', () => {
  it('drops near-background accents from the scheme list with a warning', async () => {
    // accent2 equals the background color — should be dropped from schemes.
    const themeXml = buildThemeXml({ accents: ['4472c4', 'fdfdf8', 'a5a5a5'] });
    const result = await inferThemeFromFile(await buildThemedPptx({ themeXml }));
    expect(Object.keys(result.theme.colorSchemes)).toEqual(['accent1', 'accent3']);
    expect(result.warnings.some((w) => w.includes('accent2'))).toBe(true);
  });

  it('keeps fonts inherited when the theme has no fontScheme', async () => {
    const themeXml = buildThemeXml({ omitFontScheme: true });
    const result = await inferThemeFromFile(await buildThemedPptx({ themeXml }));
    // STARTER defaults survive.
    expect(result.theme.typography.titleFont).toEqual({ stackId: 'system-serif' });
    expect(result.warnings.some((w) => w.includes('fontScheme'))).toBe(true);
  });
});
