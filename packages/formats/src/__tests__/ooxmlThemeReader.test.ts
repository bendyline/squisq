/**
 * Tests for the shared OOXML theme reader: clrScheme slot resolution
 * (srgbClr / sysClr / fallbacks) and fontScheme parsing.
 */

import { describe, expect, it } from 'vitest';
import { NS_DRAWINGML } from '../ooxml/namespaces';
import { parseThemeXml } from '../ooxml/themeReader';
import { buildThemeXml } from './pptxInferFixtures';

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

describe('parseThemeXml', () => {
  it('reads srgbClr slots, theme name, and latin fonts', () => {
    const theme = parseThemeXml(parse(buildThemeXml({ name: 'Ion' })));
    expect(theme.name).toBe('Ion');
    expect(theme.colors).toMatchObject({
      dk1: '#1a1a2e',
      lt1: '#fdfdf8',
      dk2: '#30304a',
      lt2: '#efefe4',
      accent1: '#4472c4',
      accent6: '#70ad47',
      hlink: '#0563c1',
    });
    expect(theme.fonts).toEqual({ majorLatin: 'Playfair Display', minorLatin: 'Aptos' });
  });

  it('prefers sysClr lastClr when present', () => {
    const xml = buildThemeXml({
      dk1: '<a:sysClr val="windowText" lastClr="0B0B0B"/>',
      lt1: '<a:sysClr val="window" lastClr="FAFAFA"/>',
    });
    const theme = parseThemeXml(parse(xml));
    expect(theme.colors?.dk1).toBe('#0b0b0b');
    expect(theme.colors?.lt1).toBe('#fafafa');
  });

  it('resolves windowText/window sysClr without lastClr', () => {
    const xml = buildThemeXml({
      dk1: '<a:sysClr val="windowText"/>',
      lt1: '<a:sysClr val="window"/>',
    });
    const theme = parseThemeXml(parse(xml));
    expect(theme.colors?.dk1).toBe('#000000');
    expect(theme.colors?.lt1).toBe('#ffffff');
  });

  it('falls back with a warning for unknown sysClr values', () => {
    const xml = buildThemeXml({ dk1: '<a:sysClr val="btnFace"/>' });
    const theme = parseThemeXml(parse(xml));
    expect(theme.colors?.dk1).toBe('#000000');
    expect(theme.warnings.some((w) => w.includes('dk1'))).toBe(true);
  });

  it('drops unresolvable accent slots with warnings', () => {
    // accent list of 2 → accent3..6 slots missing entirely.
    const xml = buildThemeXml({ accents: ['112233', '445566'] });
    const theme = parseThemeXml(parse(xml));
    expect(theme.colors?.accent1).toBe('#112233');
    expect(theme.colors?.accent2).toBe('#445566');
    expect(theme.colors?.accent3).toBeUndefined();
    expect(theme.warnings.some((w) => w.includes('accent3'))).toBe(true);
  });

  it('handles a missing fontScheme', () => {
    const theme = parseThemeXml(parse(buildThemeXml({ omitFontScheme: true })));
    expect(theme.fonts).toBeUndefined();
    expect(theme.warnings.some((w) => w.includes('fontScheme'))).toBe(true);
  });

  it('treats an empty typeface as absent', () => {
    const xml =
      `<a:theme xmlns:a="${NS_DRAWINGML}" name="T"><a:themeElements>` +
      `<a:fontScheme name="T">` +
      `<a:majorFont><a:latin typeface=""/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="Georgia"/></a:minorFont>` +
      `</a:fontScheme></a:themeElements></a:theme>`;
    const theme = parseThemeXml(parse(xml));
    expect(theme.fonts).toEqual({ minorLatin: 'Georgia' });
    expect(theme.warnings.some((w) => w.includes('majorFont'))).toBe(true);
  });

  it('reports a theme with no clrScheme', () => {
    const xml = `<a:theme xmlns:a="${NS_DRAWINGML}" name="Empty"><a:themeElements/></a:theme>`;
    const theme = parseThemeXml(parse(xml));
    expect(theme.colors).toBeUndefined();
    expect(theme.warnings.some((w) => w.includes('clrScheme'))).toBe(true);
  });
});
