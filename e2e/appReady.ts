import { type Page } from '@playwright/test';

/**
 * Wait for the dev-site app to actually mount after a navigation, recovering
 * from the cold-start bundle stall that occasionally leaves the first
 * navigation unmounted.
 *
 * This is the drop-in replacement for `page.waitForLoadState('networkidle')`,
 * which Playwright discourages and which — on this heavy multi-chunk bundle —
 * gates on network quiet rather than on the app being interactive. The sample
 * picker (`<select>`) renders synchronously with the app root, so its
 * visibility is the real readiness signal.
 *
 * A cold single-worker preview server occasionally stalls one of the large
 * bundle chunks on the very first navigation, so the module graph never
 * finishes evaluating and nothing mounts. A one-shot reload re-fetches the
 * now-warm chunks (preserving the current URL, query params included) and
 * recovers in-test rather than relying on Playwright's cross-test retry.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  const picker = page.locator('select').first();
  try {
    await picker.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    await page.reload();
    await picker.waitFor({ state: 'visible', timeout: 10_000 });
  }
}
