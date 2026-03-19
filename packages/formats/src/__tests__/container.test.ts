/**
 * Tests for container ZIP serialization: containerToZip, zipToContainer.
 *
 * Verifies round-trip fidelity: write files to a container, serialize to ZIP,
 * deserialize back, and confirm all files are intact.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { containerToZip, zipToContainer } from '../container/index';

// ============================================
// Helpers
// ============================================

/** Helper to read a Blob as ArrayBuffer (works in jsdom) */
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// ============================================
// containerToZip
// ============================================

describe('containerToZip', () => {
  it('creates a valid ZIP from an empty container', async () => {
    const container = new MemoryContentContainer();
    const blob = await containerToZip(container);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    // Should be parseable as a ZIP with no files
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    expect(Object.keys(zip.files)).toHaveLength(0);
  });

  it('includes all files from the container', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# Hello World');
    await container.writeFile('images/hero.jpg', new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');
    await container.writeFile('timing.json', new TextEncoder().encode('{"duration":10}'));

    const blob = await containerToZip(container);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    const filenames = Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort();
    expect(filenames).toEqual(['images/hero.jpg', 'index.md', 'timing.json']);
  });

  it('preserves file content', async () => {
    const container = new MemoryContentContainer();
    const markdown = '# Test Document\n\nSome content.';
    await container.writeDocument(markdown);

    const blob = await containerToZip(container);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    const content = await zip.file('index.md')!.async('string');
    expect(content).toBe(markdown);
  });

  it('preserves binary content', async () => {
    const container = new MemoryContentContainer();
    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await container.writeFile('image.png', binaryData, 'image/png');

    const blob = await containerToZip(container);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    const data = await zip.file('image.png')!.async('uint8array');
    expect(data).toEqual(binaryData);
  });
});

// ============================================
// zipToContainer
// ============================================

describe('zipToContainer', () => {
  it('loads files from a ZIP', async () => {
    const zip = new JSZip();
    zip.file('index.md', '# Hello');
    zip.file('images/photo.jpg', new Uint8Array([0xff, 0xd8]));
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const container = await zipToContainer(zipBlob);
    const entries = await container.listFiles();
    expect(entries.map((e) => e.path).sort()).toEqual(['images/photo.jpg', 'index.md']);
  });

  it('preserves text content', async () => {
    const zip = new JSZip();
    zip.file('index.md', '# My Document\n\nParagraph.');
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const container = await zipToContainer(zipBlob);
    expect(await container.readDocument()).toBe('# My Document\n\nParagraph.');
  });

  it('preserves binary content', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const zip = new JSZip();
    zip.file('data.bin', original);
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const container = await zipToContainer(zipBlob);
    const data = await container.readFile('data.bin');
    expect(new Uint8Array(data!)).toEqual(original);
  });

  it('skips directory entries', async () => {
    const zip = new JSZip();
    zip.folder('images');
    zip.file('images/photo.jpg', new Uint8Array([0xff]));
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const container = await zipToContainer(zipBlob);
    const entries = await container.listFiles();
    // Only the file, not the directory
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('images/photo.jpg');
  });

  it('works with ArrayBuffer input', async () => {
    const zip = new JSZip();
    zip.file('readme.md', '# Read me');
    const ab = await zip.generateAsync({ type: 'arraybuffer' });

    const container = await zipToContainer(ab);
    expect(await container.readDocument()).toBe('# Read me');
  });
});

// ============================================
// Round-trip
// ============================================

describe('containerToZip / zipToContainer round-trip', () => {
  it('round-trips a container with markdown and media', async () => {
    // Create original container
    const original = new MemoryContentContainer();
    const markdown = '# Round Trip Test\n\n![hero](images/hero.jpg)\n\nSome text.';
    await original.writeDocument(markdown);
    await original.writeFile('images/hero.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg');
    await original.writeFile('audio/narration.mp3', new Uint8Array([0x49, 0x44, 0x33]), 'audio/mpeg');
    await original.writeFile('timing.json', new TextEncoder().encode('{"segments":[]}'));

    // Serialize to ZIP
    const zipBlob = await containerToZip(original);

    // Deserialize back
    const restored = await zipToContainer(zipBlob);

    // Verify document
    expect(await restored.readDocument()).toBe(markdown);
    expect(await restored.getDocumentPath()).toBe('index.md');

    // Verify all files present
    const entries = (await restored.listFiles()).map((e) => e.path).sort();
    expect(entries).toEqual(['audio/narration.mp3', 'images/hero.jpg', 'index.md', 'timing.json']);

    // Verify binary content
    const heroData = new Uint8Array((await restored.readFile('images/hero.jpg'))!);
    expect(heroData).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    const audioData = new Uint8Array((await restored.readFile('audio/narration.mp3'))!);
    expect(audioData).toEqual(new Uint8Array([0x49, 0x44, 0x33]));

    // Verify JSON sidecar
    const timingData = new TextDecoder().decode((await restored.readFile('timing.json'))!);
    expect(timingData).toBe('{"segments":[]}');
  });
});
