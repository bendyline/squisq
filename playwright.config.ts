import { defineConfig, devices } from '@playwright/test';
import { findAvailablePort, SQUISQ_DEV_PORT, SQUISQ_E2E_PORT } from './scripts/portUtils';

function readE2ePort(value: string, variableName: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`${variableName} must be an integer between 1024 and 65535.`);
  }
  return port;
}

const selectedPort = process.env.SQUISQ_E2E_SELECTED_PORT;
const e2ePort = selectedPort
  ? readE2ePort(selectedPort, 'SQUISQ_E2E_SELECTED_PORT')
  : await findAvailablePort({
      preferredPort: process.env.SQUISQ_E2E_PORT
        ? readE2ePort(process.env.SQUISQ_E2E_PORT, 'SQUISQ_E2E_PORT')
        : SQUISQ_E2E_PORT,
      excludedPorts: [SQUISQ_DEV_PORT],
    });

// Playwright loads this config in both its coordinator and worker processes.
// Pin the coordinator's allocation so workers do not see the preview server
// itself as a collision and select a different base URL.
process.env.SQUISQ_E2E_SELECTED_PORT = String(e2ePort);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
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
  globalSetup: './e2e/globalSetup.ts',

  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      // Use the full Chromium binary in new-headless mode rather than
      // Playwright's default lightweight `chromium_headless_shell`. The shell
      // build ships a stripped-down GPU/media stack that crashes the renderer
      // during hardware WebCodecs H.264 encode and GPU-backed frame capture
      // (the browser MP4/GIF export pipeline) — headed runs and full Chromium
      // both encode fine. See e2e/video-export.spec.ts.
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      name: 'firefox-smoke',
      testMatch: /cross-browser\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-smoke',
      testMatch: /cross-browser\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
