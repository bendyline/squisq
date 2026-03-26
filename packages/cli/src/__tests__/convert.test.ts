/**
 * convert command integration tests
 *
 * Exercises the full convert pipeline: input → all formats → output validation.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, rm, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { containerToZip } from '@bendyline/squisq-formats/container';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { zipToContainer } from '@bendyline/squisq-formats/container';

const exec = promisify(execFile);

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'index.js');
const FIXTURE_MD = join(import.meta.dirname, 'fixtures', 'test.md');

/**
 * Run the CLI with the given args and return stdout/stderr.
 */
async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec('node', [CLI_PATH, ...args], { timeout: 30_000 });
}

describe('convert command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `squisq-convert-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('converts a .md file to all formats', async () => {
    const { stderr } = await runCli('convert', FIXTURE_MD, '-o', tempDir);

    expect(stderr).to.include('Done.');

    // Verify all four output files exist and are non-empty
    for (const ext of ['docx', 'pdf', 'html', 'dbk']) {
      const outPath = join(tempDir, `test.${ext}`);
      const info = await stat(outPath);
      expect(info.size).to.be.greaterThan(0);
    }
  });

  it('respects --formats to produce only selected formats', async () => {
    await runCli('convert', FIXTURE_MD, '-o', tempDir, '-f', 'docx,pdf');

    // These should exist
    const docxStat = await stat(join(tempDir, 'test.docx'));
    expect(docxStat.size).to.be.greaterThan(0);
    const pdfStat = await stat(join(tempDir, 'test.pdf'));
    expect(pdfStat.size).to.be.greaterThan(0);

    // These should NOT exist
    for (const ext of ['html', 'dbk']) {
      try {
        await stat(join(tempDir, `test.${ext}`));
        expect.fail(`test.${ext} should not exist`);
      } catch (err: unknown) {
        expect((err as NodeJS.ErrnoException).code).to.equal('ENOENT');
      }
    }
  });

  it('converts a .dbk container to all formats', async () => {
    // Create a minimal .dbk container
    const container = new MemoryContentContainer();
    await container.writeDocument('# Container Doc\n\nSome content here.');
    const blob = await containerToZip(container);
    const buf = Buffer.from(await blob.arrayBuffer());
    const dbkPath = join(tempDir, 'input.dbk');
    await fsWriteFile(dbkPath, buf);

    // Convert to a separate output dir to avoid overwriting the input .dbk
    const outDir = join(tempDir, 'out');
    const { stderr } = await runCli('convert', dbkPath, '-o', outDir);
    expect(stderr).to.include('Done.');

    for (const ext of ['docx', 'pdf', 'html', 'dbk']) {
      const info = await stat(join(outDir, `input.${ext}`));
      expect(info.size).to.be.greaterThan(0);
    }
  });

  it('exits with error for nonexistent input', async () => {
    try {
      await runCli('convert', '/nonexistent/file.md', '-o', tempDir);
      expect.fail('Expected a non-zero exit');
    } catch (err: unknown) {
      // execFile rejects on non-zero exit
      expect((err as { stderr: string }).stderr).to.include('Error');
    }
  });

  describe('output validation', () => {
    let validationDir: string;

    before(async () => {
      validationDir = join(
        tmpdir(),
        `squisq-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      await mkdir(validationDir, { recursive: true });
      await runCli('convert', FIXTURE_MD, '-o', validationDir);
    });

    after(async () => {
      await rm(validationDir, { recursive: true, force: true });
    });

    it('DOCX is a valid ZIP with WordprocessingML content', async () => {
      const data = await readFile(join(validationDir, 'test.docx'));
      // ZIP files start with PK (0x50 0x4B)
      expect(data[0]).to.equal(0x50);
      expect(data[1]).to.equal(0x4b);
      // Should contain Content_Types and document.xml inside
      const asString = data.toString('latin1');
      expect(asString).to.include('[Content_Types].xml');
      expect(asString).to.include('word/document.xml');
    });

    it('PDF starts with %PDF- magic bytes', async () => {
      const data = await readFile(join(validationDir, 'test.pdf'));
      const header = data.subarray(0, 5).toString('ascii');
      expect(header).to.equal('%PDF-');
    });

    it('HTML contains SquisqPlayer and root element', async () => {
      const html = await readFile(join(validationDir, 'test.html'), 'utf-8');
      expect(html).to.include('SquisqPlayer');
      expect(html).to.include('squisq-root');
    });

    it('DBK container round-trips through zipToContainer', async () => {
      const data = await readFile(join(validationDir, 'test.dbk'));
      const container = await zipToContainer(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      );
      const md = await container.readDocument();
      expect(md).to.be.a('string').that.includes('# Test Document');
    });
  });
});
