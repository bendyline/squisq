import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * The Slideshow's block-type picker under a finger, on a phone-sized window
 * where it sits in the toolbar's overflow menu.
 *
 * Runs on the `android-touch` (Chromium) and `iphone-touch` (WebKit) projects.
 */

function counter(page: Page) {
  return page.locator('[data-testid="slide-counter"]');
}

/** Opens the toolbar's overflow menu when the window is too narrow for the row. */
async function revealControls(page: Page) {
  const more = page.getByRole('button', { name: 'More preview settings' });
  if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) !== 'true') {
    await more.tap();
  }
}

function controls(page: Page) {
  // The toolbar also renders every control in a hidden measuring probe.
  return page.locator('.squisq-preview-controls-inline, .squisq-preview-controls-popover');
}

function blockType(page: Page) {
  return controls(page).locator('.squisq-slide-block-type .squisq-template-picker-trigger');
}

test.describe('Slideshow block-type picker under a finger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await switchView(page, 'Play');
    await selectUseMode(page, 'Slideshow');
    await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
    await expect(counter(page)).toHaveText('Cover');
    await page.getByTestId('slide-next').tap();
    await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
    await revealControls(page);
  });

  test('opens the gallery at a tap and retypes the slide', async ({ page }) => {
    await expect(blockType(page)).toBeVisible();
    await expect(blockType(page)).toBeEnabled();
    await blockType(page).tap();
    const gallery = page.getByRole('dialog', { name: /^Block Type for / });
    await expect(gallery).toBeVisible();
    await gallery
      .locator('.squisq-template-gallery-card', {
        has: page.locator('.squisq-template-gallery-card-name', { hasText: /^Pull Quote$/ }),
      })
      .tap();
    await expect(gallery).toBeHidden();
    await revealControls(page);
    await expect(blockType(page)).toContainText('Pull Quote');
  });

  test('is labelled "Slide:"', async ({ page }) => {
    const label = controls(page).locator('.squisq-slide-block-type label');
    await expect(label).toHaveText('Slide:');
    // Named by the label and the type it shows, as one: "Slide: Title".
    const shown = await blockType(page)
      .locator('.squisq-template-picker-trigger-value')
      .innerText();
    await expect(blockType(page)).toHaveAccessibleName(`Slide: ${shown.trim()}`);
  });

  test('says why at a tap while Summarize chooses the layouts', async ({ page }) => {
    await controls(page).getByRole('combobox', { name: 'Summarize' }).selectOption({ index: 1 });
    // A new summary is a new deck, which opens on its cover again.
    await expect(counter(page)).toHaveText('Cover');
    await page.getByTestId('slide-next').tap();
    await expect(counter(page)).toHaveText(/^1 \/ \d+$/);
    await revealControls(page);
    await expect(blockType(page)).toBeDisabled();

    // Playwright will not tap what is `aria-disabled`; a finger will.
    await blockType(page).tap({ force: true });
    const note = page.getByRole('tooltip');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Set Summarize to None');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Below the picker, and wholly inside the window.
    const width = page.viewportSize()!.width;
    const noteBox = (await note.boundingBox())!;
    const triggerBox = (await blockType(page).boundingBox())!;
    expect(noteBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    expect(noteBox.x).toBeGreaterThanOrEqual(0);
    expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(width);

    // A tap anywhere else puts it away.
    await controls(page).getByText('Theme:', { exact: true }).tap();
    await expect(note).toBeHidden();
  });
});
