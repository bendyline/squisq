/**
 * `convert()` ZIP sniffing honours caller limits.
 *
 * Byte sniffing runs before the source format is known, so it used to open the
 * archive at hard-coded DEFAULT limits regardless of what the caller configured
 * — handing a hostile archive one free pass at default budgets before the real
 * importer applied stricter per-format limits.
 *
 * The sniff now uses the most permissive effective limit across the ZIP-based
 * candidates (docx/pptx/xlsx/dbk): never stricter than the importer that will
 * actually run (no false rejections), but a caller who tightens every ZIP
 * format gets that budget at sniff time too.
 *
 * Note the sniff only runs when the extension is unknown/absent and no
 * `options.from` is given — a recognized extension short-circuits detection.
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { convert } from '../registry/convert';

const OOXML_CONTENT_TYPES =
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_XML =
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:body><w:p><w:r><w:t>sniffed</w:t></w:r></w:p></w:body></w:document>`;

/** A docx-flavoured zip padded with `extra` filler entries. */
async function buildFatDocxZip(extra: number): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', OOXML_CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/document.xml', DOCUMENT_XML);
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
  );
  for (let i = 0; i < extra; i++) zip.file(`filler/f${i}.txt`, 'x');
  return zip.generateAsync({ type: 'uint8array' });
}

describe('convert() ZIP sniff limits', () => {
  it('sniffs an extension-less docx and converts it', async () => {
    const bytes = await buildFatDocxZip(3);
    const result = await convert({ kind: 'bytes', data: bytes }, 'md');
    expect(new TextDecoder().decode(result.bytes)).toContain('sniffed');
  });

  it('rejects at SNIFF time when every ZIP format is tightened', async () => {
    const bytes = await buildFatDocxZip(100);

    // The archive must be opened exactly ONCE: the sniff itself rejects, so the
    // importer never runs. If the sniff ignored the caller's limits it would
    // succeed and the importer would open the archive a second time to reject —
    // same error, but only after a full open+validate at default budgets.
    const archiveModule = await import('../shared/boundedZipArchive');
    const spy = vi.spyOn(archiveModule, 'openBoundedZipArchive');

    await expect(
      convert({ kind: 'bytes', data: bytes }, 'md', {
        formatOptions: {
          docx: { maxEntries: 5 },
          pptx: { maxEntries: 5 },
          xlsx: { maxEntries: 5 },
          dbk: { maxEntries: 5 },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toMatchObject({ maxEntries: 5 });
    spy.mockRestore();
  });

  it('still applies the docx importer’s own limit when only docx is tightened', async () => {
    const bytes = await buildFatDocxZip(100);

    await expect(
      convert({ kind: 'bytes', data: bytes }, 'md', {
        formatOptions: { docx: { maxEntries: 5 } },
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('does NOT let one format’s tight limit reject a DIFFERENT format', async () => {
    // A legitimate 100-entry dbk while the caller tightened only `docx`. The
    // sniff must not apply docx's limit to a dbk it hasn't identified yet —
    // taking the MINIMUM across candidates here would falsely reject.
    const dbk = await convert({ kind: 'markdown', markdown: '# Container doc\n\nBody.' }, 'dbk');
    const zip = await JSZip.loadAsync(dbk.bytes);
    for (let i = 0; i < 100; i++) zip.file(`filler/f${i}.txt`, 'x');
    const fatDbk = await zip.generateAsync({ type: 'uint8array' });

    const result = await convert({ kind: 'bytes', data: fatDbk }, 'md', {
      formatOptions: { docx: { maxEntries: 5 } },
    });
    expect(new TextDecoder().decode(result.bytes)).toContain('Container doc');
  });

  it('threads the caller AbortSignal into the sniff', async () => {
    const bytes = await buildFatDocxZip(3);
    const archiveModule = await import('../shared/boundedZipArchive');

    const spy = vi.spyOn(archiveModule, 'openBoundedZipArchive');

    const controller = new AbortController();
    await convert({ kind: 'bytes', data: bytes }, 'md', { signal: controller.signal });

    // Assert on the FIRST open specifically — that is the sniff. Checking "some
    // call carried the signal" would be satisfied by the importer's own open.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls[0]![1]?.signal).toBe(controller.signal);
    spy.mockRestore();
  });
});
