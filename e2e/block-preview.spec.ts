import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the large block preview shown beside the editing card in
 * block-at-a-time / timeline mode when "Show block previews" is on. In
 * document mode the same toggle drives the inline-preview gutter instead.
 */

async function load(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('hello-world');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

/**
 * Set the layout and the "Show block previews" toggle in one menu session.
 * The View menu stays open after clicking its items, so we open once, apply
 * both changes, then close by re-clicking the trigger.
 */
async function configureView(
  page: Page,
  opts: { layout?: 'Document' | 'Block-at-a-time' | 'Timeline'; previews?: boolean },
) {
  const trigger = page.getByRole('button', { name: 'View options' });
  await trigger.click();
  if (opts.layout) {
    await page.getByRole('menuitemradio', { name: opts.layout }).click();
  }
  if (opts.previews !== undefined) {
    const toggle = page
      .locator('[role="menuitemcheckbox"]')
      .filter({ hasText: 'Show block previews' });
    const checked = (await toggle.getAttribute('aria-checked')) === 'true';
    if (checked !== opts.previews) await toggle.click();
  }
  await trigger.click(); // close the menu
}

const panel = (page: Page) => page.getByTestId('block-preview-panel');

test('block mode: panel appears when previews are on, follows the active block', async ({
  page,
}) => {
  await load(page);
  await configureView(page, { layout: 'Block-at-a-time', previews: true });

  await expect(panel(page)).toBeVisible();
  // The single big preview replaces the multi-card gutter in card mode.
  await expect(page.locator('.squisq-inline-preview-gutter')).toHaveCount(0);
  // It renders the active block (block 1 = "Hello World").
  await expect(panel(page)).toContainText('Hello World');

  // Navigating updates the preview to the new active block.
  await page.getByRole('button', { name: 'Next block' }).click();
  await expect(panel(page)).toContainText('Getting Started');
});

test('timeline mode shows the panel too', async ({ page }) => {
  await load(page);
  await configureView(page, { layout: 'Timeline', previews: true });
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('[data-testid="timeline-track"]')).toBeVisible();
});

test('toggling previews off hides the panel', async ({ page }) => {
  await load(page);
  await configureView(page, { layout: 'Block-at-a-time', previews: true });
  await expect(panel(page)).toBeVisible();
  await configureView(page, { previews: false });
  await expect(panel(page)).toHaveCount(0);
});

test('document mode still uses the inline-preview gutter, not the panel', async ({ page }) => {
  await load(page);
  await configureView(page, { layout: 'Document', previews: true });
  await expect(page.locator('.squisq-inline-preview-gutter')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});
