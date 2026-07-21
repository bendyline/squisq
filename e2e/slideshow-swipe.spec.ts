import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * E2E tests for drag-to-swipe navigation in slideshow mode.
 *
 * Exercises the real pointer gesture (Chromium synthesizes pointer events from
 * the mouse input) end-to-end: dragging the current slide past the threshold
 * advances/rewinds, a small slow drag snaps back, and dragging past the deck
 * boundary rubber-bands without navigating.
 */

/** Enter the Play preview and select slideshow mode. */
async function enterSlideshow(page: Page) {
  await switchView(page, 'Play');
  await selectUseMode(page, 'Slideshow');
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
  await page
    .locator('[data-testid="slideshow-controls"]')
    .waitFor({ state: 'visible', timeout: 5_000 });

  // The managed cover is a real slideshow entry before numbered content.
  // Leave it through the explicit control so swipe assertions start on slide 1.
  await expect(counter(page)).toHaveText('Cover');
  await page.getByTestId('slide-next').click();
  await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
}

function counter(page: Page) {
  return page.locator('[data-testid="slide-counter"]');
}

/**
 * Press on the player center and drag horizontally by a fraction of its width.
 */
async function dragPlayer(page: Page, dxFraction: number) {
  const box = await page.locator('.doc-player').boundingBox();
  if (!box) throw new Error('doc-player has no bounding box');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width / 2;
  const endX = startX + dxFraction * box.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.doc-player')).toHaveAttribute('data-swipe-phase', 'idle');
}

test.describe('Slideshow drag-to-swipe', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await enterSlideshow(page);
  });

  test('drag left advances, drag right rewinds', async ({ page }) => {
    const text0 = (await counter(page).textContent())?.trim() ?? '';
    const total = text0.split('/')[1]?.trim();
    expect(total).toBeTruthy();
    expect(text0).toBe(`1 / ${total}`);

    // Big drag left → next slide.
    await dragPlayer(page, -0.6);
    await expect(counter(page)).toHaveText(`2 / ${total}`);

    // Big drag right → back to the first slide.
    await dragPlayer(page, 0.6);
    await expect(counter(page)).toHaveText(`1 / ${total}`);
  });

  test('a micro-drag snaps back without navigating', async ({ page }) => {
    // Move onto slide 2 first so we can distinguish a snap-back from a boundary.
    await dragPlayer(page, -0.6);
    await expect(counter(page)).toHaveText(/^2 \//);

    // 0.5% of the width is below the minimum flick distance as well as the
    // distance threshold, so its outcome is deterministic without a timer.
    await dragPlayer(page, -0.005);
    await expect(counter(page)).toHaveText(/^2 \//);
  });

  test('dragging past the cover rubber-bands and stays put', async ({ page }) => {
    // The managed cover is the true first entry in this deck.
    await page.getByTestId('slide-prev').click();
    await expect(counter(page)).toHaveText('Cover');
    // Drag right hard on the first slide — there is no previous slide.
    await dragPlayer(page, 0.6);
    await expect(counter(page)).toHaveText('Cover');
  });
});
