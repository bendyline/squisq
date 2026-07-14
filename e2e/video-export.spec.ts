import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function countGifFrames(bytes: Uint8Array): number {
  if (bytes.byteLength < 13) return 0;
  let offset = 13;
  const globalPacked = bytes[10];
  if ((globalPacked & 0x80) !== 0) offset += 3 * 2 ** ((globalPacked & 0x07) + 1);
  let frames = 0;
  const skipSubBlocks = () => {
    while (offset < bytes.byteLength) {
      const size = bytes[offset++];
      if (size === 0) return;
      offset += size;
    }
  };
  while (offset < bytes.byteLength) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset += 1;
      skipSubBlocks();
    } else if (marker === 0x2c) {
      frames += 1;
      if (offset + 9 > bytes.byteLength) break;
      const localPacked = bytes[offset + 8];
      offset += 9;
      if ((localPacked & 0x80) !== 0) offset += 3 * 2 ** ((localPacked & 0x07) + 1);
      offset += 1;
      skipSubBlocks();
    } else if (marker !== 0x00) {
      break;
    }
  }
  return frames;
}

/**
 * E2E tests for browser-based video and animated-GIF export.
 *
 * These tests exercise the full export flow: open the download menu,
 * click "Video / Animated GIF", wait for the export modal, and verify
 * export configuration plus the browser MP4 pipeline.
 */

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Video export', () => {
  // 60 s leaves comfortable margin for the tiny fixture: 3 s of video
  // at 15 fps = 45 frames, dominated by html2canvas (~5–15 s on CI
  // hardware). The remaining headroom covers page load and modal setup.
  test.setTimeout(60_000);

  test('full export produces a downloadable MP4', async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

    // `e2e-tiny` is a one-block fixture: it hits the 3-second
    // minDuration floor in markdownToDoc, producing ~45 frames at
    // 15 fps. The site reads `?sample=...` on mount via
    // `getInitialSampleKey()`, so the export runs against the fixture
    // without anyone having to interact with the sample picker.
    await page.goto('/?sample=e2e-tiny');
    await page.waitForLoadState('networkidle');

    // This test exercises the WebCodecs path end-to-end. Linux Chromium ships
    // without the proprietary H.264 encoder, so `VideoEncoder` exists but
    // `avc1.*` configs fail. Skip cleanly in that case rather than asserting
    // a happy-path success the browser physically can't produce.
    //
    // Keep this MP4 assertion focused on its primary WebCodecs path. The GIF
    // test below exercises the locally hosted ffmpeg.wasm core end to end.
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

    const videoOption = page.getByRole('button', { name: /Video \/ Animated GIF/i });
    await videoOption.waitFor({ state: 'visible', timeout: 3_000 });
    await videoOption.click();

    const modalHeading = page.getByRole('heading', { name: 'Export Video' });
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    // Pick the fastest settings so the test isn't bottlenecked on html2canvas.
    // Modal labels aren't wired with htmlFor, so target the selects by their
    // unique option values instead.
    await page.locator('select:has(option[value="draft"])').selectOption('draft');
    // Scope to the export modal — the site toolbar's text-size select also
    // carries a "15" option and would make the bare locator ambiguous.
    await page.getByLabel('Frame Rate').selectOption('15');

    const exportBtn = page.getByRole('button', { name: 'Export Video' });
    await exportBtn.click();

    // The download <a> is created and removed inside the click handler, so we can't
    // race against it — only the "Export complete" / "Export failed" terminal text.
    // The tiny fixture finishes the capture+encode loop in ~5–15 s on
    // typical CI hardware; 45 s is plenty of margin without the
    // multi-minute waits the `hello-world` sample used to require.
    const SUCCESS_TIMEOUT = 45_000;
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
    const videoOption = page.getByRole('button', { name: /Video \/ Animated GIF/i });
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

  test('animated GIF selection applies compression-friendly defaults', async ({ page }) => {
    await page.goto('/?sample=e2e-tiny');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Download/i }).click();
    await page.getByRole('button', { name: /Video \/ Animated GIF/i }).click();

    const format = page.locator('select[aria-label="Format"]');
    const frameRate = page.locator('select[aria-label="Frame Rate"]');
    const animations = page.locator('select[aria-label="Animations and transitions"]');

    await expect(format).toHaveValue('mp4');
    await expect(animations).toHaveValue('enabled');

    await format.selectOption('gif');

    await expect(page.getByRole('heading', { name: 'Export Animated GIF' })).toBeVisible();
    await expect(frameRate).toHaveValue('10');
    await expect(animations).toHaveValue('disabled');
    await expect(page.getByRole('button', { name: 'Export GIF' })).toBeVisible();
  });

  test('full export produces a downloadable animated GIF', async ({ page }) => {
    test.setTimeout(120_000);
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

    await page.goto('/?sample=e2e-gif');
    await page.waitForLoadState('networkidle');
    const wasmAvailable = await page.evaluate(
      () => crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined',
    );
    test.skip(!wasmAvailable, 'ffmpeg.wasm requires a cross-origin-isolated browser');

    await page.locator('button', { hasText: /Download/i }).click();
    await page.getByRole('button', { name: /Video \/ Animated GIF/i }).click();
    await page.locator('select[aria-label="Format"]').selectOption('gif');
    await page.getByRole('button', { name: 'Export GIF' }).click();

    const result = await Promise.race([
      page
        .locator('text=Export complete')
        .waitFor({ state: 'visible', timeout: 90_000 })
        .then(() => 'success'),
      page
        .locator('text=Export failed')
        .waitFor({ state: 'visible', timeout: 90_000 })
        .then(
          async () =>
            `failed: ${await page.locator('text=Export failed').locator('..').textContent()}`,
        ),
    ]);
    if (result !== 'success') console.error(consoleLogs.join('\n'));
    expect(result).toBe('success');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download GIF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.gif$/i);
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    expect(bytes.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
    expect(countGifFrames(bytes)).toBeGreaterThan(1);
  });
});
