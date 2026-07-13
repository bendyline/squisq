import { test, expect, type Page } from '@playwright/test';
import { switchView } from './view-tabs';

/**
 * GFM task lists (checkboxes) in the WYSIWYG editor.
 *
 * Typing `[ ] ` or `[x] ` at the start of a line converts the paragraph into a
 * task item (via Tiptap's TaskItem input rule). The checkbox renders live, and
 * the item serializes back to GFM `- [ ]` / `- [x]` markdown — preserving both
 * the checked state and the task text across the editor↔markdown bridge.
 */

// ProseMirror binds select-all to `Mod-a` — Cmd on macOS, Ctrl elsewhere.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function startInEmptyEditor(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await switchView(page, 'Editor');
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.waitFor({ state: 'visible', timeout: 5_000 });
  // Clear the sample doc so the input rule fires on a fresh empty paragraph.
  await editor
    .locator('p')
    .first()
    .click({ position: { x: 8, y: 8 } });
  await expect(page.locator('[data-squisq-template-gallery-portal]')).toHaveCount(0);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press('Delete');
  return editor;
}

/** Read the Monaco source with whitespace normalized (it interleaves nbsp). */
async function markdownSource(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  return (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(
    /\s+/g,
    ' ',
  );
}

test('typing "[ ] " converts to an unchecked checkbox and round-trips to markdown', async ({
  page,
}) => {
  const editor = await startInEmptyEditor(page);

  // The trailing space after `]` triggers the TaskItem input rule.
  await page.keyboard.type('[ ] buy milk');

  // TaskItem renders via a node view that builds the <li> with a checkbox but
  // no data-type attr (that only appears in getHTML()); select the live <li>
  // by the checkbox the node view creates.
  const item = editor.locator('li:has(input[type="checkbox"])', { hasText: 'buy milk' });
  await expect(item).toBeVisible();
  await expect(item.locator('input[type="checkbox"]')).not.toBeChecked();

  await expect(async () => {
    expect(await markdownSource(page)).toContain('- [ ] buy milk');
  }).toPass({ timeout: 3_000 });
});

test('typing "[x] " converts to a checked checkbox and round-trips to markdown', async ({
  page,
}) => {
  const editor = await startInEmptyEditor(page);

  await page.keyboard.type('[x] walk dog');

  const item = editor.locator('li:has(input[type="checkbox"])', { hasText: 'walk dog' });
  await expect(item).toBeVisible();
  await expect(item.locator('input[type="checkbox"]')).toBeChecked();

  await expect(async () => {
    const md = await markdownSource(page);
    expect(md).toContain('- [x] walk dog');
    expect(md).not.toContain('- [ ] walk dog');
  }).toPass({ timeout: 3_000 });
});

test('existing task-list markdown renders as checkboxes in the editor', async ({ page }) => {
  // Load a sample whose markdown already contains a GFM task list, rather than
  // clearing + retyping in Monaco. Monaco here is a *controlled* editor
  // (`value={editorSource}`) with a bidirectional markdown↔state sync; driving
  // it with select-all/backspace/type races the controlled-value round-trip and
  // leaves partial residue (`Tin`, `#`). Loading a sample is the deterministic
  // path the app uses to ingest markdown, so the WYSIWYG mounts on the exact
  // source we want to verify.
  await page.goto('/?sample=e2e-tasklist');
  await page.waitForLoadState('networkidle');

  await switchView(page, 'Editor');
  const editor = page.locator('.tiptap.ProseMirror');
  await editor.waitFor({ state: 'visible', timeout: 5_000 });

  const open = editor.locator('li:has(input[type="checkbox"])', { hasText: 'open task' });
  const closed = editor.locator('li:has(input[type="checkbox"])', { hasText: 'closed task' });
  await expect(open).toBeVisible();
  await expect(closed).toBeVisible();
  await expect(open.locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(closed.locator('input[type="checkbox"]')).toBeChecked();
});
