import { defineConfig, devices } from '@playwright/test';

const e2eBaseUrl = 'http://127.0.0.1:5199';
const htmlReportOpenMode = 'never';

// Keep repo test scripts non-interactive even if a shell has
// PLAYWRIGHT_HTML_OPEN configured globally.
process.env.PLAYWRIGHT_HTML_OPEN = htmlReportOpenMode;

/**
 * Playwright configuration for squisq E2E tests.
 *
 * Targets the dev site (packages/site) running on Vite.
 * Tests cover the editor shell, DocPlayer preview, and sample interaction.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: htmlReportOpenMode }]],
  timeout: 30_000,

  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Serve the built Vite site before running tests. */
  webServer: {
    command: 'npm run preview:e2e -w squisq-site',
    url: e2eBaseUrl,
    // Always run against the built preview server for this suite. Reusing an
    // already-open Vite dev server can hit stale optimized deps and leave the
    // app shell empty, which makes every UI selector time out.
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
