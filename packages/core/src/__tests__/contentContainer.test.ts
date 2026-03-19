import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryContentContainer, findDocumentPath } from '../storage/ContentContainer';
import { createMediaProviderFromContainer } from '../storage/MediaProviderFromContainer';
import type { ContentEntry } from '../storage/ContentContainer';

// ============================================
// MemoryContentContainer
// ============================================

describe('MemoryContentContainer', () => {
  let container: MemoryContentContainer;

  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('readFile returns null for missing file', async () => {
    expect(await container.readFile('missing.txt')).toBeNull();
  });

  it('writeFile and readFile round-trip', async () => {
    const data = new TextEncoder().encode('hello world');
    await container.writeFile('test.txt', data, 'text/plain');
    const result = await container.readFile('test.txt');
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!)).toBe('hello world');
  });

  it('writeFile with ArrayBuffer', async () => {
    const buf = new ArrayBuffer(4);
    new Uint8Array(buf).set([1, 2, 3, 4]);
    await container.writeFile('data.bin', buf);
    const result = await container.readFile('data.bin');
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('writeFile overwrites existing file', async () => {
    await container.writeFile('f.txt', new TextEncoder().encode('first'));
    await container.writeFile('f.txt', new TextEncoder().encode('second'));
    const result = await container.readFile('f.txt');
    expect(new TextDecoder().decode(result!)).toBe('second');
  });

  it('removeFile deletes a file', async () => {
    await container.writeFile('f.txt', new TextEncoder().encode('data'));
    await container.removeFile('f.txt');
    expect(await container.readFile('f.txt')).toBeNull();
  });

  it('removeFile is a no-op for missing file', async () => {
    // Should not throw
    await container.removeFile('nonexistent.txt');
  });

  it('exists returns true for existing file', async () => {
    await container.writeFile('f.txt', new TextEncoder().encode('data'));
    expect(await container.exists('f.txt')).toBe(true);
  });

  it('exists returns false for missing file', async () => {
    expect(await container.exists('missing.txt')).toBe(false);
  });

  it('listFiles returns all files', async () => {
    await container.writeFile('a.txt', new TextEncoder().encode('a'), 'text/plain');
    await container.writeFile('b.jpg', new Uint8Array([0xff, 0xd8]), 'image/jpeg');
    const entries = await container.listFiles();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.path).sort()).toEqual(['a.txt', 'b.jpg']);
  });

  it('listFiles with prefix filters results', async () => {
    await container.writeFile('index.md', new TextEncoder().encode('# Hi'));
    await container.writeFile('images/hero.jpg', new Uint8Array([0xff]));
    await container.writeFile('images/bg.png', new Uint8Array([0x89]));
    await container.writeFile('audio/clip.mp3', new Uint8Array([0x49]));

    const imageEntries = await container.listFiles('images/');
    expect(imageEntries).toHaveLength(2);
    expect(imageEntries.map((e) => e.path).sort()).toEqual(['images/bg.png', 'images/hero.jpg']);
  });

  it('listFiles reports correct size', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await container.writeFile('data.bin', data);
    const entries = await container.listFiles();
    expect(entries[0].size).toBe(5);
  });

  it('listFiles guesses MIME type from extension', async () => {
    await container.writeFile('photo.jpg', new Uint8Array([0xff]));
    const entries = await container.listFiles();
    expect(entries[0].mimeType).toBe('image/jpeg');
  });

  it('listFiles uses provided MIME type over guess', async () => {
    await container.writeFile('data.bin', new Uint8Array([0]), 'application/custom');
    const entries = await container.listFiles();
    expect(entries[0].mimeType).toBe('application/custom');
  });
});

// ============================================
// Document discovery
// ============================================

describe('getDocumentPath', () => {
  let container: MemoryContentContainer;

  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('returns null for empty container', async () => {
    expect(await container.getDocumentPath()).toBeNull();
  });

  it('finds index.md', async () => {
    await container.writeFile('index.md', new TextEncoder().encode('# Hello'));
    expect(await container.getDocumentPath()).toBe('index.md');
  });

  it('prefers index.md over doc.md', async () => {
    await container.writeFile('doc.md', new TextEncoder().encode('doc'));
    await container.writeFile('index.md', new TextEncoder().encode('index'));
    expect(await container.getDocumentPath()).toBe('index.md');
  });

  it('prefers doc.md over document.md', async () => {
    await container.writeFile('document.md', new TextEncoder().encode('document'));
    await container.writeFile('doc.md', new TextEncoder().encode('doc'));
    expect(await container.getDocumentPath()).toBe('doc.md');
  });

  it('prefers document.md over arbitrary .md', async () => {
    await container.writeFile('readme.md', new TextEncoder().encode('readme'));
    await container.writeFile('document.md', new TextEncoder().encode('document'));
    expect(await container.getDocumentPath()).toBe('document.md');
  });

  it('falls back to first .md at root', async () => {
    await container.writeFile('my-story.md', new TextEncoder().encode('story'));
    expect(await container.getDocumentPath()).toBe('my-story.md');
  });

  it('ignores .md files in subdirectories', async () => {
    await container.writeFile('docs/notes.md', new TextEncoder().encode('notes'));
    expect(await container.getDocumentPath()).toBeNull();
  });

  it('ignores non-md files', async () => {
    await container.writeFile('data.json', new TextEncoder().encode('{}'));
    await container.writeFile('hero.jpg', new Uint8Array([0xff]));
    expect(await container.getDocumentPath()).toBeNull();
  });
});

