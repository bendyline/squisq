/**
 * GFM footnotes across the converters.
 *
 * Core parses `[^1]` / `[^1]: …` and DOCX has always mapped them to real Word
 * footnotes, but the HTML-family exporters rendered a reference as NOTHING and
 * left the definition as an unmarked stray paragraph (EPUB dropped both), so a
 * document's footnote markers vanished on the way out. Import had the mirror
 * gap: a page's footnote section came in as an unrelated trailing list.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPlainHtml } from '../html/plainHtml';
import { htmlToMarkdown, htmlToMarkdownDocSync } from '../html/import';
import { markdownDocToEpub } from '../epub/index';
import { markdownDocToDocx, docxToMarkdownDoc } from '../docx/index';
import { markdownDocToPdf } from '../pdf/index';

/** Newline, spelled out so these expectations read as literal source. */
const NL = '\n';

const CITED_TWICE =
  'Fresh[^1] and juice[^2].\n\nProse citing[^1] again.\n\n[^1]: USDA, ARS.\n[^2]: Refrigerated juice.\n';

function body(html: string): string {
  return html.slice(html.indexOf('<body'), html.indexOf('</body>'));
}

describe('static HTML export', () => {
  const html = body(markdownDocToPlainHtml(parseMarkdown(CITED_TWICE)));

  it('numbers references by order of first citation', () => {
    expect(html).toContain('<a href="#fn-1" id="fnref-1">1</a>');
    expect(html).toContain('<a href="#fn-2" id="fnref-2">2</a>');
  });

  it('gives a repeat citation its own element id', () => {
    // Reusing `fnref-1` would emit duplicate ids — invalid HTML, and the
    // backlink would return to whichever copy the browser found first.
    expect(html).toContain('<a href="#fn-1" id="fnref-1-2">1</a>');
  });

  it('collects the definitions into a trailing section', () => {
    const section = html.slice(html.indexOf('<section class="squisq-footnotes"'));
    expect(section).toContain('<li id="fn-1">');
    expect(section).toContain('USDA, ARS.');
    // One backlink per citation.
    expect(section).toContain('href="#fnref-1"');
    expect(section).toContain('href="#fnref-1-2"');
  });

  it('does not leave the definition inline where it was written', () => {
    const beforeSection = html.slice(0, html.indexOf('<section class="squisq-footnotes"'));
    expect(beforeSection).not.toContain('USDA, ARS.');
  });

  it('emits nothing extra for a document with no footnotes', () => {
    expect(body(markdownDocToPlainHtml(parseMarkdown('Plain prose.')))).not.toContain(
      'squisq-footnotes',
    );
  });

  it('keeps a definition that nothing cites', () => {
    // GFM's renderer drops it; a CONVERTER must not, or content whose marker was
    // lost upstream disappears entirely.
    const orphan = markdownDocToPlainHtml(parseMarkdown('Prose.\n\n[^a]: Orphaned note.\n'));
    expect(orphan).toContain('Orphaned note.');
  });
});

describe('EPUB export', () => {
  it('renders references and a footnotes aside', async () => {
    const zip = await JSZip.loadAsync(
      await markdownDocToEpub(parseMarkdown(`# Ch\n\n${CITED_TWICE}`)),
    );
    const names = Object.keys(zip.files).filter((f) => f.endsWith('.xhtml'));
    let chapter = '';
    for (const name of names) {
      const text = await zip.file(name)!.async('string');
      if (text.includes('Fresh')) chapter = text;
    }
    expect(chapter).toContain('epub:type="noteref"');
    expect(chapter).toContain('epub:type="footnotes"');
    expect(chapter).toContain('USDA, ARS.');
    expect(chapter).toContain('id="fnref-1-2"');
  });
});

