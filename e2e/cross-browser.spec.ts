import { expect, test } from '@playwright/test';
import { selectUseMode, switchView } from './view-tabs';

test.describe('cross-browser critical path', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tiptap.ProseMirror')).toBeVisible();
  });

  test('edits rich text and renders both HTML and SVG views', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    await expect(editor).toBeVisible();
    const paragraph = editor.locator('p').first();
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Cross-browser edit.');
    await expect(editor).toContainText('Cross-browser edit.');

    await page.locator('select').first().selectOption('diagram-architecture');
    await switchView(page, 'Play');
    await selectUseMode(page, 'Page');
    await expect(page.locator('.squisq-page')).toBeVisible();
    await expect(page.locator('.squisq-page-canvas svg').first()).toBeVisible();
  });

  test('traps and restores focus in the block type dialog', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    const heading = editor.locator('h1, h2, h3').first();
    await heading.click({ position: { x: 8, y: 8 } });
    const opener = heading.locator('.squisq-template-badge').first();
    await opener.click();

    const dialog = page.getByRole('dialog', { name: /Block Type/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search block types' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(editor).toBeFocused();
  });
});
