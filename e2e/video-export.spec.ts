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
    // Opt-in: the capture loop runs `hello-world` through html2canvas at
    // 15 fps and then encodes via WebCodecs. Runtime varies from ~45 s
    // to ~200 s depending on the machine, and the wait below has almost
    // no margin on slower CI runners. The sibling
    // `export modal opens from download menu` test already covers the
    // UI integration cheaply; this one is here as a pre-release smoke
    // test of the full encode pipeline. Run it locally before cutting a
    // release with: `RUN_FULL_VIDEO_EXPORT=1 npm run test:e2e`.
    test.skip(
      !process.env.RUN_FULL_VIDEO_EXPORT,
      'Slow full-pipeline encode; set RUN_FULL_VIDEO_EXPORT=1 to run.',
    );

    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // This test exercises the WebCodecs path end-to-end. Linux Chromium ships
    // without the proprietary H.264 encoder, so `VideoEncoder` exists but
    // `avc1.*` configs fail. Skip cleanly in that case rather than asserting
    // a happy-path success the browser physically can't produce.
    //
    // The runtime has a ffmpeg.wasm worker fallback (see workerEncoder.ts),
    // but the @ffmpeg/ffmpeg internal-worker URL trips on Vite + COEP in
    // this dev-server setup — covering that path needs its own test once
    // classWorkerURL/coreURL plumbing lands.
    const h264Supported = await page.evaluate(async () => {
      if (typeof VideoEncoder !== 'function') return false;
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: 'avc1.640028',
          width: 1280,
          height: 720,
          bitrate: 2_000_000,
          framerate: 30,
        });
        return support.supported === true;
      } catch {
        return false;
      }
    });

    if (!h264Supported) {
      test.skip(
        true,
        'WebCodecs H.264 encoder unavailable (typical on Linux Chromium without proprietary codecs)',
      );
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
