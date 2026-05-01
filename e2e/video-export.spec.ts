import { test, expect } from '@playwright/test';

/**
 * E2E tests for browser-based video export.
 *
 * These tests exercise the full export flow: open the download menu,
 * click "Video (.mp4)", wait for the export modal, and verify frames
 * are captured and encoded.
 */

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Video export', () => {
  test.setTimeout(240_000);

  test('full export produces a downloadable MP4', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const hasWebCodecs = await page.evaluate(() => typeof VideoEncoder === 'function');
    if (!hasWebCodecs) {
      test.skip(true, 'WebCodecs not available in this browser');
      return;
    }

    const downloadBtn = page.locator('button', { hasText: /Download/i });
    await downloadBtn.click();

    const videoOption = page.locator('button', { hasText: /Video.*\.mp4/i });
    await videoOption.waitFor({ state: 'visible', timeout: 3_000 });
    await videoOption.click();

    const modalHeading = page.getByRole('heading', { name: 'Export Video' });
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    // Pick the fastest settings so the test isn't bottlenecked on html2canvas.
    // Modal labels aren't wired with htmlFor, so target the selects by their
    // unique option values instead.
    await page.locator('select:has(option[value="draft"])').selectOption('draft');
    await page.locator('select:has(option[value="15"])').selectOption('15');

    const exportBtn = page.getByRole('button', { name: 'Export Video' });
    await exportBtn.click();

    // The download <a> is created and removed inside the click handler, so we can't
    // race against it — only the "Export complete" / "Export failed" terminal text.
    const SUCCESS_TIMEOUT = 180_000;
    const result = await Promise.race([
      page
        .locator('text=Export complete')
        .waitFor({ state: 'visible', timeout: SUCCESS_TIMEOUT })
        .then(() => 'success'),
      page
        .locator('text=Export failed')
        .waitFor({ state: 'visible', timeout: SUCCESS_TIMEOUT })
        .then(async () => {
          const errorEl = page.locator('text=Export failed').locator('..');
          const errorText = await errorEl.textContent();
          return `failed: ${errorText}`;
        }),
    ]);

    if (result !== 'success') {
      console.error('Console logs during export:', consoleLogs.join('\n'));
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
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeVisible({
      timeout: 5_000,
    });

    // Should have quality/format options and an export button
    const exportBtn = page.locator('button', { hasText: /Export|Start/i }).last();
    await expect(exportBtn).toBeVisible();
  });
});
