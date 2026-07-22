import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/**
 * Ensure the Playwright browser binaries are installed and match the version of
 * `@playwright/test` pinned in this repo.
 *
 * `@playwright/test` / `playwright-core` are npm dependencies, but the actual
 * browser binaries (Chromium/Firefox/WebKit) are downloaded out-of-band by
 * `playwright install`. A plain `npm install` never fetches them, so the CLI's
 * native e2e tests (`test:cli:native:required`) and the browser e2e suite
 * (`test:e2e:ci`) fail with "Playwright Chromium is missing" until they are.
 *
 * This step is idempotent: `playwright install` skips browsers that are already
 * present and up to date, so it is cheap to run on every `npm run all`.
 *
 * Browsers installed match the Playwright config's projects: chromium (CLI
 * native video pipeline + e2e), firefox and webkit (e2e smoke projects).
 *
 * Set PLAYWRIGHT_WITH_DEPS=1 to also install the OS-level dependencies
 * (`--with-deps`; Linux CI, needs root). Off by default so local/Windows/macOS
 * runs don't require sudo.
 */

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, '..');

// Resolve the Playwright CLI shipped by the pinned dependency so the browser
// versions always match the installed package (rather than whatever a global
// `playwright` on PATH might be). The package `exports` map blocks resolving
// `cli.js` as a subpath, so locate it relative to the package.json instead.
const playwrightPkg = require.resolve('playwright-core/package.json');
const playwrightCli = resolve(dirname(playwrightPkg), 'cli.js');

const browsers = ['chromium', 'firefox', 'webkit'];
const args = [playwrightCli, 'install'];
if (process.env.PLAYWRIGHT_WITH_DEPS === '1') args.push('--with-deps');
args.push(...browsers);

console.log(`Ensuring Playwright browsers are installed: ${browsers.join(', ')}`);

const result = spawnSync(process.execPath, args, {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
