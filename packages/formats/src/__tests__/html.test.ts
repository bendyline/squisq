/**
 * Tests for HTML export: docToHtml, docToHtmlZip, image utilities.
 *
 * Verifies that generated HTML contains the expected structure,
 * embedded script, and image handling. ZIP exports are also validated.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { Doc, Block, ImageLayer } from '@bendyline/squisq/schemas';
import { docToHtml, docToHtmlZip, collectImagePaths } from '../html/index';
import { inferMimeType, arrayBufferToBase64DataUrl, extractFilename } from '../html/imageUtils';

// ============================================
// Helpers
// ============================================

const MOCK_PLAYER_SCRIPT = 'var SquisqPlayer={mount:function(){}};';

/** Helper to read a Blob as Uint8Array (works in jsdom where blob.arrayBuffer() may not exist) */
async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    articleId: 'test-doc',
    duration: 10,
    blocks: [],
    audio: {
      segments: [{ src: 'intro.mp3', name: 'intro', duration: 10, startTime: 0 }],
    },
    ...overrides,
  };
}

function makeImageBlock(imageSrc: string): Block {
  const layer: ImageLayer = {
    id: 'img-1',
    type: 'image',
    position: { x: 0, y: 0, width: '100%', height: '100%' },
    content: { src: imageSrc, alt: 'test image' },
  };
  return {
    id: 'block-1',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [layer],
  };
}

function makeImageBuffer(): ArrayBuffer {
  // Minimal 1x1 PNG
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return bytes.buffer;
}

// ============================================
// Image Utilities
// ============================================

describe('inferMimeType', () => {
  it('returns correct MIME types for common extensions', () => {
    expect(inferMimeType('photo.jpg')).toBe('image/jpeg');
    expect(inferMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(inferMimeType('logo.png')).toBe('image/png');
    expect(inferMimeType('anim.gif')).toBe('image/gif');
    expect(inferMimeType('hero.webp')).toBe('image/webp');
    expect(inferMimeType('icon.svg')).toBe('image/svg+xml');
    expect(inferMimeType('track.mp3')).toBe('audio/mpeg');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(inferMimeType('data.xyz')).toBe('application/octet-stream');
    expect(inferMimeType('noext')).toBe('application/octet-stream');
  });
});

describe('arrayBufferToBase64DataUrl', () => {
  it('produces a valid data URI', () => {
    const buffer = new TextEncoder().encode('hello').buffer;
    const result = arrayBufferToBase64DataUrl(buffer, 'text/plain');
    expect(result).toMatch(/^data:text\/plain;base64,/);
    expect(result).toBe('data:text/plain;base64,aGVsbG8=');
  });
});

describe('extractFilename', () => {
  it('extracts filename from path', () => {
    expect(extractFilename('images/hero.jpg')).toBe('hero.jpg');
    expect(extractFilename('hero.jpg')).toBe('hero.jpg');
    expect(extractFilename('a/b/c/deep.png')).toBe('deep.png');
  });

  it('strips query and hash', () => {
    expect(extractFilename('photo.jpg?v=2')).toBe('photo.jpg');
    expect(extractFilename('photo.jpg#anchor')).toBe('photo.jpg');
  });
});

// ============================================
// Image Path Collection
// ============================================

describe('collectImagePaths', () => {
  it('collects image layer src from blocks', () => {
    const doc = makeDoc({ blocks: [makeImageBlock('hero.jpg')] });
    const paths = collectImagePaths(doc);
    expect(paths.has('hero.jpg')).toBe(true);
  });

  it('ignores absolute URLs', () => {
    const doc = makeDoc({ blocks: [makeImageBlock('https://example.com/photo.jpg')] });
    const paths = collectImagePaths(doc);
    expect(paths.size).toBe(0);
  });

  it('ignores data URIs', () => {
    const doc = makeDoc({ blocks: [makeImageBlock('data:image/png;base64,abc')] });
    const paths = collectImagePaths(doc);
    expect(paths.size).toBe(0);
  });

  it('collects startBlock heroSrc', () => {
    const doc = makeDoc({ startBlock: { heroSrc: 'cover.jpg', title: 'Test' } });
    const paths = collectImagePaths(doc);
    expect(paths.has('cover.jpg')).toBe(true);
  });
});

// ============================================
// Single HTML Export
// ============================================

describe('docToHtml', () => {
  it('produces a complete HTML document', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<div id="squisq-root">');
  });

  it('embeds the player script inline', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(html).toContain(MOCK_PLAYER_SCRIPT);
  });

  it('embeds the doc JSON', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(html).toContain('test-doc');
  });

  it('calls SquisqPlayer.mount', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(html).toContain('SquisqPlayer.mount');
  });

  it('sets the page title', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, {
      playerScript: MOCK_PLAYER_SCRIPT,
      title: 'My Amazing Doc',
    });

    expect(html).toContain('<title>My Amazing Doc</title>');
  });

  it('uses slideshow mode by default', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(html).toContain('"slideshow"');
  });

  it('supports static mode', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT, mode: 'static' });

    expect(html).toContain('"static"');
  });

  it('inlines images as base64 data URIs', () => {
    const doc = makeDoc({ blocks: [makeImageBlock('hero.png')] });
    const images = new Map([['hero.png', makeImageBuffer()]]);
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT, images });

    expect(html).toContain('data:image/png;base64,');
  });

  it('escapes script-breaking content in title', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, {
      playerScript: MOCK_PLAYER_SCRIPT,
      title: '<script>alert("xss")</script>',
    });

    // Title should be escaped
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ============================================
// ZIP Archive Export
// ============================================

describe('docToHtmlZip', () => {
  it('produces a valid ZIP blob', async () => {
    const doc = makeDoc();
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('contains index.html and squisq-player.js', async () => {
    const doc = makeDoc();
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    expect(zip.file('index.html')).not.toBeNull();
    expect(zip.file('squisq-player.js')).not.toBeNull();
  });

  it('references player script via src attribute', async () => {
    const doc = makeDoc();
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const html = await zip.file('index.html')!.async('text');
    expect(html).toContain('src="squisq-player.js"');
    // Should NOT contain the inline script
    expect(html).not.toContain(MOCK_PLAYER_SCRIPT);
  });

  it('includes images in images/ folder', async () => {
    const doc = makeDoc({ blocks: [makeImageBlock('hero.png')] });
    const images = new Map([['hero.png', makeImageBuffer()]]);
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT, images });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    expect(zip.file('images/hero.png')).not.toBeNull();
  });

  it('includes audio in audio/ folder when provided', async () => {
    const audioData = new Uint8Array([0x49, 0x44, 0x33, 0x00]).buffer;
    const doc = makeDoc();
    const audio = new Map([['intro.mp3', audioData]]);
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT, audio });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    expect(zip.file('audio/intro.mp3')).not.toBeNull();
  });

  it('HTML references doc JSON inline', async () => {
    const doc = makeDoc();
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const html = await zip.file('index.html')!.async('text');
    expect(html).toContain('test-doc');
    expect(html).toContain('SquisqPlayer.mount');
  });

  it('player.js contains the provided script', async () => {
    const doc = makeDoc();
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const js = await zip.file('squisq-player.js')!.async('text');
    expect(js).toBe(MOCK_PLAYER_SCRIPT);
  });
});
