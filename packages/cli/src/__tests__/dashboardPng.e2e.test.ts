/**
 * Self-skipping native dashboard PNG smoke test.
 *
 * Needs Playwright Chromium ONLY — deliberately no ffmpeg probe, which
 * doubles as a regression guard that the PNG path never grew an ffmpeg
 * dependency (the gate lives in the video/GIF capture path).
 */
import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { convert, renderDocToDashboardPng } from '../api.js';

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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function expectPngWithDimensions(bytes: Uint8Array, width: number, height: number): void {
  expect(Array.from(bytes.slice(0, 8))).to.deep.equal(PNG_SIGNATURE);
  // IHDR is always the first chunk: width at bytes 16-19, height at 20-23.
  expect(readUint32BE(bytes, 16)).to.equal(width);
  expect(readUint32BE(bytes, 20)).to.equal(height);
}

function dashboardDoc(): Doc {
  return {
    articleId: 'dashboard-e2e',
    duration: 20,
    frontmatter: { title: 'Fleet Wall' },
    blocks: [
      { id: 'alpha', startTime: 0, duration: 5, audioSegment: 0, title: 'Alpha' },
      { id: 'beta', startTime: 5, duration: 5, audioSegment: 0, title: 'Beta' },
      { id: 'gamma', startTime: 10, duration: 5, audioSegment: 0, title: 'Gamma' },
      { id: 'delta', startTime: 15, duration: 5, audioSegment: 0, title: 'Delta' },
    ],
    audio: { segments: [] },
  } as Doc;
}

describe('native dashboard PNG e2e', function () {
  this.timeout(120_000);
  const outputPath = join(tmpdir(), `squisq-png-e2e-${randomBytes(6).toString('hex')}.png`);

  before(async function () {
    if (!(await chromiumAvailable())) {
      console.log('  (skipping native dashboard PNG e2e — Chromium not available)');
      this.skip();
    }
  });

  after(async () => {
    await rm(outputPath, { force: true });
  });

  it('renders a dashboard to a PNG with the requested dimensions', async () => {
    const result = await renderDocToDashboardPng(dashboardDoc(), new MemoryContentContainer(), {
      outputPath,
      width: 320,
      height: 180,
    });

    expect(result.width).to.equal(320);
    expect(result.height).to.equal(180);
    expectPngWithDimensions(result.bytes, 320, 180);
    expect(result.outputPath).to.equal(outputPath);
    const written = await readFile(outputPath);
    expectPngWithDimensions(new Uint8Array(written), 320, 180);
  });

  it('exports through convert(..., "png") with format options', async () => {
    const result = await convert(
      {
        kind: 'markdown',
        markdown: '# Fleet Wall\n\n## Alpha\n\nBody A.\n\n## Beta\n\nBody B.',
        baseName: 'fleet-wall',
      },
      'png',
      { formatOptions: { png: { width: 320, height: 320 } } },
    );

    expect(result.mimeType).to.equal('image/png');
    expect(result.suggestedFilename).to.equal('fleet-wall.png');
    expectPngWithDimensions(result.bytes, 320, 320);
  });
});
