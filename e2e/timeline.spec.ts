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

  test('renders a slideshow thumbnail inside every block bar', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);
    const bars = page.locator('.squisq-timeline-block');
    const count = await bars.count();
    expect(count).toBeGreaterThan(1);
    // Each bar carries a thumbnail that renders an SVG.
    const thumbs = page.locator('.squisq-timeline-block-thumb svg');
    await expect(thumbs.first()).toBeVisible();
    expect(await thumbs.count()).toBe(count);
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

  test('typing in block mode keeps the caret in place (no jump to end)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('select').first().selectOption('hello-world');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });

    // Switch to Block-at-a-time mode.
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemradio', { name: 'Block-at-a-time' }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="block-card-view"]').waitFor({ state: 'visible' });

    // Put the caret at the very start of the body paragraph and type.
    const para = page.locator('.tiptap.ProseMirror p').first();
    await para.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
    await page.keyboard.type('ZZZ');

    // If the caret had jumped to the end after each keystroke, "ZZZ" would land
    // at the end. It should be at the start.
    await expect(para).toHaveText(/^ZZZ/);
  });

  test('Play advances a playhead and Pause halts it; the ruler seeks', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterTimelineMode(page);

    const playhead = page.locator('[data-testid="timeline-playhead"]');
    await expect(playhead).toBeVisible();
    const leftOf = async () =>
      (await playhead.evaluate((el) => parseFloat((el as HTMLElement).style.left))) || 0;

    expect(await leftOf()).toBe(0);

    await page.getByTestId('timeline-play').click();
    await page.waitForTimeout(700);
    await page.getByTestId('timeline-play').click(); // pause
    const afterPlay = await leftOf();
    expect(afterPlay).toBeGreaterThan(0);

    // Paused: the playhead stays put.
    await page.waitForTimeout(300);
    expect(await leftOf()).toBeCloseTo(afterPlay, 0);

    // Clicking the ruler seeks the playhead to that position.
    const ruler = page.locator('.squisq-timeline-row--ruler');
    const box = await ruler.boundingBox();
    if (!box) throw new Error('no ruler box');
    await page.mouse.click(box.x + 200, box.y + box.height / 2);
    expect(await leftOf()).toBeGreaterThan(150);

    // The playhead itself is draggable: grab it and drag right to scrub.
    const head = await playhead.boundingBox();
    if (!head) throw new Error('no playhead box');
    await page.mouse.move(head.x + head.width / 2, head.y + 4);
    await page.mouse.down();
    await page.mouse.move(head.x + 120, head.y + 4, { steps: 6 });
    await page.mouse.up();
    expect(await leftOf()).toBeGreaterThan(280);
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

    // Switch to Markdown and confirm the duration was written in the
    // squisq-native squiggly form (`{[duration=…]}`), not the Pandoc block.
    await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    await expect(page.locator('.monaco-editor').first()).toContainText('{[duration=');
  });
});
