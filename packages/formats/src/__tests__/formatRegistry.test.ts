/**
 * Tests for the format registry: createRegistry / defaultRegistry, capability
 * consistency across every built-in, and the structured error codes.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  createRegistry,
  defaultRegistry,
  defaultFormats,
  ConversionError,
  BUILTIN_FORMAT_IDS,
} from '../registry/index';
import type { FormatDefinition, NormalizedInput } from '../registry/index';

const SAMPLE_MD = `# Title

Some intro text.

| Name | Value |
| --- | --- |
| A | 1 |
| B | 2 |
`;

async function makeInput(baseName = 'sample'): Promise<NormalizedInput> {
  const markdownDoc = parseMarkdown(SAMPLE_MD);
  const doc = markdownToDoc(markdownDoc);
  const container = new MemoryContentContainer();
  await container.writeDocument(SAMPLE_MD);
  return { doc, markdownDoc, container, baseName };
}

const stubDef = (id: string, extensions: string[]): FormatDefinition => ({
  id,
  label: id.toUpperCase(),
  mimeType: 'application/octet-stream',
  extensions,
});

// ── Registry mechanics ──────────────────────────────────────────────

describe('createRegistry', () => {
  it('registers and gets definitions by id', () => {
    const reg = createRegistry();
    reg.register(stubDef('foo', ['.foo']));
    expect(reg.get('foo')?.id).toBe('foo');
    expect(reg.get('missing')).toBeUndefined();
  });

  it('resolves byExtension, normalizing leading dot + case', () => {
    const reg = createRegistry();
    reg.register(stubDef('foo', ['.foo', '.f']));
    expect(reg.byExtension('foo')?.id).toBe('foo');
    expect(reg.byExtension('.FOO')?.id).toBe('foo');
    expect(reg.byExtension('f')?.id).toBe('foo');
    expect(reg.byExtension('nope')).toBeUndefined();
  });

  it('is last-write-wins by id', () => {
    const reg = createRegistry();
    reg.register(stubDef('foo', ['.foo']));
    reg.register({ ...stubDef('foo', ['.foo']), label: 'SECOND' });
    expect(reg.get('foo')?.label).toBe('SECOND');
    expect(reg.list().filter((d) => d.id === 'foo')).toHaveLength(1);
  });

  it('lists all registered definitions', () => {
    const reg = createRegistry();
    reg.register(stubDef('a', ['.a']));
    reg.register(stubDef('b', ['.b']));
    expect(
      reg
        .list()
        .map((d) => d.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('defaultRegistry', () => {
  it('registers all built-in formats', () => {
    const reg = defaultRegistry();
    for (const id of BUILTIN_FORMAT_IDS) {
      expect(reg.get(id), `built-in "${id}" should be registered`).toBeDefined();
    }
    expect(reg.list()).toHaveLength(BUILTIN_FORMAT_IDS.length);
  });

  it('declares template annotation handling for every built-in exporter', () => {
    const handling = Object.fromEntries(
      defaultFormats().map((d) => [d.id, d.templateAnnotationHandling]),
    );
    expect(handling).toEqual({
      md: 'preserved',
      dbk: 'preserved',
      pptx: 'rendered',
      html: 'rendered',
      htmlzip: 'rendered',
      docx: 'ignored',
      pdf: 'ignored',
      xlsx: 'ignored',
      csv: 'ignored',
      epub: 'ignored',
    });
  });

  it('defaultFormats matches BUILTIN_FORMAT_IDS exactly', () => {
    const ids = defaultFormats()
      .map((d) => d.id)
      .sort();
    expect(ids).toEqual([...BUILTIN_FORMAT_IDS].sort());
  });
});

// ── Capability consistency ──────────────────────────────────────────

describe('built-in capability consistency', () => {
  const formats = defaultFormats();

  for (const def of formats) {
    if (!def.exportDoc) continue;
    it(`${def.id}: exportDoc produces bytes (or a tolerated not-implemented error)`, async () => {
      const input = await makeInput();
      // HTML formats need a player script; provide a trivial stub.
      const options = { resolvePlayerScript: async () => '/* stub */' };
      try {
        const result = await def.exportDoc!(input, options);
        // Use ArrayBuffer.isView rather than `instanceof Uint8Array`: under the
        // jsdom test env, bytes built from node's TextEncoder/Uint8Array live in
        // a different realm than the test file's Uint8Array global.
        expect(ArrayBuffer.isView(result.bytes)).toBe(true);
        expect(result.bytes.byteLength).toBeGreaterThan(0);
        expect(typeof result.mimeType).toBe('string');
        expect(Array.isArray(result.warnings)).toBe(true);
      } catch (err: unknown) {
        // xlsx export is being implemented concurrently and may still throw
        // 'not yet implemented'. Tolerate that specific case only.
        const message = err instanceof Error ? err.message : String(err);
        expect(def.id, `unexpected export failure for "${def.id}": ${message}`).toBe('xlsx');
        expect(message).toMatch(/not yet implemented/i);
      }
    });
  }

  it('csv export warns when the document has multiple tables', async () => {
    const multiTable = parseMarkdown(
      `| A | B |\n| - | - |\n| 1 | 2 |\n\n| C | D |\n| - | - |\n| 3 | 4 |\n`,
    );
    const container = new MemoryContentContainer();
    const input: NormalizedInput = {
      doc: markdownToDoc(multiTable),
      markdownDoc: multiTable,
      container,
      baseName: 'tables',
    };
    const csv = defaultFormats().find((d) => d.id === 'csv')!;
    const result = await csv.exportDoc!(input, {});
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/table/i);
  });
});

// ── Error codes ─────────────────────────────────────────────────────

describe('error codes', () => {
  it('ConversionError carries a stable code + optional fields', () => {
    const err = new ConversionError('invalid-input', 'boom', {
      format: 'docx',
      hint: 'try again',
      cause: new Error('root'),
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConversionError');
    expect(err.code).toBe('invalid-input');
    expect(err.format).toBe('docx');
    expect(err.hint).toBe('try again');
    expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
  });

  it('html export without a player script → missing-dependency', async () => {
    const input = await makeInput();
    const html = defaultFormats().find((d) => d.id === 'html')!;
    await expect(html.exportDoc!(input, {})).rejects.toMatchObject({
      name: 'ConversionError',
      code: 'missing-dependency',
    });
  });
});
