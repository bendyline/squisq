/**
 * OOXML theme color normalization (regression).
 *
 * `ST_HexColorRGB` — the type behind `<w:color w:val>`, `<w:shd w:fill>` and
 * `<a:srgbClr val>` — is EXACTLY six hex digits. Office does not degrade
 * gracefully on a violation; it shows a "repair this file?" prompt. Two inputs
 * reach the exporters without being 6-digit hex:
 *
 * 1. `themeValidator` deliberately accepts `#rgb` shorthand, so an entirely
 *    VALID custom theme can carry `#fff`.
 * 2. `ThemeRegistry` is a public interface and `resolveTheme` returns whatever
 *    `registry.get(id)` yields, unvalidated — so a host-owned registry can
 *    hand the exporter an arbitrary string, which used to be interpolated
 *    straight into an XML attribute.
 *
 * These tests parse the ACTUAL emitted XML and assert on the attribute values.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { Theme, ThemeRegistry } from '@bendyline/squisq/schemas';
import { compileTheme } from '@bendyline/squisq/schemas';
import { writeCustomThemesToFrontmatter } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToPptx } from '../pptx/export';

const MARKDOWN = `# Heading One

Body text with \`code\` in it.

> A quote.
`;

/** Concatenated text of every XML part in a package. */
async function allXmlText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  let all = '';
  for (const name of Object.keys(zip.files)) {
    if (/\.xml$/i.test(name)) all += await zip.files[name]!.async('string');
  }
  return all;
}

/** Every hex color attribute value emitted anywhere in a ZIP's XML parts. */
async function colorAttrValues(buf: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const values: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!/\.xml$/i.test(name)) continue;
    const text = await zip.files[name]!.async('string');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    expect(xml.querySelector('parsererror')).toBeNull();

    // DrawingML: <a:srgbClr val="RRGGBB"/>
    for (const el of xml.getElementsByTagName('a:srgbClr')) {
      const val = el.getAttribute('val');
      if (val !== null) values.push(val);
    }
    // WordprocessingML: <w:color w:val>, <w:shd w:fill>
    for (const tag of ['w:color', 'w:shd']) {
      for (const el of xml.getElementsByTagName(tag)) {
        for (const attr of ['w:val', 'w:fill', 'w:color']) {
          const val = el.getAttribute(attr);
          // `auto`/`none` are legal ST_HexColorAuto keywords, not RGB values.
          if (val !== null && val !== 'auto' && val !== 'none') values.push(val);
        }
      }
    }
  }
  return values;
}

function docWithTheme(theme: Theme) {
  return parseMarkdown(
    `---\nsquisq-theme: ${theme.id}\nsquisq-custom-themes: ${writeCustomThemesToFrontmatter([theme])}\n---\n\n${MARKDOWN}`,
  );
}

/**
 * A caller-owned registry that hands back a theme verbatim. This is the
 * unvalidated path: `ThemeRegistry` is an interface, so a host is free to
 * implement it without `createThemeRegistry`'s validation.
 */
function rawRegistry(theme: Theme): ThemeRegistry {
  return {
    register: () => undefined,
    unregister: () => false,
    get: (id) => (id === theme.id ? theme : undefined),
    list: () => [theme],
  };
}

describe('OOXML color normalization — #rgb shorthand (regression)', () => {
  // themeValidator accepts this, so it is a legitimate custom theme.
  const shorthand = compileTheme({
    id: 'shorthand-theme',
    name: 'Shorthand',
    seedColors: { primary: '#fff', background: '#000', text: '#f0c' },
  });

  it('DOCX emits only 6-digit hex colors for a #rgb theme', async () => {
    const values = await colorAttrValues(await markdownDocToDocx(docWithTheme(shorthand)));
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatch(/^[0-9A-Fa-f]{6}$/);
  });

  it('PPTX emits only 6-digit hex colors for a #rgb theme', async () => {
    const values = await colorAttrValues(await markdownDocToPptx(docWithTheme(shorthand)));
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatch(/^[0-9A-Fa-f]{6}$/);
  });

  it('expands the shorthand to the equivalent 6-digit color rather than dropping it', async () => {
    const values = await colorAttrValues(await markdownDocToPptx(docWithTheme(shorthand)));
    // #f0c must round-trip as FF00CC somewhere in the deck, not as `f0c`.
    expect(values.map((v) => v.toUpperCase())).toContain('FF00CC');
    expect(values).not.toContain('f0c');
  });
});

describe('OOXML color normalization — hostile color strings (regression)', () => {
  // A host-supplied registry bypasses validation entirely, so `colors` can
  // hold anything. Build it off a valid theme so only the color is hostile.
  const base = compileTheme({ id: 'hostile-theme', name: 'Hostile' });
  const hostile: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: '"/><w:evil attr="pwned',
      text: '#fff" onload="alert(1)',
      textMuted: 'rgb(1,2,3)',
      highlight: 'not a color at all',
    },
  };
  const options = { themeId: hostile.id, themeRegistry: rawRegistry(hostile) };

  it('DOCX cannot be broken out of an attribute by a hostile color', async () => {
    const buf = await markdownDocToDocx(parseMarkdown(MARKDOWN), options);
    const values = await colorAttrValues(buf);
    for (const value of values) expect(value).toMatch(/^[0-9A-Fa-f]{6}$/);

    // Scan EVERY part, not just document.xml: the theme colors land in
    // styles.xml, and the injected markup is itself well-formed — so it
    // parses cleanly and only an explicit content check catches it.
    const all = await allXmlText(buf);
    expect(all).not.toContain('w:evil');
    expect(all).not.toContain('onload');
  });

  it('PPTX cannot be broken out of an attribute by a hostile color', async () => {
    const buf = await markdownDocToPptx(parseMarkdown(MARKDOWN), options);
    const values = await colorAttrValues(buf);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatch(/^[0-9A-Fa-f]{6}$/);

    const all = await allXmlText(buf);
    expect(all).not.toContain('w:evil');
    expect(all).not.toContain('onload');
    expect(all).not.toContain('rgb(1,2,3)');
  });
});