describe('readDocument / writeDocument', () => {
  let container: MemoryContentContainer;

  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('writeDocument creates index.md by default', async () => {
    await container.writeDocument('# Hello');
    expect(await container.getDocumentPath()).toBe('index.md');
    expect(await container.readDocument()).toBe('# Hello');
  });

  it('writeDocument uses custom filename', async () => {
    await container.writeDocument('# Custom', 'story.md');
    expect(await container.getDocumentPath()).toBe('story.md');
    expect(await container.readDocument()).toBe('# Custom');
  });

  it('readDocument returns null for empty container', async () => {
    expect(await container.readDocument()).toBeNull();
  });
});

// ============================================
// findDocumentPath (standalone)
// ============================================

describe('findDocumentPath', () => {
  it('returns null for empty list', () => {
    expect(findDocumentPath([])).toBeNull();
  });

  it('finds index.md from entry list', () => {
    const entries: ContentEntry[] = [
      { path: 'images/hero.jpg', mimeType: 'image/jpeg', size: 100 },
      { path: 'index.md', mimeType: 'text/markdown', size: 50 },
    ];
    expect(findDocumentPath(entries)).toBe('index.md');
  });

  it('skips subdirectory .md files', () => {
    const entries: ContentEntry[] = [
      { path: 'docs/guide.md', mimeType: 'text/markdown', size: 50 },
    ];
    expect(findDocumentPath(entries)).toBeNull();
  });
});

// ============================================
// createMediaProviderFromContainer
// ============================================

describe('createMediaProviderFromContainer', () => {
  let container: MemoryContentContainer;
  let blobCounter = 0;

  beforeEach(() => {
    container = new MemoryContentContainer();
    blobCounter = 0;
    // Mock URL.createObjectURL / revokeObjectURL (not available in Node)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => `blob:mock-${++blobCounter}`,
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolveUrl returns path as-is for missing file', async () => {
    const provider = createMediaProviderFromContainer(container);
    expect(await provider.resolveUrl('missing.jpg')).toBe('missing.jpg');
    provider.dispose();
  });

  it('resolveUrl returns blob URL for existing file', async () => {
    await container.writeFile('hero.jpg', new Uint8Array([0xff, 0xd8]), 'image/jpeg');
    const provider = createMediaProviderFromContainer(container);
    const url = await provider.resolveUrl('hero.jpg');
    expect(url).toMatch(/^blob:/);
    provider.dispose();
  });

  it('resolveUrl caches blob URLs', async () => {
    await container.writeFile('hero.jpg', new Uint8Array([0xff, 0xd8]), 'image/jpeg');
    const provider = createMediaProviderFromContainer(container);
    const url1 = await provider.resolveUrl('hero.jpg');
    const url2 = await provider.resolveUrl('hero.jpg');
    expect(url1).toBe(url2);
    provider.dispose();
  });

  it('listMedia excludes markdown files', async () => {
    await container.writeFile('index.md', new TextEncoder().encode('# Doc'));
    await container.writeFile('hero.jpg', new Uint8Array([0xff]), 'image/jpeg');
    await container.writeFile('clip.mp4', new Uint8Array([0x00]), 'video/mp4');

    const provider = createMediaProviderFromContainer(container);
    const media = await provider.listMedia();
    expect(media).toHaveLength(2);
    expect(media.map((m) => m.name).sort()).toEqual(['clip.mp4', 'hero.jpg']);
    provider.dispose();
  });

  it('addMedia writes to container and returns path', async () => {
    const provider = createMediaProviderFromContainer(container);
    const path = await provider.addMedia('photo.png', new Uint8Array([0x89]), 'image/png');
    expect(path).toBe('photo.png');
    expect(await container.exists('photo.png')).toBe(true);
    provider.dispose();
  });

  it('removeMedia deletes from container', async () => {
    await container.writeFile('hero.jpg', new Uint8Array([0xff]), 'image/jpeg');
    const provider = createMediaProviderFromContainer(container);
    // Resolve first to populate cache
    await provider.resolveUrl('hero.jpg');
    await provider.removeMedia('hero.jpg');
    expect(await container.exists('hero.jpg')).toBe(false);
    provider.dispose();
  });
});
