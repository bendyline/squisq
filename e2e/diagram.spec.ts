import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the Squisq diagram editor — the Scene-engine-driven
 * canvas that replaced React Flow.
 *
 * Strategy: each test loads the `diagram-family-tree` sample (which
 * has a `{[diagram]}` heading + several child node headings), so the
 * canvas mounts immediately and we can interact with real node cards.
 *
 * Interaction model:
 *   - Drag = pointer down on a card, pointer move, pointer up.
 *   - Resize = pointer down on a handle (positioned at the card's
 *     bounding-rect corners), pointer move, pointer up.
 *   - Connect = activate the Connect tool, drag from one card to another.
 *
 * Each test verifies the change persisted to markdown by switching to
 * the Markdown view and asserting the relevant Pandoc attrs appear
 * (`x=`, `y=`, `w=`, `h=`, `connectsTo=`).
 */

// ── Helpers ──────────────────────────────────────────────────────────

async function switchView(page: Page, label: 'Markdown' | 'Editor' | 'Play') {
  await page.getByRole('tab', { name: label, exact: true }).click();
}

async function loadDiagramSample(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Sample switcher is the first <select> on the page.
  await page.locator('select').first().selectOption('diagram-family-tree');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  // Diagram widget mounts as a ProseMirror decoration below the parent heading.
  await page.locator('.squisq-diagram-widget-host').waitFor({ state: 'visible', timeout: 5_000 });
  // Scene SVG should be rendered with at least one node card.
  await page
    .locator('.squisq-scene-viewport [data-layer-id^="node-card-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 });
}

/** Get the on-screen bounding rect of a node card layer. */
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

/** Drag from (x1, y1) to (x2, y2) using pointer events at the page level. */
async function dragPointer(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Two intermediate moves so the drag-threshold check inside SelectTool
  // (3px movement) is unambiguously crossed before the release.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Read the current markdown source from the Monaco editor. */
async function readMarkdown(page: Page): Promise<string> {
  await switchView(page, 'Markdown');
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
  // Monaco wraps content in `.monaco-editor .view-lines`.
  const text = await page.locator('.monaco-editor .view-lines').first().innerText();
  return text;
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Diagram editor (Scene engine)', () => {
  // The diagram canvas is ~420px tall and sits below the editor chrome; at
  // the default 720px viewport its bottom row of nodes (child-1/2/3) falls
  // behind the pinned status bar, so pointer interactions there hit the
  // status bar instead of the card. A taller viewport keeps every node
  // clickable.
  test.use({ viewport: { width: 1280, height: 1000 } });

  test.beforeEach(async ({ page }) => {
    await loadDiagramSample(page);
  });

  test('renders all node cards from the diagram sample', async ({ page }) => {
    const ids = ['grandparent', 'parent-a', 'parent-b', 'child-1', 'child-2', 'child-3'];
    for (const id of ids) {
      await expect(page.locator(`[data-layer-id="node-card-${id}"]`).first()).toBeVisible();
    }
  });

  test('renders the toolbar with Select and Connect tools', async ({ page }) => {
    const toolbar = page.locator('.squisq-scene-block-toolbar').first();
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('button', { hasText: 'Select' })).toBeVisible();
    await expect(toolbar.locator('button', { hasText: 'Connect' })).toBeVisible();
  });

  test('the toolbar Node button adds a node', async ({ page }) => {
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Node' }).click();
    // A fresh `### Node N {#node-N …}` child heading lands in the markdown.
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toMatch(/\{#node-\d+/);
    }).toPass({ timeout: 3_000 });
  });

  test('the toolbar Delete button removes the selected node', async ({ page }) => {
    const center = await cardCenter(page, 'child-3');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Delete' }).click();
    await expect(page.locator('[data-layer-id="node-card-child-3"]')).toHaveCount(0);
  });

  test('clicking a node selects it (shows resize handles)', async ({ page }) => {
    const center = await cardCenter(page, 'grandparent');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    // 8 selection handles (4 corners + 4 edges) appear once selected.
    await expect(page.locator('.squisq-scene-selection-handle')).toHaveCount(8);
  });

  test('dragging a node persists its new position to markdown', async ({ page }) => {
    const before = await cardCenter(page, 'parent-a');
    // Move the node 120px to the right and 60px down on screen. The
    // canvas auto-fits at mount and may be zoomed, so we can't predict
    // the exact viewport-unit delta — only its sign.
    await dragPointer(page, before, { x: before.x + 120, y: before.y + 60 });

    // The persisted (authored) viewport coordinates should have grown.
    // The sample places parent-a at x=240 y=260; any rightward+downward
    // drag should monotonically increase both numbers in markdown.
    //
    // Monaco renders each line via styled spans, which means the text
    // it returns from `innerText` may interleave non-breaking spaces or
    // zero-width separators between tokens. We use `\s+` so the regex
    // accepts any whitespace between `#parent-a`, `x=…`, and `y=…`.
    await expect(async () => {
      const md = await readMarkdown(page);
      const match = md.match(/#parent-a\s+x=(\d+)\s+y=(\d+)/);
      expect(match, `expected updated x/y on parent-a in markdown:\n${md}`).toBeTruthy();
      const newX = parseInt(match![1], 10);
      const newY = parseInt(match![2], 10);
      expect(newX).toBeGreaterThan(240);
      expect(newY).toBeGreaterThan(260);
    }).toPass({ timeout: 3_000 });
  });

  test('dragging the SE handle writes w= and h= Pandoc params', async ({ page }) => {
    // Select the node first.
    const center = await cardCenter(page, 'grandparent');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();

    // The SE handle sits at the card's bottom-right corner. We aim at the
    // exact corner; the handle's hit area extends ±4px around it.
    const r = await cardRect(page, 'grandparent');
    const seCorner = { x: r.x + r.w, y: r.y + r.h };
    const target = { x: seCorner.x + 80, y: seCorner.y + 40 };
    await dragPointer(page, seCorner, target);

    // Markdown should now carry w= and h= on grandparent (these only
    // appear after a resize — diagram nodes default to no explicit size).
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toMatch(/#grandparent[^}]*\bw=\d+/);
      expect(md).toMatch(/#grandparent[^}]*\bh=\d+/);
    }).toPass({ timeout: 3_000 });
  });

  test('Connect tool creates a new edge between two nodes', async ({ page }) => {
    // Switch to the Connect tool.
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Connect' }).click();
    // child-2 has no connectsTo in the sample; drag from it to child-3.
    const source = await cardCenter(page, 'child-2');
    const target = await cardCenter(page, 'child-3');
    await dragPointer(page, source, target);

    // Markdown should now contain a connectsTo entry on child-2 referencing child-3.
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toMatch(/#child-2[^}]*connectsTo=[^\s}]*child-3/);
    }).toPass({ timeout: 3_000 });
  });

  test('Delete key removes a selected node from the diagram', async ({ page }) => {
    // Select child-3.
    const center = await cardCenter(page, 'child-3');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('Delete');

    // Card disappears from the SVG. (Two elements carry `data-layer-id`
    // for each layer — the Scene's group wrapper and the SSR layer
    // renderer's own `<g>` — so the matcher counts both; either way
    // the count drops to zero once the node is removed.)
    await expect(page.locator('[data-layer-id="node-card-child-3"]')).toHaveCount(0);
    // Markdown loses the heading.
    const md = await readMarkdown(page);
    expect(md).not.toContain('#child-3');
  });

  test('shows a live drag preview while the pointer is down (not just on commit)', async ({
    page,
  }) => {
    // Grab the initial on-screen position of the card.
    const card = page.locator('[data-layer-id="node-card-grandparent"]').first();
    const before = await card.boundingBox();
    if (!before) throw new Error('no box');
    const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };

    // Press down, move halfway WITHOUT releasing. The card should already
    // be drawn at the new (offset) position because the Scene applies a
    // live `translate(…)` transform to the selected layer's `<g>` while
    // the drag is in flight.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 40, { steps: 6 });

    // Inspect the in-flight box. The card should have moved on screen
    // without any markdown round-trip having completed yet.
    const during = await card.boundingBox();
    if (!during) throw new Error('no box during drag');

    // Release without committing the assertions below first, so the
    // editor doesn't end up in a half-locked state if the test fails.
    await page.mouse.up();

    expect(during.x, 'card x should have moved during drag').toBeGreaterThan(before.x + 8);
    expect(during.y, 'card y should have moved during drag').toBeGreaterThan(before.y + 4);
  });

  test('shows a live resize preview while the SE handle is dragged', async ({ page }) => {
    // Select first.
    const center = await cardCenter(page, 'grandparent');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();

    const before = await cardRect(page, 'grandparent');
    const seCorner = { x: before.x + before.w, y: before.y + before.h };

    await page.mouse.move(seCorner.x, seCorner.y);
    await page.mouse.down();
    await page.mouse.move(seCorner.x + 80, seCorner.y + 40, { steps: 6 });

    // Mid-drag the card should already be bigger on screen.
    const during = await cardRect(page, 'grandparent');

    await page.mouse.up();

    expect(during.w, 'card width should grow during resize').toBeGreaterThan(before.w + 8);
    expect(during.h, 'card height should grow during resize').toBeGreaterThan(before.h + 4);
  });

  test('shows a live connection preview while the Connect tool is dragging', async ({ page }) => {
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Connect' }).click();
    const source = await cardCenter(page, 'child-2');
    const target = await cardCenter(page, 'child-3');

    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move((source.x + target.x) / 2, (source.y + target.y) / 2, { steps: 6 });

    // The Scene's overlay layer renders a dashed preview path while the
    // user is mid-drag. Check it's present in the DOM right now.
    const previewCount = await page.locator('path.squisq-scene-connect-preview').count();

    await page.mouse.up();

    expect(previewCount).toBeGreaterThanOrEqual(1);
  });

  test('card stays at its new position after drop (no snap-back)', async ({ page }) => {
    // Regression: each drag-commit writes a `data-block-attrs` change to
    // the heading. The ProseMirror widget decoration used to be
    // destroyed+recreated on every doc change, blowing away the React
    // root and resetting the canvas's pan/zoom. The user perceived this
    // as the card snapping back. Stable decoration keys keep the widget
    // alive across attribute-only edits — verify by sampling the card's
    // on-screen position before the drag, after the drop, and again a
    // beat later, and asserting they all agree.
    const before = await cardCenter(page, 'grandparent');
    const dropTarget = { x: before.x + 100, y: before.y + 60 };
    await dragPointer(page, before, dropTarget);

    // Wait for the editor transaction to settle.
    await page.waitForTimeout(100);
    const afterImmediate = await cardCenter(page, 'grandparent');

    // Sample again a few hundred ms later — if the widget had been
    // destroyed and recreated, the re-fit would shift the screen
    // position even though the underlying viewport coords are right.
    await page.waitForTimeout(400);
    const afterSettled = await cardCenter(page, 'grandparent');

    // The two post-drop samples should agree to within rounding.
    expect(Math.abs(afterSettled.x - afterImmediate.x)).toBeLessThan(4);
    expect(Math.abs(afterSettled.y - afterImmediate.y)).toBeLessThan(4);

    // And the post-drop screen position should NOT match the pre-drag
    // position (i.e. the drag visibly took effect — no snap-back).
    expect(Math.hypot(afterSettled.x - before.x, afterSettled.y - before.y)).toBeGreaterThan(4);
  });

  test('dragging one node does not move other nodes', async ({ page }) => {
    // Regression: `computeDiagramLayout` places unpinned children below
    // the bounding box of pinned ones. Without freezing, dragging any
    // node would pin it AND pull every unpinned sibling along by
    // recomputing their auto-layout offset relative to the new pinned
    // bounding box. After the fix, the first interaction snapshots all
    // siblings into explicit positions so each node moves independently.
    //
    // child-2 has no x/y in the sample? Actually all nodes do — but
    // even with all-pinned, sibling moves shouldn't affect each other.
    // We construct a worst-case by using child-3 (the last entry) as the
    // mover and asserting that grandparent, parent-a, parent-b stay put.
    const others = ['grandparent', 'parent-a', 'parent-b'] as const;
    const beforeOthers: Record<string, { x: number; y: number }> = {};
    for (const id of others) beforeOthers[id] = await cardCenter(page, id);

    const moverBefore = await cardCenter(page, 'child-3');
    await dragPointer(page, moverBefore, {
      x: moverBefore.x + 60,
      y: moverBefore.y + 30,
    });
    await page.waitForTimeout(200);

    for (const id of others) {
      const after = await cardCenter(page, id);
      const dx = after.x - beforeOthers[id].x;
      const dy = after.y - beforeOthers[id].y;
      expect(
        Math.hypot(dx, dy),
        `${id} should not have moved when child-3 was dragged`,
      ).toBeLessThan(4);
    }
  });

  test('label moves with its card during a drag (no detached label)', async ({ page }) => {
    const cardBefore = await cardRect(page, 'grandparent');
    const labelLocator = page.locator('[data-layer-id="node-label-grandparent"]').first();
    const labelBefore = await labelLocator.boundingBox();
    if (!labelBefore) throw new Error('no label bounding box before drag');
    const offsetX = labelBefore.x - cardBefore.x;
    const offsetY = labelBefore.y - cardBefore.y;

    const center = { x: cardBefore.x + cardBefore.w / 2, y: cardBefore.y + cardBefore.h / 2 };
    await dragPointer(page, center, { x: center.x + 80, y: center.y + 40 });

    // After commit, the label's relative offset from the card should be
    // approximately preserved (within a few pixels of subpixel rounding).
    await expect(async () => {
      const cardAfter = await cardRect(page, 'grandparent');
      const labelAfter = await labelLocator.boundingBox();
      if (!labelAfter) throw new Error('no label bounding box after drag');
      expect(Math.abs(labelAfter.x - cardAfter.x - offsetX)).toBeLessThan(8);
      expect(Math.abs(labelAfter.y - cardAfter.y - offsetY)).toBeLessThan(8);
    }).toPass({ timeout: 3_000 });
  });
});

