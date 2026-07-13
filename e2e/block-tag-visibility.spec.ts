import { expect, test } from '@playwright/test';
import { switchView } from './view-tabs';

test('selected/hovered mode shows tags for both active blocks', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await switchView(page, 'Editor');

  const editor = page.locator('.tiptap.ProseMirror');
  await expect(editor).toBeVisible();

  const selectedHeading = editor.locator('h2').filter({ hasText: 'The Philosophy' });
  const selectedBody = editor.locator('p').filter({
    hasText: 'Author in the Markdown you already know.',
  });
  const hoveredHeading = editor.locator('h2').filter({ hasText: 'Content Comes From Markdown' });
  const hoveredBody = editor.locator('p').filter({
    hasText: 'You almost never type the content',
  });

  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitemradio', { name: 'Selected/hovered block' }).click();

  await selectedBody.click({ position: { x: 20, y: 10 } });
  await expect(selectedHeading.locator('.squisq-template-badge')).toBeVisible();

  await hoveredBody.hover({ position: { x: 20, y: 10 } });
  await expect(hoveredHeading.locator('.squisq-template-badge')).toBeVisible();
  await expect(selectedHeading.locator('.squisq-template-badge')).toBeVisible();
});
