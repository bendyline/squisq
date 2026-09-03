import { test, expect, type Page } from '@playwright/test';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '@bendyline/squisq-formats/docx';
import { markdownDocToPdf } from '@bendyline/squisq-formats/pdf';
import { markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

/**
 * E2E coverage for uploading a non-markdown document to the dev site.
 *
 * The unit tests in `packages/site/src/__tests__/documentImport.test.ts` cover
 * the conversion pipeline itself; these two cover the parts only a real browser
 * can show — that an office file picked through the Upload control lands in the
 * editor as editable markdown, and that a conversion failure surfaces in the
 * import dialog (which the user can read and dismiss) rather than as a
 * browser alert.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build a real DOCX in the test process so the fixture never goes stale. */
async function docxFixture(markdown: string): Promise<Buffer> {
  const bytes = await markdownDocToDocx(parseMarkdown(markdown));
  return Buffer.from(bytes as ArrayBuffer);
}

/**
 * Wait out the import dialog before touching the editor chrome.
 *
 * The dialog is a real modal — a full-viewport overlay at z-index 10000 — and
 * conversion is not cancellable, so it stays up for the whole import and eats
 * pointer events aimed at anything behind it. Clicking a view tab while it is
 * open therefore does not race the import, it deadlocks against it: Playwright
 * retries the click until the test times out. Gate on the dialog closing (which
 * it only does on success) and the click lands on the first try.
 */
async function waitForImportToFinish(page: Page, timeout: number): Promise<void> {
  await expect(page.getByTestId('import-progress-dialog')).toBeHidden({ timeout });
}

test.describe('document import', () => {
  test('converts an uploaded DOCX into editable markdown', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByTestId('site-upload-input').setInputFiles({
      name: 'quarterly.docx',
      mimeType: DOCX_MIME,
      buffer: await docxFixture('# Quarterly Review\n\nRevenue climbed in every region.\n'),
    });

    // The dialog closes itself on success — it is only dismissible on failure.
    await waitForImportToFinish(page, 15_000);

    await switchView(page, 'Editor');
    await expect(page.locator('.tiptap.ProseMirror')).toContainText(
      'Revenue climbed in every region.',
      { timeout: 15_000 },
    );
  });

  test('converts an uploaded PDF into editable markdown', async ({ page }) => {
    // pdfjs is the heaviest importer we ship, and on a cold single-worker CI
    // run its first parse has exceeded the 30s default on its own.
    test.setTimeout(90_000);

    await page.goto('/');
    await waitForAppReady(page);

    const bytes = await markdownDocToPdf(
      parseMarkdown('# Field Notes\n\nRevenue climbed in every region.\n'),
    );
    await page.getByTestId('site-upload-input').setInputFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes as ArrayBuffer),
    });

    await waitForImportToFinish(page, 60_000);

    await switchView(page, 'Editor');
    // pdfjs reflows extracted text, so match a phrase rather than a paragraph.
    await expect(page.locator('.tiptap.ProseMirror')).toContainText('Revenue climbed', {
      timeout: 20_000,
    });
  });

  test('converts an uploaded spreadsheet into a markdown table', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const source = [
      '# Sales',
      '',
      '| Region | Total |',
      '| --- | --- |',
      '| North | 120 |',
      '',
    ].join('\n');
    const bytes = await markdownDocToXlsx(parseMarkdown(source));
    await page.getByTestId('site-upload-input').setInputFiles({
      name: 'sales.xlsx',
      mimeType: XLSX_MIME,
      buffer: Buffer.from(bytes),
    });

    await waitForImportToFinish(page, 15_000);

    await switchView(page, 'Editor');
    await expect(page.locator('.tiptap.ProseMirror')).toContainText('North', {
      timeout: 15_000,
    });
  });

  test('reports a failed conversion in the import dialog', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByTestId('site-upload-input').setInputFiles({
      name: 'broken.docx',
      mimeType: DOCX_MIME,
      buffer: Buffer.from('this is not a zip archive'),
    });

    const dialog = page.getByTestId('import-progress-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('import-error-message')).toContainText('broken.docx');

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });
});
