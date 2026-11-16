import { expect, test, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * On a phone-sized window the block type gallery fills the window: no margin,
 * no frame, and its header runs up under the status bar with the title just
 * below it. A host laid out under the system bars publishes the insets it wants
 * dialogs to clear as `--squisq-safe-area-*`; these tests write a notched
 * iPhone's directly, since no emulated browser reports a safe area.
 */

const SAFE_TOP = 47;
const SAFE_BOTTOM = 34;
const KEYBOARD = 336;

/**
 * The squisq site resets every element to `border-box`; a host such as
 * DocBlocks does not. Undo the reset so the gallery is measured as such a host
 * lays it out: a box that needs `border-box` has to ask for it itself.
 */
async function dropBoxSizingReset(page: Page) {
  await page.addStyleTag({ content: '* { box-sizing: content-box; }' });
}

async function emulateNotch(page: Page) {
  await page.evaluate(
    ([top, bottom]) => {
      const root = document.documentElement.style;
      root.setProperty('--squisq-safe-area-top', `${top}px`);
      root.setProperty('--squisq-safe-area-bottom', `${bottom}px`);
    },
    [SAFE_TOP, SAFE_BOTTOM],
  );
}

async function openBlockTypeGallery(page: Page) {
  const heading = page.locator('.tiptap.ProseMirror').locator('h1, h2, h3').first();
  await heading.click({ position: { x: 8, y: 8 } });
  await heading.locator('.squisq-template-badge').first().click();
  const panel = page.getByRole('dialog', { name: /Block Type/i });
  await expect(panel).toBeVisible();
  return panel;
}

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  expect(found, selector).not.toBeNull();
  return found!;
}

test.describe('Block type gallery on a phone-sized window', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForAppReady(page);
    await dropBoxSizingReset(page);
    await emulateNotch(page);
  });

  test('fills the window, its header running up under the status bar', async ({
    page,
  }, testInfo) => {
    const panel = await openBlockTypeGallery(page);
    const frame = await panel.boundingBox();
    expect(frame).toEqual({ x: 0, y: 0, width: 390, height: 844 });

    // The header starts at the top edge, so its color meets the status bar…
    const header = await box(page, '.squisq-template-gallery-dialog-header');
    expect(header.y).toBe(0);
    expect(header.width).toBe(390);
    // …and its title and close button sit below the status bar's inset.
    const title = await box(page, '.squisq-template-gallery-dialog-title');
    const close = await box(page, '.squisq-template-gallery-dialog-close');
    expect(title.y).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(close.y).toBeGreaterThanOrEqual(SAFE_TOP);

    // The list ends above the home indicator.
    const gallery = await box(page, '.squisq-template-gallery-dialog .squisq-template-gallery');
    expect(gallery.y + gallery.height).toBeLessThanOrEqual(844 - SAFE_BOTTOM);

    await testInfo.attach('phone gallery', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('ends its list above the on-screen keyboard', async ({ page }) => {
    const panel = await openBlockTypeGallery(page);
    await page.evaluate(
      (keyboard) =>
        document.documentElement.style.setProperty('--squisq-keyboard-inset', `${keyboard}px`),
      KEYBOARD,
    );
    const gallery = await box(page, '.squisq-template-gallery-dialog .squisq-template-gallery');
    expect(gallery.y + gallery.height).toBeLessThanOrEqual(844 - KEYBOARD);

    // The list shortens inside the window: the panel does not grow by the
    // keyboard's height and ride up, taking its header under the status bar.
    expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    const header = await box(page, '.squisq-template-gallery-dialog-header');
    expect(header.y).toBe(0);
    const title = await box(page, '.squisq-template-gallery-dialog-title');
    expect(title.y).toBeGreaterThanOrEqual(SAFE_TOP);
  });

  test('spans a landscape phone without widening by the side insets', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      const root = document.documentElement.style;
      root.setProperty('--squisq-safe-area-top', '0px');
      root.setProperty('--squisq-safe-area-left', '47px');
      root.setProperty('--squisq-safe-area-right', '47px');
      root.setProperty('--squisq-safe-area-bottom', '21px');
    });
    const panel = await openBlockTypeGallery(page);
    expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 844, height: 390 });
    // The list keeps clear of the notch's side.
    const gallery = await box(page, '.squisq-template-gallery-dialog .squisq-template-gallery');
    expect(gallery.x).toBeGreaterThanOrEqual(47);
    expect(gallery.x + gallery.width).toBeLessThanOrEqual(844 - 47);
  });

  test('keeps its frame inside the safe areas once the window is wide', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    const panel = await openBlockTypeGallery(page);
    const frame = (await panel.boundingBox())!;
    expect(frame.x).toBeGreaterThan(0);
    expect(frame.width).toBeLessThan(1280);
    // The squisq site's shell fills the window, so the panel clears the
    // emulated insets on its own.
    expect(frame.y).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(frame.y + frame.height).toBeLessThanOrEqual(844 - SAFE_BOTTOM);
  });
});
