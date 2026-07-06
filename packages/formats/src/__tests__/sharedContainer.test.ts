/**
 * Tests for the shared container-assembly tail (`shared/container.ts`) that the
 * docx / pptx / pdf `*ToContainer` importers now delegate to.
 */

import { describe, it, expect } from 'vitest';
import { buildContainer } from '../shared/container';

const BYTES_A = new Uint8Array([1, 2, 3, 4]);
const BYTES_B = new Uint8Array([9, 8, 7]);

describe('buildContainer', () => {
  it('writes the markdown document and every image with its mime type', async () => {
    const container = await buildContainer(
      '# Hello\n\n![](images/a.png)',
      new Map([
        ['images/a.png', { data: BYTES_A.buffer, mimeType: 'image/png' }],
        ['images/b.jpg', { data: BYTES_B.buffer, mimeType: 'image/jpeg' }],
      ]),
    );

    expect(await container.readDocument()).toContain('Hello');
    expect(await container.exists('images/a.png')).toBe(true);
    expect(await container.exists('images/b.jpg')).toBe(true);
    expect(new Uint8Array((await container.readFile('images/a.png'))!)).toEqual(BYTES_A);
    expect(new Uint8Array((await container.readFile('images/b.jpg'))!)).toEqual(BYTES_B);
  });

  it('accepts any iterable of [path, {data, mimeType}] (e.g. mapped array)', async () => {
    const images = [{ path: 'images/x.png', data: BYTES_A.buffer }].map(
      (i) => [i.path, { data: i.data, mimeType: 'image/png' }] as const,
    );
    const container = await buildContainer('# Doc', images);
    expect(await container.exists('images/x.png')).toBe(true);
  });

  it('produces a valid empty container with no images', async () => {
    const container = await buildContainer('', []);
    expect(await container.readDocument()).toBe('');
  });
});
