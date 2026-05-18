/**
 * Tests for the recursive plain-HTML bundle export
 * (`markdownDocsToPlainHtmlBundle`).
 *
 * Each test sets up an in-memory "container" — a `Map<path, string>`
 * for markdown sources and a `Map<path, ArrayBuffer>` for binary
 * assets — wires it up as the `readDocument` / `readBinary` callbacks,
 * exports the bundle, and inspects the resulting JSZip.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { markdownDocsToPlainHtmlBundle } from '../html/plainHtmlBundle';

/** Helper to read a Blob as Uint8Array (works in jsdom). */
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
    readDocument: async (p: string) => (p in docs ? docs[p] : null),
    readBinary: async (p: string) => (p in binaries ? binaries[p] : null),
  };
}

async function readZipPath(blob: Blob, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
  const file = zip.file(path);
  return file ? file.async('text') : null;
}

async function listZipPaths(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await blobToUint8Array(blob));
  // JSZip emits implicit directory entries (paths ending in `/`) when
  // any file lives in a subfolder. We're testing file content; the
  // directory placeholders are noise.
  return Object.keys(zip.files)
    .filter((p) => !p.endsWith('/'))
    .sort();
}

describe('markdownDocsToPlainHtmlBundle', () => {
  it('exports a single doc with no links to a 1-file html', async () => {
    const c = makeContainer({ 'home.md': '# Home\n\nJust a single page.' });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths).toEqual(['home.html']);
    const html = await readZipPath(blob, 'home.html');
    expect(html).toContain('<h1>Home</h1>');
  });

  it('follows a linear chain home.md → resume.md and bundles both', async () => {
    const c = makeContainer({
      'home.md': '# Home\n\nMy [resume](resume.md) is here.',
      'resume.md': '# Resume\n\nWork history.',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths).toContain('home.html');
    expect(paths).toContain('resume.html');
    const home = await readZipPath(blob, 'home.html');
    // The .md link is rewritten to .html
    expect(home).toContain('href="resume.html"');
    expect(home).not.toContain('href="resume.md"');
    const resume = await readZipPath(blob, 'resume.html');
    expect(resume).toContain('<h1>Resume</h1>');
  });

  it('cycle-detects so a.md ↔ b.md does not loop', async () => {
    const c = makeContainer({
      'a.md': '# A\n\n[b](b.md)',
      'b.md': '# B\n\n[a](a.md)',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'a.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths.sort()).toEqual(['a.html', 'b.html']);
  });

  it('does NOT follow ../parent.md (scope rule)', async () => {
    const c = makeContainer({
      'subdir/intro.md': '# Intro\n\nLink to [parent](../outside.md).',
      'outside.md': '# Outside',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'subdir/intro.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    // `outside.md` lives ABOVE the entry doc's directory → out of scope.
    expect(paths).toEqual(['subdir/intro.html']);
    const intro = await readZipPath(blob, 'subdir/intro.html');
    // The link is not rewritten to .html — it stays as authored.
    expect(intro).toContain('href="../outside.md"');
  });

  it('follows links into subfolders (still in scope)', async () => {
    const c = makeContainer({
      'home.md': '# Home\n\n[chapter 1](chapters/one.md)',
      'chapters/one.md': '# Chapter 1\n\nContent.',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths).toContain('home.html');
    expect(paths).toContain('chapters/one.html');
    const home = await readZipPath(blob, 'home.html');
    expect(home).toContain('href="chapters/one.html"');
  });

  it('preserves #anchor fragments when rewriting .md → .html', async () => {
    const c = makeContainer({
      'home.md': '# Home\n\nJump to [exp](resume.md#experience).',
      'resume.md': '# Resume\n\n## Experience',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const home = await readZipPath(blob, 'home.html');
    expect(home).toContain('href="resume.html#experience"');
  });

  it('aborts with an error when a linked doc cannot be read', async () => {
    const c = makeContainer({
      'home.md': '# Home\n\n[missing](does-not-exist.md)',
    });
    await expect(markdownDocsToPlainHtmlBundle({ entryPath: 'home.md', ...c })).rejects.toThrow(
      /failed to read.*does-not-exist\.md/i,
    );
  });

  it('emits image assets at their authored relative paths inside the zip', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const c = makeContainer(
      { 'home.md': '# Home\n\n![hero](home_files/hero.png)' },
      { 'home_files/hero.png': png },
    );
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths).toContain('home_files/hero.png');
    const home = await readZipPath(blob, 'home.html');
    expect(home).toContain('src="home_files/hero.png"');
  });

  it('linked sub-folder docs reference parent assets via ../', async () => {
    // The doc lives in subdir/, the image in home_files/, so the
    // rewritten src should walk up one level.
    const png = new Uint8Array([0x89]).buffer;
    const c = makeContainer(
      {
        'home.md': '# Home\n\n[deep](chapters/one.md)',
        'chapters/one.md': '# One\n\n![shared](../home_files/hero.png)',
      },
      { 'home_files/hero.png': png },
    );
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths).toContain('home_files/hero.png');
    const one = await readZipPath(blob, 'chapters/one.html');
    expect(one).toContain('src="../home_files/hero.png"');
  });

  it('passes the entry title through; sibling docs derive title from the shallowest heading', async () => {
    const c = makeContainer({
      'home.md': '# Home\n\n[resume](resume.md)\n\n[notes](notes.md)',
      'resume.md': '# Resume',
      'notes.md': 'Just a paragraph.',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      title: 'My Home Page',
      ...c,
    });
    const home = await readZipPath(blob, 'home.html');
    expect(home).toContain('<title>My Home Page</title>');
    // Heading-bearing sibling uses its heading text, not the filename.
    const resume = await readZipPath(blob, 'resume.html');
    expect(resume).toContain('<title>Resume</title>');
    // Heading-less sibling falls back to the filename.
    const notes = await readZipPath(blob, 'notes.html');
    expect(notes).toContain('<title>notes</title>');
  });

  it('respects maxDepth — depth 0 means entry only, no link following', async () => {
    const c = makeContainer({
      'home.md': '# Home\n\n[resume](resume.md)',
      'resume.md': '# Resume',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      maxDepth: 0,
      ...c,
    });
    const paths = await listZipPaths(blob);
    expect(paths).toEqual(['home.html']);
  });

  it('does not rewrite external links (http://) or fragment-only links', async () => {
    const c = makeContainer({
      'home.md':
        '[google](https://google.com)\n\n[#section](#somewhere)\n\n[email](mailto:me@example.com)',
    });
    const blob = await markdownDocsToPlainHtmlBundle({
      entryPath: 'home.md',
      ...c,
    });
    const home = await readZipPath(blob, 'home.html');
    expect(home).toContain('href="https://google.com"');
    expect(home).toContain('href="#somewhere"');
    expect(home).toContain('href="mailto:me@example.com"');
  });
});
