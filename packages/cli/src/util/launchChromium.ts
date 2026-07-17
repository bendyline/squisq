import type { Browser } from 'playwright-core';

/**
 * Launch the Playwright-managed Chromium browser in headless mode.
 *
 * Recent Playwright releases resolve the Chromium headless shell and the full
 * managed browser separately. Prefer the shell when it is installed, then
 * fall back to the full browser so either installation shape can render.
 */
export async function launchHeadlessChromium(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ headless: true, channel: 'chromium' });
  }
}
