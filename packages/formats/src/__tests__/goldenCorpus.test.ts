import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import {
  csvToMarkdownDoc,
  docxToMarkdownDoc,
  htmlToMarkdownDoc,
  markdownDocToEpub,
  pdfToMarkdownDoc,
  pptxToMarkdownDoc,
  xlsxToMarkdownDoc,
} from '../index';
import {
  buildIndependentDocx,
  buildIndependentPdf,
  buildIndependentPptx,
  buildIndependentXlsx,
} from './goldenCorpus.fixtures';

interface ImportExpectation {
  producer: string;
  phrases: string[];
  nodeTypes: string[];
}

interface EpubExpectation {
  producer: string;
  phrases: string[];
  entries: string[];
}

interface GoldenManifest {
  docx: ImportExpectation;
  pptx: ImportExpectation;
  xlsx: ImportExpectation;
  pdf: ImportExpectation;
  html: ImportExpectation;
  csv: ImportExpectation;
  epub: EpubExpectation;
}

const fixturePath = (name: string) =>
  resolve(process.cwd(), 'packages', 'formats', 'testdata', 'golden', name);

async function manifest(): Promise<GoldenManifest> {
  return JSON.parse(await readFile(fixturePath('manifest.json'), 'utf8')) as GoldenManifest;
}

function semanticFingerprint(doc: MarkdownDocument): { text: string; nodeTypes: Set<string> } {
  const text: string[] = [];
  const nodeTypes = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: unknown; value?: unknown; url?: unknown; children?: unknown };
    if (typeof node.type === 'string') nodeTypes.add(node.type);
    if (typeof node.value === 'string') text.push(node.value);
    if (typeof node.url === 'string') text.push(node.url);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(doc);
  return { text: text.join(' ').replace(/\s+/g, ' ').trim(), nodeTypes };
}

function assertSemantics(doc: MarkdownDocument, expected: ImportExpectation): void {
  const actual = semanticFingerprint(doc);
  for (const phrase of expected.phrases) {
    expect(actual.text.toLocaleLowerCase()).toContain(phrase.toLocaleLowerCase());
  }
  for (const nodeType of expected.nodeTypes) expect(actual.nodeTypes.has(nodeType)).toBe(true);
}

describe('independent format golden corpus', () => {
  it('imports independently assembled Word content', async () => {
    assertSemantics(await docxToMarkdownDoc(await buildIndependentDocx()), (await manifest()).docx);
  });

  it('imports independently assembled PowerPoint content', async () => {
    assertSemantics(
      await pptxToMarkdownDoc(await buildIndependentPptx(), {
        inferTheme: false,
        inferLayouts: false,
      }),
      (await manifest()).pptx,
    );
  });

  it('imports independently assembled Excel content with display formatting', async () => {
    assertSemantics(await xlsxToMarkdownDoc(await buildIndependentXlsx()), (await manifest()).xlsx);
  });

  it('imports a PDF generated outside the Squisq PDF exporter', async () => {
    assertSemantics(
      await pdfToMarkdownDoc(await buildIndependentPdf(), { bodyFontSize: 12 }),
      (await manifest()).pdf,
    );
  });

  it('imports hand-authored hostile semantic HTML', async () => {
    const html = await readFile(fixturePath('interop.html'), 'utf8');
    const doc = await htmlToMarkdownDoc(html);
    assertSemantics(doc, (await manifest()).html);
    expect(semanticFingerprint(doc).text).not.toContain('fixtureMustNotRun');
  });

  it('imports RFC 4180 CSV with BOM, Unicode, commas, and multiline fields', async () => {
    const csv = await readFile(fixturePath('interop.csv'), 'utf8');
    assertSemantics(await csvToMarkdownDoc(csv), (await manifest()).csv);
  });

  it('exports an EPUB 3 package matching the semantic golden contract', async () => {
    const source: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'Quarterly field report' }],
        },
        { type: 'paragraph', children: [{ type: 'text', value: 'Measured twice' }] },
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'Second chapter' }],
        },
        { type: 'paragraph', children: [{ type: 'text', value: 'Closing notes' }] },
      ],
    };
    const expected = (await manifest()).epub;
    const zip = await JSZip.loadAsync(await markdownDocToEpub(source, { title: 'Field report' }));
    for (const entry of expected.entries) expect(zip.file(entry)).toBeTruthy();
    const chapterText = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((path) => /OEBPS\/chapters\/chapter-\d+\.xhtml$/.test(path))
          .sort()
          .map((path) => zip.file(path)!.async('string')),
      )
    ).join(' ');
    for (const phrase of expected.phrases) expect(chapterText).toContain(phrase);
  });
});
