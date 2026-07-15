/**
 * Flagship pptx → mp4 end-to-end test.
 *
 * This is the one place the full CLI video pipeline is exercised for real:
 * a tiny PPTX (built in-memory from markdown + a 1×1 PNG) is imported into a
 * ContentContainer, then converted to MP4 through the programmatic
 * `convert(..., 'mp4')` surface — which drives the standalone player under
 * headless Chromium and encodes frames + audio with native ffmpeg.
 *
 * Local development may skip when native tools are absent. CI/release set
 * SQUISQ_REQUIRE_NATIVE_E2E=1, which turns a missing dependency into a failure.
 */

import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { detectFfmpegDetailed } from '../util/detectFfmpeg.js';

// 1×1 transparent PNG (68 bytes). Enough for the pptx image-extraction path.
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SAMPLE_MD = [
  '# Flagship Deck',
  '',
  'A one-slide deck for the mp4 pipeline smoke test.',
  '',
  '![Pixel](images/pixel.png)',
  '',
  '## Second Slide',
  '',
  'A little more content so the doc has real duration.',
  '',
].join('\n');

/** Probe whether Playwright Chromium can actually launch here. */
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

describe('flagship pptx → mp4 e2e', function () {
  // Rendering runs Playwright + ffmpeg; give it plenty of headroom.
  this.timeout(120_000);

  const tmpFiles: string[] = [];
  let ffmpegPath: string | null = null;
  let hasChromium = false;

  before(async function () {
    try {
      ffmpegPath = (await detectFfmpegDetailed())?.path ?? null;
    } catch {
      // SQUISQ_FFMPEG set but broken — treat as unavailable for this test.
      ffmpegPath = null;
    }
    hasChromium = await chromiumAvailable();

    if (!ffmpegPath || !hasChromium) {
      const missing = [!ffmpegPath && 'ffmpeg', !hasChromium && 'Playwright Chromium']
        .filter(Boolean)
        .join(' and ');
      if (process.env.SQUISQ_REQUIRE_NATIVE_E2E === '1') {
        throw new Error(`Required flagship MP4 dependencies are missing: ${missing}`);
      }
      console.error(`  (skipping flagship mp4 e2e — missing ${missing})`);
      this.skip();
    }
  });

  after(async function () {
    const { rm } = await import('node:fs/promises');
    for (const f of tmpFiles) {
      await rm(f, { force: true });
    }
  });

  it('builds a pptx, extracts its image, and renders a real MP4', async function () {
    const { parseMarkdown } = await import('@bendyline/squisq/markdown');
    const { markdownDocToPptx, pptxToContainer } = await import('@bendyline/squisq-formats/pptx');
    const { convert } = await import('../api.js');

    // ── Build the deck.pptx in-memory (markdown + a 1×1 PNG) ──────────
    const png = Buffer.from(PNG_1x1_BASE64, 'base64');
    const pngBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    const mdDoc = parseMarkdown(SAMPLE_MD);
    const images = new Map<string, ArrayBuffer>([['images/pixel.png', pngBuffer]]);
    const pptxBytes = await markdownDocToPptx(mdDoc, { images });
    expect(pptxBytes.byteLength).to.be.greaterThan(0);

    // ── Round-trip the pptx into a container; the image must survive ──
    const container = await pptxToContainer(pptxBytes);
    const extracted = await container.readFile('images/image1.png');
    expect(extracted, 'pptxToContainer should extract images/image1.png').to.not.equal(undefined);

    // ── Convert the pptx bytes straight to MP4 via the CLI api ────────
    const result = await convert({ kind: 'bytes', data: pptxBytes, filename: 'deck.pptx' }, 'mp4');

    expect(result.bytes).to.be.instanceOf(Uint8Array);
    expect(result.bytes.length).to.be.greaterThan(0);

    // An MP4 begins with a `ftyp` box: 4-byte size, then the ASCII 'ftyp'.
    const magic = new TextDecoder('ascii').decode(result.bytes.slice(4, 8));
    expect(magic, 'output should be an MP4 (ftyp box at bytes 4..8)').to.equal('ftyp');
  });
});
