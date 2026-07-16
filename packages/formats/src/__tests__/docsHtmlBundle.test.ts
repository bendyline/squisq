import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { markdownDocsToHtmlBundle } from '../html/docsHtmlBundle';

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function makeContainer(docs: Record<string, string>, binaries: Record<string, ArrayBuffer> = {}) {
  return {
    readDocument: async (path: string) => (path in docs ? docs[path]! : null),
    readBinary: async (path: string) => (path in binaries ? binaries[path]! : null),
  };
}

async function openZip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blobToUint8Array(blob));
}

async function readZipPath(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async('text') : null;
}

function listZipPaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((path) => !path.endsWith('/'))
    .sort();
}

function readEmbeddedDoc(html: string): unknown {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const payload = parsed.querySelector('script[data-squisq-doc="1"]')?.textContent;
  if (!payload) throw new Error('Rendered page did not contain an embedded Doc');
  return JSON.parse(payload) as unknown;
}

describe('markdownDocsToHtmlBundle', () => {
  it('renders an entry page and a shared external player', async () => {
    const blob = await markdownDocsToHtmlBundle({
      entryPath: 'home.md',
      ...makeContainer({ 'home.md': '# Home\n\nWelcome.' }),
      playerScript: 'window.SquisqPlayer = testPlayer;',
      title: 'Documentation Home',
    });
    const zip = await openZip(blob);

    expect(listZipPaths(zip)).toEqual(['home.html', 'squisq-player.js']);
    expect(await readZipPath(zip, 'squisq-player.js')).toBe('window.SquisqPlayer = testPlayer;');
    const html = await readZipPath(zip, 'home.html');
    expect(html).toContain('<title>Documentation Home</title>');
    expect(html).toContain('<script src="squisq-player.js"></script>');
    expect(html).toContain('mode: "static"');
  });

  it('follows links, preserves fragments, rewrites raw HTML anchors, and handles cycles', async () => {
    const blob = await markdownDocsToHtmlBundle({
      entryPath: 'home.md',
      ...makeContainer({
        'home.md': '# Home\n\n[Resume](resume.md#work)\n\n<a href="resume.md#work">HTML resume</a>',
        'resume.md': '# Resume\n\n[Home](home.md)',
      }),
      playerScript: 'player();',
    });
    const zip = await openZip(blob);
    const home = await readZipPath(zip, 'home.html');
    const resume = await readZipPath(zip, 'resume.html');

    expect(listZipPaths(zip)).toEqual(['home.html', 'resume.html', 'squisq-player.js']);
    expect(home).toContain('resume.html#work');
    // The parser retains the authored `rawHtml` string for lossless round-trips,
    // while the structured HTML tree consumed by renderers gets the new href.
    expect(JSON.stringify(readEmbeddedDoc(home!))).toContain(
      '"attributes":{"href":"resume.html#work"}',
    );
    expect(resume).toContain('home.html');
    expect(resume).not.toContain('home.md');
  });

  it('supports an index entry in a subdirectory with correct relative paths', async () => {
    const blob = await markdownDocsToHtmlBundle({
      entryPath: 'docs/home.md',
      entryAsIndex: true,
      ...makeContainer({
        'docs/home.md': '# Home\n\n[Guide](guide.md)',
        'docs/guide.md': '# Guide\n\n[Home](home.md)',
      }),
      playerScript: 'player();',
    });
    const zip = await openZip(blob);
    const index = await readZipPath(zip, 'docs/index.html');
    const guide = await readZipPath(zip, 'docs/guide.html');

    expect(listZipPaths(zip)).toEqual(['docs/guide.html', 'docs/index.html', 'squisq-player.js']);
    expect(index).toContain('<script src="../squisq-player.js"></script>');
    expect(index).toContain('guide.html');
    expect(guide).toContain('index.html');
  });

  it('honors maxDepth and does not follow documents outside the entry scope', async () => {
    const blob = await markdownDocsToHtmlBundle({
      entryPath: 'docs/home.md',
      maxDepth: 1,
      ...makeContainer({
        'docs/home.md': '# Home\n\n[One](chapters/one.md)\n\n[Outside](../outside.md)',
        'docs/chapters/one.md': '# One\n\n[Two](two.md)',
        'docs/chapters/two.md': '# Two',
        'outside.md': '# Outside',
      }),
      playerScript: 'player();',
    });
    const zip = await openZip(blob);
    const home = await readZipPath(zip, 'docs/home.html');

    expect(listZipPaths(zip)).toEqual([
      'docs/chapters/one.html',
      'docs/home.html',
      'squisq-player.js',
    ]);
    expect(home).toContain('../outside.md');
  });

  it('bundles markdown and raw-HTML images while ignoring remote and missing assets', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;
    const blob = await markdownDocsToHtmlBundle({
      entryPath: 'docs/home.md',
      ...makeContainer(
        {
          'docs/home.md':
            '# Home\n\n![Hero](assets/hero.png)\n\n<img src="assets/card.webp">\n\n' +
            '![Remote](https://example.com/remote.png)\n\n![Missing](assets/missing.png)',
        },
        {
          'docs/assets/hero.png': png,
          'docs/assets/card.webp': webp,
        },
      ),
      playerScript: 'player();',
    });
    const zip = await openZip(blob);
    const html = await readZipPath(zip, 'docs/home.html');

    expect(listZipPaths(zip)).toEqual([
      'docs/assets/card.webp',
      'docs/assets/hero.png',
      'docs/home.html',
      'squisq-player.js',
    ]);
    expect(html).toContain('assets/hero.png');
    expect(html).toContain('assets/card.webp');
    expect(html).toContain('https://example.com/remote.png');
  });

  it('fails clearly for an empty or unreadable entry', async () => {
    const c = makeContainer({});

    await expect(
      markdownDocsToHtmlBundle({ entryPath: '', ...c, playerScript: 'player();' }),
    ).rejects.toThrow(/entryPath is required/);
    await expect(
      markdownDocsToHtmlBundle({ entryPath: 'missing.md', ...c, playerScript: 'player();' }),
    ).rejects.toThrow(/failed to read "missing\.md"/);
  });
});
