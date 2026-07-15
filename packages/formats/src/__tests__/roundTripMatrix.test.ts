import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { markdownToDoc } from '@bendyline/squisq/doc';

import { markdownDocToDocx } from '../docx/export';
import { docxToMarkdownDoc } from '../docx/import';
import { markdownDocToPptx } from '../pptx/export';
import { pptxToMarkdownDoc } from '../pptx/import';
import { markdownDocToPdf } from '../pdf/export';
import { pdfToMarkdownDoc } from '../pdf/import';
import { markdownDocToCsv, csvToMarkdownDoc } from '../csv/index';
import { markdownDocToEpub } from '../epub/export';
import { docToHtml } from '../html/index';
import { markdownDocToXlsx } from '../xlsx/index';
import { xlsxToMarkdownDoc } from '../xlsx/import';
import { assertHybridRoundTrip, extractNormalizedText } from './roundTripMatrix.helpers';
import { ROUNDTRIP_FIXTURES } from './roundTripMatrix.fixtures';

const MOCK_PLAYER_SCRIPT = 'var SquisqPlayer={mount:function(){}};';

describe('format content-flow matrix', () => {
  it('round-trips markdown through DOCX with hybrid equivalence', async () => {
    const source = ROUNDTRIP_FIXTURES.story;
    const docx = await markdownDocToDocx(source.doc);
    const roundTrip = await docxToMarkdownDoc(docx);

    assertHybridRoundTrip({
      source: source.doc,
      roundTrip,
      keyPhrases: source.keyPhrases,
      headingTexts: source.headingTexts,
      requireHeadingOrder: true,
      requireListSurvival: true,
      minRetainRatio: 0.65,
    });
  });

  it('round-trips markdown through PPTX with hybrid equivalence', async () => {
    const source = ROUNDTRIP_FIXTURES.mixed;
    const pptx = await markdownDocToPptx(source.doc);
    const roundTrip = await pptxToMarkdownDoc(pptx);

    assertHybridRoundTrip({
      source: source.doc,
      roundTrip,
      keyPhrases: source.keyPhrases,
      headingTexts: source.headingTexts,
      requireHeadingOrder: true,
      minRetainRatio: 0.5,
    });
  });

  it('round-trips markdown through PDF with hybrid equivalence', async () => {
    const source = ROUNDTRIP_FIXTURES.mixed;
    const pdf = await markdownDocToPdf(source.doc, { title: 'Ops Weekly' });
    const roundTrip = await pdfToMarkdownDoc(pdf, { bodyFontSize: 11 });

    assertHybridRoundTrip({
      source: source.doc,
      roundTrip,
      keyPhrases: ['ops weekly', 'launch readiness', 'rollback script', 'support tickets declined'],
      minRetainRatio: 0.4,
    });
  });

  it('preserves inter-word spacing when importing a Squisq-exported PDF', async () => {
    const source = ROUNDTRIP_FIXTURES.mixed;
    const roundTrip = await pdfToMarkdownDoc(await markdownDocToPdf(source.doc), {
      bodyFontSize: 11,
    });
    const text = extractNormalizedText(roundTrip);

    expect(text).toContain('ops weekly');
    expect(text).toContain(
      'this week we tracked launch readiness quality signals and risk burn-down',
    );
    expect(text).toContain('launch readiness improved and support tickets declined');
  });

  it('round-trips markdown through CSV for table-centric content', async () => {
    const source = ROUNDTRIP_FIXTURES.table;
    const csv = markdownDocToCsv(source.doc);
    const roundTrip = await csvToMarkdownDoc(csv);

    assertHybridRoundTrip({
      source: source.doc,
      roundTrip,
      keyPhrases: ['throughput', '120 req/s', 'error rate', 'p95'],
      requireTableSurvival: true,
      minRetainRatio: 0.7,
    });
  });

  it('exports markdown to HTML as one-way smoke coverage', async () => {
    const source = ROUNDTRIP_FIXTURES.story;
    const doc = markdownToDoc(source.doc, { articleId: 'matrix-story' });
    const html = docToHtml(doc, {
      playerScript: MOCK_PLAYER_SCRIPT,
      title: 'Matrix Story',
    });

    expect(html).toContain('<!DOCTYPE html>');
    const normalizedHtml = html.toLowerCase();
    expect(normalizedHtml).toContain('river journal');
    expect(normalizedHtml).toContain('north bank');
    expect(normalizedHtml).toContain('full report');
  });

  it('exports markdown to EPUB as one-way smoke coverage', async () => {
    const source = ROUNDTRIP_FIXTURES.story;
    const epub = await markdownDocToEpub(source.doc, {
      title: 'River Journal',
      author: 'Squisq Test',
    });

    const zip = await JSZip.loadAsync(epub);
    expect(zip.file('OEBPS/content.opf')).toBeTruthy();

    const chapter = await zip.file('OEBPS/chapters/chapter-001.xhtml')?.async('string');
    expect(chapter).toBeTruthy();

    const normalized = (chapter ?? '').toLowerCase();
    expect(normalized).toContain('river journal');
    expect(normalized).toContain('north bank');
  });

  it('keeps high-value text through all bidirectional formats', async () => {
    const source = ROUNDTRIP_FIXTURES.story;

    const docxRoundTrip = await docxToMarkdownDoc(await markdownDocToDocx(source.doc));
    const pptxRoundTrip = await pptxToMarkdownDoc(await markdownDocToPptx(source.doc));
    const pdfRoundTrip = await pdfToMarkdownDoc(await markdownDocToPdf(source.doc));
    const csvRoundTrip = await csvToMarkdownDoc(markdownDocToCsv(ROUNDTRIP_FIXTURES.table.doc));

    const docxText = extractNormalizedText(docxRoundTrip);
    const pptxText = extractNormalizedText(pptxRoundTrip);
    const pdfText = extractNormalizedText(pdfRoundTrip);
    const csvText = extractNormalizedText(csvRoundTrip);

    expect(docxText).toContain('river journal');
    expect(pptxText).toContain('river journal');
    expect(pdfText).toContain('river journal');
    expect(csvText).toContain('throughput');
  });

  it('round-trips markdown through XLSX with table cell survival', async () => {
    const source = ROUNDTRIP_FIXTURES.table;
    const xlsx = await markdownDocToXlsx(source.doc);
    const roundTrip = await xlsxToMarkdownDoc(xlsx);

    const text = extractNormalizedText(roundTrip);
    for (const phrase of source.keyPhrases) {
      expect(text).toContain(phrase);
    }
  });
});
