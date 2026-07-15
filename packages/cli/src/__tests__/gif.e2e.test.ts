/** Self-skipping native Playwright + FFmpeg animated-GIF smoke test. */
import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { renderDocToGif } from '../api.js';
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

/** Count image descriptors while respecting GIF color tables and sub-blocks. */
function countGifFrames(bytes: Uint8Array): number {
  if (bytes.byteLength < 13) return 0;
  let offset = 13;
  const globalPacked = bytes[10];
  if ((globalPacked & 0x80) !== 0) offset += 3 * 2 ** ((globalPacked & 0x07) + 1);

  let frames = 0;
  const skipSubBlocks = () => {
    while (offset < bytes.byteLength) {
      const size = bytes[offset++];
      if (size === 0) return;
      offset += size;
    }
  };

  while (offset < bytes.byteLength) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset += 1; // extension label
      skipSubBlocks();
      continue;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (offset + 9 > bytes.byteLength) break;
      const localPacked = bytes[offset + 8];
      offset += 9;
      if ((localPacked & 0x80) !== 0) offset += 3 * 2 ** ((localPacked & 0x07) + 1);
      offset += 1; // LZW minimum code size
      skipSubBlocks();
      continue;
    }
    // Padding is legal; any other marker means the stream is malformed.
    if (marker !== 0x00) break;
  }
  return frames;
}

describe('native animated GIF e2e', function () {
  this.timeout(120_000);
  const outputPath = join(tmpdir(), `squisq-gif-e2e-${randomBytes(6).toString('hex')}.gif`);

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
        throw new Error(`Required native GIF dependencies are missing: ${missing}`);
      }
      console.error(`  (skipping animated GIF e2e — missing ${missing})`);
      this.skip();
    }
  });

  after(async () => {
    await rm(outputPath, { force: true });
  });

  it('renders a real animated GIF through the native pipeline', async () => {
    const doc: Doc = {
      articleId: 'gif-e2e',
      duration: 1,
      blocks: [
        {
          id: 'slide-blue',
          startTime: 0,
          duration: 0.5,
          audioSegment: 0,
          layers: [
            {
              id: 'background',
              type: 'shape',
              position: { x: 0, y: 0, width: 160, height: 90 },
              content: { shape: 'rect', fill: '#2563eb' },
            },
          ],
        },
        {
          id: 'slide-orange',
          startTime: 0.5,
          duration: 0.5,
          audioSegment: 0,
          layers: [
            {
              id: 'background',
              type: 'shape',
              position: { x: 0, y: 0, width: 160, height: 90 },
              content: { shape: 'rect', fill: '#f97316' },
            },
          ],
        },
      ],
      audio: { segments: [] },
    };

    const result = await renderDocToGif(doc, new MemoryContentContainer(), {
      outputPath,
      width: 160,
      height: 90,
      fps: 2,
      animationsEnabled: false,
    });
    const bytes = await readFile(outputPath);
    const magic = bytes.subarray(0, 6).toString('ascii');
    expect(['GIF87a', 'GIF89a']).to.include(magic);
    expect(result.frameCount).to.be.greaterThan(1);
    expect(countGifFrames(bytes)).to.be.greaterThan(1);
    expect(result.warnings).to.deep.equal([]);
  });
});
