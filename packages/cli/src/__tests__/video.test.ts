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
    expect(stderr).to.include('FPS must be a number between 1 and 120');
  });
});
