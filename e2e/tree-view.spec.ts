import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the ASCII tree outline editor.
 *
 * A tree fence is hidden and an interactive outline widget is mounted over
 * it; every edit rewrites the fence (op → render). Assertions read the live
 * hidden `<pre>` (the fence text) — no view switching needed.
 */

async function loadSample(page: Page, sample: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption(sample);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function loadTree(page: Page, sample = 'tree-project-scaffold') {
  await loadSample(page, sample);
  await page
    .locator('.squisq-tree-widget-host')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
  await page
    .locator('.squisq-tree-outline .squisq-tree-label')
    .first()
    .waitFor({ state: 'visible' });
}

/** The live fence text behind the (first) outline widget. */
async function fenceText(page: Page): Promise<string> {
  const pre = page.locator('pre.squisq-tree-fence-hidden, pre.squisq-tree-fence-source').first();
  return ((await pre.textContent()) ?? '').replace(new RegExp(String.fromCharCode(160), 'g'), ' ');
}

/** The `language-*` class on the (first) tree fence's `<code>`, or ''. */
async function fenceLang(page: Page): Promise<string> {
  const code = page
    .locator('pre.squisq-tree-fence-hidden code, pre.squisq-tree-fence-source code')
    .first();
  const cls = (await code.getAttribute('class')) ?? '';
  return /language-(\S+)/.exec(cls)?.[1] ?? '';
}

test.describe('ASCII tree outline editor', () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('renders the outline over a hidden fence with folder/file rows', async ({ page }) => {
    await loadTree(page);
    // Rows render with labels.
    const labels = page.locator('.squisq-tree-outline .squisq-tree-label');
    expect(await labels.count()).toBeGreaterThanOrEqual(5);
    // The source fence exists but is hidden.
    const pre = page.locator('pre.squisq-tree-fence-hidden').first();
    await expect(pre).toBeAttached();
    await expect(pre).toBeHidden();
  });

  test('untouched tree round-trips its art verbatim', async ({ page }) => {
    await loadTree(page);
    const md = await fenceText(page);
    expect(md).toContain('my-app/');
    expect(md).toContain('├── src/');
    expect(md).toContain('│       ├── Header.tsx');
  });

  test('renaming a row rewrites the fence', async ({ page }) => {
    await loadTree(page);
    const before = await fenceText(page);
    const input = page
      .locator('.squisq-tree-outline .squisq-tree-label')
      .filter({ has: page.locator(':scope') })
      .nth(0);
    // Find the input whose value is "my-app/" and rename the root.
    const root = page.locator('.squisq-tree-label').first();
    await root.click();
    await root.fill('renamed-app/');
    await root.blur();
    await expect(async () => {
      const md = await fenceText(page);
      expect(md).not.toBe(before);
      expect(md).toContain('renamed-app/');
    }).toPass({ timeout: 5_000 });
    void input;
  });

  test('the add-item toolbar button grows the tree', async ({ page }) => {
    await loadTree(page);
    const beforeCount = await page.locator('.squisq-tree-label').count();
    await page
      .locator('.squisq-tree-toolbar .squisq-tree-btn', { hasText: 'Item' })
      .first()
      .click();
    await expect(async () => {
      expect(await page.locator('.squisq-tree-label').count()).toBe(beforeCount + 1);
    }).toPass({ timeout: 5_000 });
  });

  test('the add-folder toolbar button adds a directory', async ({ page }) => {
    await loadTree(page);
    await page
      .locator('.squisq-tree-toolbar .squisq-tree-btn', { hasText: 'Folder' })
      .first()
      .click();
    await expect(async () => {
      expect(await fenceText(page)).toContain('folder1/');
    }).toPass({ timeout: 5_000 });
  });

  test('undo restores the original fence after an edit', async ({ page }) => {
    await loadTree(page);
    const before = await fenceText(page);
    const root = page.locator('.squisq-tree-label').first();
    await root.click();
    await root.fill('changed/');
    await root.blur();
    await expect(async () => {
      expect(await fenceText(page)).not.toBe(before);
    }).toPass({ timeout: 5_000 });
    await page.locator('.tiptap.ProseMirror').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(async () => {
      expect(await fenceText(page)).toBe(before);
    }).toPass({ timeout: 5_000 });
  });

  test('editing promotes the fence to the explicit `tree` language tag', async ({ page }) => {
    // The sticky-identity guarantee: once the outline is edited, the fence
    // carries `language-tree` so it survives a later flatten → markdown → back
    // round-trip (the language class round-trips; fence meta does not).
    await loadTree(page);
    const root = page.locator('.squisq-tree-label').first();
    await root.click();
    await root.fill('tagged-app/');
    await root.blur();
    await expect(async () => {
      expect(await fenceText(page)).toContain('tagged-app/');
      expect(await fenceLang(page)).toBe('tree');
    }).toPass({ timeout: 5_000 });
  });

  test('collapse chevron hides a folder’s children', async ({ page }) => {
    await loadTree(page);
    const totalBefore = await page.locator('.squisq-tree-label').count();
    // Collapse the first folder that has a chevron.
    await page.locator('.squisq-tree-chevron:not(.squisq-tree-chevron--empty)').first().click();
    await expect(async () => {
      expect(await page.locator('.squisq-tree-label').count()).toBeLessThan(totalBefore);
    }).toPass({ timeout: 3_000 });
  });

  test('a box-diagram fence still gets the diagram widget (mutual exclusion)', async ({ page }) => {
    await loadSample(page, 'diagram-gallery');
    // Diagram widgets mount; no tree widgets appear for box diagrams.
    await page
      .locator('.squisq-ascii-diagram-widget-host')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    await expect(page.locator('.squisq-tree-widget-host')).toHaveCount(0);
  });
});
