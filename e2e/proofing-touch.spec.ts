import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

/**
 * A finger cannot hover, so on a phone or tablet a squiggle answers a tap:
 * the tap raises the proofing card, and the card's buttons fix the word.
 *
 * Both views, on both engines a phone runs. Each engine once broke this in a
 * way a synthetic event cannot see: WebKit reports a finger's click as
 * `pointerType: "mouse"`, so the Write view took every tap for a mouse click;
 * and Monaco takes a tap over with its own gesture handling, so the Source
 * view never received a click at all.
 *
 * Runs on the `android-touch` (Chromium) and `iphone-touch` (WebKit) projects.
 */

/** The Tiptap editor on its element, enough of it to replace the document. */
type TiptapElement = HTMLElement & {
  editor: { commands: { setContent(html: string, emitUpdate: boolean): boolean } };
};

const card = (page: Page) => page.locator('.squisq-proof-tooltip');
const writeSquiggle = (page: Page) =>
  page.locator('.tiptap .squisq-proof-underline', { hasText: /^teh$/ });
const sourceSquiggle = (page: Page) =>
  page.locator('.monaco-editor .squisq-proof-underline', { hasText: /^teh$/ });

/** Load a document whose only finding is the misspelling "teh". */
async function loadTypo(page: Page): Promise<void> {
  await page.goto('/');
  await waitForAppReady(page);
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.evaluate((element) => {
    (element as TiptapElement).editor.commands.setContent(
      '<p>Plain intro text here.</p><p>Trailing teh paragraph.</p>',
      true,
    );
  });
  // Cold engine setup (~5s WASM compile) precedes the first squiggle.
  await expect(writeSquiggle(page)).toBeVisible({ timeout: 60_000 });
}

test.describe('with a finger', () => {
  test('Write: tapping a squiggle raises the card, and its suggestion fixes the word', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loadTypo(page);

    await writeSquiggle(page).tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-trigger', 'tap');

    await card(page).getByRole('button', { name: 'the', exact: true }).tap();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.tiptap p').last()).toHaveText('Trailing the paragraph.');
  });

  test('Source: tapping a squiggle raises the card, and a second tap puts it away', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loadTypo(page);
    await switchView(page, 'Markdown');
    await expect(sourceSquiggle(page)).toBeVisible({ timeout: 30_000 });

    await sourceSquiggle(page).tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-trigger', 'tap');
    await expect(card(page).locator('.squisq-proof-tooltip-chip')).toHaveText(['the']);
    // The card sits against the word it explains, below it or, where there
    // is no room below, above it: not wherever Monaco happens to put the caret.
    const word = (await sourceSquiggle(page).boundingBox())!;
    const box = (await card(page).boundingBox())!;
    const gap = Math.min(
      Math.abs(box.y - (word.y + word.height)),
      Math.abs(word.y - (box.y + box.height)),
    );
    expect(gap).toBeLessThan(16);

    await sourceSquiggle(page).tap();
    await expect(card(page)).toHaveCount(0);
  });

  test('Source: tapping a suggestion applies it', async ({ page }) => {
    test.setTimeout(120_000);
    await loadTypo(page);
    await switchView(page, 'Markdown');
    await expect(sourceSquiggle(page)).toBeVisible({ timeout: 30_000 });

    await sourceSquiggle(page).tap();
    await card(page).getByRole('button', { name: 'the', exact: true }).tap();
    await expect(card(page)).toHaveCount(0);
    await expect(sourceSquiggle(page)).toHaveCount(0);
    await switchView(page, 'Editor');
    await expect(page.locator('.tiptap p').last()).toHaveText('Trailing the paragraph.');
  });
});
