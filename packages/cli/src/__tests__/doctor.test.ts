import { describe, it } from 'mocha';
import { expect } from 'chai';
import { runDoctor, type DoctorRuntime } from '../commands/doctor.js';

function makeRuntime(overrides: Partial<DoctorRuntime> = {}) {
  const lines: string[] = [];
  let closeCount = 0;
  const runtime: DoctorRuntime = {
    nodeVersion: 'v22.14.0-test',
    detectFfmpeg: async () => ({ path: '/tools/ffmpeg', source: 'path' }),
    getFfmpegVersion: async () => 'ffmpeg version 7.1',
    launchChromium: async () => ({
      executablePath: '/browsers/chromium',
      close: async () => {
        closeCount += 1;
      },
    }),
    log: (line) => lines.push(line),
    ...overrides,
  };
  return { runtime, lines, closeCount: () => closeCount };
}

describe('doctor command checks', () => {
  it('reports a healthy video-rendering environment', async () => {
    const test = makeRuntime();

    expect(await runDoctor(test.runtime)).to.equal(true);
    expect(test.closeCount()).to.equal(1);
    expect(test.lines).to.deep.equal([
      'Node:     v22.14.0-test',
      'ffmpeg:   /tools/ffmpeg (source: path) — ffmpeg version 7.1',
      'Chromium: available (/browsers/chromium)',
      '\n✓ All checks passed',
    ]);
  });

  it('provides install guidance when ffmpeg is missing', async () => {
    const test = makeRuntime({ detectFfmpeg: async () => null });

    expect(await runDoctor(test.runtime)).to.equal(false);
    expect(test.closeCount()).to.equal(1);
    expect(test.lines).to.include('ffmpeg:   not found.');
    expect(test.lines).to.include('            Windows: winget install ffmpeg');
    expect(test.lines[test.lines.length - 1]).to.equal('\n✗ Some checks failed');
  });

  it('reports detector and Chromium launch failures without hiding either check', async () => {
    const test = makeRuntime({
      detectFfmpeg: async () => {
        throw new Error('configured ffmpeg is broken');
      },
      launchChromium: async () => {
        throw new Error('browser missing\nlong Playwright details');
      },
    });

    expect(await runDoctor(test.runtime)).to.equal(false);
    expect(test.lines).to.include('ffmpeg:   configured ffmpeg is broken');
    expect(test.lines).to.include('Chromium: not available — browser missing');
    expect(test.lines.join('\n')).not.to.include('long Playwright details');
    expect(test.lines).to.include('          Run: npx playwright install chromium');
  });

  it('keeps a detected binary usable when its version is unavailable', async () => {
    const test = makeRuntime({ getFfmpegVersion: async () => null });

    expect(await runDoctor(test.runtime)).to.equal(true);
    expect(test.lines).to.include('ffmpeg:   /tools/ffmpeg (source: path) — version unknown');
  });
});
