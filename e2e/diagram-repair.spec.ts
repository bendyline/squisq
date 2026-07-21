import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';

/**
 * E2E for the "Repair as diagram" affordance.
 *
 * A broken box-art fence (labels overflow their boxes so the columns desync)
 * renders as a faithful code block with an inline repair banner. Clicking the
 * button reconstructs a clean, `diagram`-tagged fence, which the
 * AsciiDiagramExtension turns into an interactive canvas. One undo restores
 * the original broken code block.
 */

async function loadSample(page: Page, sample: string) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption(sample);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

test.describe('Repair as diagram', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('a broken diagram shows the repair banner, not a canvas', async ({ page }) => {
    await loadSample(page, 'diagram-broken');
    await expect(page.locator('.squisq-repair-banner-btn').first()).toBeVisible();
    // No diagram canvas mounts (the art is too broken to auto-detect)…
    await expect(page.locator('.squisq-ascii-diagram-widget-host')).toHaveCount(0);
    // …and the raw fence is still present as a code block.
    await expect(page.locator('pre').filter({ hasText: '@scope/event-bus' }).first()).toBeVisible();
  });

  test('clicking Repair turns it into an interactive canvas', async ({ page }) => {
    await loadSample(page, 'diagram-broken');
    await page.locator('.squisq-repair-banner-btn').first().click();
    // The canvas mounts with recovered node cards.
    await page
      .locator('.squisq-ascii-diagram-widget-host')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    await expect(page.locator('[data-layer-id="node-card-scope-event-bus"]').first()).toBeVisible();
    // The repair banner is gone.
    await expect(page.locator('.squisq-repair-banner-btn')).toHaveCount(0);
  });

  test('one undo restores the broken code block', async ({ page }) => {
    await loadSample(page, 'diagram-broken');
    await page.locator('.squisq-repair-banner-btn').first().click();
    await page
      .locator('.squisq-ascii-diagram-widget-host')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });

    // Focus the prose (the heading, well clear of the canvas widget which
    // swallows keydown) so the undo shortcut reaches the editor.
    await page.getByText('Broken Diagram', { exact: false }).first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

    // The repair banner reappears — proof the broken art is restored and
    // re-detected as repairable (the raw code fence is back too).
    await expect(page.locator('.squisq-repair-banner-btn').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('pre').filter({ hasText: '@scope/event-bus' }).first()).toBeVisible();
  });
});
