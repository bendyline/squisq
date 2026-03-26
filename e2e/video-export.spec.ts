import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for browser-based video export.
 *
 * These tests exercise the full export flow: open the download menu,
 * click "Video (.mp4)", wait for the export modal, and verify frames
 * are captured and encoded.
 */

// ── Helpers ──────────────────────────────────────────────────────────

async function switchView(page: Page, label: 'Raw' | 'Editor' | 'Play') {
  await page.getByRole('tab', { name: label }).click();
}

async function waitForDocPlayer(page: Page) {
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Video export', () => {
  test.setTimeout(120_000);

  test('full export produces a downloadable MP4', async ({ page }) => {
    // Collect console messages for debugging
    const consoleLogs: string[] = [];
    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => consoleLogs.push(`[pageerror] ${err.message}`));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if WebCodecs is available (Chromium 94+)
    const hasWebCodecs = await page.evaluate(() => typeof VideoEncoder === 'function');
    if (!hasWebCodecs) {
      test.skip(true, 'WebCodecs not available in this browser');
      return;
    }

    // Open the download menu and click Video (.mp4)
    const downloadBtn = page.locator('button', { hasText: /Download/i });
    await downloadBtn.click();

    const videoOption = page.locator('button', { hasText: /Video.*\.mp4/i });
    await videoOption.waitFor({ state: 'visible', timeout: 3_000 });
    await videoOption.click();

    // The export modal should appear (use heading to avoid ambiguity with the button)
    const modalHeading = page.getByRole('heading', { name: 'Export Video' });
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    // Click the "Export Video" button inside the modal (not the heading)
    const exportBtn = page.getByRole('button', { name: 'Export Video' });
    await exportBtn.click();

    // Wait for export to either complete or fail
    const result = await Promise.race([
      // Success: download link appears
      page.locator('a[download]').waitFor({ state: 'visible', timeout: 90_000 }).then(() => 'success'),
      // Or "Export complete" text
      page.locator('text=Export complete').waitFor({ state: 'visible', timeout: 90_000 }).then(() => 'success'),
      // Failure: error message
      page.locator('text=Export failed').waitFor({ state: 'visible', timeout: 90_000 }).then(async () => {
        const errorEl = page.locator('text=Export failed').locator('..');
        const errorText = await errorEl.textContent();
        return `failed: ${errorText}`;
      }),
    ]);

    if (result !== 'success') {
      console.log('Console logs during export:', consoleLogs.join('\n'));
    }
    expect(result).toBe('success');
  });

  test('export modal opens from download menu', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open download menu
    const downloadBtn = page.locator('button', { hasText: /Download/i });
    await downloadBtn.click();

    // Click Video option
    const videoOption = page.locator('button', { hasText: /Video.*\.mp4/i });
    await expect(videoOption).toBeVisible({ timeout: 3_000 });
    await videoOption.click();

    // Modal should appear with Export Video heading
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeVisible({ timeout: 5_000 });

    // Should have quality/format options and an export button
    const exportBtn = page.locator('button', { hasText: /Export|Start/i }).last();
    await expect(exportBtn).toBeVisible();
  });
});
