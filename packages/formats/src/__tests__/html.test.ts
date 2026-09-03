/**
 * Tests for HTML export: docToHtml, docToHtmlZip, image utilities.
 *
 * Verifies that generated HTML contains the expected structure,
 * embedded script, and image handling. ZIP exports are also validated.
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import type { Doc, Block, ImageLayer } from '@bendyline/squisq/schemas';
import { compileTheme, createThemeRegistry } from '@bendyline/squisq/schemas';
import { docToHtml, docToHtmlZip, collectImagePaths, generateExternalHtml } from '../html/index';
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

  it('encodes large buffers correctly across chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 100_003 }, (_, index) => index % 251);
    const result = arrayBufferToBase64DataUrl(bytes.buffer, 'application/octet-stream');
    const decoded = Uint8Array.from(atob(result.split(',')[1]), (character) =>
      character.charCodeAt(0),
    );

    expect(decoded).toEqual(bytes);
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

  it('collects markdown image refs from block contents', () => {
    const doc = makeDoc({
      blocks: [
        {
          id: 'b1',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
          contents: [
            {
              type: 'paragraph',
              children: [{ type: 'image', url: 'body.jpg', alt: '' }],
            },
          ] as unknown as Block['contents'],
        },
      ],
    });
    const paths = collectImagePaths(doc);
    expect(paths.has('body.jpg')).toBe(true);
  });

  it('collects raw HTML <img> refs from block contents (WYSIWYG resize case)', () => {
    // When the WYSIWYG editor serializes a resized image, it emits a raw
    // `<img src width>` tag because markdown shorthand has no width syntax.
    // The parser produces an htmlBlock node with htmlChildren rather than
    // an image node — earlier this was invisible to the export pipeline.
    const doc = makeDoc({
      blocks: [
        {
          id: 'b1',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
          contents: [
            {
              type: 'htmlBlock',
              rawHtml: '<img alt="resized" src="resized.jpg" width="194">',
              htmlChildren: [
                {
                  type: 'htmlElement',
                  tagName: 'img',
                  attributes: { src: 'resized.jpg', alt: 'resized', width: '194' },
                  children: [],
                  selfClosing: true,
                },
              ],
            },
          ] as unknown as Block['contents'],
        },
      ],
    });
    const paths = collectImagePaths(doc);
    expect(paths.has('resized.jpg')).toBe(true);
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

  it('passes captionStyle through to the mount options', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT, captionStyle: 'social' });

    expect(html).toContain('captionStyle: "social"');
  });

  it('omits captionStyle from the mount options when not requested', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    expect(html).not.toContain('captionStyle');
  });

  it('generateExternalHtml is public and references the player by path', () => {
    const doc = makeDoc();
    const html = generateExternalHtml(doc, {
      playerScriptPath: '../assets/squisq-player.js',
      mode: 'static',
      captionStyle: 'social',
    });

    expect(html).toContain('<script src="../assets/squisq-player.js"></script>');
    expect(html).not.toContain(MOCK_PLAYER_SCRIPT);
    expect(html).toContain('captionStyle: "social"');
  });

  it('embeds an explicitly registered theme selected by the document', () => {
    const external = compileTheme({
      id: 'tenant-brand',
      name: 'External Tenant Brand',
      seedColors: { primary: '#6633cc' },
    });
    const html = docToHtml(makeDoc({ themeId: external.id }), {
      playerScript: MOCK_PLAYER_SCRIPT,
      themeRegistry: createThemeRegistry([external]),
    });

    expect(html).toContain('External Tenant Brand');
    expect(html).toContain('"themeId":"tenant-brand"');
  });

  it('keeps a document-scoped theme ahead of the explicit registry', () => {
    const inline = compileTheme({
      id: 'tenant-brand',
      name: 'Inline Tenant Brand',
      seedColors: { primary: '#112233' },
    });
    const external = compileTheme({
      id: 'tenant-brand',
      name: 'External Tenant Brand',
      seedColors: { primary: '#6633cc' },
    });
    const html = docToHtml(makeDoc({ themeId: inline.id, customThemes: [inline] }), {
      playerScript: MOCK_PLAYER_SCRIPT,
      themeRegistry: createThemeRegistry([external]),
    });

    expect(html).toContain('Inline Tenant Brand');
    expect(html).not.toContain('External Tenant Brand');
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
    // The page rendition owns its own background/scrolling — the host shim
    // must not hardcode a white background that fights themed pages.
    expect(html).toContain('#squisq-root{display:block}');
    expect(html).not.toContain('background:#fff');
  });

  it('supports video mode for timed movie playback', () => {
    const doc = makeDoc();
    const html = docToHtml(doc, {
      playerScript: MOCK_PLAYER_SCRIPT,
      mode: 'video',
      autoPlay: true,
    });

    expect(html).toContain('"video"');
    expect(html).toContain('autoPlay: true');
  });

  it('passes captionPosition through to the standalone player', () => {
    const html = docToHtml(makeDoc(), {
      playerScript: MOCK_PLAYER_SCRIPT,
      captionStyle: 'social',
      captionPosition: 'top',
    });

    expect(html).toContain('captionStyle: "social"');
    expect(html).toContain('captionPosition: "top"');
  });

  it('passes the fenced-code Copy option to the standalone player', () => {
    const html = docToHtml(makeDoc(), {
      playerScript: MOCK_PLAYER_SCRIPT,
      showCodeCopyButton: true,
    });

    expect(bootExportedHtml(html).options.showCodeCopyButton).toBe(true);
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

  it('embeds a caller-owned theme selected by the document', async () => {
    const external = compileTheme({
      id: 'tenant-zip-brand',
      name: 'Tenant ZIP Brand',
      seedColors: { primary: '#224466' },
    });
    const blob = await docToHtmlZip(makeDoc({ themeId: external.id }), {
      playerScript: MOCK_PLAYER_SCRIPT,
      themeRegistry: createThemeRegistry([external]),
    });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const html = await zip.file('index.html')!.async('text');
    expect(html).toContain('Tenant ZIP Brand');
  });

  it('preserves the original image path inside the zip', async () => {
    // Direct `<img src="folder/file.png">` references in the rendered HTML
    // resolve only if the zip mirrors the doc's path layout — flattening
    // to `images/<basename>` would 404 in the static renderer (which does
    // not rewrite paths through imagePathMap).
    const doc = makeDoc({ blocks: [makeImageBlock('mikehome_files/hero.png')] });
    const images = new Map([['mikehome_files/hero.png', makeImageBuffer()]]);
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT, images });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    expect(zip.file('mikehome_files/hero.png')).not.toBeNull();
    expect(zip.file('images/hero.png')).toBeNull();
  });

  it('strips leading slashes and rejects parent-traversal paths', async () => {
    const doc = makeDoc();
    const buffer = makeImageBuffer();
    const images = new Map([
      ['/leading/slash.png', buffer],
      ['../escape.png', buffer],
      ['nested/../sneaky.png', buffer],
      ['ok/path.png', buffer],
    ]);
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT, images });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    expect(zip.file('leading/slash.png')).not.toBeNull();
    expect(zip.file('ok/path.png')).not.toBeNull();
    expect(zip.file('../escape.png')).toBeNull();
    expect(zip.file('nested/../sneaky.png')).toBeNull();
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

  it('passes the fenced-code Copy option through ZIP exports', async () => {
    const blob = await docToHtmlZip(makeDoc(), {
      playerScript: MOCK_PLAYER_SCRIPT,
      showCodeCopyButton: true,
    });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const html = await zip.file('index.html')!.async('text');
    expect(bootExportedHtml(html).options.showCodeCopyButton).toBe(true);
  });

  it('player.js contains the provided script', async () => {
    const doc = makeDoc();
    const blob = await docToHtmlZip(doc, { playerScript: MOCK_PLAYER_SCRIPT });

    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const js = await zip.file('squisq-player.js')!.async('text');
    expect(js).toBe(MOCK_PLAYER_SCRIPT);
  });
});

// ============================================
// Regression: payload duplication, script escaping, ZIP collisions
// ============================================

/** The options the exported page's boot script hands to SquisqPlayer.mount. */
interface MountedOptions {
  images: Record<string, string>;
  audio?: Record<string, string> | null;
  showCodeCopyButton?: boolean;
}

