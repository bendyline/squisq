import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let fixtureScript: string;
let playerCss: string;
test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/video-capture.tsx', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'browser',
    // ESM, not IIFE: the workspace packages are ESM-only and reference
    // import.meta (squisq-graph's worker spawn), which an IIFE cannot carry.
    format: 'esm',
    jsx: 'automatic',
  });
  fixtureScript = bundle.outputFiles[0].text;
  playerCss = await readFile(
    new URL('../packages/react/src/styles/doc-animations.css', import.meta.url),
    'utf8',
  );
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.setContent(
    '<!doctype html><html><body style="margin:0"><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: playerCss });
  await page.addScriptTag({ content: fixtureScript, type: 'module' });
  await page.getByRole('button', { name: 'Initialize', exact: true }).click();
  await expect(page.locator('#state')).toHaveText('ready');
});

async function capture(page: Page, time: number, cover = false): Promise<void> {
  await page.locator('#time').fill(String(time));
  await page.locator('#cover').setChecked(cover);
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.locator('#state')).toHaveText('captured');
  await page.locator('#captured').evaluate(async (image: HTMLImageElement) => image.decode());
}

test('animated export keeps the held cover title visible', async ({ page }) => {
  await capture(page, 0, true);
  const ink = await page.locator('#captured').evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(80, 70, 480, 210).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) count += 1;
    }
    return count;
  });
  expect(ink).toBeGreaterThan(500);
});

test('captured fade and layer entrances match the sought player pixels', async ({ page }) => {
  // Include the exact boundary and revisit earlier frames to exercise both
  // animation seeking and the slide raster cache without relying on a codec.
  for (const time of [1, 2, 2.1, 2.25, 2.4, 2.5, 2.1]) {
    await capture(page, time);
    await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('#squisq-capture-root')!.parentElement!;
      container.style.opacity = '1';
      container.style.zIndex = '10';
    });
    const live = await page.locator('#squisq-capture-root').screenshot();
    await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('#squisq-capture-root')!.parentElement!;
      container.style.opacity = '0';
      container.style.zIndex = '-1';
    });
    const difference = await page.locator('#captured').evaluate(
      async (captured: HTMLImageElement, source) => {
        const reference = new Image();
        reference.src = source;
        await reference.decode();
        const canvas = document.createElement('canvas');
        canvas.width = reference.width;
        canvas.height = reference.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(reference, 0, 0);
        const expected = context.getImageData(0, 0, canvas.width, canvas.height).data;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(captured, 0, 0);
        const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let total = 0;
        for (let i = 0; i < actual.length; i++) total += Math.abs(actual[i] - expected[i]);
        return total / actual.length;
      },
      `data:image/png;base64,${live.toString('base64')}`,
    );
    expect(difference, `capture at ${time}s must match the sought player`).toBeLessThan(1);
  }
});
