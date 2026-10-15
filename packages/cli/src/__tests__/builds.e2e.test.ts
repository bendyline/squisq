/** Native browser and FFmpeg parity for progressive slide builds. */
import { after, before, describe, it } from 'mocha';
import { expect } from 'chai';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { generateRenderHtml } from '@bendyline/squisq-video';
import { renderDocToMp4 } from '../api.js';
import { detectFfmpegDetailed } from '../util/detectFfmpeg.js';

function fixture(effect = 'appear') {
  return buildPreviewDoc(
    markdownToDoc(
      parseMarkdown(
        `## Our approach {[list build=items buildEffect=${effect} duration=4]}\n\n- Discover\n  - **Interview** customers\n- Deliver\n`,
      ),
    ),
    { interleaveImages: false },
  );
}

describe('native progressive builds', function () {
  this.timeout(120_000);
  let browser: Browser | undefined;
  let dir: string;
  before(async function () {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      if (process.env.SQUISQ_REQUIRE_NATIVE_E2E === '1') throw error;
      this.skip();
    }
    dir = await mkdtemp(join(tmpdir(), 'squisq-builds-'));
  });
  after(async () => {
    await browser?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  for (const motion of [false, true]) {
    it(`preserves layout and identical pixels after nonsequential seeks with motion ${motion ? 'on' : 'off'}`, async () => {
      const page = await browser!.newPage({ viewport: { width: 960, height: 540 } });
      try {
        const playerScript = await readFile(
          new URL('../../../react/dist/squisq-player.global.js', import.meta.url),
          'utf8',
        );
        await page.setContent(
          generateRenderHtml(fixture(motion ? 'fadeInUp' : 'appear'), {
            playerScript,
            width: 960,
            height: 540,
            animationsEnabled: motion,
          }),
        );
        const handle = await page.evaluateHandle(async () => {
          const player = (
            globalThis as unknown as {
              SquisqPlayer: {
                getHandle(element: Element): {
                  renderAPI: Promise<{ seekTo(time: number): Promise<void> }>;
                };
              };
            }
          ).SquisqPlayer;
          return player.getHandle(document.querySelector('#squisq-root')!).renderAPI;
        });
        await handle.evaluate((api) => api.seekTo(0));
        const targets = page.locator('.doc-player__block--active [data-squisq-build-step]');
        expect(await targets.count()).to.equal(3);
        const geometry = await targets.evaluateAll((nodes) =>
          nodes.map((node) => {
            const element = node as HTMLElement;
            return [
              element.offsetLeft,
              element.offsetTop,
              element.offsetWidth,
              element.offsetHeight,
            ];
          }),
        );
        expect(
          await targets.evaluateAll(
            (nodes) =>
              nodes.filter((node) => getComputedStyle(node).visibility === 'visible').length,
          ),
        ).to.equal(0);
        await handle.evaluate((api) => api.seekTo(3.9));
        const final = await page.screenshot();
        expect(
          await targets.evaluateAll(
            (nodes) =>
              nodes.filter((node) => getComputedStyle(node).visibility === 'visible').length,
          ),
        ).to.equal(3);
        expect(
          await targets.evaluateAll((nodes) =>
            nodes.map((node) => {
              const element = node as HTMLElement;
              return [
                element.offsetLeft,
                element.offsetTop,
                element.offsetWidth,
                element.offsetHeight,
              ];
            }),
          ),
        ).to.deep.equal(geometry);
        await handle.evaluate((api) => api.seekTo(0.5));
        const partial = await page.screenshot();
        if (motion) {
          const opacity = await targets
            .first()
            .evaluate((node) => Number(getComputedStyle(node).opacity));
          expect(opacity).to.be.greaterThan(0).and.lessThan(1);
        }
        expect(
          await targets.evaluateAll(
            (nodes) =>
              nodes.filter((node) => getComputedStyle(node).visibility === 'visible').length,
          ),
        ).to.equal(1);
        await handle.evaluate((api) => api.seekTo(0));
        expect((await page.screenshot()).equals(final)).to.equal(false);
        await handle.evaluate((api) => api.seekTo(3.9));
        expect((await page.screenshot()).equals(final)).to.equal(true);
        await handle.evaluate((api) => api.seekTo(0.5));
        expect((await page.screenshot()).equals(partial)).to.equal(true);
      } finally {
        await page.close();
      }
    });
  }

  it('encodes progressive frames through the native MP4 path', async function () {
    if (!(await detectFfmpegDetailed())) {
      if (process.env.SQUISQ_REQUIRE_NATIVE_E2E === '1') throw new Error('FFmpeg is required');
      this.skip();
    }
    const framesDir = join(dir, 'frames');
    const outputPath = join(dir, 'builds.mp4');
    await renderDocToMp4(fixture(), new MemoryContentContainer(), {
      outputPath,
      fps: 4,
      width: 640,
      height: 360,
      quality: 'draft',
      captureFormat: 'png',
      framesDir,
      coverPreRoll: 0,
      animationsEnabled: false,
    });
    const names = (await readdir(framesDir)).filter((name) => name.endsWith('.png')).sort();
    expect(names).to.have.length(16);
    expect(
      (await readFile(join(framesDir, names[0]!))).equals(
        await readFile(join(framesDir, names[names.length - 1]!)),
      ),
    ).to.equal(false);
    expect((await readFile(outputPath)).byteLength).to.be.greaterThan(1000);
  });
});
