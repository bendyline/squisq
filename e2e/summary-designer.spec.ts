import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { chooseSummaryStyle } from './view-tabs';

/**
 * The Custom summary designer in Write › Summarize: built in, so the demo site
 * has it with no host designer and no AI. Its slide list sits beside the
 * selected slide; in a narrow panel the list becomes a picker with Previous and
 * Next, and the designer scrolls as one.
 */

async function openDesigner(page: Page) {
  await chooseSummaryStyle(page, 'Custom');
  const designer = page.getByRole('region', { name: 'Summarization designer', exact: true });
  await expect(designer.getByRole('img', { name: /^Slide 1/ })).toBeVisible({ timeout: 15_000 });
  return designer;
}

test.describe('Custom summary designer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('designs slides beside a slide list, with no AI on a host that lends none', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const designer = await openDesigner(page);
    const list = designer.getByRole('navigation', { name: 'Presentation slides' });
    await expect(list.getByRole('button').first()).toBeVisible();
    await expect(designer.getByRole('combobox', { name: 'Slide', exact: true })).toBeHidden();
    await expect(designer.getByRole('button', { name: 'Suggest with AI' })).toHaveCount(0);

    await list.getByRole('button').nth(1).click();
    await expect(designer.getByRole('img', { name: /^Slide 2/ })).toBeVisible();
    await expect(designer.getByRole('region', { name: 'Original document text' })).toBeVisible();

    // A section's opening slide takes the author's wording, saved as it is left.
    await list.getByRole('button').first().click();
    await designer.getByText('Customize slide wording (slides only)', { exact: true }).click();
    const headline = designer.getByRole('textbox', { name: 'Slide headline', exact: true });
    await headline.fill('Plain text, designed');
    await headline.press('Tab');
    await expect(list.getByRole('button').first()).toContainText('Plain text, designed');
    await expect(
      designer.getByRole('img', { name: /^Slide 1: Plain text, designed/ }),
    ).toBeVisible();
  });

  test('folds the slide list into a picker in a narrow panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const designer = await openDesigner(page);
    const picker = designer.getByRole('combobox', { name: 'Slide', exact: true });
    await expect(designer.getByRole('navigation', { name: 'Presentation slides' })).toBeHidden();
    await expect(picker).toBeVisible();
    await expect(designer.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
    await designer.getByRole('button', { name: 'Next slide' }).click();
    await expect(designer.getByRole('img', { name: /^Slide 2/ })).toBeVisible();
    await expect(picker).toHaveValue('1');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The designer is its own scroller here, so a row too wide for it would
    // scroll it sideways without widening the page.
    const designerOverflow = await designer
      .locator('.squisq-summary-designer-inner')
      .evaluate((inner) => inner.scrollWidth - inner.clientWidth);
    expect(designerOverflow).toBeLessThanOrEqual(0);
  });
});
