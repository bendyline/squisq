import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * E2E tests for the Slideshow toolbar's block-type picker: changing the type
 * of the slide on screen without leaving for Write.
 *
 * Exercises the whole loop the unit tests stub — the real player naming its
 * current slide, the gallery, the edit to the document source, and the slide
 * redrawing with the new type.
 */

function blockType(page: Page) {
  // The toolbar also renders every control in a hidden measuring probe.
  return page
    .locator('.squisq-preview-controls-inline, .squisq-preview-controls-popover')
    .locator('.squisq-slide-block-type .squisq-template-picker-trigger');
}

function counter(page: Page) {
  return page.locator('[data-testid="slide-counter"]');
}

async function enterSlideshow(page: Page) {
  await switchView(page, 'Play');
  await selectUseMode(page, 'Slideshow');
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(counter(page)).toHaveText('Cover');
}

async function sourceText(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  const lines = page.locator('[data-testid="raw-editor"] .monaco-editor .view-lines').first();
  await lines.waitFor({ state: 'visible', timeout: 15_000 });
  // Monaco renders spaces as non-breaking ones.
  return (await lines.innerText()).replaceAll(String.fromCharCode(160), ' ');
}

test.describe('Slideshow block-type picker', () => {
  test.beforeEach(async ({ page }) => {
    // Wide enough that the picker sits inline rather than in the overflow menu.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await waitForAppReady(page);
    await enterSlideshow(page);
  });

  test('names the cover without offering to change it', async ({ page }) => {
    await expect(blockType(page)).toBeDisabled();
    await expect(blockType(page)).toContainText('Cover');
    await expect(blockType(page)).toHaveAttribute('title', /Cover slide menu/);
  });

  test('changes the type of the slide on screen', async ({ page }) => {
    await page.getByTestId('slide-next').click();
    await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
    await expect(blockType(page)).toBeEnabled();
    const before = (await blockType(page).innerText()).trim();

    await blockType(page).click();
    const gallery = page.getByRole('dialog', { name: /^Block Type for / });
    await expect(gallery).toBeVisible();
    await gallery
      .locator('.squisq-template-gallery-card', {
        has: page.locator('.squisq-template-gallery-card-name', { hasText: /^Pull Quote$/ }),
      })
      .click();

    await expect(gallery).toBeHidden();
    await expect(blockType(page)).toContainText('Pull Quote');
    expect(before).not.toContain('Pull Quote');
    // Still on the same slide, now drawn as the new type.
    await expect(counter(page)).toHaveText(/^1 \/ \d+$/);

    expect(await sourceText(page)).toContain('{[pullQuote]}');
  });

  test('follows the deck from slide to slide', async ({ page }) => {
    await page.getByTestId('slide-next').click();
    await expect(blockType(page)).toBeEnabled();
    await page.getByTestId('slide-prev').click();
    await expect(counter(page)).toHaveText('Cover');
    await expect(blockType(page)).toBeDisabled();
  });

  test('stands down while Summarize is choosing the layouts', async ({ page }) => {
    await page.getByTestId('slide-next').click();
    await expect(blockType(page)).toBeEnabled();

    await page
      .locator('.squisq-preview-controls-inline')
      .getByRole('combobox', { name: 'Summarize' })
      .selectOption({ index: 1 });

    // A new summary is a new deck, which opens on its cover again.
    await expect(counter(page)).toHaveText('Cover');
    await page.getByTestId('slide-next').click();
    await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
    await expect(blockType(page)).toBeDisabled();
    await expect(blockType(page)).toHaveAttribute('title', /Set Summarize to None/);
  });

  test('is not offered outside Slideshow', async ({ page }) => {
    await selectUseMode(page, 'Video');
    await expect(page.locator('.squisq-slide-block-type')).toHaveCount(0);
  });
});
