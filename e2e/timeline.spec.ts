import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the Timeline view: block bars render, selecting a block in the
 * track moves the card editor, and dragging a block's right edge rewrites its
 * `duration` in the markdown source.
 */

async function loadFeaturesSample(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('features-demo');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function enterTimelineMode(page: Page) {
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitemradio', { name: 'Timeline' }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="timeline-track"]').waitFor({ state: 'visible' });
}

test.describe('Timeline view', () => {
  test('renders a bar per block and scopes the editor to one block', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    const blocks = page.locator('.squisq-timeline-block');
    expect(await blocks.count()).toBeGreaterThan(1);
    // The card above shows a single block.
    await expect(page.locator('[data-testid="block-card-view"]')).toBeVisible();
    expect(await page.locator('.tiptap.ProseMirror :is(h1,h2,h3,h4,h5,h6)').count()).toBe(1);
  });

  test('selecting a block in the track moves the card', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 1 of');
    await page.locator('.squisq-timeline-block').nth(2).click();
    await expect(page.locator('.squisq-block-card-position')).not.toContainText('Block 1 of');
  });

  test('embedded media shows on the track and can move to another block', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption('timeline-media');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
    await enterTimelineMode(page);

    // The embedded <video> in block One appears as a clip on the media track.
    const embedded = page.locator('.squisq-timeline-clip--embedded');
    await expect(embedded).toHaveCount(1);

    // Drag it far left (well before block One) — it should relocate/convert.
    const box = await embedded.boundingBox();
    if (!box) throw new Error('no embedded clip box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // It is now an authored video clip annotation in the markdown.
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('{[video');
    await expect(page.locator('.monaco-editor').first()).not.toContainText('<video');
  });

  test('dragging a block right edge updates its duration in markdown', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    const firstBlock = page.locator('.squisq-timeline-block').first();
    const edge = firstBlock.locator('.squisq-timeline-edge--right');
    const box = await edge.boundingBox();
    if (!box) throw new Error('no edge box');

    // Drag the right edge ~90px to the right (~5s at 18px/s).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // Switch to Markdown and confirm a duration attribute was written.
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('duration=');
  });
});
