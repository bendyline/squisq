import { test, expect, type Page } from '@playwright/test';
import { switchView } from './view-tabs';

/**
 * E2E tests for the ASCII-fence diagram editor.
 *
 * Diagrams are authored as code fences containing box-and-line art; the
 * AsciiDiagramExtension hides the fence and mounts the Scene canvas over
 * it. Every canvas edit rewrites the fence (parse, op, render), so the
 * fence IS the persistence format.
 *
 * Assertion channels:
 * - `fenceText()` reads the hidden `<pre>` — the live fence content —
 *   without any view switching (Monaco's virtualized DOM is unreliable
 *   for content assertions, and switching views can remount the editor).
 * - `readMarkdown()` reads the full source via Monaco's model API for the
 *   whole-document round-trip checks.
 */

/** Non-breaking space (Monaco renders plain spaces as nbsp). */
const NBSP_RE = new RegExp(String.fromCharCode(160), 'g');

// ── Helpers ──────────────────────────────────────────────────────────

async function loadSample(page: Page, sample: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption(sample);
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function loadDiagramSample(page: Page, sample = 'diagram-family-tree') {
  await loadSample(page, sample);
  await page
    .locator('.squisq-ascii-diagram-widget-host')
    .waitFor({ state: 'visible', timeout: 5_000 });
  await page
    .locator('.squisq-scene-viewport [data-layer-id^="node-card-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
}

/** The live fence text behind the (first) diagram canvas. */
async function fenceText(page: Page): Promise<string> {
  const pre = page.locator('pre.squisq-ascii-fence-hidden, pre.squisq-ascii-fence-source').first();
  const text = await pre.textContent();
  return (text ?? '').replace(NBSP_RE, ' ');
}

/** The `language-*` class on the (first) diagram fence's `<code>`, or ''. */
async function fenceLang(page: Page): Promise<string> {
  const code = page
    .locator('pre.squisq-ascii-fence-hidden code, pre.squisq-ascii-fence-source code')
    .first();
  const cls = (await code.getAttribute('class')) ?? '';
  return /language-(\S+)/.exec(cls)?.[1] ?? '';
}

async function cardRect(
  page: Page,
  nodeId: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const card = page.locator(`[data-layer-id="node-card-${nodeId}"]`).first();
  await card.waitFor({ state: 'visible' });
  const box = await card.boundingBox();
  if (!box) throw new Error(`no bounding box for node-card-${nodeId}`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

async function cardCenter(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  const r = await cardRect(page, nodeId);
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

/** Read the full markdown source from Monaco's model (not the virtualized DOM). */
async function readMarkdown(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  const lines = page.locator('.monaco-editor .view-lines').first();
  await expect(lines).toContainText(/\S/, { timeout: 4_000 });
  const text = await lines.innerText();
  return text.replace(NBSP_RE, ' ');
}

/**
 * All six family-tree node labels. Edge-route turn glyphs reuse `┌` and
 * edge attachments upgrade box borders to `├`/`┤`, so "same boxes" is
 * asserted via padded label presence, not corner/border matching (the
 * box/edge-count invariants are covered by the codec unit tests).
 */
const FAMILY_LABELS = ['Grandparent', 'Parent A', 'Parent B', 'Child 1', 'Child 2', 'Child 3'];

function expectFamilyLabels(art: string): void {
  for (const label of FAMILY_LABELS) expect(art).toContain(` ${label} `);
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('ASCII diagram editor', () => {
  // Tall viewport keeps the whole canvas clickable above the status bar.
  test.use({ viewport: { width: 1280, height: 1000 } });

  test('renders the canvas over a hidden fence with all node cards', async ({ page }) => {
    await loadDiagramSample(page);
    const ids = ['grandparent', 'parent-a', 'parent-b', 'child-1', 'child-2', 'child-3'];
    for (const id of ids) {
      await expect(page.locator(`[data-layer-id="node-card-${id}"]`).first()).toBeVisible();
    }
    // The source fence exists but is hidden behind the canvas.
    const pre = page.locator('pre.squisq-ascii-fence-hidden').first();
    await expect(pre).toBeAttached();
    await expect(pre).toBeHidden();
  });

  test('untouched diagram round-trips its art through the markdown view', async ({ page }) => {
    await loadDiagramSample(page);
    const md = await readMarkdown(page);
    expect(md).toContain('┌─────────────┐');
    expect(md).toContain('│ born');
    expectFamilyLabels(md);
  });

  test('renders containers behind their children', async ({ page }) => {
    await loadDiagramSample(page, 'diagram-nested-cluster');
    await expect(
      page.locator('[data-layer-id="node-card-inference-cluster"]').first(),
    ).toBeVisible();
    // A child inside the container is still individually visible/clickable.
    const worker = page.locator('[data-layer-id="node-card-worker-a"]').first();
    await expect(worker).toBeVisible();
  });

  test('dragging a node rewrites the fence as ASCII with the same boxes', async ({ page }) => {
    await loadDiagramSample(page);
    const before = await fenceText(page);
    expectFamilyLabels(before);

    const from = await cardCenter(page, 'child-1');
    await dragPointer(page, from, { x: from.x - 60, y: from.y + 40 });

    await expect(async () => {
      const art = await fenceText(page);
      expect(art).not.toBe(before);
      expectFamilyLabels(art); // same boxes, art regenerated
    }).toPass({ timeout: 5_000 });
  });

  test('undo restores the original fence after a drag', async ({ page }) => {
    await loadDiagramSample(page);
    const before = await fenceText(page);
    const from = await cardCenter(page, 'child-2');
    await dragPointer(page, from, { x: from.x + 80, y: from.y + 40 });
    await expect(async () => {
      expect(await fenceText(page)).not.toBe(before);
    }).toPass({ timeout: 5_000 });

    // Focus the prose surface (the widget swallows keydown) and undo.
    await page.locator('.tiptap.ProseMirror').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(async () => {
      expect(await fenceText(page)).toBe(before);
    }).toPass({ timeout: 5_000 });
  });

  test('editing promotes the fence to the explicit `diagram` language tag', async ({ page }) => {
    // Sticky identity: once the canvas is edited, the fence carries
    // `language-diagram` so it survives a later flatten → markdown → back
    // round-trip (the language class round-trips; fence meta does not).
    await loadDiagramSample(page);
    const from = await cardCenter(page, 'child-1');
    await dragPointer(page, from, { x: from.x - 60, y: from.y + 40 });
    await expect(async () => {
      expect(await fenceLang(page)).toBe('diagram');
    }).toPass({ timeout: 5_000 });
  });

  test('connecting two nodes adds an edge to the art', async ({ page }) => {
    await loadDiagramSample(page);
    const before = await fenceText(page);
    const beforeArrows = (before.match(/[▲▼◄►]/g) ?? []).length;

    await page
      .locator('.squisq-scene-block-toolbar button', { hasText: 'Connect' })
      .first()
      .click();
    const source = await cardCenter(page, 'child-2');
    const target = await cardCenter(page, 'child-3');
    await dragPointer(page, source, target);

    await expect(async () => {
      const art = await fenceText(page);
      expect(art).not.toBe(before);
      expectFamilyLabels(art);
      const arrows = (art.match(/[▲▼◄►]/g) ?? []).length;
      expect(arrows).toBeGreaterThan(beforeArrows);
    }).toPass({ timeout: 5_000 });
  });

  test('toolbar Node button adds a box; Delete removes the selection', async ({ page }) => {
    await loadDiagramSample(page);
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Node' }).first().click();
    await expect(async () => {
      const art = await fenceText(page);
      expect(art).toContain(' Node 1 ');
      expectFamilyLabels(art);
    }).toPass({ timeout: 5_000 });

    // Delete a pristine node via the toolbar (select → Delete).
    const center = await cardCenter(page, 'child-3');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Delete' }).first().click();
    await expect(async () => {
      const art = await fenceText(page);
      expect(art).not.toContain('Child 3');
      expect(art).toContain(' Node 1 ');
      expect(art).toContain(' Child 2 ');
    }).toPass({ timeout: 5_000 });
  });

  test('the Source toggle reveals the raw monospace fence', async ({ page }) => {
    await loadDiagramSample(page);
    const before = await fenceText(page);
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Source' }).first().click();
    const pre = page.locator('pre.squisq-ascii-fence-source').first();
    await expect(pre).toBeVisible();
    const whiteSpace = await pre.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe('pre');
    // Toggling is chrome-only — the fence text is untouched.
    expect(await fenceText(page)).toBe(before);
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Source' }).first().click();
    await expect(page.locator('pre.squisq-ascii-fence-source')).toHaveCount(0);
  });

  test('a dropped node does not snap back (widget identity survives rewrites)', async ({
    page,
  }) => {
    await loadDiagramSample(page);
    const from = await cardCenter(page, 'child-3');
    const to = { x: from.x + 70, y: from.y + 50 };
    const before = await fenceText(page);
    await dragPointer(page, from, to);
    await expect.poll(() => fenceText(page)).not.toBe(before);
    // And it actually moved from the origin. The on-screen displacement is
    // much smaller than the 70×50px drag: the fence quantizes to the ASCII
    // char grid and the renderer re-packs neighbours, so a diagonal drag nets
    // only a cell or two. The rewritten fence plus this fresh card position
    // demonstrate that the remounted widget retained the move.
    await expect
      .poll(async () => {
        const settled = await cardCenter(page, 'child-3');
        return Math.hypot(settled.x - from.x, settled.y - from.y);
      })
      .toBeGreaterThan(8);
  });

  test('the Insert menu creates a starter ASCII diagram', async ({ page }) => {
    await loadSample(page, 'e2e-tiny');
    await page.locator('.tiptap.ProseMirror').click();
    await page.locator('.squisq-toolbar button[aria-label="Insert"]').click();
    // Exact name — the Insert menu also offers "Complex Diagram" (Mermaid).
    await page.getByRole('menuitem', { name: 'Diagram', exact: true }).click();
    await page
      .locator('.squisq-ascii-diagram-widget-host')
      .waitFor({ state: 'visible', timeout: 5_000 });
    const art = await fenceText(page);
    expect(art).toContain('│  Start  │');
    expect(art).toContain('│  Next   │');
  });

  test('legacy heading-based diagrams load without a canvas (render-only)', async ({ page }) => {
    await loadSample(page, 'diagram-legacy-headings');
    // No ASCII widget mounts (no fence), and no legacy widget exists anymore.
    await expect(page.locator('.squisq-ascii-diagram-widget-host')).toHaveCount(0);
    // The child headings are plain editable text in the WYSIWYG.
    await expect(page.locator('.tiptap.ProseMirror')).toContainText('API Server');
  });
});
