import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * E2E tests for the block-at-a-time view.
 *
 * Verifies the View menu toggle, that the editing surface is scoped to a
 * single block, that Prev/Next navigate, and that "Add block" both inserts
 * into the full document and advances the card.
 */

async function loadFeaturesSample(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption('features-demo');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function enterBlockMode(page: Page) {
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitemradio', { name: 'Block-at-a-time' }).click();
  // Close the menu.
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="block-card-view"]').waitFor({ state: 'visible' });
}

const HEADINGS = '.tiptap.ProseMirror :is(h1, h2, h3, h4, h5, h6)';

test.describe('Block-at-a-time view', () => {
  test('scopes the WYSIWYG editor to a single block', async ({ page }) => {
    await loadFeaturesSample(page);
    // Document mode shows the whole doc — many headings.
    expect(await page.locator(HEADINGS).count()).toBeGreaterThan(1);

    await enterBlockMode(page);

    // The card shows only the first block: a single heading.
    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 1 of');
    expect(await page.locator(HEADINGS).count()).toBe(1);
  });

  test('Previous/Next move between blocks', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterBlockMode(page);

    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 1 of');
    // Previous is disabled on the first block.
    await expect(page.getByRole('button', { name: 'Previous block' })).toBeDisabled();

    await page.getByRole('button', { name: 'Next block' }).click();
    await expect(page.locator('.squisq-block-card-position')).toContainText('Block 2 of');
    expect(await page.locator(HEADINGS).count()).toBe(1);
  });

  test('the outline jumps the card to the clicked block', async ({ page }) => {
    await loadFeaturesSample(page);
    // Turn on the outline, then enter block mode.
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show outline' }).click();
    await page.getByRole('menuitemradio', { name: 'Block-at-a-time' }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="block-card-view"]').waitFor({ state: 'visible' });

    await page.locator('.squisq-outline-row', { hasText: 'Lists' }).first().click();
    // "Lists" is the third top-level section in the sample.
    await expect(page.locator('.squisq-block-card-position')).not.toContainText('Block 1 of');
  });

  test('Add block inserts a new block and moves to it', async ({ page }) => {
    await loadFeaturesSample(page);
    await enterBlockMode(page);

    const before = await page.locator('.squisq-block-card-position').textContent();
    const total = Number(before?.match(/of (\d+)/)?.[1] ?? '0');

    await page.getByRole('button', { name: 'Add block' }).click();

    await expect(page.locator('.squisq-block-card-position')).toContainText(
      `Block 2 of ${total + 1}`,
    );
    await expect(page.locator('.tiptap.ProseMirror')).toContainText('New section');
  });
});
