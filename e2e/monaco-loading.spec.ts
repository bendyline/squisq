import { expect, test } from '@playwright/test';
import { switchView } from './view-tabs';

function isMonacoJavaScript(url: string): boolean {
  const pathname = new URL(url).pathname;
  const name = pathname.split('/').at(-1) ?? '';
  return (
    pathname.endsWith('.js') &&
    /^(?:editor\.api|markdown(?:\.contribution)?|markdownHoverParticipant|monaco-|monacoRichFeatures|monacoSuggestions)-/.test(
      name,
    )
  );
}

test('loads the compact Markdown editor only when Source is opened', async ({ page }) => {
  const requestedScripts: string[] = [];
  const startedWorkers: string[] = [];
  page.on('request', (request) => {
    if (isMonacoJavaScript(request.url())) requestedScripts.push(request.url());
  });
  page.on('worker', (worker) => startedWorkers.push(worker.url()));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(requestedScripts).toEqual([]);

  await switchView(page, 'Markdown');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.waitForLoadState('networkidle');

  const requestedNames = requestedScripts.map(
    (url) => new URL(url).pathname.split('/').at(-1) ?? '',
  );
  expect(
    requestedNames.some((name) => name.startsWith('monaco-') || name.startsWith('editor.api-')),
  ).toBe(true);
  expect(
    requestedNames.some(
      (name) => name.startsWith('markdown-') || name.startsWith('markdown.contribution-'),
    ),
  ).toBe(true);
  expect(
    requestedNames.some(
      (name) =>
        name.startsWith('monacoRichFeatures-') ||
        name.startsWith('monacoSuggestions-') ||
        name.startsWith('markdownHoverParticipant-'),
    ),
  ).toBe(false);
  // Markdown uses grammar-only highlighting. Monaco can opportunistically
  // start its base editor worker (for links/word operations) depending on
  // browser scheduling, but it must not start a rich language-service worker.
  // The proofing engine (harper) legitimately runs in a blob: worker at app
  // boot — unrelated to Monaco, so it is exempt from this assertion.
  expect(
    startedWorkers.every(
      (url) =>
        url.startsWith('blob:') ||
        (new URL(url).pathname.split('/').at(-1) ?? '').startsWith('editor.worker-'),
    ),
  ).toBe(true);

  // The page is already network-idle here, so another waitForLoadState can
  // resolve before the keydown's dynamic import starts. Wait for the specific
  // request that proves first keyboard use crossed the lazy-load boundary.
  const suggestionsRequest = page.waitForRequest((request) => {
    const pathname = new URL(request.url()).pathname;
    return (
      pathname.endsWith('.js') &&
      (pathname.split('/').at(-1) ?? '').startsWith('monacoSuggestions-')
    );
  });
  await page.locator('textarea.inputarea').press('KeyA');
  await suggestionsRequest;
  expect(
    requestedScripts.some((url) =>
      (new URL(url).pathname.split('/').at(-1) ?? '').startsWith('monacoSuggestions-'),
    ),
  ).toBe(true);
});
