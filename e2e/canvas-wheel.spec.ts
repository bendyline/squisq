import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * A plain mouse wheel over a canvas (drawing/layout/diagram) must scroll the
 * page, NOT zoom the canvas (which made shapes appear to grow/shrink under the
 * cursor). Zoom is reserved for Ctrl/Cmd + wheel.
 */

async function loadDrawing(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption('drawing-org-chart');
  await page.locator('.squisq-scene-widget-host').waitFor({ state: 'visible', timeout: 5_000 });
  await page
    .locator('.squisq-scene-viewport [data-layer-id^="dshape-"]')
    .first()
    .waitFor({ state: 'visible' });
}

/** The pan/zoom group's transform attribute (changes iff the canvas zoomed/panned). */
async function groupTransform(page: Page): Promise<string | null> {
  return page.locator('.squisq-scene-viewport > g').first().getAttribute('transform');
}

test('plain wheel over a shape does NOT zoom the canvas', async ({ page }) => {
  await loadDrawing(page);
  const shape = await page.locator('[data-layer-id="dshape-ceo"]').first().boundingBox();
  if (!shape) throw new Error('no shape');
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;

  const before = await groupTransform(page);
  await page.evaluate(() => {
    const state = window as Window & { __squisqWheelPrevented?: boolean | null };
    state.__squisqWheelPrevented = null;
    window.addEventListener(
      'wheel',
      (event) => {
        state.__squisqWheelPrevented = event.defaultPrevented;
      },
      { once: true },
    );
  });
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __squisqWheelPrevented?: boolean | null }).__squisqWheelPrevented,
      ),
    )
    .toBe(false);

  // The canvas transform is unchanged — the wheel scrolled the page instead.
  expect(await groupTransform(page)).toBe(before);
});

test('Ctrl + wheel still zooms the canvas', async ({ page }) => {
  await loadDrawing(page);
  const shape = await page.locator('[data-layer-id="dshape-ceo"]').first().boundingBox();
  if (!shape) throw new Error('no shape');
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;

  const before = await groupTransform(page);
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');

  // The transform changed — Ctrl+wheel zoomed.
  await expect.poll(() => groupTransform(page)).not.toBe(before);
});
