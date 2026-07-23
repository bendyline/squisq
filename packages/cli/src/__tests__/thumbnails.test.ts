import { afterEach, beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractThumbnails } from '../api.js';

describe('extractThumbnails cancellation', () => {
  let tempDir: string;
  let savedFfmpeg: string | undefined;

  beforeEach(async () => {
    savedFfmpeg = process.env.SQUISQ_FFMPEG;
    tempDir = join(
      tmpdir(),
      `squisq-thumbnails-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (savedFfmpeg === undefined) delete process.env.SQUISQ_FFMPEG;
    else process.env.SQUISQ_FFMPEG = savedFfmpeg;
    delete process.env.SQUISQ_THUMB_STARTED;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('preserves a pre-aborted caller reason before FFmpeg detection', async () => {
    const controller = new AbortController();
    const reason = new Error('thumbnail request cancelled');
    controller.abort(reason);

    let caught: unknown;
    try {
      await extractThumbnails({
        videoPath: join(tempDir, 'input.mp4'),
        outputDir: tempDir,
        slug: 'preview',
        sizes: [{ name: 'preview', width: 640, height: 360, filter: 'scale=640:360' }],
        signal: controller.signal,
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).to.equal(reason);
  });

  it('rejects POSIX, Windows, mixed-separator, drive, and UNC path slugs before FFmpeg detection', async () => {
    const unsafe = [
      '../escaped',
      '..\\escaped',
      'mixed/..\\escaped',
      '/absolute',
      'C:\\absolute',
      '\\\\server\\share',
      'folder/name',
      'folder\\name',
      '.',
      '..',
      'bad:slug',
    ];

    for (const slug of unsafe) {
      let caught: unknown;
      try {
        await extractThumbnails({
          videoPath: join(tempDir, 'input.mp4'),
          outputDir: tempDir,
          slug,
          sizes: [{ name: 'preview', width: 640, height: 360, filter: 'scale=640:360' }],
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught, slug).to.be.instanceOf(TypeError);
      expect((caught as Error).message, slug).to.contain('Thumbnail slug');
    }
  });

  it('preserves a pre-existing thumbnail when force is false', async function () {
    if (process.platform === 'win32') this.skip();

    const invokedPath = join(tempDir, 'invoked');
    const fakeFfmpeg = join(tempDir, 'fake-ffmpeg-skip');
    await writeFile(
      fakeFfmpeg,
      '#!/bin/sh\n' +
        'if [ "$1" = "-version" ]; then echo "ffmpeg version 0.0-test"; exit 0; fi\n' +
        `touch "${invokedPath}"\n` +
        'exit 1\n',
    );
    await chmod(fakeFfmpeg, 0o755);
    process.env.SQUISQ_FFMPEG = fakeFfmpeg;

    const outputPath = join(tempDir, 'preview-640x360.jpg');
    await writeFile(outputPath, 'original');
    await extractThumbnails({
      videoPath: join(tempDir, 'input.mp4'),
      outputDir: tempDir,
      slug: 'preview',
      sizes: [{ name: 'preview', width: 640, height: 360, filter: 'scale=640:360' }],
    });

    expect(await readFile(outputPath, 'utf8')).to.equal('original');
    let invoked = true;
    try {
      await access(invokedPath);
    } catch {
      invoked = false;
    }
    expect(invoked).to.equal(false);
  });

  it('terminates an active FFmpeg child and preserves the exact reason', async function () {
    if (process.platform === 'win32') this.skip();

    const startedPath = join(tempDir, 'started');
    const fakeFfmpeg = join(tempDir, 'fake-ffmpeg');
    await writeFile(
      fakeFfmpeg,
      '#!/bin/sh\n' +
        'if [ "$1" = "-version" ]; then echo "ffmpeg version 0.0-test"; exit 0; fi\n' +
        'for output in "$@"; do :; done\n' +
        'echo partial > "$output"\n' +
        'touch "$SQUISQ_THUMB_STARTED"\n' +
        "trap 'exit 143' TERM INT\n" +
        'while :; do :; done\n',
    );
    await chmod(fakeFfmpeg, 0o755);
    process.env.SQUISQ_FFMPEG = fakeFfmpeg;
    process.env.SQUISQ_THUMB_STARTED = startedPath;

    const controller = new AbortController();
    const reason = new Error('stop active thumbnail extraction');
    const pending = extractThumbnails({
      videoPath: join(tempDir, 'input.mp4'),
      outputDir: tempDir,
      slug: 'preview',
      sizes: [{ name: 'preview', width: 640, height: 360, filter: 'scale=640:360' }],
      signal: controller.signal,
    });

    let started = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await access(startedPath);
        started = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(started).to.equal(true);
    controller.abort(reason);

    let caught: unknown;
    try {
      await pending;
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).to.equal(reason);
    let outputExists = true;
    try {
      await access(join(tempDir, 'preview-640x360.jpg'));
    } catch {
      outputExists = false;
    }
    expect(outputExists).to.equal(false);
  });
});
