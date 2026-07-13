import { test, expect, type Page } from '@playwright/test';
import { selectUseMode, switchView } from './view-tabs';

/**
 * Screenshot spec: loads the tree gallery and captures the Use-mode
 * (player) rendering of each tree block — the beautiful filesystem
 * treeview (folder/file icons + connector rails) that ships in slides /
 * exports. Visual-validation aid, not a pixel-diff gate.
 */

async function enterPlay(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('tree-gallery');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await switchView(page, 'Play');
  await selectUseMode(page, 'Slideshow');
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
}

test.describe('tree gallery screenshots', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the tree blocks render as filesystem treeviews in Use mode', async ({ page }) => {
    await enterPlay(page);
    // Advance through the deck (keyboard is more robust than the button at
    // the deck boundary), screenshotting each distinct tree slide.
    const names = ['file-tree', 'dependency-tree', 'category-outline'];
    let captured = 0;
    let lastText = '';
    for (let i = 0; i < 10 && captured < names.length; i++) {
      const tree = page.locator('.doc-player .squisq-treelayer').first();
      if ((await tree.count()) > 0) {
        const text = await tree.textContent();
        if (text && text !== lastText) {
          lastText = text;
          await page.waitForTimeout(250);
          await page.locator('.doc-player').screenshot({
            path: `test-results/tree-gallery/${String(captured + 1).padStart(2, '0')}-${names[captured]}.png`,
            animations: 'disabled',
          });
          captured++;
        }
      }
      await page.locator('.doc-player').click({ position: { x: 40, y: 40 } });
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
    }
    expect(captured).toBeGreaterThanOrEqual(2);
  });
});
