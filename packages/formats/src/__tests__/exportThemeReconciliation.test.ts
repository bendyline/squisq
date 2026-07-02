/**
 * Export theme reconciliation.
 *
 * Every export format must honor the theme the document selects in its
 * frontmatter (`squisq-theme`) — including an inline custom theme stored in
 * `squisq-custom-themes` — without an explicit `themeId` option. This guards
 * the fix that made PDF/EPUB read the frontmatter theme like PPTX/DOCX/HTML,
 * and that custom themes resolve doc-scoped in exports (no global register).
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { compileTheme } from '@bendyline/squisq/schemas';
import { writeCustomThemesToFrontmatter } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPptx } from '../pptx/export';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToPdf } from '../pdf/export';
import { markdownDocToEpub } from '../epub/export';
import { markdownDocToPlainHtml } from '../html/plainHtml';

const brand = compileTheme({
  id: 'custom-brand',
  name: 'Brand',
  seedColors: { primary: '#ff0088', background: '#123456', text: '#abcdef' },
});

const withTheme = parseMarkdown(`---
title: Audit
squisq-theme: custom-brand
squisq-custom-themes: ${writeCustomThemesToFrontmatter([brand])}
---

# Heading One

Body with a [link](https://example.com).
`);

const noTheme = parseMarkdown('# Heading One\n\nBody.\n');

/** Concatenate the text of every XML/CSS/HTML entry in a ZIP export. */
async function zipText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  let text = '';
  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|css|html|xhtml|rels)$/i.test(name)) {
      text += await zip.files[name].async('string');
    }
  }
  return text.toLowerCase();
}

describe('export theme reconciliation (frontmatter-only custom theme)', () => {
  it('HTML applies the frontmatter custom theme colors', () => {
    const html = markdownDocToPlainHtml(withTheme, {}).toLowerCase();
    expect(html).toContain('123456'); // background
    expect(html).toContain('abcdef'); // text
  });

  it('PPTX applies the frontmatter custom theme colors', async () => {
    const text = await zipText(await markdownDocToPptx(withTheme, {}));
    expect(text).toContain('123456');
  });

  it('DOCX applies the frontmatter custom theme colors', async () => {
    const text = await zipText(await markdownDocToDocx(withTheme, {}));
    expect(text).toContain('123456');
  });

  it('EPUB applies the frontmatter custom theme colors (frontmatter fallback)', async () => {
    const text = await zipText(await markdownDocToEpub(withTheme, {}));
    expect(text).toContain('123456');
  });

  it('PDF themes from frontmatter — themed output differs from un-themed', async () => {
    const themed = new Uint8Array(await markdownDocToPdf(withTheme, {}));
    const plain = new Uint8Array(await markdownDocToPdf(noTheme, {}));
    const differs = themed.length !== plain.length || !themed.every((b, i) => b === plain[i]);
    expect(differs).toBe(true);
  });

  it('an explicit themeId option still overrides the frontmatter theme', async () => {
    const bare = await zipText(await markdownDocToPptx(withTheme, { themeId: 'standard' }));
    // The custom background must NOT appear when the caller forces 'standard'.
    expect(bare).not.toContain('123456');
  });
});
