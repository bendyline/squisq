import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, selectWriteMode } from './view-tabs';

/**
 * Write › Study cards on the demo site, which lends no AI: the sections of
 * the "Study cards" sample beside their cards, a card added by hand and saved
 * into the document, a changed section's AI card kept, and the cards studied
 * in Use › Flashcards.
 */

async function openStudyCards(page: Page) {
  await page.locator('select').first().selectOption('study-cards');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 10_000 });
  await selectWriteMode(page, 'Study cards');
  const view = page.getByRole('region', { name: 'Study cards', exact: true });
  await expect(view.getByRole('status').first()).toContainText('cards in', { timeout: 15_000 });
  return view;
}

test.describe('Study cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('lists each section with its cards, with no AI on a host that lends none', async ({
    page,
  }) => {
    const view = await openStudyCards(page);
    const sections = view.getByRole('navigation', { name: 'Sections' }).getByRole('button');
    await expect(sections).toHaveCount(3);
    await expect(sections.nth(1)).toContainText('How leaves work');
    await expect(sections.nth(1)).toContainText('2 cards');
    await expect(sections.nth(1)).toContainText('1 to check');
    await expect(view.getByRole('button', { name: 'Generate for this section' })).toHaveCount(0);
  });

  test('adds a card by hand and keeps a changed section’s AI card', async ({ page }) => {
    const view = await openStudyCards(page);
    const sections = view.getByRole('navigation', { name: 'Sections' }).getByRole('button');
    await sections.nth(2).click();
    await view.getByRole('button', { name: 'Add flashcard' }).click();
    const form = view.getByRole('article', { name: 'New flashcard' });
    await form
      .getByRole('textbox', { name: 'Question' })
      .fill('What do roots do besides drinking?');
    await form.getByRole('textbox', { name: 'Answer' }).fill('They anchor the plant.');
    await form.getByRole('button', { name: 'Save card' }).click();
    await expect(sections.nth(2)).toContainText('2 cards');

    await sections.nth(1).click();
    await expect(view.getByText(/text changed after AI wrote one of its cards/)).toBeVisible();
    await view.getByRole('button', { name: 'Keep all' }).click();
    await expect(view.getByText(/text changed after AI wrote/)).toHaveCount(0);
    await expect(sections.nth(1)).not.toContainText('to check');
  });

  test('studies exactly the document’s cards in Use › Flashcards', async ({ page }) => {
    await openStudyCards(page);
    await selectUseMode(page, 'Flashcards');
    await expect(page.getByRole('heading', { name: 'What makes leaves green?' })).toBeVisible();
    await expect(page.getByText('Card 1 of 3').first()).toBeVisible();
  });

  test('folds the section list into a picker in a narrow panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const view = await openStudyCards(page);
    await expect(view.getByRole('combobox', { name: 'Section' })).toBeVisible();
    await expect(view.getByRole('navigation', { name: 'Sections' })).toBeHidden();
  });
});
