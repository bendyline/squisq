import { expect, test, type Response } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForAppReady } from './appReady';

test('startup keeps optional encoders and diagrams out of the initial script payload', async ({
  page,
}, testInfo) => {
  // The proofing engine's cold setup (a WASM compile) can take a while.
  test.setTimeout(90_000);
  const scripts: Promise<{ name: string; bytes: number }>[] = [];
  const collectScript = (response: Response) => {
    if (
      response.request().resourceType() !== 'script' ||
      !/\.m?js$/.test(new URL(response.url()).pathname)
    )
      return;
    scripts.push(
      response
        .body()
        .then((body) => ({ name: new URL(response.url()).pathname, bytes: body.byteLength })),
    );
  };
  page.on('response', collectScript);
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('.tiptap.ProseMirror')).toBeVisible();
  // The proofing engine (harper.js and its binary module) loads after mount —
  // lazily, but on every visit, so it belongs in the count. Its chunks land
  // right around the moment the network first goes quiet, so waiting on
  // network quiet alone counted them on some runs and not others (43 KB that
  // decided the budget). The status bar leaves "Proofing…" only once the
  // engine is set up, by which point every one of its scripts has loaded.
  await expect(page.locator('.squisq-proof-status')).toHaveText(/^(✓ Proofing|\d+ issues?)$/, {
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle');
  // Stop collecting before awaiting: a body() read started after Promise.all
  // took its snapshot is awaited by nothing, and Playwright rejects it with
  // "Test ended" at teardown, failing a test whose budget held.
  page.off('response', collectScript);
  const payload = await Promise.all(scripts);
  const total = payload.reduce((sum, script) => sum + script.bytes, 0);
  const reportPath = testInfo.outputPath('startup-scripts.json');
  await writeFile(reportPath, JSON.stringify({ total, scripts: payload }, null, 2));
  await testInfo.attach('startup-scripts', {
    path: reportPath,
    contentType: 'application/json',
  });
  // The first split left 7.32 MB eager. Native import boundaries and deferred
  // capture/ZIP tools bring it below 4 MB, including post-mount startup scripts.
  // 4.05 MB since 2026-11-24: the slide projection draws blocks rolled up onto
  // another slide, and the Flashcards view reads study cards kept with a
  // section — both run at startup. Writing and making cards stays lazy
  // (`@bendyline/squisq/study`).
  expect(total).toBeLessThan(4_050_000);
  expect(
    payload.filter((script) =>
      /\/(?:rnnoise|mermaid|html2canvas|captureVideoCodecs|pdf|jszip)[.-]/.test(script.name),
    ),
  ).toEqual([]);
});

test('plain HTML ZIP export loads on demand and preserves the document', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  const editor = page.locator('.tiptap.ProseMirror');
  await expect(editor).toBeVisible();
  const heading = (await editor.locator('h1').first().textContent())!.trim();
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export with Options', exact: true });
  await dialog.getByLabel('Format', { exact: true }).selectOption('htmlzip');
  await dialog.getByRole('button', { name: 'Plain', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const file = await download.path();
  expect(file).not.toBeNull();
  const zip = await JSZip.loadAsync(await readFile(file!));
  const html = await zip.file('index.html')!.async('string');
  expect(html).toContain(heading);
  expect(html).toContain('</html>');
});
