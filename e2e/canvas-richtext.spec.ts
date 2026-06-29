import { test, expect, type Page } from '@playwright/test';

/**
 * Rich inline text editing for canvas textboxes.
 *
 * Layout textboxes support rich editing: double-click a text layer to open a
 * Tiptap overlay, and the top formatting toolbar (Bold etc.) applies to the
 * selection. Committed content persists as the layer's child sub-block
 * markdown body (no base64 `layers=` blob) and renders via `<foreignObject>`.
 */

test.use({ viewport: { width: 1500, height: 950 } });

// ProseMirror binds select-all to `Mod-a` — Cmd on macOS, Ctrl elsewhere.
// Use the platform-correct modifier so select-all works locally (Mac) and
// in CI (Linux). Matches the convention in editor.spec.ts / timeline.spec.ts.
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

async function clickInsert(page: Page, name: string) {
  await page.locator('.squisq-toolbar button[aria-label="Insert"]').click();
  await page.getByRole('menuitem', { name }).click();
}

async function insertLayout(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.tiptap.ProseMirror').click();
  await clickInsert(page, 'Layout');
  await page.locator('.squisq-scene-widget-host').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
}

test('double-click opens an inline editor and the toolbar bolds the selection', async ({
  page,
}) => {
  await insertLayout(page);

  // The seeded text layer renders plainly to start.
  const seed = page.locator('[data-layer-id="text-1"]').first();
  await seed.scrollIntoViewIfNeeded();
  const box = await seed.boundingBox();
  if (!box) throw new Error('no seed box');

  // Double-click → inline Tiptap overlay over the layer.
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const overlay = page.locator('.squisq-scene-text-overlay .ProseMirror');
  await expect(overlay).toBeVisible({ timeout: 3_000 });

  // Replace the text, select all, and click Bold in the top toolbar.
  await overlay.click();
  await page.keyboard.press(SELECT_ALL);
  await page.keyboard.type('Hello bold');
  await page.keyboard.press(SELECT_ALL);
  await page.locator('.squisq-toolbar button[aria-label^="Bold"]').click();

  // The overlay now carries a <strong> run.
  await expect(page.locator('.squisq-scene-text-overlay strong')).toHaveText('Hello bold');

  // Clicking Bold re-focuses the editor asynchronously (Tiptap's
  // `chain().focus()`); a real click on the overlay restores focus
  // synchronously so the next outside-click reliably blurs → commits.
  await overlay.click();
  // Commit by clicking a neutral spot on the canvas OUTSIDE the textbox
  // overlay (clicking inside it wouldn't blur → wouldn't commit).
  await page.mouse.click(box.x + box.width / 2, box.y - 60);
  await page.waitForTimeout(400);

  // The committed text renders rich (foreignObject HTML with a <strong>).
  await expect(page.locator('.squisq-scene-widget-host strong')).toHaveText('Hello bold', {
    timeout: 3_000,
  });

  // …and persists as readable markdown in the text layer's sub-block body
  // (the bold run as **…**), with no base64 layers= blob.
  await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  await expect(async () => {
    // Monaco renders styled spans, interleaving non-breaking spaces between
    // tokens — normalize whitespace before substring checks.
    const md = (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    expect(md).toContain('Hello bold');
    expect(md).toContain('{[text');
    expect(md).not.toContain('layers=');
  }).toPass({ timeout: 3_000 });
});

test('alignment controls appear for a selected textbox and apply', async ({ page }) => {
  await insertLayout(page);
  const seed = page.locator('[data-layer-id="text-1"]').first();
  await seed.scrollIntoViewIfNeeded();
  const box = await seed.boundingBox();
  if (!box) throw new Error('no box');

  // Single-click selects the textbox → alignment controls appear. The seed
  // starts center/middle.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[aria-label="Align center"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[aria-label="Align middle"]')).toHaveAttribute('aria-pressed', 'true');

  // Re-align left + top; the controls reflect the new state (and persist).
  await page.locator('[aria-label="Align left"]').click();
  await expect(page.locator('[aria-label="Align left"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[aria-label="Align top"]').click();
  await expect(page.locator('[aria-label="Align top"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a selected layout box exposes Fill/Stroke in the toolbar and applies', async ({ page }) => {
  await insertLayout(page);
  await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Box' }).click();
  const box = page.locator('[data-layer-id="box-1"]').first();
  await box.scrollIntoViewIfNeeded();
  const b = await box.boundingBox();
  if (!b) throw new Error('no box');
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);

  // Per-box color controls live inline in the contextual toolbar.
  const fill = page.locator('.squisq-scene-block-toolbar [aria-label="Fill color"]');
  await expect(fill).toBeVisible();
  await fill.fill('#00ff00');

  // Persists to the box's {[rectangle … fill=…]} child annotation (no base64).
  await page.getByRole('tab', { name: 'Markdown', exact: true }).click();
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  await expect(async () => {
    const md = (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(
      /\s+/g,
      ' ',
    );
    expect(md).toMatch(/fill="?#00ff00"?/i);
    expect(md).not.toContain('layers=');
  }).toPass({ timeout: 3_000 });
});

test('a bulleted list renders inside the textbox', async ({ page }) => {
  await insertLayout(page);
  const seed = page.locator('[data-layer-id="text-1"]').first();
  await seed.scrollIntoViewIfNeeded();
  const box = await seed.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const overlay = page.locator('.squisq-scene-text-overlay .ProseMirror');
  await expect(overlay).toBeVisible({ timeout: 3_000 });
  await overlay.click();
  await page.keyboard.press(SELECT_ALL);
  await page.keyboard.type('Apple');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Banana');
  await page.keyboard.press(SELECT_ALL);
  await page.locator('.squisq-toolbar button[aria-label="Bullet list"]').click();
  // The toolbar click re-focuses the editor asynchronously; a real click
  // on the overlay restores focus synchronously so the outside-click below
  // reliably blurs → commits (otherwise the assertion would match the
  // still-open overlay's list rather than the committed render).
  await overlay.click();
  // Commit outside the overlay so the list persists and re-renders rich.
  await page.mouse.click(box.x + box.width / 2, box.y - 60);

  // The list renders as a real <ul><li> inside the canvas textbox.
  await expect(page.locator('.squisq-scene-widget-host ul li').first()).toContainText('Apple', {
    timeout: 3_000,
  });
});

test('Escape cancels the edit without changing the text', async ({ page }) => {
  await insertLayout(page);
  const seed = page.locator('[data-layer-id="text-1"]').first();
  await seed.scrollIntoViewIfNeeded();
  const box = await seed.boundingBox();
  if (!box) throw new Error('no seed box');

  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const overlay = page.locator('.squisq-scene-text-overlay .ProseMirror');
  await expect(overlay).toBeVisible({ timeout: 3_000 });
  await overlay.click();
  await page.keyboard.press(SELECT_ALL);
  await page.keyboard.type('discarded');
  await page.keyboard.press('Escape');

  // Overlay closes and the original seed text is unchanged.
  await expect(page.locator('.squisq-scene-text-overlay')).toHaveCount(0);
  await expect(page.locator('[data-layer-id="text-1"]').first()).toBeVisible();
});

test('drawing shape palette opens from the Shape tool (gutter toolbar, light)', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.tiptap.ProseMirror').click();
  await clickInsert(page, 'Drawing');
  await page.locator('.squisq-scene-widget-host').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);

  // Clicking the Shape tool opens the palette. The toolbar now lives in the
  // right gutter, so the palette opens toward the canvas (to its LEFT).
  await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Shape' }).click();
  const palette = page.locator('.squisq-shape-palette');
  await expect(palette).toBeVisible({ timeout: 3_000 });

  const toolbarBox = await page.locator('.squisq-scene-block-toolbar').boundingBox();
  const palBox = await palette.boundingBox();
  if (!toolbarBox || !palBox) throw new Error('no box');
  // It opens to the LEFT of the gutter toolbar (not over empty page to the right).
  expect(palBox.x).toBeLessThan(toolbarBox.x);
  // …and is light-themed (white surface, dark text).
  const bg = await palette.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');

  // Picking a shape closes it.
  await page.locator('.squisq-shape-palette-item[aria-label="Rectangle"]').click();
  await expect(palette).toHaveCount(0);
});

test('diagram node label is editable inline (plain text)', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('diagram-family-tree');
  await page.locator('.squisq-diagram-widget-host').waitFor({ state: 'visible', timeout: 5_000 });
  await page
    .locator('.squisq-scene-viewport [data-layer-id^="node-card-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });

  const card = page.locator('[data-layer-id="node-card-parent-a"]').first();
  const box = await card.boundingBox();
  if (!box) throw new Error('no card box');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const overlay = page.locator('.squisq-scene-text-overlay .ProseMirror');
  await expect(overlay).toBeVisible({ timeout: 3_000 });
  await overlay.click();
  await page.keyboard.press(SELECT_ALL);
  await page.keyboard.type('Renamed');
  await page.mouse.click(box.x + box.width / 2, box.y - 120);
  await page.waitForTimeout(400);

  // The node label updates (rendered as the node-label text layer).
  await expect(page.locator('[data-layer-id="node-label-parent-a"]').first()).toContainText(
    'Renamed',
    { timeout: 3_000 },
  );
});
