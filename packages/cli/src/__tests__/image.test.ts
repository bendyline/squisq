/**
 * image command flag-validation tests
 *
 * Exercises option validation only — no actual rendering (which would
 * require Chromium and real wall time). Every case here must fail before
 * the render pipeline starts.
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

describe('image command flag validation', () => {
  it('rejects an unknown resolution preset', async () => {
    const stderr = await runCliExpectingError('image', FIXTURE_MD, '--resolution', '8k');
    expect(stderr).to.include('Unknown resolution preset "8k"');
    expect(stderr).to.include('fhd');
  });

  it('rejects a lone width or height', async () => {
    const width = await runCliExpectingError('image', FIXTURE_MD, '--width', '800');
    expect(width).to.include('both width and height');
    const height = await runCliExpectingError('image', FIXTURE_MD, '--height', '600');
    expect(height).to.include('both width and height');
  });

  it('rejects combining a preset with custom dimensions', async () => {
    const stderr = await runCliExpectingError(
      'image',
      FIXTURE_MD,
      '--resolution',
      'fhd',
      '--width',
      '800',
      '--height',
      '600',
    );
    expect(stderr).to.include('not both');
  });

  it('rejects out-of-range custom dimensions', async () => {
    const small = await runCliExpectingError(
      'image',
      FIXTURE_MD,
      '--width',
      '63',
      '--height',
      '600',
    );
    expect(small).to.include('at least 64');
    const large = await runCliExpectingError(
      'image',
      FIXTURE_MD,
      '--width',
      '7681',
      '--height',
      '600',
    );
    expect(large).to.include('at most 7680');
    const budget = await runCliExpectingError(
      'image',
      FIXTURE_MD,
      '--width',
      '7680',
      '--height',
      '7680',
    );
    expect(budget).to.include('total pixels');
  });

  it('accepts odd dimensions (no H.264 even-dimension rule) — theme check is reached next', async () => {
    const stderr = await runCliExpectingError(
      'image',
      FIXTURE_MD,
      '--width',
      '851',
      '--height',
      '479',
      '--theme',
      'bogus-theme',
    );
    expect(stderr).to.not.include('at least 64');
    expect(stderr).to.not.include('even');
    expect(stderr).to.include('Unknown theme "bogus-theme"');
  });

  it('rejects a non-.png output path', async () => {
    const stderr = await runCliExpectingError('image', FIXTURE_MD, '-o', 'out.jpg');
    expect(stderr).to.include('must end in .png');
  });

  it('rejects an unknown output format', async () => {
    const stderr = await runCliExpectingError('image', FIXTURE_MD, '--format', 'webp');
    expect(stderr).to.include('Invalid format "webp"');
  });

  it('rejects an unknown dashboard layout after reading the doc', async () => {
    const stderr = await runCliExpectingError('image', FIXTURE_MD, '--layout', 'no-such-layout');
    expect(stderr).to.include('Unknown dashboard layout "no-such-layout"');
    expect(stderr).to.include('grid-2x2');
  });

  it('rejects an unknown transform style', async () => {
    const stderr = await runCliExpectingError('image', FIXTURE_MD, '--transform', 'bogus-style');
    expect(stderr).to.include('Unknown transform style "bogus-style"');
  });

  it('accepts a valid resolution and layout (theme validation is reached next)', async () => {
    const stderr = await runCliExpectingError(
      'image',
      FIXTURE_MD,
      '--resolution',
      'square',
      '--layout',
      'grid-2x2',
      '--no-title',
      '--theme',
      'bogus-theme',
    );
    expect(stderr).to.not.include('Unknown resolution preset');
    expect(stderr).to.not.include('Unknown dashboard layout');
    expect(stderr).to.include('Unknown theme "bogus-theme"');
  });

  it('rejects using the positional output and --output together', async () => {
    const stderr = await runCliExpectingError('image', FIXTURE_MD, 'out.png', '-o', 'other.png');
    expect(stderr).to.include('positional output and --output cannot be used together');
  });
});
