/**
 * Diagrams in document exports.
 *
 * The rasterizer itself needs a browser (see e2e/export-diagrams.spec.ts);
 * these tests use a stand-in renderer and check what each exporter does with
 * the pictures: DOCX, EPUB and PDF get images in place of diagram source,
 * PPTX gets a picture for Mermaid and native shapes for drawings.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  findDiagrams,
  rasterizeDiagrams,
  type DiagramPicture,
  type ExportDiagram,
} from '../diagrams/index';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToEpub } from '../epub/export';
import { markdownDocToPdf } from '../pdf/export';
import { docToPptx } from '../pptx/export';

/** A valid 1×1 PNG, decodable by pdf-lib. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);

const SOURCE = [
  '# Report',
  '',
  'Intro paragraph.',
  '',
  '```mermaid',
  'flowchart LR',
  '  accTitle: Review flow',
  '  accDescr: Draft then publish',
  '  a --> b',
  '```',
  '',
  '- A list item with a nested fence:',
  '',
  '  ```timeline',
  '  Milestones: ● 2019 {#a} ─────────● 2021 {#b} ───►',
  '  ```',
  '',
  '```ts',
  'const ordinary = "code";',
  '```',
  '',
  '```tree',
  'src/',
  '└── index.ts',
  '```',
  '',
  '## Team {[drawing]}',
  '',
  '### Lead {#lead} {[rectangle x=0 y=0 width=200 height=90]}',
  '',
  '### Engineer {#engineer} {[rectangle x=0 y=200 width=200 height=90]}',
  '',
  '### {[arrow from=lead to=engineer]}',
  '',
  '## After',
  '',
  'Closing paragraph.',
  '',
].join('\n');

const picture = async (): Promise<DiagramPicture> => ({ data: PNG, width: 400, height: 200 });

describe('findDiagrams', () => {
  it('finds each diagram kind the player renders, ignoring ordinary code', () => {
    const found = findDiagrams(parseMarkdown(SOURCE));
    expect(found.map((diagram) => [diagram.kind, diagram.template, diagram.alt])).toEqual([
      ['mermaid', '', 'Review flow. Draft then publish'],
      ['timeline', '', 'Timeline'],
      ['tree', '', 'Tree'],
      ['container', 'drawing', 'Team'],
    ]);
  });

  it('gives a container its heading and every child it owns, and nothing after', () => {
    const container = findDiagrams(parseMarkdown(SOURCE)).find(
      (diagram) => diagram.kind === 'container',
    ) as ExportDiagram;
    expect(container.markdown).toContain('## Team {[drawing]}');
    expect(container.markdown).toContain('{[arrow from=lead to=engineer]}');
    expect(container.markdown).not.toContain('After');
  });
});

describe('rasterizeDiagrams', () => {
  it('swaps each pictured diagram for an image and keeps everything else', async () => {
    const result = await rasterizeDiagrams(parseMarkdown(SOURCE), picture);
    expect([...result.images.keys()]).toEqual([
      'diagram-1.png',
      'diagram-2.png',
      'diagram-3.png',
      'diagram-4.png',
    ]);
    expect(result.images.get('diagram-1.png')).toMatchObject({
      contentType: 'image/png',
      width: 400,
      height: 200,
    });
    const top = result.markdownDoc.children;
    expect(top.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph', // mermaid → image
      'list', // the timeline inside it → image
      'code', // ordinary code is untouched
      'paragraph', // tree → image
      'heading', // "Team", without its template; the shapes are gone
      'paragraph', // drawing → image
      'heading',
      'paragraph',
    ]);
    const team = top[6];
    expect(team.type === 'heading' && team.templateAnnotation).toBeFalsy();
    expect(JSON.stringify(top[3])).toContain('diagram-2.png');
    expect(
      result.mermaid.get(
        'flowchart LR\n  accTitle: Review flow\n  accDescr: Draft then publish\n  a --> b',
      ),
    ).toBeTruthy();
  });

  it('leaves a diagram as source when the renderer declines or fails', async () => {
    const warnings: string[] = [];
    let calls = 0;
    const result = await rasterizeDiagrams(
      parseMarkdown(SOURCE),
      async (diagram) => {
        calls++;
        if (diagram.kind === 'tree') return null;
        if (diagram.kind === 'timeline') throw new Error('no canvas');
        return picture();
      },
      { onWarning: (message) => warnings.push(message) },
    );
    expect(calls).toBe(4);
    expect(result.images.size).toBe(2);
    expect(warnings).toEqual(['A timeline could not be drawn and was kept as text: no canvas']);
    const kinds = result.markdownDoc.children.map((node) => node.type);
    expect(kinds.filter((type) => type === 'code')).toHaveLength(2); // ts + tree
  });

  it('pictures only the kinds asked for', async () => {
    const result = await rasterizeDiagrams(parseMarkdown(SOURCE), picture, { kinds: ['mermaid'] });
    expect(result.images.size).toBe(1);
    expect(result.mermaid.size).toBe(1);
  });

  it("never reuses a name the document's own images use", async () => {
    const doc = parseMarkdown(
      '![Mine](diagram-1.png)\n\n```mermaid\nflowchart LR\n  a --> b\n```\n',
    );
    const result = await rasterizeDiagrams(doc, picture);
    expect([...result.images.keys()]).toEqual(['diagram-2.png']);
  });

  it('returns the same document when nothing is a diagram', async () => {
    const doc = parseMarkdown('# Plain\n\nJust text.\n');
    const result = await rasterizeDiagrams(doc, picture);
    expect(result.markdownDoc).toBe(doc);
    expect(result.images.size).toBe(0);
  });
});

describe('exporters with diagram pictures', () => {
  async function pictured() {
    return rasterizeDiagrams(parseMarkdown(SOURCE), picture);
  }

  it('DOCX embeds the pictures at their display size, with alt text', async () => {
    const { markdownDoc, images } = await pictured();
    const zip = await JSZip.loadAsync(await markdownDocToDocx(markdownDoc, { images }));
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !zip.files[name].dir,
    );
    expect(media).toHaveLength(4);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toContain('flowchart LR');
    expect(xml).not.toContain('Engineer');
    expect(xml).toContain('descr="Review flow. Draft then publish"');
    // 400 × 200 CSS px at 96 per inch, not the PNG's 1 × 1 pixels.
    const cx = Math.round((400 / 96) * 914400);
    const cy = Math.round((200 / 96) * 914400);
    expect(xml).toContain(`cx="${String(cx)}" cy="${String(cy)}"`);
  });

  it('DOCX keeps a tall picture on one page', async () => {
    const doc = parseMarkdown('![Tall](tall.png)\n');
    const images = new Map([
      ['tall.png', { data: PNG, contentType: 'image/png', width: 300, height: 3000 }],
    ]);
    const zip = await JSZip.loadAsync(await markdownDocToDocx(doc, { images }));
    const xml = await zip.file('word/document.xml')!.async('string');
    const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/u.exec(xml);
    expect(Number(extent?.[2])).toBe(8 * 914400);
    expect(Number(extent?.[1])).toBe(
      Math.round(((300 / 96) * 914400 * 8 * 914400) / ((3000 / 96) * 914400)),
    );
  });

  it('EPUB embeds the pictures', async () => {
    const { markdownDoc, images } = await pictured();
    const epubImages = new Map([...images].map(([url, entry]) => [url, entry.data.slice().buffer]));
    const zip = await JSZip.loadAsync(await markdownDocToEpub(markdownDoc, { images: epubImages }));
    const files = Object.keys(zip.files).filter((name) => name.startsWith('OEBPS/images/'));
    expect(files.filter((name) => name.endsWith('.png'))).toHaveLength(4);
  });

  it('PDF draws each pictured diagram as an image', async () => {
    const { markdownDoc, images } = await pictured();
    const pdf = await PDFDocument.load(await markdownDocToPdf(markdownDoc, { images }));
    let count = 0;
    for (const page of pdf.getPages()) {
      const resources = page.node.Resources();
      const objects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      count += objects?.keys().length ?? 0;
    }
    expect(count).toBe(4);
  });

  it('PDF draws ordinary pictures too, and keeps a note for missing ones', async () => {
    const doc = parseMarkdown('![Logo](logo.png)\n\n![Missing](missing.png)\n');
    const images = new Map([['logo.png', { data: PNG, contentType: 'image/png' }]]);
    const pdf = await PDFDocument.load(await markdownDocToPdf(doc, { images }));
    const objects = pdf
      .getPages()[0]!
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect(objects?.keys().length).toBe(1);
  });

  it('PPTX draws Mermaid pictures and the drawing as native shapes', async () => {
    const markdownDoc = parseMarkdown(SOURCE);
    const { mermaid } = await rasterizeDiagrams(markdownDoc, picture, { kinds: ['mermaid'] });
    const zip = await JSZip.loadAsync(
      await docToPptx(markdownToDoc(markdownDoc), { diagramImages: mermaid }),
    );
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('ppt/media/') && !zip.files[name].dir,
    );
    expect(media).toHaveLength(1);
    const slides = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
        .map((name) => zip.file(name)!.async('string')),
    );
    const all = slides.join('\n');
    expect(all).not.toContain('flowchart LR');
    expect(all).toContain('descr="Review flow"');
    expect(all).toContain('Lead');
    expect(all).toContain('Engineer');
  });
});
