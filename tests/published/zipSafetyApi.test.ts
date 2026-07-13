import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

const rootEntry = pathToFileURL(resolve('packages/formats/dist/index.js')).href;
const containerEntry = pathToFileURL(resolve('packages/formats/dist/container/index.js')).href;
const ooxmlEntry = pathToFileURL(resolve('packages/formats/dist/ooxml/index.js')).href;

describe('published ZIP safety API', () => {
  it('exports one ZipSafetyError class from every documented entry point', async () => {
    const [root, container, ooxml] = await Promise.all([
      import(rootEntry),
      import(containerEntry),
      import(ooxmlEntry),
    ]);
    expect(root.ZipSafetyError).toBeTypeOf('function');
    expect(container.ZipSafetyError).toBe(root.ZipSafetyError);
    expect(ooxml.ZipSafetyError).toBe(root.ZipSafetyError);
  });

  it('preserves structured fields through a built-package container read', async () => {
    const [root, container] = await Promise.all([import(rootEntry), import(containerEntry)]);
    const zip = new JSZip();
    zip.file('large.txt', '12345');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });

    let error: unknown;
    try {
      await container.zipToContainer(bytes, { maxEntryUncompressedBytes: 4 });
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(root.ZipSafetyError);
    expect(error).toMatchObject({
      name: 'ZipSafetyError',
      code: 'entry-too-large',
      path: 'large.txt',
      limit: 4,
      actual: 5,
    });
  });
});
