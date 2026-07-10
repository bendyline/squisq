/**
 * Tests for the programmatic convert() entry point: normalization across the
 * three source shapes, byte sniffing, transform threading, round-trips, and
 * suggested-filename correctness.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { convert, ConversionError, defaultRegistry } from '../registry/index';
import { markdownDocToPptx } from '../pptx/export';
import { buildThemedPptx } from './pptxInferFixtures';

const SAMPLE_MD = `# Round Trip

This is a paragraph that should survive a docx round trip.
`;

// ── unknown-format / unsupported-output ─────────────────────────────

describe('convert error paths', () => {
  it('throws unknown-format for an unregistered target', async () => {
    await expect(convert({ kind: 'markdown', markdown: '# hi' }, 'nope')).rejects.toMatchObject({
      name: 'ConversionError',
      code: 'unknown-format',
    });
  });

  it('throws unsupported-output when exporting to an import-only format', async () => {
    // Register a definition with only importDoc, then export to it.
    const registry = defaultRegistry();
    registry.register({
      id: 'importonly',
      label: 'Import Only',
      mimeType: 'application/x-import',
      extensions: ['.imp'],
      async importDoc() {
        return parseMarkdown('# x');
      },
    });
    await expect(
      convert({ kind: 'markdown', markdown: '# hi' }, 'importonly', { registry }),
    ).rejects.toMatchObject({ name: 'ConversionError', code: 'unsupported-output' });
  });
});

// ── round trip: md → docx → md ──────────────────────────────────────

describe('md → docx → md round trip', () => {
  it('preserves paragraph text through a docx round trip', async () => {
    const toDocx = await convert(
      { kind: 'markdown', markdown: SAMPLE_MD, baseName: 'doc' },
      'docx',
    );
    expect(toDocx.mimeType).toContain('wordprocessingml');
    expect(toDocx.bytes.byteLength).toBeGreaterThan(0);

    // Feed the docx bytes back in with an explicit `from`.
    const backToMd = await convert(
      { kind: 'bytes', data: toDocx.bytes, filename: 'doc.docx' },
      'md',
      { from: 'docx' },
    );
    const text = new TextDecoder().decode(backToMd.bytes);
    expect(text).toContain('survive a docx round trip');
    expect(backToMd.suggestedFilename).toBe('doc.md');
  });
});

// ── byte sniffing ───────────────────────────────────────────────────

describe('byte sniffing', () => {
  it('sniffs a PDF by its %PDF magic', async () => {
    // Stub the pdf importer so the test exercises the sniff, not pdfjs (which
    // can't run under jsdom). Any %PDF-prefixed bytes must route to 'pdf'.
    const registry = defaultRegistry();
    registry.register({
      ...registry.get('pdf')!,
      importContainer: undefined, // force the importDoc path (skip pdfjs)
      async importDoc() {
        return parseMarkdown('# sniffed as pdf');
      },
    });
    const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%mock pdf body\n');
    const back = await convert({ kind: 'bytes', data: pdfBytes }, 'md', { registry });
    expect(new TextDecoder().decode(back.bytes)).toContain('sniffed as pdf');
  });

  it('sniffs a squisq container (plain zip, no [Content_Types].xml) as dbk', async () => {
    // A dbk is a ZIP with a markdown doc and no OOXML content-types part.
    const dbk = await convert({ kind: 'markdown', markdown: '# In a container\n\nBody.' }, 'dbk');
    expect(dbk.mimeType).toBe('application/zip');

    const back = await convert({ kind: 'bytes', data: dbk.bytes }, 'md');
    const text = new TextDecoder().decode(back.bytes);
    expect(text).toContain('In a container');
  });

  it('disambiguates a docx zip via its content-types part', async () => {
    const docx = await convert({ kind: 'markdown', markdown: '# Word doc' }, 'docx');
    // No filename, no `from` — must read [Content_Types].xml to pick docx.
    const back = await convert({ kind: 'bytes', data: docx.bytes }, 'md');
    const text = new TextDecoder().decode(back.bytes);
    expect(text).toContain('Word doc');
  });
});

// ── transform threading ─────────────────────────────────────────────

describe('transform threading', () => {
  it('applies a transform style before handing off to the exporter', async () => {
    // A capture format records the NormalizedInput it receives, letting us
    // observe that the transform ran without depending on any converter.
    let captured: import('../registry/index').NormalizedInput | undefined;
    const registry = defaultRegistry();
    registry.register({
      id: 'capture',
      label: 'Capture',
      mimeType: 'application/x-capture',
      extensions: ['.cap'],
      async exportDoc(input) {
        captured = input;
        return {
          bytes: new Uint8Array([1]),
          mimeType: 'application/x-capture',
          suggestedFilename: '',
          warnings: [],
        };
      },
    });

    const plainDoc = markdownToDoc(parseMarkdown(SAMPLE_MD));
    await convert({ kind: 'markdown', markdown: SAMPLE_MD }, 'capture', {
      registry,
      transformStyle: 'magazine',
    });

    expect(captured).toBeDefined();
    // The transform promotes/reshapes blocks, so the exporter sees a different
    // Doc than a plain markdownToDoc of the same source.
    expect(captured!.doc.blocks.length).not.toBe(plainDoc.blocks.length);
    // markdownDoc is re-derived from the transformed Doc.
    expect(captured!.markdownDoc).toBeDefined();
  });
});

// ── doc-kind source ─────────────────────────────────────────────────

describe('doc-kind source', () => {
  it('exports a Doc source', async () => {
    const doc = markdownToDoc(parseMarkdown('# From a Doc\n\nContent.'));
    const result = await convert({ kind: 'doc', doc, baseName: 'fromdoc' }, 'md');
    const text = new TextDecoder().decode(result.bytes);
    expect(text).toContain('From a Doc');
    expect(result.suggestedFilename).toBe('fromdoc.md');
  });
});

// ── suggested filename ──────────────────────────────────────────────

describe('suggestedFilename', () => {
  it('uses the primary extension per format', async () => {
    const docx = await convert({ kind: 'markdown', markdown: '# t', baseName: 'report' }, 'docx');
    expect(docx.suggestedFilename).toBe('report.docx');
  });

  it('htmlzip suggests <base>.html.zip', async () => {
    const zip = await convert(
      { kind: 'markdown', markdown: '# t', baseName: 'slides' },
      'htmlzip',
      {
        resolvePlayerScript: async () => '/* stub */',
      },
    );
    expect(zip.suggestedFilename).toBe('slides.html.zip');
    expect(zip.mimeType).toBe('application/zip');
  });

  it('defaults baseName to "document" when none is given', async () => {
    const out = await convert({ kind: 'markdown', markdown: '# t' }, 'md');
    expect(out.suggestedFilename).toBe('document.md');
  });
});

