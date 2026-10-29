import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView } from './view-tabs';

/**
 * Document exports carry diagrams as pictures, drawn in the real browser:
 * a Mermaid flowchart, an ASCII timeline, a file tree, a drawing block, and
 * a bar chart all reach Word and PDF as PNG images instead of source text or
 * a bare table, and the Mermaid diagram reaches PowerPoint as a picture
 * beside the drawing's native shapes. Plain HTML pages, and the editor's
 * Document preview of them, show the same pictures.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function loadDiagrams(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('select').first().selectOption('e2e-diagrams');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(page.locator('.tiptap.ProseMirror')).toContainText('Closing paragraph.');
}

async function exportPlainHtml(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export with Options', exact: true });
  await dialog.getByLabel('Format', { exact: true }).selectOption('html');
  await dialog.getByRole('button', { name: 'Plain', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!, 'utf8');
}

async function exportAs(page: Page, format: 'docx' | 'pdf' | 'pptx'): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const dialog = page.locator('text=Export with Options').locator('..');
  await dialog.waitFor({ state: 'visible' });
  await page.locator('select', { has: page.locator('option[value="docx"]') }).selectOption(format);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

test.describe('Diagrams in document exports', () => {
  test.beforeEach(async ({ page }) => {
    await loadDiagrams(page);
  });

  test('Word gets a picture of every diagram, not its source', async ({ page }) => {
    const zip = await JSZip.loadAsync(await exportAs(page, 'docx'));
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !zip.files[name]!.dir,
    );
    expect(media).toHaveLength(5);
    for (const name of media) {
      const size = pngSize(await zip.file(name)!.async('uint8array'));
      expect(size.width).toBeGreaterThan(100);
      expect(size.height).toBeGreaterThan(20);
    }
    const documentXml = await zip.file('word/document.xml')!.async('string');
    expect(documentXml).not.toContain('flowchart LR');
    expect(documentXml).not.toContain('Milestones');
    expect(documentXml).not.toContain('helpers.ts');
    // The drawing's heading stays in the outline; its shapes are in the picture.
    expect(documentXml).toContain('Team');
    expect(documentXml).not.toContain('Engineer');
    expect(documentXml).toContain('Closing paragraph.');
    expect(documentXml).toContain('descr="Review flow"');
    // The chart is a picture in place of its table.
    expect(documentXml).toContain('descr="Revenue: bar chart of Revenue by Quarter"');
    expect(documentXml).not.toContain('>Q1<');
  });

  test('PDF embeds the pictures', async ({ page }) => {
    const bytes = await exportAs(page, 'pdf');
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.match(/\/Subtype\s*\/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  test('PowerPoint gets the Mermaid picture and native drawing shapes', async ({ page }) => {
    const zip = await JSZip.loadAsync(await exportAs(page, 'pptx'));
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('ppt/media/') && !zip.files[name]!.dir,
    );
    expect(media.length).toBeGreaterThanOrEqual(1);
    pngSize(await zip.file(media[0]!)!.async('uint8array'));
    const slides = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
        .map((name) => zip.file(name)!.async('string')),
    );
    const all = slides.join('\n');
    expect(all).not.toContain('flowchart LR');
    // The drawing used to export as an empty slide; its shapes are native now.
    expect(all).toContain('Lead');
    expect(all).toContain('Engineer');
  });

  test('a plain HTML page pictures diagrams and charts, and keeps the tree as text', async ({
    page,
  }) => {
    const html = await exportPlainHtml(page);
    const pictures = [
      ...html.matchAll(/<img src="data:image\/png;base64,([^"]+)" alt="([^"]*)"/gu),
    ];
    expect(pictures.map((match) => match[2])).toEqual([
      'Review flow',
      'Timeline',
      'Team',
      'Revenue: bar chart of Revenue by Quarter',
    ]);
    for (const [, base64] of pictures) {
      const size = pngSize(Buffer.from(base64!, 'base64'));
      expect(size.width).toBeGreaterThan(100);
      expect(size.height).toBeGreaterThan(20);
    }
    expect(html).not.toContain('flowchart LR');
    expect(html).not.toContain('Milestones');
    expect(html).toContain('<code class="language-tree">');
    expect(html).toContain('<h2>Revenue</h2>');
    expect(html).not.toContain('<td>Q1</td>');
  });

  test("the editor's Document preview shows the pictures the page will", async ({ page }) => {
    await switchView(page, 'Preview');
    await selectUseMode(page, 'Document');
    const frame = page.frameLocator('[data-testid="plain-html-preview"]');
    const pictures = frame.locator('img[src^="data:image/png;base64,"]');
    await expect(pictures).toHaveCount(4, { timeout: 15_000 });
    await expect(frame.locator('code.language-mermaid')).toHaveCount(0);
    await expect(frame.locator('code.language-tree')).toHaveCount(1);
    await expect(frame.locator('img[alt^="Revenue: bar chart"]')).toHaveCount(1);
  });
});