/**
 * The bottom drag bar pins the diagram canvas to a fixed pixel height,
 * persisted as a `height=` token on the `{[diagram …]}` heading. Uses the
 * family-tree sample so the canvas is already mounted.
 */
test.describe('Diagram canvas height handle', () => {
  test.beforeEach(async ({ page }) => {
    await loadDiagramSample(page);
  });

  test('dragging the bottom handle grows the canvas and persists height=', async ({ page }) => {
    const inline = page.locator('.squisq-diagram-inline');
    await expect(inline).toBeVisible();

    // Scroll the handle clear of the sticky status bar before grabbing it.
    const handle = page.locator('.squisq-diagram-resize-handle');
    await handle.scrollIntoViewIfNeeded();
    const before = await inline.boundingBox();
    const hb = await handle.boundingBox();
    if (!before || !hb) throw new Error('no box');
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await dragPointer(page, from, { x: from.x, y: from.y + 140 });

    // The canvas grew on screen by roughly the drag distance.
    await expect(async () => {
      const after = await inline.boundingBox();
      expect(after!.height).toBeGreaterThan(before.height + 80);
    }).toPass({ timeout: 2_000 });

    // …and the height is pinned on the {[diagram …]} heading.
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toMatch(/\{\[diagram[^\]]*height=\d+/);
    }).toPass({ timeout: 3_000 });
  });

  test('double-clicking the handle resets to the default height', async ({ page }) => {
    const handle = page.locator('.squisq-diagram-resize-handle');
    await handle.scrollIntoViewIfNeeded();
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('no handle box');
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };

    // Pin a custom height first.
    await dragPointer(page, from, { x: from.x, y: from.y + 140 });
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toMatch(/height=\d+/);
    }).toPass({ timeout: 3_000 });

    // Reading markdown switched to Monaco and unmounted the canvas — go
    // back to the editor, then double-click the handle to clear the pin.
    await switchView(page, 'Editor');
    const handle2 = page.locator('.squisq-diagram-resize-handle');
    await handle2.scrollIntoViewIfNeeded();
    const hb2 = await handle2.boundingBox();
    if (!hb2) throw new Error('no handle box after reset');
    await page.mouse.dblclick(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);

    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).not.toMatch(/height=\d+/);
    }).toPass({ timeout: 3_000 });
  });
});

