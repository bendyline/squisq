import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForAppReady } from './appReady';

/**
 * Document exports carry diagrams as pictures, drawn in the real browser:
 * a Mermaid flowchart, an ASCII timeline, a file tree, and a drawing block
 * all reach Word and PDF as PNG images instead of source text, and the
 * Mermaid diagram reaches PowerPoint as a picture beside the drawing's
 * native shapes.
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
    expect(media).toHaveLength(4);
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
  });

  test('PDF embeds the pictures', async ({ page }) => {
    const bytes = await exportAs(page, 'pdf');
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.match(/\/Subtype\s*\/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
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
});
