/**
 * Regression: no even-dimension validation anywhere in the H.264 pipeline.
 *
 * `squisq video doc.md --width 851` used to launch a browser, capture every
 * frame — minutes of work — and only then die inside libx264 with "width not
 * divisible by 2", wrapped as an opaque "ffmpeg failed: …".
 *
 * Policy: reject, never round. Width/height are explicit user intent; silently
 * shipping 850 when 851 was asked for corrupts aspect-ratio-sensitive pipelines
 * invisibly. The rejection now happens before the document is even read.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
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

describe('video dimension validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `squisq-dims-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects an odd --width for MP4', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.mp4'),
      '--width',
      '851',
    );
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Video width must be an even number of pixels');
    expect(result.stderr).to.contain('851');
  });

  it('rejects an odd --height for MP4', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.mp4'),
      '--height',
      '1081',
    );
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Video height must be an even number of pixels');
  });

  /** The core of the bug: failing at the END of a long capture is the problem. */
  it('rejects BEFORE reading the document or launching a browser', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.mp4'),
      '--width',
      '851',
    );
    expect(result.stderr).to.not.contain('Reading:');
    expect(result.stderr).to.not.contain('Rendering');
    // And definitely not the old post-capture libx264 failure.
    expect(result.stderr).to.not.contain('ffmpeg failed');
  });

  it('names the nearest legal values so the fix is obvious', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.mp4'),
      '--width',
      '851',
    );
    expect(result.stderr).to.contain('Use 850 or 852');
  });

  it('rejects rather than rounding — no output is produced', async () => {
    const outPath = join(tempDir, 'out.mp4');
    const result = await runCliAllowError('video', FIXTURE_MD, '-o', outPath, '--width', '851');
    expect(result.exitCode).to.equal(1);
    // Rounding to 850 and succeeding would be the wrong fix.
    expect(result.stderr).to.not.contain('✓');
  });

  it('rejects a non-numeric --width as a positive-integer problem', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.mp4'),
      '--width',
      'wide',
    );
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Video width must be a positive integer');
  });

  it('rejects a zero --width', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.mp4'),
      '--width',
      '0',
    );
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Video width must be a positive integer');
  });

  /**
   * One rule for both formats. Native GIF could technically encode odd sizes,
   * but browser GIF export muxes an H.264 intermediate and cannot — a dimension
   * rule that silently depends on output format and runtime is worse than one
   * the user learns once.
   */
  it('applies the same even rule to GIF output', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.gif'),
      '--width',
      '851',
    );
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('even number of pixels');
    expect(result.stderr).to.not.contain('Reading:');
  });

  it('rejects a nonsensical GIF dimension', async () => {
    const result = await runCliAllowError(
      'video',
      FIXTURE_MD,
      '-o',
      join(tempDir, 'out.gif'),
      '--width',
      '-4',
    );
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('Video width must be a positive integer');
  });

  // The accepting case is covered as a unit test in
  // packages/video/src/__tests__/types.test.ts — exercising it here would mean a
  // real Playwright capture + FFmpeg encode for every run.
});
