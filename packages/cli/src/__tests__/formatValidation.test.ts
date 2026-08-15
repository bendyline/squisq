/**
 * Regression: `--formats` typos were warn-and-continue with exit 0.
 *
 * `squisq convert doc.md -f docx,pfd` warned about `pfd`, produced only the
 * DOCX, and exited 0. In CI that is indistinguishable from success — the
 * missing PDF goes unnoticed until someone looks for the artifact.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { suggestId } from '../util/suggestId.js';

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

describe('--formats validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `squisq-fmt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails hard on a typo instead of warning and exiting 0', async () => {
    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'docx,pfd');

    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Unknown format');
    expect(result.stderr).to.contain('pfd');
  });

  it('suggests the intended format for a near-miss typo', async () => {
    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'docx,pfd');
    expect(result.stderr).to.contain('did you mean "pdf"');
  });

  it('produces nothing at all when one id is bad', async () => {
    await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'docx,pfd');
    // The bug: the DOCX was produced and the run "succeeded" without the PDF.
    expect(await exists(join(tempDir, 'test.docx'))).to.equal(false);
  });

  it('lists the valid ids', async () => {
    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'pfd');
    expect(result.stderr).to.contain('Valid:');
    expect(result.stderr).to.contain('docx');
    expect(result.stderr).to.contain('pdf');
  });

  it('reports every unknown id at once', async () => {
    const result = await runCliAllowError(
      'convert',
      FIXTURE_MD,
      '-d',
      tempDir,
      '-f',
      'docx,pfd,epubb',
    );
    expect(result.stderr).to.contain('Unknown formats');
    expect(result.stderr).to.contain('pfd');
    expect(result.stderr).to.contain('epubb');
  });

  it('errors when --formats is entirely unknown', async () => {
    const result = await runCliAllowError('convert', FIXTURE_MD, '--formats', 'bogus');
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Unknown format');
  });

  it('errors on an empty --formats value', async () => {
    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', ',');
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('No formats specified');
  });

  it('still accepts a list of valid ids', async () => {
    const result = await runCliAllowError('convert', FIXTURE_MD, '-d', tempDir, '-f', 'docx');
    expect(result.exitCode).to.equal(0);
    expect(await exists(join(tempDir, 'test.docx'))).to.equal(true);
  });
});

describe('suggestId', () => {
  const formats = [
    'md',
    'docx',
    'pptx',
    'pdf',
    'html',
    'htmlzip',
    'epub',
    'dbk',
    'mp4',
    'gif',
    'png',
  ];

  it('catches a transposition', () => {
    expect(suggestId('pfd', formats)).to.equal('pdf');
  });

  it('catches a doubled character', () => {
    expect(suggestId('epubb', formats)).to.equal('epub');
  });

  it('catches a missing character', () => {
    expect(suggestId('docs', formats)).to.equal('docx');
  });

  it('declines to guess for wholly unrelated input', () => {
    expect(suggestId('quicktime', formats)).to.equal(null);
  });
});
