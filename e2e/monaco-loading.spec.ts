import { expect, test } from '@playwright/test';
import { switchView } from './view-tabs';

function isMonacoJavaScript(url: string): boolean {
  const pathname = new URL(url).pathname;
  const name = pathname.split('/').at(-1) ?? '';
  return (
    pathname.endsWith('.js') &&
    /^(?:editor\.api|markdown(?:\.contribution)?|markdownHoverParticipant|monaco|monacoRichFeatures|monacoSuggestions)-/.test(
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
        name.startsWith('monacoRichFeatures-') || name.startsWith('markdownHoverParticipant-'),
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

  // Completion controllers must register before editor construction. The core
  // remains lazy until Source opens, and unrelated language workers stay out.
  expect(requestedNames.some((name) => name.startsWith('monacoSuggestions-'))).toBe(true);
});

test('deferred suggestions remain available when Source is followed by fenced-code editors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await switchView(page, 'Markdown');
  const source = page.locator('[data-testid="raw-editor"] textarea.inputarea');
  await expect(source).toBeVisible();
  const modifier = await page.evaluate(() =>
    navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control',
  );
  await source.press(`${modifier}+a`);
  await page.keyboard.insertText(
    '# Completion regression\n\n```javascript\nconst marker = 42;\nconsole.log(marker);\n```\n',
  );
  for (let cycle = 0; cycle < 2; cycle++) {
    await switchView(page, 'Editor');
    const inset = page.locator('.tiptap .monaco-editor');
    await expect(inset).toBeVisible();
    await expect(inset).toContainText('const marker = 42;');
    const input = inset.locator('textarea.inputarea');
    await input.press(`${modifier}+End`);
    await input.press('Enter');
    await page.keyboard.insertText('mar');
    await input.press('Control+Space');
    await expect
      .poll(async () => {
        expect(errors).toEqual([]);
        return inset.locator('.suggest-widget.visible').isVisible();
      })
      .toBe(true);
    await page.keyboard.press('Escape');
    await switchView(page, 'Markdown');
    await expect(page.locator('[data-testid="raw-editor"]')).toContainText('console.log(marker);');
  }
  expect(errors).toEqual([]);
});