/**
 * The toolbar's "Insert diagram" button drops a `{[diagram]}` heading at
 * the cursor in either editing view. In WYSIWYG the DiagramExtension then
 * mounts the editable canvas (with its empty-state affordance) below it.
 *
 * Uses a wide viewport so the media-group button never lands in the
 * overflow menu.
 */
test.describe('Insert diagram toolbar button', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('inserts an editable diagram block in WYSIWYG view', async ({ page }) => {
    // The default "hello world" sample has no diagram yet.
    await expect(page.locator('.squisq-diagram-widget-host')).toHaveCount(0);

    // Click into the editor so the insert lands at a stable cursor.
    await page.locator('.tiptap.ProseMirror').click();
    await page.locator('.squisq-toolbar button[aria-label="Insert diagram"]').click();

    // The canvas mounts below the new heading and shows its empty state.
    await expect(page.locator('.squisq-diagram-widget-host')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add first node' })).toBeVisible();

    // The heading round-trips to markdown carrying the {[diagram]} annotation.
    // Retry the read — Monaco paints its lines lazily after the view switch.
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toContain('{[diagram]}');
    }).toPass({ timeout: 3_000 });
  });

  test('inserts a {[diagram]} heading in Markdown view', async ({ page }) => {
    await switchView(page, 'Markdown');
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });
    // Place the cursor in the Monaco editor.
    await page.locator('.monaco-editor .view-lines').first().click();

    await page.locator('.squisq-toolbar button[aria-label="Insert diagram"]').click();

    await expect(async () => {
      const text = await page.locator('.monaco-editor .view-lines').first().innerText();
      expect(text).toContain('{[diagram]}');
    }).toPass({ timeout: 3_000 });
  });
});