/**
 * Parse the exported HTML and RUN its boot script against a stub player,
 * returning what the real player would have received.
 *
 * Parsing (rather than string-matching) is load-bearing for these tests: the
 * escaping bugs are about whether the HTML tokenizer agrees the script element
 * closed where we think it did, and executing the result proves the payload
 * survived escaping intact rather than merely "looking right".
 */
function bootExportedHtml(html: string): { doc: Doc; options: MountedOptions } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts = [...parsed.querySelectorAll('script')];
  const bootScript = scripts[scripts.length - 1]!.textContent ?? '';

  let captured: { doc: Doc; options: MountedOptions } | undefined;
  const player = {
    mount: (_el: unknown, doc: Doc, options: MountedOptions) => {
      captured = { doc, options };
    },
  };
  new Function('SquisqPlayer', 'document', bootScript)(player, parsed);
  if (!captured) throw new Error('boot script did not call SquisqPlayer.mount');
  return captured;
}

describe('docToHtml — inline image payloads (regression)', () => {
  it('embeds each distinct image payload exactly once despite path+basename aliases', () => {
    const buffer = makeImageBuffer();
    // Exactly the shape collectContainerImages produces: the SAME buffer
    // under both the container path and the bare basename.
    const images = new Map<string, ArrayBuffer>([
      ['assets/photo.png', buffer],
      ['photo.png', buffer],
    ]);

    const html = docToHtml(makeDoc({ blocks: [makeImageBlock('assets/photo.png')] }), {
      playerScript: MOCK_PLAYER_SCRIPT,
      images,
    });

    const base64 = arrayBufferToBase64DataUrl(buffer, 'image/png').split(',')[1]!;
    expect(base64.length).toBeGreaterThan(0);
    expect(html.split(base64).length - 1).toBe(1);
  });

  it('keeps both the path and basename aliases resolvable at runtime', () => {
    const buffer = makeImageBuffer();
    const images = new Map<string, ArrayBuffer>([
      ['assets/photo.png', buffer],
      ['photo.png', buffer],
    ]);

    const html = docToHtml(makeDoc({ blocks: [makeImageBlock('assets/photo.png')] }), {
      playerScript: MOCK_PLAYER_SCRIPT,
      images,
    });

    const { options } = bootExportedHtml(html);
    const expected = arrayBufferToBase64DataUrl(buffer, 'image/png');
    expect(options.images['assets/photo.png']).toBe(expected);
    expect(options.images['photo.png']).toBe(expected);
  });

  it('keeps distinct images that share a basename separate', () => {
    const first = makeImageBuffer();
    const second = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]).buffer;
    const images = new Map<string, ArrayBuffer>([
      ['one/photo.png', first],
      ['two/photo.png', second],
    ]);

    const { options } = bootExportedHtml(
      docToHtml(makeDoc(), { playerScript: MOCK_PLAYER_SCRIPT, images }),
    );

    expect(options.images['one/photo.png']).toBe(arrayBufferToBase64DataUrl(first, 'image/png'));
    expect(options.images['two/photo.png']).toBe(arrayBufferToBase64DataUrl(second, 'image/png'));
    expect(options.images['one/photo.png']).not.toBe(options.images['two/photo.png']);
  });
});

