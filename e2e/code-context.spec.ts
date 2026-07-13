import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the codeContext feature: host-supplied markdown sections rendered
 * as Monaco view zones in the code surface. This is the test that retires
 * the zone-interactivity risk (z-index over .view-lines) against REAL
 * Monaco — strips must be clickable, expansion must grow the zone, links
 * must be intercepted without navigation, and streaming/re-anchoring prop
 * updates must reconcile live.
 */

async function openDemo(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('toggle-code-context').click();
  // Monaco mounts lazily; the first zone strip appearing means the whole
  // pipeline (editor → zones → portal) is live.
  await page.locator('.squisq-ccx-strip').first().waitFor({ state: 'visible', timeout: 15_000 });
}

test.describe('codeContext view zones', () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test('renders a strip per section plus the expanded file-top', async ({ page }) => {
    await expect(page.locator('.squisq-ccx-section')).toHaveCount(4);
    // fileTop is defaultExpanded — its body (with the Imports list) is visible.
    const fileTop = page.locator('[data-section-id="file"]');
    await expect(fileTop.locator('.squisq-ccx-body')).toBeVisible();
    await expect(fileTop).toContainText('Profile loading and formatting helpers');
  });

  test('clicking a strip expands the section and grows its zone', async ({ page }) => {
    const zone = page.locator('[data-section-id="formatProfile@9"]');
    const before = (await zone.boundingBox())!.height;
    await zone.locator('.squisq-ccx-strip').click();
    await expect(zone.locator('.squisq-ccx-body')).toBeVisible();
    await expect
      .poll(async () => (await zone.boundingBox())!.height, { timeout: 5_000 })
      .toBeGreaterThan(before + 10);
    // collapse restores
    await zone.locator('.squisq-ccx-strip').click();
    await expect(zone.locator('.squisq-ccx-body')).toHaveCount(0);
  });

  test('custom-scheme links are intercepted without navigating', async ({ page }) => {
    const fileTop = page.locator('[data-section-id="file"]');
    // .view-zones is aria-hidden — target by href, not role
    await fileTop.locator('a[href="workspace-nav:src%2Fresolver.ts"]').click();
    await expect(page.getByTestId('link-log')).toContainText('workspace-nav:src%2Fresolver.ts');
    // still on the demo page — no navigation happened
    await expect(page.getByTestId('toggle-code-context')).toBeVisible();
  });

  test('#L links reveal the line in the editor instead of reaching the host', async ({ page }) => {
    await page.getByTestId('ccx-stream').click();
    const zone = page.locator('[data-section-id="loadProfile@4"]');
    await zone.locator('.squisq-ccx-strip').click();
    await zone.locator('a[href="#L9"]').click();
    await expect(page.getByTestId('link-log')).not.toContainText('#L9');
  });

  test('streaming a body in while expanded replaces the loading row', async ({ page }) => {
    const zone = page.locator('[data-section-id="loadProfile@4"]');
    await zone.locator('.squisq-ccx-strip').click();
    await expect(zone.locator('.squisq-ccx-body--loading')).toBeVisible();
    await page.getByTestId('ccx-stream').click();
    await expect(zone.locator('.squisq-ccx-body')).toContainText('Imported by (3)');
    await expect(zone.locator('.squisq-ccx-body--loading')).toHaveCount(0);
  });

  test('re-anchoring moves zones without losing expansion state', async ({ page }) => {
    const zone = page.locator('[data-section-id="unusedHelper@13"]');
    await zone.locator('.squisq-ccx-strip').click();
    await expect(zone.locator('.squisq-ccx-body')).toBeVisible();
    const before = (await zone.boundingBox())!.y;
    await page.getByTestId('ccx-shift').click();
    await expect
      .poll(async () => (await zone.boundingBox())!.y, { timeout: 5_000 })
      .toBeGreaterThan(before + 5);
    await expect(zone.locator('.squisq-ccx-body')).toBeVisible();
  });
});
