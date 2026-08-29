import { expect, test } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * The proofing capability on the demo site (the reference host):
 * with a provider wired and default-on, the harper WASM loads once a
 * markdown doc is active, typed misspellings get red squiggles in the
 * Write view, and the View-menu session toggle clears them.
 *
 * The "no engine bytes without opt-in" guarantees live at the unit
 * level (a doc frontmatter opt-out / `proofingDefaultEnabled: false`
 * never call `setup()`), because the site deliberately runs default-on.
 */
test('proofing squiggles appear in Write view and the session toggle clears them', async ({
  page,
}) => {
  // Cold engine setup (~5s WASM compile) + typing + relint cycles.
  test.setTimeout(120_000);
  const harperRequests: string[] = [];
  page.on('request', (request) => {
    if (/harper/i.test(new URL(request.url()).pathname)) harperRequests.push(request.url());
  });

  await page.goto('/');
  await waitForAppReady(page);

  // Default-on with a markdown sample: the engine loads without any user
  // gesture — same-origin, served by the harperCorePlugin.
  await expect
    .poll(() => harperRequests.some((url) => url.includes('harper_wasm_bg.wasm')), {
      timeout: 30_000,
    })
    .toBe(true);

  // Type a misspelling into the Write view and wait for the squiggle.
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.click();
  await page.keyboard.type('Thsi is teh proofing tset. ');
  const squiggle = page.locator('.squisq-proof-underline--spelling').first();
  await expect(squiggle).toBeVisible({ timeout: 30_000 });

  // Session toggle off via the View menu clears every squiggle.
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByText('Check spelling & grammar').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.squisq-proof-underline--spelling')).toHaveCount(0, {
    timeout: 10_000,
  });
});