describe('docToHtml — script escaping (regression)', () => {
  // Drives the HTML tokenizer into "script data double escaped" state, where
  // a subsequent </script> no longer closes the element.
  const HOSTILE = '<!--<script>';

  it('does not let doc text swallow the rest of the page', () => {
    const html = docToHtml(makeDoc({ articleId: `hostile-${HOSTILE}` }), {
      playerScript: MOCK_PLAYER_SCRIPT,
    });

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const scripts = [...parsed.querySelectorAll('script')];
    expect(scripts).toHaveLength(3);
    // If the script never closed, the trailing markup gets parsed as script
    // text instead of as elements.
    expect(scripts.some((s) => (s.textContent ?? '').includes('</html>'))).toBe(false);
    expect(parsed.querySelector('#squisq-root')).not.toBeNull();
  });

  it('round-trips hostile doc text through the embedded JSON byte-for-byte', () => {
    const html = docToHtml(makeDoc({ articleId: `hostile-${HOSTILE}` }), {
      playerScript: MOCK_PLAYER_SCRIPT,
    });

    // JSON.parse must succeed (an invalid escape would throw) and preserve
    // the original text exactly.
    const { doc } = bootExportedHtml(html);
    expect(doc.articleId).toBe(`hostile-${HOSTILE}`);
  });

  it('survives a player bundle containing the hostile sequences', () => {
    const script = `var SquisqPlayer={mount:function(){}};var probe=${JSON.stringify('<!--<script>x</script>')};var re=/<script/;`;
    const html = docToHtml(makeDoc(), { playerScript: script });

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const scripts = [...parsed.querySelectorAll('script')];
    expect(scripts).toHaveLength(3);

    // The bundle's string literal AND regex literal must keep their MEANING.
    // (`re.source` legitimately shows the escape — what must not change is
    // what the regex matches. This is why the escape is `<`: a `\s`-style
    // escape would silently turn `<script` into "< whitespace cript".)
    const out = new Function(
      `${scripts.find((script) => script.getAttribute('type') !== 'application/json')!.textContent};return [probe, re.test('<script')];`,
    )() as [string, boolean];
    expect(out[0]).toBe('<!--<script>x</script>');
    expect(out[1]).toBe(true);
  });

  it('escapes hostile doc text in the external (ZIP) HTML too', async () => {
    const blob = await docToHtmlZip(makeDoc({ articleId: `hostile-${HOSTILE}` }), {
      playerScript: MOCK_PLAYER_SCRIPT,
    });
    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
    const html = await zip.file('index.html')!.async('text');

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('#squisq-root')).not.toBeNull();
    expect(
      [...parsed.querySelectorAll('script')].some((s) => (s.textContent ?? '').includes('</html>')),
    ).toBe(false);
  });
});

