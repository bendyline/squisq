import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * E2E tests for the redesigned Page (linear) mode: variable-height HTML
 * sections art-directed by the theme, with SVG retained only for spatial
 * canvas embeds, plus the Cover toggle and per-theme design distinctness.
 */

async function selectSample(page: Page, id: string) {
  await page.locator('select').first().selectOption(id);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function enterPageMode(page: Page) {
  await switchView(page, 'Play');
  await selectUseMode(page, 'Page');
  await page.locator('.squisq-page').waitFor({ state: 'visible', timeout: 5_000 });
}

test.describe('Page mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('renders template blocks as variable-height HTML sections', async ({ page }) => {
    await selectSample(page, 'all-templates');
    await enterPageMode(page);

    // Cover hero synthesized from the doc's start block.
    const hero = page.locator('[data-section-kind="hero"]').first();
    await expect(hero).toBeVisible();

    // Text-first templates render as HTML sections without slide SVG.
    const statBand = page.locator('[data-section-kind="stat-band"]').first();
    await expect(statBand).toBeVisible();
    expect(await statBand.locator('svg').count()).toBe(0);

    const quoteBand = page.locator('[data-section-kind="quote-band"]').first();
    await expect(quoteBand).toBeAttached();
    expect(await quoteBand.locator('svg').count()).toBe(0);

    // Sections are variable height — a stat band must not be a full
    // 16:9 slide (the old behavior rendered ~width*9/16 tall cards).
    const box = await statBand.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan((box!.width * 9) / 16);
  });

  test('spatial diagrams keep SVG inside a responsive canvas section', async ({ page }) => {
    await selectSample(page, 'diagram-architecture');
    await enterPageMode(page);

    const canvas = page.locator('.squisq-page-canvas').first();
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('svg').first()).toBeVisible();
  });

  test('page does not overflow horizontally', async ({ page }) => {
    await selectSample(page, 'all-templates');
    await enterPageMode(page);

    const overflow = await page
      .locator('.squisq-linear')
      .first()
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the Cover slide checkbox toggles the synthesized hero section', async ({ page }) => {
    // features-demo opens with a plain H1 (no authored {[title]} block), so
    // the hero comes from the auto-generated cover startBlock.
    await selectSample(page, 'features-demo');
    await enterPageMode(page);

    await expect(page.locator('[data-block-id="cover"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Cover slide settings' }).click();
    const coverToggle = page.getByRole('checkbox', { name: 'Cover slide' });
    await coverToggle.uncheck();
    await expect(page.locator('[data-block-id="cover"]')).toHaveCount(0);

    await coverToggle.check();
    await expect(page.locator('[data-block-id="cover"]')).toHaveCount(1);
  });

  test('an authored title block wins over the synthesized cover (no duplicate hero)', async ({
    page,
  }) => {
    // all-templates opens with `# … {[title]}` — the cover must dedupe
    // against it instead of rendering the same title twice.
    await selectSample(page, 'all-templates');
    await enterPageMode(page);

    await expect(page.locator('[data-section-kind="hero"]')).toHaveCount(1);
    await expect(page.locator('[data-block-id="cover"]')).toHaveCount(0);
  });

  test('switching themes changes the page art direction', async ({ page }) => {
    await selectSample(page, 'features-demo');
    await enterPageMode(page);

    const pageEl = page.locator('.squisq-page');
    const readDesign = () =>
      pageEl.evaluate((el) => ({
        family: el.getAttribute('data-family'),
        divider: el.getAttribute('data-divider'),
        bg: getComputedStyle(el).getPropertyValue('--squisq-page-bg').trim(),
      }));

    const pickTheme = async (name: string) => {
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page
        .getByRole('listbox', { name: 'Theme' })
        .getByRole('option', { name, exact: true })
        .click();
    };

    await pickTheme('Magazine');
    const magazine = await readDesign();

    await pickTheme('Tech Dark');
    const techDark = await readDesign();

    expect(magazine.family).toBe('editorial');
    expect(techDark.family).toBe('terminal');
    expect(magazine.divider).not.toBe(techDark.divider);
    expect(magazine.bg).not.toBe(techDark.bg);
  });
});
