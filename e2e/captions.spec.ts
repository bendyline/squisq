import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests verifying that closed captions are derived from the
 * hello-world sample content and displayed during playback.
 */

// ── Helpers (shared with site.spec.ts) ──────────────────────────────

async function selectSample(page: Page, key: string) {
  await page.locator('select').first().selectOption(key);
}

async function switchView(page: Page, label: 'Raw' | 'Editor' | 'Play' | 'Preview') {
  await page.getByRole('tab', { name: label }).click();
}

async function waitForDocPlayer(page: Page) {
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
}

async function startPlaybackAndWaitForActiveBlock(page: Page) {
  await page.locator('.doc-player').click();
  await page.locator('.doc-player__block--active').waitFor({ state: 'visible', timeout: 5_000 });
}

// ── Caption Tests ───────────────────────────────────────────────────

test.describe('Caption display', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await selectSample(page, 'hello-world');
    await switchView(page, 'Play');
    await waitForDocPlayer(page);
  });

  test('caption overlay element exists after playback starts', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);
    const overlay = page.locator('.caption-overlay');
    await expect(overlay).toBeAttached({ timeout: 5_000 });
  });

  test('captions show text derived from hello-world content', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);

    // Wait a moment for the first caption phrase to kick in
    await page.waitForTimeout(1_000);

    // The hello-world sample body starts with "Welcome to the Squisq Editor."
    // and "This is a simple markdown document."
    // Collect caption text over the first few seconds.
    const captionTexts: string[] = [];

    for (let i = 0; i < 8; i++) {
      const span = page.locator('.caption-overlay span');
      const text = await span.textContent().catch(() => null);
      if (text && text.trim()) {
        captionTexts.push(text.trim());
      }
      await page.waitForTimeout(500);
    }

    // We should have captured at least one caption phrase
    expect(captionTexts.length).toBeGreaterThan(0);

    // Caption text should come from the hello-world content
    const allCaptionText = captionTexts.join(' ');
    const containsExpected =
      allCaptionText.includes('Squisq Editor') ||
      allCaptionText.includes('simple markdown') ||
      allCaptionText.includes('editing this document') ||
      allCaptionText.includes('switch views') ||
      allCaptionText.includes('Happy editing');
    expect(containsExpected).toBe(true);
  });

  test('captions change as playback progresses through blocks', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);

    // Collect unique caption texts over ~16s of the ~19s document
    const uniqueCaptions = new Set<string>();

    for (let i = 0; i < 16; i++) {
      const span = page.locator('.caption-overlay span');
      // Use a short timeout so we don't hang when the span is absent
      const text = await span.textContent({ timeout: 500 }).catch(() => null);
      if (text && text.trim()) {
        uniqueCaptions.add(text.trim());
      }
      await page.waitForTimeout(1_000);
    }

    // There are 4 caption phrases across 3 blocks — we should see at least 2 distinct captions
    expect(uniqueCaptions.size).toBeGreaterThanOrEqual(2);
  });

  test('screenshots at different timestamps show captions', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);

    // Take screenshots at different points during the ~19s playback
    const timestamps = [
      { wait: 500, name: 'caption-block1-early' },
      { wait: 2_000, name: 'caption-block1-late' },
      { wait: 3_500, name: 'caption-block2' },
      { wait: 7_000, name: 'caption-block3' },
    ];

    let captionFound = false;
    let elapsed = 0;

    for (const ts of timestamps) {
      const toWait = ts.wait - elapsed;
      if (toWait > 0) {
        await page.waitForTimeout(toWait);
      }
      elapsed = ts.wait;

      // Take a screenshot of the DocPlayer area
      const player = page.locator('.doc-player');
      await player.screenshot({
        path: `test-results/${ts.name}.png`,
      });

      // Check if caption text is visible at this moment
      const span = page.locator('.caption-overlay span');
      const text = await span.textContent().catch(() => null);
      if (text && text.trim()) {
        captionFound = true;
      }
    }

    // At least one screenshot should have had a visible caption
    expect(captionFound).toBe(true);
  });
});