describe('HTML import', () => {
  it('recovers GitHub-shaped footnotes', () => {
    const html =
      '<p>Fresh<sup class="footnote-ref"><a href="#user-content-fn-1" data-footnote-ref>1</a></sup>.</p>' +
      '<section data-footnotes class="footnotes"><ol>' +
      '<li id="user-content-fn-1"><p>USDA, ARS. <a href="#user-content-fnref-1" data-footnote-backref>↩</a></p></li>' +
      '</ol></section>';
    // Identifiers are shortened from the generator's boilerplate, the backlink
    // is dropped, and no trailing `&#x20;` is left where it was.
    expect(htmlToMarkdown(html).trim()).toBe('Fresh[^1].\n\n[^1]: USDA, ARS.');
  });

  it('recovers a plain `class="footnotes"` section', () => {
    const html =
      '<p>Price<sup><a href="#fn1">1</a></sup>.</p>' +
      '<section class="footnotes"><ol><li id="fn1">Retail average. <a href="#fnref1">↩</a></li></ol></section>';
    expect(htmlToMarkdown(html).trim()).toBe('Price[^1].\n\n[^1]: Retail average.');
  });

  it('leaves a superscript link alone when the page marks no footnotes section', () => {
    // A superscript link is far more often a cross-reference than a note, so
    // the marked container is the trigger — never the marker shape alone.
    const html = '<p>See<sup><a href="#x">1</a></sup>.</p><p id="x">Elsewhere</p>';
    expect(htmlToMarkdown(html)).toContain('<sup>[1](#x)</sup>');
  });

  it('leaves an ordinary prose link to a footnote as a link', () => {
    const html =
      '<p>As noted <a href="#fn1">in the methodology note</a>.</p>' +
      '<section class="footnotes"><ol><li id="fn1">Method.</li></ol></section>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('[in the methodology note](#fn1)');
    // The definition is still lifted out — its content must not be lost. What
    // must NOT happen is the prose link itself becoming a marker.
    expect(md.split('\n')[0]).not.toContain('[^');
  });

  it('does not also import the definitions as a trailing list', () => {
    const html =
      '<p>A<sup><a href="#fn1">1</a></sup></p>' +
      '<section class="footnotes"><ol><li id="fn1">Note.</li></ol></section>';
    expect(htmlToMarkdown(html)).not.toMatch(/^\s*1\. /m);
  });
});

describe('HTML → DOCX', () => {
  it('turns a page’s footnotes into real Word footnotes', async () => {
    const html =
      '<p>Fresh<sup><a href="#fn1">1</a></sup>.</p>' +
      '<section class="footnotes"><ol><li id="fn1">USDA, ARS.</li></ol></section>';
    const zip = await JSZip.loadAsync(await markdownDocToDocx(htmlToMarkdownDocSync(html)));
    const document = await zip.file('word/document.xml')!.async('string');
    const footnotes = await zip.file('word/footnotes.xml')?.async('string');
    expect(document).toContain('w:footnoteReference');
    expect(footnotes).toContain('USDA, ARS.');
  });
});

describe('round-trip', () => {
  it('survives markdown → HTML → markdown', () => {
    // Our own exported section must be recognized by our own importer — it
    // carries `data-footnotes` for exactly that reason.
    const html = markdownDocToPlainHtml(parseMarkdown('Fresh[^1].\n\n[^1]: USDA, ARS.\n'));
    const back = stringifyMarkdown(htmlToMarkdownDocSync(html));
    expect(back).toContain('Fresh[^1].');
    expect(back).toContain('[^1]: USDA, ARS.');
  });
});

describe('document round-trips (footnotes stay footnotes)', () => {
  const SOURCE =
    'Fresh[^1] and juice[^2].' +
    NL +
    NL +
    'Citing[^1] again.' +
    NL +
    NL +
    '[^1]: USDA, ARS.' +
    NL +
    NL +
    '[^2]: Refrigerated.' +
    NL;

  it('markdown → DOCX → markdown keeps the labels the author typed', async () => {
    // Word numbers its notes and has no labels, so the importer used to invent
    // `fn1`/`endnote2` and leak them into the markdown. Renumbering by
    // reference order lands back on exactly what went in.
    const back = await docxToMarkdownDoc(await markdownDocToDocx(parseMarkdown(SOURCE)));
    expect(stringifyMarkdown(back)).toBe(SOURCE);
  });

  it('is a fixpoint after the first pass', async () => {
    let doc = parseMarkdown(SOURCE);
    for (let i = 0; i < 3; i++) doc = await docxToMarkdownDoc(await markdownDocToDocx(doc));
    expect(stringifyMarkdown(doc)).toBe(SOURCE);
  });

  it('renumbers source labels that Word cannot carry', async () => {
    // A named `[^note]` has nowhere to live in a DOCX, so it comes back as a
    // number rather than as a mangled invention.
    const named = 'A[^note].' + NL + NL + '[^note]: Body.' + NL;
    const back = await docxToMarkdownDoc(await markdownDocToDocx(parseMarkdown(named)));
    expect(stringifyMarkdown(back)).toBe('A[^1].' + NL + NL + '[^1]: Body.' + NL);
  });

  it('carries DOCX footnotes on to HTML', async () => {
    const viaDocx = await docxToMarkdownDoc(await markdownDocToDocx(parseMarkdown(SOURCE)));
    const html = markdownDocToPlainHtml(viaDocx);
    expect(html).toContain('<section class="squisq-footnotes"');
    expect(html).toContain('USDA, ARS.');
    expect(html).toContain('id="fnref-1-2"');
  });

  it('carries DOCX footnotes on to EPUB', async () => {
    const viaDocx = await docxToMarkdownDoc(await markdownDocToDocx(parseMarkdown(SOURCE)));
    const zip = await JSZip.loadAsync(await markdownDocToEpub(viaDocx));
    const names = Object.keys(zip.files).filter((f) => f.endsWith('.xhtml'));
    const texts = await Promise.all(names.map((n) => zip.file(n)!.async('string')));
    expect(texts.some((t) => t.includes('epub:type="footnotes"'))).toBe(true);
  });
});

describe('PDF export', () => {
  it('numbers markers rather than printing the raw identifier', async () => {
    // Identifiers may be arbitrary labels; the reader must see 1, 2, 3.
    const bytes = await markdownDocToPdf(
      parseMarkdown(
        'A[^alpha] B[^beta].' + NL + NL + '[^alpha]: One.' + NL + NL + '[^beta]: Two.' + NL,
      ),
    );
    const text = new TextDecoder('latin1').decode(new Uint8Array(bytes));
    expect(text).not.toContain('[alpha]');
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