/**
 * The sibling "Insert drawing" and "Insert layout" buttons drop the other
 * two Scene-backed container templates. Both mount a `SceneBlockWidget`.
 * Drawing is usable empty (the "Shapes ▾" palette); layout is seeded with
 * a starter text layer so its Select-only canvas isn't blank.
 *
 * Wide viewport so the media-group buttons stay out of the overflow menu.
 */
test.describe('Insert drawing / layout toolbar buttons', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
  });

  test('inserts an editable drawing block in WYSIWYG view', async ({ page }) => {
    await expect(page.locator('.squisq-scene-widget-host')).toHaveCount(0);

    await page.locator('.tiptap.ProseMirror').click();
    await page.locator('.squisq-toolbar button[aria-label="Insert drawing"]').click();

    // The Scene canvas mounts with the drawing tools (Shape opens the palette).
    await expect(page.locator('.squisq-scene-widget-host')).toBeVisible();
    await expect(
      page.locator('.squisq-scene-block-toolbar button', { hasText: 'Shape' }),
    ).toBeVisible();

    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toContain('{[drawing]}');
    }).toPass({ timeout: 3_000 });
  });

  test('inserts a layout block seeded with a starter layer in WYSIWYG view', async ({ page }) => {
    await expect(page.locator('.squisq-scene-widget-host')).toHaveCount(0);

    await page.locator('.tiptap.ProseMirror').click();
    await page.locator('.squisq-toolbar button[aria-label="Insert layout"]').click();

    // The canvas mounts and the seeded text layer is rendered (so the
    // layout isn't a blank, undiscoverable surface).
    await expect(page.locator('.squisq-scene-widget-host')).toBeVisible();
    await expect(page.locator('[data-layer-id="text-1"]').first()).toBeVisible();

    // Round-trips as a {[layout]} heading with a readable text child
    // sub-block — no base64 layers= blob.
    await expect(async () => {
      const md = await readMarkdown(page);
      expect(md).toContain('{[layout]}');
      expect(md).toContain('{[text');
      expect(md).not.toContain('layers=');
    }).toPass({ timeout: 3_000 });
  });

  test('layout toolbar adds a box and deletes the selection', async ({ page }) => {
    await page.locator('.tiptap.ProseMirror').click();
    await page.locator('.squisq-toolbar button[aria-label="Insert layout"]').click();
    await page.locator('.squisq-scene-widget-host').waitFor({ state: 'visible' });
    // Seeded with one text layer; the Box action adds a shape layer.
    await expect(page.locator('[data-layer-id="text-1"]').first()).toBeVisible();
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Box' }).click();
    const box = page.locator('[data-layer-id="box-1"]').first();
    await expect(box).toBeVisible();

    // Select the box (mouse at its center) and delete it via the toolbar.
    const bb = await box.boundingBox();
    if (!bb) throw new Error('no box bbox');
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator('.squisq-scene-block-toolbar button', { hasText: 'Delete' }).click();
    await expect(page.locator('[data-layer-id="box-1"]')).toHaveCount(0);
  });

  test('inserts {[drawing]} and {[layout]} headings in Markdown view', async ({ page }) => {
    await switchView(page, 'Markdown');
    await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible' });

    await page.locator('.monaco-editor .view-lines').first().click();
    await page.locator('.squisq-toolbar button[aria-label="Insert drawing"]').click();
    await page.locator('.squisq-toolbar button[aria-label="Insert layout"]').click();

    await expect(async () => {
      const text = await page.locator('.monaco-editor .view-lines').first().innerText();
      expect(text).toContain('{[drawing]}');
      expect(text).toContain('{[layout]}');
    }).toPass({ timeout: 3_000 });
  });
});