describe('docToHtmlZip — asset naming and skips (regression)', () => {
  it('keeps two same-basename audio segments as distinct archive members', async () => {
    const first = new Uint8Array([1, 1, 1, 1]).buffer;
    const second = new Uint8Array([2, 2, 2, 2]).buffer;
    const audio = new Map<string, ArrayBuffer>([
      ['takes/1/narration.webm', first],
      ['takes/2/narration.webm', second],
    ]);

    const blob = await docToHtmlZip(makeDoc(), { playerScript: MOCK_PLAYER_SCRIPT, audio });
    const zip = await JSZip.loadAsync(await blobToUint8Array(blob));

    expect(
      Object.keys(zip.files).filter((f) => f.startsWith('audio/') && !f.endsWith('/')),
    ).toHaveLength(2);

    const html = await zip.file('index.html')!.async('text');
    const { options } = bootExportedHtml(html);
    const pathA = options.audio?.['takes/1/narration.webm'];
    const pathB = options.audio?.['takes/2/narration.webm'];
    expect(pathA).toBeDefined();
    expect(pathB).toBeDefined();
    expect(pathA).not.toBe(pathB);

    // Each mapped path must resolve to ITS OWN bytes, not the last writer's.
    expect([...(await zip.file(pathA!)!.async('uint8array'))]).toEqual([1, 1, 1, 1]);
    expect([...(await zip.file(pathB!)!.async('uint8array'))]).toEqual([2, 2, 2, 2]);
  });

  it('warns rather than silently dropping an image with an unsafe path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // `..` segments are rejected so the archive can't be extracted outside
      // its root — but the doc still references the image, so the export
      // carries a broken reference and must say so.
      const images = new Map<string, ArrayBuffer>([['../escape.png', makeImageBuffer()]]);
      const blob = await docToHtmlZip(makeDoc(), { playerScript: MOCK_PLAYER_SCRIPT, images });
      const zip = await JSZip.loadAsync(await blobToUint8Array(blob));

      expect(Object.keys(zip.files).some((f) => f.includes('escape.png'))).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('../escape.png');
    } finally {
      warn.mockRestore();
    }
  });
});
