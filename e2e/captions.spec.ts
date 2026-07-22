import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * E2E tests verifying that closed captions are derived from the
 * hello-world sample content and displayed during playback.
 */

// ── Helpers (shared with site.spec.ts) ──────────────────────────────

async function selectSample(page: Page, key: string) {
  await page.locator('select').first().selectOption(key);
}

async function waitForDocPlayer(page: Page) {
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
}

async function startPlaybackAndWaitForActiveBlock(page: Page) {
  await page.locator('.doc-player').click();
  await page.locator('.doc-player__block--active').waitFor({ state: 'visible', timeout: 5_000 });
}

async function waitForDifferentCaption(page: Page, previous: string): Promise<string> {
  const span = page.locator('.caption-overlay span');
  await expect
    .poll(
      async () => {
        const text = (await span.textContent())?.trim() ?? '';
        return text && text !== previous ? text : '';
      },
      { timeout: 18_000 },
    )
    .not.toBe('');
  return (await span.textContent())?.trim() ?? '';
}

// ── Caption Tests ───────────────────────────────────────────────────

test.describe('Caption display', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await selectSample(page, 'hello-world');
    await switchView(page, 'Play');
    await selectUseMode(page, 'Video');
    await waitForDocPlayer(page);
  });

  test('caption overlay element exists after playback starts', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);
    const overlay = page.locator('.caption-overlay');
    await expect(overlay).toBeAttached({ timeout: 5_000 });
  });

  test('captions show text derived from hello-world content', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);

    // The hello-world sample body starts with "Welcome to the Squisq Editor."
    // and "This is a simple markdown document." Wait for content, not a timer.
    await expect(page.locator('.caption-overlay span')).toContainText(
      /Squisq Editor|simple markdown|editing this document|switch views|Happy editing/,
      { timeout: 8_000 },
    );
  });

  test('captions change as playback progresses through blocks', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);

    const span = page.locator('.caption-overlay span');
    await expect(span).toContainText(/\S/, { timeout: 8_000 });
    const firstCaption = (await span.textContent())?.trim() ?? '';
    expect(firstCaption).not.toBe('');
    expect(await waitForDifferentCaption(page, firstCaption)).not.toBe(firstCaption);
  });

  test('screenshots capture captions when caption state is visible', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);
    const span = page.locator('.caption-overlay span');
    await expect(span).toContainText(/\S/, { timeout: 8_000 });
    const firstCaption = (await span.textContent())?.trim() ?? '';
    await page.locator('.doc-player').screenshot({
      path: 'test-results/caption-visible-first.png',
    });

    expect(await waitForDifferentCaption(page, firstCaption)).not.toBe(firstCaption);
    await expect(span).toContainText(/\S/);
    await page.locator('.doc-player').screenshot({
      path: 'test-results/caption-visible-next.png',
    });
  });
});
