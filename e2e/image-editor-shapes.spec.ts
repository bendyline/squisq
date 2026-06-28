import { test, expect, type Page } from '@playwright/test';

/**
 * Image editor — drawing shape palette parity.
 *
 * The image editor's Shape tool exposes the same palette and shape
 * vocabulary as drawings: picking a named shape (e.g. Diamond) and clicking
 * the canvas drops a path layer rendered by the shared drawing PathLayer.
 */

async function openImageEditor(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Image Editor' }).click();
  await page.locator('[data-testid="image-editor"]').waitFor({ state: 'visible', timeout: 8000 });
}

test('Shape tool opens the full drawing palette', async ({ page }) => {
  await openImageEditor(page);
  await page.locator('[data-testid="image-editor-toolbar"] [aria-label="Add shape (S)"]').click();

  const palette = page.locator('.squisq-shape-palette');
  await expect(palette).toBeVisible();
  // Same catalog as drawings (rect, circle, polygons, stars, block arrows…).
  expect(await page.locator('.squisq-shape-palette-item').count()).toBeGreaterThan(20);
  await expect(page.locator('.squisq-shape-palette-item[aria-label="Diamond"]')).toBeVisible();
});

test('picking a named shape drops a path layer on the canvas', async ({ page }) => {
  await openImageEditor(page);
  await page.locator('[data-testid="image-editor-toolbar"] [aria-label="Add shape (S)"]').click();
  await page.locator('.squisq-shape-palette-item[aria-label="Diamond"]').click();

  const canvas = page.locator('.squisq-image-editor-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // The diamond renders as a <path> (shared drawing PathLayer).
  await expect(canvas.locator('path')).toHaveCount(1);
  // It is added as a selectable layer named after the shape kind.
  await expect(
    page.locator('[data-testid="image-editor-properties"]').getByText('Diamond', { exact: false }),
  ).toBeVisible();
});
