import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { switchView } from './view-tabs';

/**
 * Heading-based blocks own everything up to the next heading, so the toolbar
 * inserts a layout at the end of the caret's section, deep enough to nest
 * under it — never mid-section, where it would swallow the paragraphs after
 * the caret as a canvas text box. The insert is one undo step.
 */

const NBSP_RE = new RegExp(String.fromCharCode(160), 'g');

const SOURCE = [
  '## Plan',
  '',
  'First paragraph of the plan.',
  '',
  'Second paragraph of the plan.',
  '',
  '## Next',
  '',
  'Closing paragraph.',
].join('\n');

async function loadDocument(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  // Uploaded rather than typed into Monaco: select-all is a platform-specific
  // keystroke, and when it misses, the typed text merges into the sample and
  // "## Plan" loses a level.
  await page.getByTestId('site-upload-input').setInputFiles({
    name: 'sections.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(SOURCE),
  });
  await switchView(page, 'Editor');
  await expect(page.locator('.tiptap.ProseMirror')).toContainText('Closing paragraph.');
}

async function readMarkdown(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  const lines = page.locator('[data-testid="raw-editor"] .monaco-editor .view-lines').first();
  await expect(lines).toContainText('Closing paragraph.', { timeout: 4_000 });
  return (await lines.innerText()).replace(NBSP_RE, ' ');
}

test('Insert → Layout lands at the end of the section without capturing text', async ({ page }) => {
  await loadDocument(page);
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.locator('p', { hasText: 'First paragraph' }).click();
  await page.locator('.squisq-toolbar button[aria-label="Insert"]').click();
  await page.getByRole('menuitem', { name: 'Layout', exact: true }).click();
  await page.locator('.squisq-scene-widget-host').first().waitFor({ state: 'visible' });

  // Both plan paragraphs stay ordinary paragraphs in Write view.
  await expect(editor.locator('p', { hasText: 'Second paragraph of the plan.' })).toBeVisible();

  const source = await readMarkdown(page);
  expect(source).toMatch(/^## Plan$/mu);
  const second = source.indexOf('Second paragraph of the plan.');
  const heading = /^(#{2,5}) Layout \{\[layout\]\}/mu.exec(source);
  const next = source.indexOf('## Next');
  expect(second).toBeGreaterThan(-1);
  expect(heading?.index ?? -1).toBeGreaterThan(second);
  expect(next).toBeGreaterThan(heading?.index ?? Infinity);
  // One level under "## Plan", so it nests in the section and "## Next" still
  // closes it; its text layer one level deeper.
  const depth = heading?.[1]?.length ?? 0;
  expect(depth).toBe(3);
  expect(source).toMatch(new RegExp(`^#{${String(depth + 1)}}\\s+\\{#text-1\\} \\{\\[text `, 'mu'));
});

test('the inserted layout is removed by one undo', async ({ page }) => {
  await loadDocument(page);
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.locator('p', { hasText: 'First paragraph' }).click();
  await page.locator('.squisq-toolbar button[aria-label="Insert"]').click();
  await page.getByRole('menuitem', { name: 'Layout', exact: true }).click();
  await page.locator('.squisq-scene-widget-host').first().waitFor({ state: 'visible' });
  // Past ProseMirror's 500 ms grouping window, so the undo is the insert alone.
  await page.waitForTimeout(600);
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.squisq-scene-widget-host')).toHaveCount(0);
  const source = await readMarkdown(page);
  expect(source).not.toContain('{[layout]}');
  expect(source).toContain('Second paragraph of the plan.');
});
