import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the Squisq drawing editor — the Scene canvas that authors a
 * `{[drawing]}` block as semantic markdown child-heading shapes (no base64).
 *
 * Loads the `drawing-org-chart` sample (a `{[drawing]}` heading + rectangle
 * shapes + `{[arrow from=.. to=..]}` connectors) so the canvas mounts with
 * real shapes, then verifies edits persist to markdown as `{[shape …]}`
 * headings.
 */

async function switchView(page: Page, label: 'Markdown' | 'Editor' | 'Play') {
  await page.getByRole('tab', { name: label, exact: true }).click();
}

async function loadDrawingSample(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('drawing-org-chart');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.squisq-scene-widget-host').waitFor({ state: 'visible', timeout: 5_000 });
  await page
    .locator('.squisq-scene-viewport [data-layer-id^="dshape-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
}

async function shapeRect(page: Page, id: string) {
  const el = page.locator(`[data-layer-id="dshape-${id}"]`).first();
  await el.waitFor({ state: 'visible' });
  const box = await el.boundingBox();
  if (!box) throw new Error(`no bounding box for dshape-${id}`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

async function shapeCenter(page: Page, id: string) {
  const r = await shapeRect(page, id);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

async function dragPointer(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function readMarkdown(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  return page.locator('.monaco-editor .view-lines').first().innerText();
}

test.describe('Drawing editor (Scene engine, semantic markdown)', () => {
  test.beforeEach(async ({ page }) => {
    await loadDrawingSample(page);
  });

  test('renders the drawing shapes and connectors from the sample', async ({ page }) => {
    for (const id of ['ceo', 'cto', 'coo']) {
      await expect(page.locator(`[data-layer-id="dshape-${id}"]`).first()).toBeVisible();
    }
    // Two connectors (CTO→CEO, COO→CEO).
    await expect(page.locator('path.squisq-scene-edge-path')).toHaveCount(2);
  });

  test('toolbar exposes Select and Connect tools', async ({ page }) => {
    const toolbar = page.locator('.squisq-scene-block-toolbar').first();
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('button', { hasText: 'Select' })).toBeVisible();
    await expect(toolbar.locator('button', { hasText: 'Connect' })).toBeVisible();
  });

  test('dragging a shape persists its new x/y into the {[rectangle …]} annotation', async ({
    page,
  }) => {
    const before = await shapeCenter(page, 'cto');
    await dragPointer(page, before, { x: before.x + 120, y: before.y + 60 });
    // CTO starts at x=160 y=320; a rightward+downward drag grows both.
    await expect(async () => {
      const md = await readMarkdown(page);
      const match = md.match(/#cto\}?\s*\{\[rectangle\s+x=(\d+)\s+y=(\d+)/);
      expect(match, `expected updated x/y on cto:\n${md}`).toBeTruthy();
      expect(parseInt(match![1], 10)).toBeGreaterThan(160);
      expect(parseInt(match![2], 10)).toBeGreaterThan(320);
    }).toPass({ timeout: 3_000 });
  });

  test('the Connect tool adds a {[arrow from=.. to=..]} heading', async ({ page }) => {
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Connect' }).click();
    // COO and CTO are not connected to each other in the sample.
    const source = await shapeCenter(page, 'coo');
    const target = await shapeCenter(page, 'cto');
    await dragPointer(page, source, target);
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toMatch(/\{\[arrow\s+from=coo\s+to=cto\]\}/);
    }).toPass({ timeout: 3_000 });
  });

  test('Delete removes a selected shape heading and its connectors', async ({ page }) => {
    const center = await shapeCenter(page, 'cto');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('Delete');

    await expect(page.locator('[data-layer-id="dshape-cto"]')).toHaveCount(0);
    const md = await readMarkdown(page);
    expect(md).not.toContain('#cto');
    // The CTO→CEO connector is dropped along with the shape.
    expect(md).not.toMatch(/from=cto\s+to=ceo/);
  });

  test('the shape palette draws a new {[star …]} shape', async ({ page }) => {
    // The Shape tool opens the palette (a dropdown from the contextual toolbar).
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Shape' }).click();
    await page.locator('.squisq-shape-palette-item[aria-label="5-Point Star"]').click();
    // The draw tool is now active with kind=star; drag anywhere on the canvas.
    const host = await page.locator('.squisq-scene-widget-host').first().boundingBox();
    if (!host) throw new Error('no widget host box');
    const from = { x: host.x + host.width * 0.3, y: host.y + host.height * 0.55 };
    await dragPointer(page, from, { x: from.x + 90, y: from.y + 70 });
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md, `expected a star heading:\n${md}`).toMatch(/\{\[star\b/);
    }).toPass({ timeout: 3_000 });
  });

  test('selecting a shape surfaces Fill/Stroke in the toolbar and applies a fill', async ({
    page,
  }) => {
    // Single-click selects CEO; the per-shape style controls now live inline
    // in the contextual toolbar (no separate floating panel).
    const center = await shapeCenter(page, 'ceo');
    await page.mouse.click(center.x, center.y);
    const fill = page.locator('.squisq-scene-block-toolbar [aria-label="Fill color"]');
    await expect(fill).toBeVisible();
    await expect(
      page.locator('.squisq-scene-block-toolbar [aria-label="Stroke color"]'),
    ).toBeVisible();

    // Setting the fill persists to the shape's {[rectangle … fill=…]} annotation.
    await fill.fill('#ff0000');
    await expect(async () => {
      const md = (await readMarkdown(page)).replace(/\s+/g, ' ');
      expect(md, `expected ceo fill in markdown:\n${md}`).toMatch(/fill="?#ff0000"?/i);
    }).toPass({ timeout: 3_000 });
  });
});
