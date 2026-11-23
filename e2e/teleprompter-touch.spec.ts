import { test, expect } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, toggleViewPane } from './view-tabs';

/**
 * Narrate's own controls under a finger, on a phone (the android-touch and
 * iphone-touch projects supply the device). With the status bar off they sit
 * in place above the prompter.
 *
 * WebKit draws a native select at its own fixed height, about 20px on an
 * iPhone, whatever its min-height says, so the prompter's selects draw
 * without the native appearance to reach the 36px a finger needs.
 */
test("Narrate's selects are finger-sized", async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible' });
  await toggleViewPane(page, 'Status bar');
  await selectUseMode(page, 'Narrate');
  const controls = page.locator('.squisq-teleprompter-controls');
  await controls.locator('#squisq-prompter-countdown').waitFor();
  const readHeights = () =>
    controls.locator('select').evaluateAll((selects) =>
      selects
        .filter((select) => select.getBoundingClientRect().width > 0)
        .map((select) => ({
          name: select.getAttribute('aria-label') ?? select.id,
          height: select.getBoundingClientRect().height,
        })),
    );
  // The controls lay out a moment after the view opens.
  await expect.poll(async () => (await readHeights()).length).toBeGreaterThan(0);
  for (const { name, height } of await readHeights()) {
    expect(height, name).toBeGreaterThanOrEqual(36);
  }
});
