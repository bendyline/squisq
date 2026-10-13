import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForAppReady } from './appReady';

test('startup keeps optional encoders and diagrams out of the initial script payload', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const scripts: Promise<{ name: string; bytes: number }>[] = [];
  page.on('response', (response) => {
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
  });
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('.tiptap.ProseMirror')).toBeVisible();
  await page.waitForLoadState('networkidle');
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
  expect(total).toBeLessThan(4_000_000);
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
