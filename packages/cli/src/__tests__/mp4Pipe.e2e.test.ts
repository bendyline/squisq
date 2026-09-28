/**
 * Self-skipping native Playwright + FFmpeg MP4 smoke test for the streaming
 * (pipe) frame transport, portrait composition, and spool resume.
 */
import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { renderDocToMp4 } from '../api.js';
import { detectFfmpegDetailed } from '../util/detectFfmpeg.js';

async function chromiumAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/** Duration in seconds from the MP4 movie header box (mvhd), or null. */
function mp4Duration(bytes: Uint8Array): number | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = buffer.indexOf('mvhd', 0, 'ascii');
  if (at < 0) return null;
  const version = buffer[at + 4];
  if (version === 1) {
    const timescale = buffer.readUInt32BE(at + 8 + 16);
    const duration = Number(buffer.readBigUInt64BE(at + 8 + 20));
    return duration / timescale;
  }
  const timescale = buffer.readUInt32BE(at + 8 + 8);
  const duration = buffer.readUInt32BE(at + 8 + 12);
  return duration / timescale;
}

function twoSlideDoc(width: number, height: number): Doc {
  const slide = (id: string, startTime: number, fill: string): Doc['blocks'][number] => ({
    id,
    startTime,
    duration: 1.5,
    audioSegment: 0,
    layers: [
      {
        id: 'background',
        type: 'shape',
        position: { x: 0, y: 0, width, height },
        content: { shape: 'rect', fill },
      },
      {
        id: 'title',
        type: 'text',
        position: { x: 16, y: 16 },
        content: { text: id, style: { fontSize: 24, color: '#ffffff' } },
        animation: { type: 'fadeIn', duration: 0.5 },
      },
    ],
  });
  return {
    articleId: `mp4-pipe-${width}x${height}`,
    duration: 3,
    blocks: [slide('slide-blue', 0, '#2563eb'), slide('slide-orange', 1.5, '#f97316')],
    audio: { segments: [] },
  };
}

describe('native MP4 pipe e2e', function () {
  this.timeout(180_000);
  let dir: string;

  before(async function () {
    let hasFfmpeg = false;
    try {
      hasFfmpeg = (await detectFfmpegDetailed()) !== null;
    } catch {
      hasFfmpeg = false;
    }
    const hasChromium = await chromiumAvailable();
    if (!hasFfmpeg || !hasChromium) {
      const missing = [!hasFfmpeg && 'ffmpeg', !hasChromium && 'Playwright Chromium']
        .filter(Boolean)
        .join(' and ');
      if (process.env.SQUISQ_REQUIRE_NATIVE_E2E === '1') {
        throw new Error(`Required native MP4 dependencies are missing: ${missing}`);
      }
      console.error(`  (skipping MP4 pipe e2e — missing ${missing})`);
      this.skip();
    }
    dir = await mkdtemp(join(tmpdir(), `squisq-mp4-pipe-${randomBytes(4).toString('hex')}-`));
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('streams frames to ffmpeg, spools them, and resumes from the spool', async () => {
    const outputPath = join(dir, 'landscape.mp4');
    const framesDir = join(dir, 'frames');
    const doc = twoSlideDoc(320, 180);
    const captured: number[] = [];
    const first = await renderDocToMp4(doc, new MemoryContentContainer(), {
      outputPath,
      width: 320,
      height: 180,
      fps: 10,
      quality: 'draft',
      framesDir,
      onFrame: (frame) => captured.push(frame.captureMs),
    });
    expect(first.frameCount).to.equal(30);
    expect(first.reusedFrameCount).to.equal(0);
    expect(first.framesDir).to.equal(framesDir);
    expect(captured).to.have.length(30);
    const bytes = await readFile(outputPath);
    expect(bytes.subarray(4, 8).toString('ascii')).to.equal('ftyp');
    expect(mp4Duration(bytes)).to.be.closeTo(3, 0.15);
    const spooled = (await readdir(framesDir)).filter((name) => name.startsWith('frame-'));
    expect(spooled).to.have.length(30);
    expect(spooled[0].endsWith('.jpg')).to.equal(true); // draft quality captures JPEG

    const second = await renderDocToMp4(doc, new MemoryContentContainer(), {
      outputPath: join(dir, 'resumed.mp4'),
      width: 320,
      height: 180,
      fps: 10,
      quality: 'draft',
      framesDir,
      resume: true,
    });
    expect(second.reusedFrameCount).to.equal(30);
    expect(second.frameCount).to.equal(30);
  });

  it('composes portrait renders natively (viewport check passes)', async () => {
    const outputPath = join(dir, 'portrait.mp4');
    const result = await renderDocToMp4(twoSlideDoc(180, 320), new MemoryContentContainer(), {
      outputPath,
      width: 180,
      height: 320,
      fps: 5,
      quality: 'draft',
    });
    expect(result.frameCount).to.equal(15);
    expect(mp4Duration(await readFile(outputPath))).to.be.closeTo(3, 0.25);
  });
});
