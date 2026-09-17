/**
 * Native managed-cover PNG smoke test.
 *
 * Exercises the public CLI API Qualla's Electron wallpaper export consumes.
 * The test only needs Playwright Chromium and self-skips when Chromium is not
 * installed, keeping the generic cover renderer independent of ffmpeg.
 */
import { before, describe, it } from 'mocha';
import { expect } from 'chai';
import type { Doc } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { renderDocCoverToPng } from '../api.js';

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

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

describe('native managed-cover PNG e2e', function () {
  this.timeout(120_000);

  before(async function () {
    if (!(await chromiumAvailable())) {
      console.log('  (skipping native managed-cover PNG e2e — Chromium not available)');
      this.skip();
    }
  });

  it('renders the cover at the requested dimensions', async () => {
    const doc: Doc = {
      articleId: 'cover-e2e',
      duration: 0,
      blocks: [],
      audio: { segments: [] },
      startBlock: {
        title: 'A Managed Cover',
        subtitle: 'Rendered through the public API',
      },
    };

    const result = await renderDocCoverToPng(doc, new MemoryContentContainer(), {
      width: 320,
      height: 180,
    });

    expect(Array.from(result.bytes.slice(0, 8))).to.deep.equal([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(readUint32BE(result.bytes, 16)).to.equal(320);
    expect(readUint32BE(result.bytes, 20)).to.equal(180);
  });
});
