/**
 * Regression: the CLI silently overwrote existing output files.
 *
 * A bare `squisq convert report.md` writes seven files next to the input. Before
 * this guard every one of them clobbered any existing file of that name with no
 * prompt, warning, or flag — a hand-edited `report.docx` was simply destroyed.
 *
 * The flag is `--overwrite`, not `--force`/`-f`: `-f` is already `--formats` on
 * `squisq convert`. It is non-interactive by design (scripts pass the flag or
 * get a non-zero exit).
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'index.js');
const FIXTURE_MD = join(import.meta.dirname, 'fixtures', 'test.md');

async function runCliAllowError(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec('node', [CLI_PATH, ...args], { timeout: 60_000 });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('convert output overwrite protection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `squisq-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('refuses to clobber an existing -o output and preserves its contents', async () => {
    const outFile = join(tempDir, 'precious.html');
    await writeFile(outFile, 'HAND EDITED — DO NOT LOSE');

    const result = await runCliAllowError('convert', FIXTURE_MD, '-o', outFile);

    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('already exists');
    expect(result.stderr).to.contain('--overwrite');
    // The whole point: the file is untouched.
    expect(await readFile(outFile, 'utf-8')).to.equal('HAND EDITED — DO NOT LOSE');
  });

  it('replaces the file when --overwrite is passed', async () => {
    const outFile = join(tempDir, 'precious.html');
    await writeFile(outFile, 'old contents');

    const result = await runCliAllowError('convert', FIXTURE_MD, '-o', outFile, '--overwrite');

    expect(result.exitCode).to.equal(0);
    const html = await readFile(outFile, 'utf-8');
    expect(html).to.contain('SquisqPlayer');
  });

  it('writes normally when no file is in the way', async () => {
    const outFile = join(tempDir, 'fresh.html');
    const result = await runCliAllowError('convert', FIXTURE_MD, '-o', outFile);
    expect(result.exitCode).to.equal(0);
    expect(await exists(outFile)).to.equal(true);
  });

  /**
   * The dangerous multi-format case: refusing must happen BEFORE any
   * conversion, otherwise the earlier formats are already destroyed by the time
   * the collision is noticed.
   */
  it('refuses the whole multi-format run up front, writing nothing', async () => {
    const pdfPath = join(tempDir, 'test.pdf');
    await writeFile(pdfPath, 'EXISTING PDF');

    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'docx,pdf');

    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('already exists');
    expect(result.stderr).to.contain('test.pdf');
    // The pre-existing file survives...
    expect(await readFile(pdfPath, 'utf-8')).to.equal('EXISTING PDF');
    // ...and the non-colliding format was never written either.
    expect(await exists(join(tempDir, 'test.docx'))).to.equal(false);
  });

  it('lists every colliding path so one run tells the user everything', async () => {
    await writeFile(join(tempDir, 'test.pdf'), 'x');
    await writeFile(join(tempDir, 'test.docx'), 'y');

    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'docx,pdf');

    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('test.pdf');
    expect(result.stderr).to.contain('test.docx');
  });

  it('proceeds through a multi-format run with --overwrite', async () => {
    await writeFile(join(tempDir, 'test.pdf'), 'EXISTING PDF');

    const result = await runCliAllowError(
      'convert',
      FIXTURE_MD,
      '-d',
      tempDir,
      '-f',
      'docx,pdf',
      '--overwrite',
    );

    expect(result.exitCode).to.equal(0);
    const pdf = await readFile(join(tempDir, 'test.pdf'));
    expect(pdf.subarray(0, 5).toString('ascii')).to.equal('%PDF-');
  });
});

describe('video output overwrite protection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `squisq-vguard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Must refuse before rendering — a video render costs minutes, and the old
   * code passed `-y` to ffmpeg, destroying the existing file at the very end.
   */
  it('refuses an existing output before doing any render work', async () => {
    const outFile = join(tempDir, 'existing.mp4');
    await writeFile(outFile, 'PREVIOUS RENDER');

    const result = await runCliAllowError('video', FIXTURE_MD, '-o', outFile);

    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('already exists');
    expect(result.stderr).to.contain('--overwrite');
    expect(await readFile(outFile, 'utf-8')).to.equal('PREVIOUS RENDER');
    // Refused before even reading the document.
    expect(result.stderr).to.not.contain('Reading:');
  });
});
