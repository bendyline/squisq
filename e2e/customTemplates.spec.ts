import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the custom template designer.
 *
 * Strategy: load the `custom-template-demo` sample (which pre-defines
 * a `hero` template in frontmatter and uses it on two blocks), then
 * verify:
 *   1. The picker surfaces both the custom template + the "+ New" card.
 *   2. Applying a custom template writes the right markdown annotation
 *      and produces the right preview layers (with title/content
 *      tokens substituted).
 *   3. The designer modal opens, accepts edits, and round-trips a new
 *      template through the markdown frontmatter.
 *   4. The same template renders correctly across viewport presets.
 */

async function loadCustomTemplateSample(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('select').first().selectOption('custom-template-demo');
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

async function openTemplatePickerForFirstHeading(page: Page): Promise<void> {
  const editor = page.locator('.tiptap.ProseMirror');
  // Click the template badge on the first heading (the doc's "# Custom
  // Templates Demo" title). Badge is a span with role=button — clicking
  // it opens the picker popover.
  const firstBadge = editor.locator('.squisq-template-badge').first();
  await firstBadge.waitFor({ state: 'visible' });
  await firstBadge.click();
  await page.locator('#squisq-template-gallery-portal').waitFor({ state: 'visible' });
}

test.describe('Custom template designer', () => {
  test.beforeEach(async ({ page }) => {
    await loadCustomTemplateSample(page);
  });

  test('picker shows a "+ New layout" card', async ({ page }) => {
    await openTemplatePickerForFirstHeading(page);
    const newCard = page.locator('.squisq-template-gallery-new');
    await expect(newCard).toBeVisible();
    await expect(newCard).toContainText(/new layout/i);
  });

  test('picker shows existing doc-defined custom templates in a Custom section', async ({
    page,
  }) => {
    await openTemplatePickerForFirstHeading(page);
    // The "hero" template defined in the sample's frontmatter should
    // appear in a "Custom" section above the built-in templates.
    const customSection = page
      .locator('.squisq-template-gallery-section')
      .filter({ hasText: /custom/i })
      .first();
    await expect(customSection).toBeVisible();
    await expect(customSection.locator('.squisq-template-gallery-card-name')).toContainText(
      'Hero Section',
    );
  });

  test('sample doc parses the inlined custom template + uses it on at least one block', async ({
    page,
  }) => {
    // Round-trip is exercised by the core unit tests
    // (`customTemplateSample.test.ts`). Here we only verify the
    // editor's perspective: the doc parsed from the sample markdown
    // exposes the hero template name on its annotated headings, and
    // the picker recognizes it as a known template.
    const annotatedHeadings = await page.evaluate(() => {
      const headings = document.querySelectorAll('.tiptap.ProseMirror h2[data-template]');
      return Array.from(headings).map((h) => h.getAttribute('data-template'));
    });
    expect(annotatedHeadings).toContain('hero');
    // Open the picker and confirm "Hero Section" appears in the
    // Custom section — that's our proxy for "the doc's custom
    // template is wired up to the picker".
    await openTemplatePickerForFirstHeading(page);
    await expect(
      page.locator('.squisq-template-gallery-section').filter({ hasText: /custom/i }),
    ).toContainText('Hero Section');
  });

  test('opening the designer mounts the modal with the placeholder palette', async ({ page }) => {
    await openTemplatePickerForFirstHeading(page);
    await page.locator('.squisq-template-gallery-new').click();
    const dialog = page.locator('.squisq-template-designer-panel');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Token palette should be present with the v1 placeholders.
    const palette = page.locator('.squisq-template-designer-palette');
    await expect(palette).toBeVisible();
    for (const token of ['{title}', '{content}', '{children}', '{image:0}']) {
      await expect(palette).toContainText(token);
    }
    // Aspect-ratio dropdown exposes 16:9 / 9:16 / 1:1.
    const ratio = page.getByRole('combobox', { name: 'Preview aspect ratio' });
    await expect(ratio).toBeVisible();
    await expect(ratio.locator('option')).toHaveText(['16:9', '9:16', '1:1']);
  });

  test('saving a new template makes it appear in the picker and persists to the doc', async ({
    page,
  }) => {
    await openTemplatePickerForFirstHeading(page);
    await page.locator('.squisq-template-gallery-new').click();
    await page.locator('.squisq-template-designer-panel').waitFor({ state: 'visible' });

    // Fill in the label (now the first field). The name field auto-
    // derives its slug from the label, so we only need the label — the
    // save button alerts and bails out when label/name are blank.
    await page.locator('.squisq-template-designer-field input').first().fill('Greeting');
    // Name auto-derives to the lowercased slug of the label.
    await expect(page.locator('.squisq-template-designer-field input').nth(1)).toHaveValue(
      'greeting',
    );

    // Activate the title token tool and click on the canvas to drop a
    // {title} placeholder so the template has at least one layer
    // (validation requires non-empty layers).
    await page
      .locator('.squisq-template-designer-palette-item')
      .filter({ hasText: '{title}' })
      .first()
      .click();
    const canvas = page.locator('.squisq-template-designer-scene .squisq-scene-viewport');
    await canvas.waitFor({ state: 'visible' });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Save to the doc. The designer closes on success.
    await page
      .locator('.squisq-template-designer-btn--primary')
      .filter({ hasText: /save to this doc/i })
      .click();
    await expect(page.locator('.squisq-template-designer-panel')).toHaveCount(0);

    // Reopen the picker — the new "Greeting" template should now
    // appear in the Custom section alongside the pre-existing "Hero
    // Section". This is end-to-end proof that the save flow updated
    // the doc state (via `setMarkdownSource` → re-parse → new
    // `Doc.customTemplates` → context update → picker re-render).
    await openTemplatePickerForFirstHeading(page);
    const customSection = page
      .locator('.squisq-template-gallery-section')
      .filter({ hasText: /custom/i })
      .first();
    await expect(customSection).toContainText('Greeting');
    await expect(customSection).toContainText('Hero Section');
  });

  test('dragging a placeholder from the palette onto the canvas adds a layer', async ({ page }) => {
    await openTemplatePickerForFirstHeading(page);
    await page.locator('.squisq-template-gallery-new').click();
    await page.locator('.squisq-template-designer-panel').waitFor({ state: 'visible' });

    // Label is the first field; Name auto-derives from it.
    await page.locator('.squisq-template-designer-field input').first().fill('Dragged');

    // Drag the {content} placeholder onto the canvas (instead of the
    // click-to-arm-then-click path the test above exercises).
    const item = page
      .locator('.squisq-template-designer-palette-item')
      .filter({ hasText: '{content}' })
      .first();
    const canvas = page.locator('.squisq-template-designer-scene .squisq-scene-viewport');
    await canvas.waitFor({ state: 'visible' });
    await item.dragTo(canvas);

    // The dropped placeholder renders as a layer on the canvas.
    await expect(canvas.getByText('{content}')).toBeVisible();

    // And it satisfies the "at least one layer" save validation.
    await page
      .locator('.squisq-template-designer-btn--primary')
      .filter({ hasText: /save to this doc/i })
      .click();
    await expect(page.locator('.squisq-template-designer-panel')).toHaveCount(0);
  });

  test('selecting a text layer reveals a styling toolbar that edits it', async ({ page }) => {
    await openTemplatePickerForFirstHeading(page);
    await page.locator('.squisq-template-gallery-new').click();
    await page.locator('.squisq-template-designer-panel').waitFor({ state: 'visible' });

    const canvas = page.locator('.squisq-template-designer-scene .squisq-scene-viewport');
    await canvas.waitFor({ state: 'visible' });
    await page
      .locator('.squisq-template-designer-palette-item')
      .filter({ hasText: '{title}' })
      .first()
      .dragTo(canvas);

    // No toolbar until something is selected; clicking the layer selects it.
    await expect(page.locator('.squisq-layer-toolbar')).toHaveCount(0);
    await canvas.getByText('{title}').click();

    const toolbar = page.locator('.squisq-layer-toolbar');
    await expect(toolbar).toBeVisible();

    // Exercise representative controls across the toolbar's groups.
    await toolbar.getByRole('button', { name: 'Align center' }).click();
    await toolbar.getByRole('button', { name: 'Align middle' }).click();
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    await toolbar
      .getByRole('combobox', { name: 'Font', exact: true })
      .selectOption({ label: 'Playfair Display' });
    await toolbar.getByRole('combobox', { name: 'Font size' }).selectOption({ label: 'Huge' });

    // Active states reflect the edits.
    await expect(toolbar.getByRole('button', { name: 'Align center' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The styled layer still saves.
    // Label is the first field; Name auto-derives from it.
    await page.locator('.squisq-template-designer-field input').first().fill('Styled');
    await page
      .locator('.squisq-template-designer-btn--primary')
      .filter({ hasText: /save to this doc/i })
      .click();
    await expect(page.locator('.squisq-template-designer-panel')).toHaveCount(0);
  });

  test('the Custom layouts toolbar button opens the manager listing doc layouts beside the designer', async ({
    page,
  }) => {
    // The toolbar button opens the full-window manager.
    await page.getByRole('button', { name: 'Custom layouts' }).click();
    const panel = page.locator('.squisq-layout-manager-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The doc's pre-defined "hero" template (label "Hero Section") shows
    // in the sidebar under "This document".
    const sidebar = panel.locator('.squisq-layout-manager-sidebar');
    await expect(sidebar).toContainText('This document');
    await expect(sidebar).toContainText('Hero Section');

    // The existing designer is embedded on the right (its placeholder
    // palette is present).
    const designer = panel.locator('.squisq-template-designer-panel--embedded');
    await expect(designer).toBeVisible();
    await expect(designer).toContainText('{title}');

    // "+ New layout" switches the right pane to the blank-slate designer
    // (the Label field clears).
    await sidebar.getByRole('button', { name: '+ New layout' }).click();
    await expect(designer.locator('.squisq-template-designer-field input').first()).toHaveValue('');
  });

  test('creating a layout in the manager persists it into the doc and selects it', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Custom layouts' }).click();
    const panel = page.locator('.squisq-layout-manager-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Start a new layout, name it via the label (Name auto-derives).
    await panel
      .locator('.squisq-layout-manager-sidebar')
      .getByRole('button', {
        name: '+ New layout',
      })
      .click();
    await panel.locator('.squisq-template-designer-field input').first().fill('Managed Layout');

    // Add a {title} placeholder so save validation passes.
    await panel
      .locator('.squisq-template-designer-palette-item')
      .filter({ hasText: '{title}' })
      .first()
      .click();
    const canvas = panel.locator('.squisq-template-designer-scene .squisq-scene-viewport');
    await canvas.waitFor({ state: 'visible' });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Save to the doc — the manager stays open and the new layout joins
    // the sidebar's "This document" list.
    await panel
      .locator('.squisq-template-designer-btn--primary')
      .filter({ hasText: /save to this doc/i })
      .click();
    await expect(panel.locator('.squisq-layout-manager-sidebar')).toContainText('Managed Layout');
    await expect(panel).toBeVisible();
  });

  test('saving a doc layout to the library adds a separate Library entry', async ({ page }) => {
    await page.getByRole('button', { name: 'Custom layouts' }).click();
    const panel = page.locator('.squisq-layout-manager-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    const sidebar = panel.locator('.squisq-layout-manager-sidebar');

    // The doc's "hero" layout is selected by default. There is no Library
    // section yet.
    await expect(sidebar).toContainText('This document');
    await expect(sidebar).not.toContainText('Library');

    // Copy it to the browser library — a distinct "Library" section now
    // lists it alongside the doc copy (two entries, both "Hero Section").
    await panel
      .locator('.squisq-template-designer-btn')
      .filter({ hasText: /save to library/i })
      .click();
    await expect(sidebar).toContainText('Library');
    await expect(sidebar.getByText('Hero Section')).toHaveCount(2);
  });

  test('the Add bin places a standard shape on the canvas', async ({ page }) => {
    await page.getByRole('button', { name: 'Custom layouts' }).click();
    const panel = page.locator('.squisq-layout-manager-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel
      .locator('.squisq-layout-manager-sidebar')
      .getByRole('button', { name: '+ New layout' })
      .click();

    // The bin now offers Placeholders, Shapes, and Media sections.
    const bin = panel.locator('.squisq-template-designer-palette');
    await expect(bin).toContainText('Placeholders');
    await expect(bin).toContainText('Shapes');
    await expect(bin).toContainText('Media');

    // Arm the Diamond shape, then click the canvas to drop it.
    await bin.locator('.squisq-template-designer-shape-item[aria-label="Diamond"]').click();
    const canvas = panel.locator('.squisq-template-designer-scene .squisq-scene-viewport');
    await canvas.waitFor({ state: 'visible' });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The diamond is a computed path shape, so it renders as a path layer.
    const shapePath = panel.locator('.squisq-template-designer-scene .block-layer--path path');
    await expect(shapePath).toHaveCount(1);

    // Dragging the shape must move the geometry, not just the selection box:
    // the path's `d` is re-derived from the (moved) position. Drag from the
    // box centre to a new spot and assert `d` changed.
    const before = await shapePath.getAttribute('d');
    const cx = box.x + box.width / 2 + 110; // box top-left was at the click point
    const cy = box.y + box.height / 2 + 90;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 160, cy + 120, { steps: 8 });
    await page.mouse.up();
    await expect(shapePath).not.toHaveAttribute('d', before ?? '');

    // Selecting the path shape reveals the styling toolbar with fill +
    // border controls (path shapes are stylable like native shapes).
    const toolbar = panel.locator('.squisq-layer-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: 'Fill style' })).toBeVisible();
    await expect(toolbar.getByRole('spinbutton', { name: 'Border thickness' })).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: 'Border style' })).toBeVisible();
  });
});
