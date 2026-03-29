/**
 * readInput unit tests
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { readInput } from '../util/readInput.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { containerToZip } from '@bendyline/squisq-formats/container';
import { MemoryContentContainer } from '@bendyline/squisq/storage';

const FIXTURE_MD = join(import.meta.dirname, 'fixtures', 'test.md');

describe('readInput', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `squisq-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads a .md file into a container and MarkdownDocument', async () => {
    const result = await readInput(FIXTURE_MD);

    expect(result.markdownDoc).to.not.equal(null);
    expect(result.markdownDoc).to.have.property('type', 'document');
    expect(result.markdownDoc!.children).to.be.an('array');
    expect(result.markdownDoc!.children.length).to.be.greaterThan(0);

    const docContent = await result.container.readDocument();
    expect(docContent).to.be.a('string').that.includes('# Test Document');
  });

  it('reads a .zip container', async () => {
    // Build a minimal container ZIP
    const container = new MemoryContentContainer();
    await container.writeDocument('# From ZIP\n\nHello from a ZIP container.');
    const blob = await containerToZip(container);
    const buf = Buffer.from(await blob.arrayBuffer());

    const zipPath = join(tempDir, 'test.zip');
    await writeFile(zipPath, buf);

    const result = await readInput(zipPath);
    expect(result.markdownDoc).to.not.equal(null);
    expect(result.markdownDoc!.type).to.equal('document');
    const doc = await result.container.readDocument();
    expect(doc).to.include('# From ZIP');
  });

  it('reads a .dbk container (same as .zip)', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# From DBK\n\nHello from a DBK container.');
    const blob = await containerToZip(container);
    const buf = Buffer.from(await blob.arrayBuffer());

    const dbkPath = join(tempDir, 'test.dbk');
    await writeFile(dbkPath, buf);

    const result = await readInput(dbkPath);
    expect(result.markdownDoc).to.not.equal(null);
    expect(result.markdownDoc!.type).to.equal('document');
    const doc = await result.container.readDocument();
    expect(doc).to.include('# From DBK');
  });

  it('reads a folder with markdown and media', async () => {
    const folderPath = join(tempDir, 'mydoc');
    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, 'index.md'), '# Folder Doc\n\nContent here.');
    await writeFile(join(folderPath, 'image.txt'), 'placeholder');

    const result = await readInput(folderPath);
    expect(result.markdownDoc).to.not.equal(null);
    expect(result.markdownDoc!.type).to.equal('document');

    const doc = await result.container.readDocument();
    expect(doc).to.include('# Folder Doc');

    // Media files are also in the container
    const files = await result.container.listFiles();
    const paths = files.map((f) => f.path);
    expect(paths).to.include('image.txt');
  });

  it('throws on folder with no markdown file', async () => {
    const folderPath = join(tempDir, 'empty');
    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, 'image.png'), Buffer.from([0x89, 0x50]));

    try {
      await readInput(folderPath);
      expect.fail('Expected an error');
    } catch (err: unknown) {
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.include('No markdown document');
    }
  });

  it('reads a .json file as Doc JSON', async () => {
    const doc = {
      articleId: 'test-article',
      duration: 30,
      blocks: [{ id: 'b1', startTime: 0, duration: 30, audioSegment: 0 }],
      audio: { segments: [] },
    };
    const jsonPath = join(tempDir, 'doc.json');
    await writeFile(jsonPath, JSON.stringify(doc));

    const result = await readInput(jsonPath);
    expect(result.markdownDoc).to.equal(null);
    expect(result.doc).to.deep.include({ articleId: 'test-article', duration: 30 });
    expect(result.doc!.blocks).to.have.length(1);
  });

  it('reads a folder with doc.json instead of markdown', async () => {
    const folderPath = join(tempDir, 'jsondoc');
    await mkdir(folderPath, { recursive: true });
    const doc = {
      articleId: 'folder-doc',
      duration: 20,
      blocks: [],
      audio: { segments: [] },
    };
    await writeFile(join(folderPath, 'doc.json'), JSON.stringify(doc));
    await writeFile(join(folderPath, 'image.txt'), 'placeholder');

    const result = await readInput(folderPath);
    expect(result.markdownDoc).to.equal(null);
    expect(result.doc).to.deep.include({ articleId: 'folder-doc' });

    // Media files are still in the container
    const files = await result.container.listFiles();
    const paths = files.map((f) => f.path);
    expect(paths).to.include('image.txt');
  });
});