// sanity: ConversionError is exported and usable
// ── pptx theme/layout inference threading ───────────────────────────

describe('pptx import inference threading (default ON)', () => {
  it('carries an inferred theme through convert() by default', async () => {
    const deck = await markdownDocToPptx(parseMarkdown('# Hi\n\nBody.\n'), {});
    const result = await convert({ kind: 'bytes', data: deck, filename: 'deck.pptx' }, 'md');
    const md = new TextDecoder().decode(result.bytes);
    expect(md).toContain('squisq-theme: custom-office-theme');
    expect(md).toContain('squisq-custom-themes');
  });

  it('omits inference with formatOptions.pptx.inferTheme=false', async () => {
    const deck = await markdownDocToPptx(parseMarkdown('# Hi\n\nBody.\n'), {});
    const result = await convert({ kind: 'bytes', data: deck, filename: 'deck.pptx' }, 'md', {
      formatOptions: { pptx: { inferTheme: false, inferLayouts: false } },
    });
    const md = new TextDecoder().decode(result.bytes);
    expect(md).not.toContain('squisq-theme');
    expect(md).not.toContain('squisq-custom-themes');
  });

  it('end-to-end: inferred theme colors reach a downstream docx export', async () => {
    // Distinctive fixture theme (bg #fdfdf8, text #1a1a2e) → pptx → docx.
    const result = await convert(
      { kind: 'bytes', data: await buildThemedPptx(), filename: 'deck.pptx' },
      'docx',
    );
    const zip = await JSZip.loadAsync(result.bytes);
    let text = '';
    for (const name of Object.keys(zip.files)) {
      if (/\.(xml|rels)$/i.test(name)) text += await zip.files[name]!.async('string');
    }
    expect(text.toLowerCase()).toContain('1a1a2e');
  });
});

it('exports ConversionError', () => {
  expect(new ConversionError('conversion-failed', 'x')).toBeInstanceOf(Error);
});
