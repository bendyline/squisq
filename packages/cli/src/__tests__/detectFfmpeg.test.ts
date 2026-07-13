/**
 * detectFfmpeg unit tests
 *
 * Exercises the resolution order in-process: an SQUISQ_FFMPEG env override
 * wins (and is verified), a broken override is a hard error, and detection
 * falls through cleanly when the override is unset.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectFfmpegDetailed, getFfmpegVersion } from '../util/detectFfmpeg.js';

describe('detectFfmpeg', () => {
  let tempDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    savedEnv = process.env.SQUISQ_FFMPEG;
    delete process.env.SQUISQ_FFMPEG;
    tempDir = join(tmpdir(), `squisq-ffmpeg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.SQUISQ_FFMPEG;
    else process.env.SQUISQ_FFMPEG = savedEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Write a fake executable that responds to `-version` like ffmpeg does. */
  async function writeFakeFfmpeg(): Promise<string> {
    const fakePath = join(tempDir, 'fake-ffmpeg');
    await writeFile(fakePath, '#!/bin/sh\necho "ffmpeg version 0.0-test"\n');
    await chmod(fakePath, 0o755);
    return fakePath;
  }

  it('SQUISQ_FFMPEG override wins and reports source "env"', async function () {
    if (process.platform === 'win32') this.skip(); // fake binary is a shell script

    const fakePath = await writeFakeFfmpeg();
    process.env.SQUISQ_FFMPEG = fakePath;

    const detection = await detectFfmpegDetailed();
    expect(detection).to.not.equal(null);
    expect(detection!.path).to.equal(fakePath);
    expect(detection!.source).to.equal('env');
  });

  it('errors clearly when SQUISQ_FFMPEG is set but broken', async () => {
    process.env.SQUISQ_FFMPEG = join(tempDir, 'does-not-exist');

    try {
      await detectFfmpegDetailed();
      expect.fail('Expected detectFfmpegDetailed to throw');
    } catch (err: unknown) {
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.include('SQUISQ_FFMPEG');
      expect((err as Error).message).to.include('does-not-exist');
    }
  });

  it('falls through cleanly when SQUISQ_FFMPEG is unset', async () => {
    // Whatever this machine has (PATH ffmpeg, ffmpeg-static, or nothing),
    // the un-overridden lookup must not throw and must never report "env".
    const detection = await detectFfmpegDetailed();
    if (detection) {
      expect(detection.source).to.be.oneOf(['path', 'ffmpeg-static']);
      expect(detection.path).to.be.a('string');
      expect(detection.path.length).to.be.greaterThan(0);
    } else {
      expect(detection).to.equal(null);
    }
  });

  it('preserves a pre-aborted caller reason', async () => {
    const controller = new AbortController();
    const reason = new Error('stop ffmpeg detection');
    controller.abort(reason);

    try {
      await detectFfmpegDetailed(controller.signal);
      expect.fail('Expected detectFfmpegDetailed to abort');
    } catch (err: unknown) {
      expect(err).to.equal(reason);
    }
  });

  it('getFfmpegVersion returns the first line for a working binary and null for a broken one', async function () {
    if (process.platform === 'win32') this.skip();

    const fakePath = await writeFakeFfmpeg();
    expect(await getFfmpegVersion(fakePath)).to.equal('ffmpeg version 0.0-test');
    expect(await getFfmpegVersion(join(tempDir, 'missing'))).to.equal(null);
  });
});
