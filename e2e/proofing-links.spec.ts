import { test, expect, devices, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * A link whose text is also flagged by proofing, in the Write view.
 *
 * A mouse click has to open the link. It once did not: the hover title was
 * written on the link, ProseMirror redrew the squiggle under the pointer each
 * time, and with no element surviving from press to release the browser never
 * fired the click. A finger, which has no hover, raises the proofing card
 * instead, and the card offers the link.
 *
 * These go through the browser's own input pipeline. A synthetic `click`
 * always arrives, so it cannot see the first failure at all.
 */

const SQUIGGLED = 'https://example.com/squiggled';
const CLEAN = 'https://example.com/clean';

/** The Tiptap editor on its element, enough of it to replace the document. */
type TiptapElement = HTMLElement & {
  editor: { commands: { setContent(html: string, emitUpdate: boolean): boolean } };
};

declare global {
  interface Window {
    __openedLinks: string[];
  }
}

const opened = (page: Page) => page.evaluate(() => window.__openedLinks.slice());
const squiggledLink = (page: Page) => page.locator(`.tiptap a[href="${SQUIGGLED}"]`);
const cleanLink = (page: Page) => page.locator(`.tiptap a[href="${CLEAN}"]`);
const card = (page: Page) => page.locator('.squisq-proof-tooltip');
/** The misspelling outside any link. */
const plainSquiggle = (page: Page) =>
  page.locator('.tiptap .squisq-proof-underline', { hasText: /^teh$/ });

/** Load a document with a misspelled link, a clean link and a plain misspelling. */
async function loadLinks(page: Page) {
  // The demo site opens a delegated link with `window.open`; record instead.
  await page.addInitScript(() => {
    window.__openedLinks = [];
    window.open = (url) => {
      window.__openedLinks.push(String(url));
      return null;
    };
  });
  await page.goto('/');
  await waitForAppReady(page);
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.evaluate(
    (element, { squiggled, clean }) => {
      (element as TiptapElement).editor.commands.setContent(
        `<p>Plain intro text here.</p>` +
          `<p><a href="${clean}">Documentation</a> is a clean link.</p>` +
          `<p><a href="${squiggled}">Quallla</a> is a misspelled link.</p>` +
          `<p>Trailing teh paragraph.</p>`,
        true,
      );
    },
    { squiggled: SQUIGGLED, clean: CLEAN },
  );
  // Cold engine setup (~5s WASM compile) precedes the first squiggle.
  await expect(squiggledLink(page).locator('.squisq-proof-underline')).toBeVisible({
    timeout: 60_000,
  });
  await expect(plainSquiggle(page)).toBeVisible();
}

test.describe('with a mouse', () => {
  test('clicking a squiggled link opens it', async ({ page }) => {
    test.setTimeout(120_000);
    await loadLinks(page);

    // Held by reference. Marking it with an attribute would itself make
    // ProseMirror redraw it, which is the fault under test.
    const rendered = await squiggledLink(page)
      .locator('.squisq-proof-underline')
      .evaluateHandle((element) => element);

    // Rest on the link long enough for the hover card, as a reader would.
    await squiggledLink(page).hover();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-trigger', 'hover');
    await expect(card(page).locator('.squisq-proof-tooltip-link')).toHaveCount(0);

    // The squiggle under the pointer is still the element that was rendered,
    // and the href shows from the editor rather than from the link.
    expect(await rendered.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.locator('.tiptap.ProseMirror')).toHaveAttribute('title', SQUIGGLED);
    await expect(squiggledLink(page)).not.toHaveAttribute('title');

    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => opened(page)).toEqual([SQUIGGLED]);
  });

  test('a clean link opens as before', async ({ page }) => {
    test.setTimeout(120_000);
    await loadLinks(page);
    await cleanLink(page).click();
    await expect.poll(() => opened(page)).toEqual([CLEAN]);
  });
});

test.describe('with a finger', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('tapping a squiggle raises the card, and a second tap puts it away', async ({ page }) => {
    test.setTimeout(120_000);
    await loadLinks(page);

    await plainSquiggle(page).tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-trigger', 'tap');
    await expect(card(page).locator('.squisq-proof-tooltip-link')).toHaveCount(0);

    // Buttons a finger can hit, on a card that stays inside the screen.
    const chip = await card(page).locator('.squisq-proof-tooltip-chip').first().boundingBox();
    expect(chip?.height).toBeGreaterThanOrEqual(40);
    const box = await card(page).boundingBox();
    expect(box && box.x >= 8 && box.x + box.width <= viewport.width - 8).toBe(true);

    await plainSquiggle(page).tap();
    await expect(card(page)).toHaveCount(0);

    await plainSquiggle(page).tap();
    await expect(card(page)).toBeVisible();
    await page.locator('.tiptap p').first().tap();
    await expect(card(page)).toHaveCount(0);
  });

  test('tapping a suggestion applies it', async ({ page }) => {
    test.setTimeout(120_000);
    await loadLinks(page);
    await plainSquiggle(page).tap();
    await card(page).getByRole('button', { name: 'the', exact: true }).tap();
    await expect(page.locator('.tiptap p').last()).toHaveText('Trailing the paragraph.');
    await expect(card(page)).toHaveCount(0);
  });

  test('tapping a squiggled link raises the card, which offers the link', async ({ page }) => {
    test.setTimeout(120_000);
    await loadLinks(page);

    await squiggledLink(page).tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator('.squisq-proof-tooltip-link-href')).toHaveText(SQUIGGLED);
    // The tap raised the card; it did not also follow the link.
    expect(await opened(page)).toEqual([]);

    await card(page).getByRole('button', { name: 'Open link' }).tap();
    await expect.poll(() => opened(page)).toEqual([SQUIGGLED]);
    await expect(card(page)).toHaveCount(0);
  });

  test('tapping a clean link opens it directly', async ({ page }) => {
    test.setTimeout(120_000);
    await loadLinks(page);
    await cleanLink(page).tap();
    await expect.poll(() => opened(page)).toEqual([CLEAN]);
    await expect(card(page)).toHaveCount(0);
  });
});
