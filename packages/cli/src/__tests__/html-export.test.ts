/**
 * HTML export integration tests
 *
 * Validates that standalone HTML and HTML ZIP exports correctly embed images
 * and that the player can resolve and display them.
 */

import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { containerToZip } from '@bendyline/squisq-formats/container';
import { MemoryContentContainer } from '@bendyline/squisq/storage';

const exec = promisify(execFile);
const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'index.js');

/** Create a minimal 1x1 red PNG (68 bytes). */
function createTestPng(): Buffer {
  // Minimal valid PNG: 1x1 pixel, red (#FF0000), RGBA
  const png = Buffer.from(
    '89504e470d0a1a0a' + // PNG signature
      '0000000d49484452' + // IHDR chunk length + type
      '00000001' + // width: 1
      '00000001' + // height: 1
      '08020000009001' + // bit depth 8, color type 2 (RGB), compression/filter/interlace
      '2e00' + // CRC
      '0000000c49444154' + // IDAT chunk length + type
      '08d763f86f0000' + // compressed data (1 red pixel)
      '00020001e221bc33' + // CRC
      '0000000049454e44ae426082', // IEND
    'hex',
  );
  return png;
}

/**
 * Run the CLI with the given args.
 */
async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec('node', [CLI_PATH, ...args], { timeout: 60_000 });
}

describe('HTML export with images', () => {
  let tempDir: string;
  let containerPath: string;

  before(async () => {
    tempDir = join(tmpdir(), `squisq-html-export-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    // Create a container with markdown + image
    const container = new MemoryContentContainer();
    const md = [
      '# Image Test',
      '',
      'A document with images.',
      '',
      '## Hero Section {[imageWithCaption]}',
      '',
      '![Test Image](test-image.png)',
      '',
      'Some text after the image.',
      '',
      '## Second Section {[sectionHeader]}',
      '',
      'More content.',
      '',
    ].join('\n');

    await container.writeDocument(md);
    await container.writeFile('test-image.png', createTestPng(), 'image/png');

    const blob = await containerToZip(container);
    const buf = Buffer.from(await blob.arrayBuffer());
    containerPath = join(tempDir, 'test-doc.dbk');
    await writeFile(containerPath, buf);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('standalone HTML embeds image as base64 data URI', async () => {
    const outDir = join(tempDir, 'html-out');
    await mkdir(outDir, { recursive: true });

    const { stderr } = await runCli('convert', containerPath, '-o', outDir, '-f', 'html');
    expect(stderr).to.include('Done.');

    const htmlPath = join(outDir, 'test-doc.html');
    const info = await stat(htmlPath);
    expect(info.size).to.be.greaterThan(0);

    const html = await readFile(htmlPath, 'utf-8');

    // Verify the HTML contains the SquisqPlayer
    expect(html).to.include('SquisqPlayer');
    expect(html).to.include('squisq-root');

    // Verify the image is embedded as base64
    expect(html).to.include('data:image/png;base64,');

    // Verify the image map contains a reference to our image
    expect(html).to.include('test-image.png');
  });

  it('HTML ZIP contains image file and references it', async () => {
    const outDir = join(tempDir, 'htmlzip-out');
    await mkdir(outDir, { recursive: true });

    const { stderr } = await runCli('convert', containerPath, '-o', outDir, '-f', 'htmlzip');
    expect(stderr).to.include('Done.');

    const zipPath = join(outDir, 'test-doc.html.zip');
    const info = await stat(zipPath);
    expect(info.size).to.be.greaterThan(0);

    // Verify ZIP structure by checking it's a valid ZIP
    const data = await readFile(zipPath);
    expect(data[0]).to.equal(0x50); // PK magic
    expect(data[1]).to.equal(0x4b);

    // The ZIP should contain our image and the player JS
    const content = data.toString('latin1');
    expect(content).to.include('squisq-player.js');
    expect(content).to.include('test-image.png');
  });

  it('standalone HTML with plain .md file also embeds images from container', async () => {
    // Test with a folder input instead of container
    const folderDir = join(tempDir, 'folder-input');
    await mkdir(folderDir, { recursive: true });

    const md = ['# Folder Test', '', '![My Image](test-image.png)', '', 'Text content.'].join('\n');

    await writeFile(join(folderDir, 'index.md'), md);
    await writeFile(join(folderDir, 'test-image.png'), createTestPng());

    const outDir = join(tempDir, 'folder-html-out');
    await mkdir(outDir, { recursive: true });

    const { stderr } = await runCli('convert', folderDir, '-o', outDir, '-f', 'html');
    expect(stderr).to.include('Done.');

    const htmlPath = join(outDir, `${folderDir.split(/[\\/]/).pop()}.html`);
    const html = await readFile(htmlPath, 'utf-8');

    // Image should be embedded
    expect(html).to.include('data:image/png;base64,');
    expect(html).to.include('test-image.png');
  });
});
