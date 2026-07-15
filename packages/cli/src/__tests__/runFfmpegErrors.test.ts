/**
 * Regression: `runFfmpeg` used to reject with `err.message` straight from
 * `execFile`, which is "Command failed: <the entire command line>" followed by
 * the whole buffered stderr. An encode failure therefore printed dozens of
 * temp-file arguments under an `Error:` heading — wildly at odds with the rest
 * of the CLI's error formatting, and burying the one line that says what broke.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { describeFfmpegFailure, lastMeaningfulFfmpegLine, runFfmpeg } from '../util/runFfmpeg.js';
import type { ExecFileException } from 'node:child_process';

/** Realistic libx264 output for the odd-dimension failure. */
const ODD_DIMENSION_STDERR = [
  'ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers',
  '  built with gcc 13.2.0',
  '  configuration: --prefix=/usr --enable-gpl --enable-libx264 --enable-libmp3lame',
  '  libavutil      58. 29.100 / 58. 29.100',
  '  libavcodec     60. 31.102 / 60. 31.102',
  "Input #0, image2, from '/tmp/squisq-video-ab12/frame-%03d.png':",
  '  Duration: 00:00:03.00, start: 0.000000, bitrate: N/A',
  '  Stream #0:0: Video: png, rgba(pc), 851x480, 30 fps, 30 tbr, 30 tbn',
  'Stream mapping:',
  '  Stream #0:0 -> #0:0 (png (native) -> h264 (libx264))',
  '[libx264 @ 0x55d3f8e1a2c0] width not divisible by 2 (851x480)',
  '[vost#0:0/libx264 @ 0x55d3f8e0b100] Error while opening encoder - maybe incorrect parameters',
  'Conversion failed!',
].join('\n');

function execError(overrides: Partial<ExecFileException> = {}): ExecFileException {
  return Object.assign(new Error('Command failed: ffmpeg -y -framerate 30 -i /tmp/...'), {
    code: 1 as unknown,
    ...overrides,
  }) as ExecFileException;
}

describe('runFfmpeg failure messages', () => {
  describe('lastMeaningfulFfmpegLine', () => {
    it('picks the line that names the problem out of a full ffmpeg log', () => {
      const line = lastMeaningfulFfmpegLine(ODD_DIMENSION_STDERR);
      expect(line).to.contain('width not divisible by 2');
    });

    it('strips the heap addresses ffmpeg stamps into component tags', () => {
      const line = lastMeaningfulFfmpegLine(ODD_DIMENSION_STDERR);
      expect(line).to.not.match(/0x[0-9a-f]{6,}/i);
      expect(line).to.contain('[libx264]');
    });

    it('drops banner, configuration, and stream-info noise', () => {
      const line = lastMeaningfulFfmpegLine(ODD_DIMENSION_STDERR)!;
      expect(line).to.not.contain('ffmpeg version');
      expect(line).to.not.contain('configuration:');
    });

    it('falls back to the last real line when nothing looks error-ish', () => {
      expect(lastMeaningfulFfmpegLine('something unusual happened\n\n')).to.equal(
        'something unusual happened',
      );
    });

    it('returns null for empty or noise-only stderr', () => {
      expect(lastMeaningfulFfmpegLine('')).to.equal(null);
      expect(lastMeaningfulFfmpegLine('   \n\n  ')).to.equal(null);
    });
  });

  describe('describeFfmpegFailure', () => {
    it('never leaks the "Command failed: <command line>" prefix', () => {
      const message = describeFfmpegFailure(execError(), ODD_DIMENSION_STDERR, 600_000);
      expect(message).to.not.contain('Command failed');
      expect(message).to.not.contain('-framerate');
      expect(message).to.not.contain('/tmp/');
    });

    it('surfaces the real cause plus the exit code', () => {
      const message = describeFfmpegFailure(execError(), ODD_DIMENSION_STDERR, 600_000);
      expect(message).to.contain('width not divisible by 2');
      expect(message).to.contain('exit code 1');
    });

    it('stays a single concise line', () => {
      const message = describeFfmpegFailure(execError(), ODD_DIMENSION_STDERR, 600_000);
      expect(message.split('\n')).to.have.lengthOf(1);
      expect(message.length).to.be.lessThan(160);
    });

    it('gives an actionable message when the binary is missing', () => {
      const message = describeFfmpegFailure(execError({ code: 'ENOENT' }), '', 600_000);
      expect(message).to.contain('ENOENT');
      expect(message).to.contain('squisq doctor');
    });

    it('reports a timeout as a timeout, in seconds', () => {
      const message = describeFfmpegFailure(execError({ killed: true }), '', 600_000);
      expect(message).to.contain('timed out after 600s');
    });

    it('degrades gracefully when ffmpeg said nothing', () => {
      const message = describeFfmpegFailure(execError(), '', 600_000);
      expect(message).to.contain('exit code 1');
    });
  });

  describe('end to end', () => {
    it('prefixes the caller failureMessage and omits the command line', async () => {
      // A child that prints an ffmpeg-shaped error and exits non-zero.
      const script =
        'console.error("[libx264 @ 0x55d3f8e1a2c0] width not divisible by 2 (851x480)");' +
        'process.exit(1);';
      try {
        await runFfmpeg(process.execPath, ['-e', script], {
          timeoutMs: 30_000,
          failureMessage: 'ffmpeg failed',
        });
        expect.fail('Expected a rejection');
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).to.contain('ffmpeg failed:');
        expect(message).to.contain('width not divisible by 2');
        expect(message).to.contain('[libx264]');
        expect(message).to.not.contain('Command failed');
        expect(message).to.not.contain('-e');
      }
    });
  });
});
