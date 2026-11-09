import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectWriteMode, type WriteMode } from './view-tabs';

/**
 * E2E for the large block preview shown beside the editing card in
 * block-at-a-time / timeline mode when "Show block previews" is on. In
 * document mode the same toggle drives the inline-preview gutter instead.
 */

async function load(page: Page, sample = 'hello-world') {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption(sample);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  if (sample === 'hello-world') {
    await expect(page.locator('.tiptap.ProseMirror h1').first()).toContainText('Hello World');
  }
}

/**
 * Set the layout (the Write tab's mode menu, which also enters Write) and the
 * "Show block previews" toggle. The View menu stays open after clicking its
 * items, so we close it by re-clicking the trigger.
 */
async function configureView(page: Page, opts: { layout?: WriteMode; previews?: boolean }) {
  if (opts.layout) await selectWriteMode(page, opts.layout);
  if (opts.previews === undefined) return;
  const trigger = page.getByRole('button', { name: 'View options' });
  await trigger.click();
  const toggle = page
    .locator('[role="menuitemcheckbox"]')
    .filter({ hasText: 'Show block previews' });
  const checked = (await toggle.getAttribute('aria-checked')) === 'true';
  if (checked !== opts.previews) await toggle.click();
  await trigger.click(); // close the menu
}

const panel = (page: Page) => page.getByTestId('block-preview-panel');

test('block mode: panel appears when previews are on, follows the active block', async ({
  page,
}) => {
  await load(page);
  await configureView(page, { layout: 'Blocks', previews: true });

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
  await configureView(page, { layout: 'Blocks', previews: true });
  await expect(panel(page)).toBeVisible();
  await configureView(page, { previews: false });
  await expect(panel(page)).toHaveCount(0);
});

test('document mode still uses the inline-preview gutter, not the panel', async ({ page }) => {
  await load(page, 'about-squisq');
  await configureView(page, { layout: 'Write', previews: true });
  await expect(page.locator('.squisq-inline-preview-gutter')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

for (const view of ['Write', 'Source'] as const) {
  test(`document mode previews untagged blocks in ${view}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await load(page);
    await configureView(page, { layout: 'Write', previews: true });
    if (view === 'Source') await page.getByRole('tab', { name: 'Source', exact: true }).click();
    const gutter = page.getByTestId('inline-preview-gutter');
    await expect(gutter).toBeVisible();
    const cards = gutter.locator('.squisq-inline-preview-card');
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index++) await expect(cards.nth(index)).toBeVisible();
    await expect(cards.first().locator('.squisq-inline-preview-card-svg')).toContainText(
      'This is a simple markdown document.',
    );
    await configureView(page, { previews: false });
    await expect(gutter).toHaveCount(0);
  });
}

test('document mode previews prose without any headings in Source and Write', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await load(page);
  await configureView(page, { layout: 'Write', previews: true });
  await page.getByRole('tab', { name: 'Source', exact: true }).click();
  const source = page.locator('[data-testid="raw-editor"] textarea.inputarea');
  await expect(source).toBeVisible();
  const modifier = await page.evaluate(() =>
    navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control',
  );
  await source.press(`${modifier}+a`);
  await page.keyboard.insertText('An introduction without any headings or template tags.');
  const card = page.getByTestId('inline-preview-gutter').locator('.squisq-inline-preview-card');
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card.locator('.squisq-inline-preview-card-svg')).toContainText(
    'An introduction without any headings or template tags.',
  );

  await page.getByRole('tab', { name: 'Write', exact: true }).click();
  await expect(page.locator('.tiptap.ProseMirror')).toHaveText(
    'An introduction without any headings or template tags.',
  );
  await expect(page.locator('.tiptap.ProseMirror :is(h1,h2,h3,h4,h5,h6)')).toHaveCount(0);
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card.locator('.squisq-inline-preview-card-svg')).toContainText(
    'An introduction without any headings or template tags.',
  );
});
