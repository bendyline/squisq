/**
 * video command flag-validation tests
 *
 * Exercises option validation only — no actual video rendering (which would
 * require ffmpeg + Chromium and minutes of wall time). Every case here must
 * fail before the render pipeline starts.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'index.js');
const FIXTURE_MD = join(import.meta.dirname, 'fixtures', 'test.md');

/** Run the CLI expecting a non-zero exit; return the captured stderr. */
async function runCliExpectingError(...args: string[]): Promise<string> {
  try {
    await exec('node', [CLI_PATH, ...args], { timeout: 30_000 });
  } catch (err: unknown) {
    return (err as { stderr: string }).stderr;
  }
  expect.fail('Expected a non-zero exit');
}

describe('video command flag validation', () => {
  it('rejects an unknown transform style', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '--transform', 'bogus-style');
    expect(stderr).to.include('Unknown transform style "bogus-style"');
    expect(stderr).to.include('Available:');
  });

  it('rejects an unknown theme', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '--theme', 'bogus-theme');
    expect(stderr).to.include('Unknown theme "bogus-theme"');
    expect(stderr).to.include('Available:');
  });

  it('accepts a valid transform style (theme validation is reached next)', async () => {
    // A valid --transform must pass validation; the run then fails on the
    // bogus theme, proving the transform check did not reject it.
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '--transform',
      'documentary',
      '--theme',
      'bogus-theme',
    );
    expect(stderr).to.not.include('Unknown transform style');
    expect(stderr).to.include('Unknown theme "bogus-theme"');
  });

  it('rejects a negative cover pre-roll', async () => {
    // `=` form so commander doesn't mistake "-1" for an option flag
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '--cover-preroll=-1',
      '--theme',
      'bogus-theme',
    );
    expect(stderr).to.include('Cover pre-roll must be a number of seconds >= 0');
  });

  it('rejects a non-numeric cover pre-roll', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '--cover-preroll', 'abc');
    expect(stderr).to.include('Cover pre-roll must be a number of seconds >= 0');
  });

  it('accepts a valid cover pre-roll (validation is passed through)', async () => {
    // 0 is a valid pre-roll; the run then fails on the bogus theme, proving
    // the pre-roll check did not reject it.
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '--cover-preroll',
      '0',
      '--theme',
      'bogus-theme',
    );
    expect(stderr).to.not.include('Cover pre-roll');
    expect(stderr).to.include('Unknown theme "bogus-theme"');
  });

  it('rejects invalid fps', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '--fps', '0');
    expect(stderr).to.include('FPS must be an integer between 1 and 120');
  });

  it('rejects fractional and partially numeric fps values', async () => {
    for (const value of ['1.9', '30fps']) {
      const stderr = await runCliExpectingError('video', FIXTURE_MD, '--fps', value);
      expect(stderr).to.include('FPS must be an integer between 1 and 120');
      expect(stderr).to.not.include('Reading:');
    }
  });

  it('rejects an unknown output format', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '--format', 'webp');
    expect(stderr).to.include('Invalid format "webp". Valid: mp4, gif');
  });

  it('infers GIF from the output extension and applies its FPS limit', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '-o', 'out.gif', '--fps', '101');
    expect(stderr).to.include('FPS must be an integer between 1 and 100');
  });

  it('rejects positional and flagged outputs together', async () => {
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      'positional.mp4',
      '--output',
      'flag.mp4',
    );
    expect(stderr).to.include('positional output and --output cannot be used together');
    expect(stderr).to.not.include('Reading:');
  });

  it('rejects a format that conflicts with the output extension', async () => {
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '-o',
      'out.gif',
      '--format',
      'mp4',
    );
    expect(stderr).to.include('Output extension ".gif" conflicts with --format mp4');
  });

  it('rejects an output path whose media format cannot be inferred', async () => {
    const stderr = await runCliExpectingError('video', FIXTURE_MD, '-o', 'out.bin');
    expect(stderr).to.include('Output path must end in .mp4 or .gif');
  });

  it('validates GIF palette options before rendering', async () => {
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '--format',
      'gif',
      '--max-colors',
      '257',
    );
    expect(stderr).to.include('GIF max colors must be an integer between 2 and 256');
  });

  it('rejects the MP4-only quality option for GIF output', async () => {
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '--format',
      'gif',
      '--quality',
      'draft',
    );
    expect(stderr).to.include('--quality only applies to MP4 output');
  });

  it('accepts GIF and --no-animations options through early validation', async () => {
    const stderr = await runCliExpectingError(
      'video',
      FIXTURE_MD,
      '--format',
      'gif',
      '--no-animations',
      '--theme',
      'bogus-theme',
    );
    expect(stderr).to.not.include('Invalid format');
    expect(stderr).to.not.include('unknown option');
    expect(stderr).to.include('Unknown theme "bogus-theme"');
  });
});
