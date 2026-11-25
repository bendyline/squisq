import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { chooseSummaryStyle, selectWriteMode } from './view-tabs';

/**
 * Slide summaries are accessory blocks: `{[summary]}` headings saved in the
 * document under the section they describe. The designer writes them; Write
 * folds a section's summaries into one row that opens in place; Source folds
 * each one; neither view shows them as slides.
 */

async function designSummaries(page: Page) {
  await chooseSummaryStyle(page, 'Custom');
  const designer = page.getByRole('region', { name: 'Summarization designer', exact: true });
  await expect(designer.getByRole('img', { name: /^Slide 1/ })).toBeVisible({ timeout: 15_000 });
  const headline = designer.getByRole('textbox', { name: 'Slide headline', exact: true });
  await headline.fill('Plain text, designed');
  await headline.press('Tab');
  const highlights = designer.getByRole('textbox', { name: 'Slide highlights, one per line' });
  await highlights.fill('Write in Markdown\nPresent it as slides');
  await highlights.press('Tab');
  await expect(designer.getByRole('img', { name: /^Slide 1: Plain text, designed/ })).toBeVisible();
}

test.describe('Slide summaries in the document', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('fold into one row per section in Write, opened by mouse or keyboard', async ({ page }) => {
    await designSummaries(page);
    await selectWriteMode(page, 'Write');
    const row = page.locator('.squisq-accessory-row').first();
    const toggle = row.getByRole('button', { name: 'Slide summary' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const summary = page.locator('.squisq-wysiwyg-editor h2, .squisq-wysiwyg-editor h3', {
      hasText: 'Plain text, designed',
    });
    await expect(summary).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(summary).toBeVisible();
    await expect(
      page.locator('.squisq-wysiwyg-editor li', { hasText: 'Present it as slides' }),
    ).toBeVisible();

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(summary).toBeHidden();
  });

  test('open folded in Source, and are never slides', async ({ page }) => {
    await designSummaries(page);
    await selectWriteMode(page, 'Source');
    const editor = page.locator('.monaco-editor').first();
    await expect(editor.locator('.view-line', { hasText: '{[summary]}' })).toBeVisible();
    // The summary's points are folded away under its heading.
    await expect(editor.locator('.view-line', { hasText: 'Present it as slides' })).toHaveCount(0);
    await expect(editor.locator('.inline-folded').first()).toBeVisible();

    // The block previews show the document's sections, not its summaries.
    const previews = page.locator('.squisq-inline-preview-label, .squisq-block-preview-label');
    if ((await previews.count()) > 0)
      await expect(previews.filter({ hasText: 'Plain text, designed' })).toHaveCount(0);
  });
});
