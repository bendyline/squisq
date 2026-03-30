import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the Squisq editor UI.
 *
 * Tests the editor shell: view switching, toolbar interactions,
 * WYSIWYG editing, template picker, and markdown ↔ editor sync.
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Switch to a view tab by its data-label */
async function switchView(page: Page, label: 'Raw' | 'Editor' | 'Play') {
  await page.getByRole('tab', { name: label }).click();
}

/** Wait for the WYSIWYG editor to be ready */
async function waitForWysiwyg(page: Page) {
  await page.locator('.tiptap.ProseMirror').waitFor({ state: 'visible', timeout: 5_000 });
}

/** Wait for Monaco editor to be ready */
async function waitForMonaco(page: Page) {
  await page.locator('[data-testid="raw-editor"]').waitFor({ state: 'visible', timeout: 5_000 });
}

// ── View Switching ──────────────────────────────────────────────────

test.describe('Editor view switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('starts in Editor (WYSIWYG) view by default', async ({ page }) => {
    const activeTab = page.locator('.squisq-toolbar-view-tab--active');
    await expect(activeTab).toHaveText('Editor');
  });

  test('switching to Raw view shows Monaco editor', async ({ page }) => {
    await switchView(page, 'Raw');
    await waitForMonaco(page);
    await expect(page.locator('[data-testid="raw-editor"]')).toBeVisible();
  });

  test('switching to Editor view shows WYSIWYG editor', async ({ page }) => {
    await switchView(page, 'Raw');
    await switchView(page, 'Editor');
    await waitForWysiwyg(page);
    await expect(page.locator('.tiptap.ProseMirror')).toBeVisible();
  });

  test('switching to Play view shows preview panel', async ({ page }) => {
    await switchView(page, 'Play');
    await expect(page.locator('[data-testid="preview-panel"]')).toBeVisible();
  });

  test('all three tabs are visible in the toolbar', async ({ page }) => {
    for (const label of ['Editor', 'Raw', 'Play']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }
  });

  test('tabs are not too narrow to read', async ({ page }) => {
    const tabs = page.locator('.squisq-toolbar-view-tab');
    const count = await tabs.count();
    expect(count).toBe(3);

    for (let i = 0; i < count; i++) {
      const box = await tabs.nth(i).boundingBox();
      expect(box).toBeTruthy();
      // Each tab should be wide enough to read (at least 50px)
      expect(box!.width).toBeGreaterThanOrEqual(50);
    }
  });
});

// ── Toolbar ─────────────────────────────────────────────────────────

test.describe('Editor toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Ensure we're in Editor view
    await switchView(page, 'Editor');
    await waitForWysiwyg(page);
  });

  test('toolbar is visible in Editor view', async ({ page }) => {
    await expect(page.locator('.squisq-toolbar')).toBeVisible();
  });

  test('formatting buttons are visible (bold, italic)', async ({ page }) => {
    const toolbar = page.locator('.squisq-toolbar-actions');
    // Buttons have aria-label like "Bold (Ctrl+B)"
    await expect(toolbar.locator('button[aria-label*="Bold"]')).toBeVisible();
    await expect(toolbar.locator('button[aria-label*="Italic"]')).toBeVisible();
  });

  test('heading buttons are visible (H1, H2, H3)', async ({ page }) => {
    const toolbar = page.locator('.squisq-toolbar-actions');
    await expect(toolbar.locator('button[aria-label*="Heading 1"]')).toBeVisible();
    await expect(toolbar.locator('button[aria-label*="Heading 2"]')).toBeVisible();
    await expect(toolbar.locator('button[aria-label*="Heading 3"]')).toBeVisible();
  });

  test('toolbar is hidden in Play view', async ({ page }) => {
    await switchView(page, 'Play');
    const actions = page.locator('.squisq-toolbar-actions');
    await expect(actions).not.toBeVisible();
  });

  test('toolbar background is darker than tabs area', async ({ page }) => {
    const tabs = page.locator('.squisq-toolbar-view-tabs');
    const toolbar = page.locator('.squisq-toolbar');

    const tabsBg = await tabs.evaluate((el) => getComputedStyle(el).backgroundColor);
    const toolbarBg = await toolbar.evaluate((el) => getComputedStyle(el).backgroundColor);

    // Tabs should be white, toolbar should be non-white
    expect(tabsBg).not.toBe(toolbarBg);
  });
});

// ── WYSIWYG Editing ─────────────────────────────────────────────────

test.describe('WYSIWYG editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await switchView(page, 'Editor');
    await waitForWysiwyg(page);
  });

  test('editor contains the sample document content', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    await expect(editor).toContainText('Hello World');
  });

  test('typing in the editor updates content', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    // Click at end and type
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — appended text');
    await expect(editor).toContainText('appended text');
  });

  test('Ctrl+B applies bold formatting to new text', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');

    // Count existing strong elements before our edit
    const initialCount = await editor.locator('strong').count();

    // Click at end of content and type new bold text
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+b');
    await page.keyboard.type('bold text');
    await page.keyboard.press('Meta+b');

    // There should now be more strong elements than before
    const newCount = await editor.locator('strong').count();
    expect(newCount).toBeGreaterThan(initialCount);
  });
});

// ── Markdown Sync ───────────────────────────────────────────────────

test.describe('Markdown sync between views', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Raw view shows markdown source', async ({ page }) => {
    await switchView(page, 'Raw');
    await waitForMonaco(page);
    // Monaco editor should contain markdown with the heading
    const monacoContent = page.locator('.monaco-editor');
    await expect(monacoContent).toContainText('Hello World');
  });

  test('switching from Editor to Raw preserves content', async ({ page }) => {
    await switchView(page, 'Editor');
    await waitForWysiwyg(page);

    // Verify content exists in editor
    await expect(page.locator('.tiptap.ProseMirror')).toContainText('Hello World');

    // Switch to Raw and verify the same content is there
    await switchView(page, 'Raw');
    await waitForMonaco(page);
    await expect(page.locator('.monaco-editor')).toContainText('Hello World');
  });
});

// ── Sample Switching ────────────────────────────────────────────────

test.describe('Sample switching in editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await switchView(page, 'Editor');
    await waitForWysiwyg(page);
  });

  test('changing sample updates the editor content', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    const initialText = await editor.textContent();

    // Switch to a different sample
    await page.locator('select').first().selectOption('all-templates');

    // Wait for content to change
    await expect(editor).not.toHaveText(initialText ?? '');
  });
});

// ── Template Picker ─────────────────────────────────────────────────

test.describe('Template picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await switchView(page, 'Editor');
    await waitForWysiwyg(page);
  });

  test('template picker appears when cursor is in a heading', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    // Click on a heading in the editor
    const heading = editor.locator('h1, h2, h3').first();
    if (await heading.isVisible()) {
      await heading.click();
      // Give time for the toolbar to update
      await page.waitForTimeout(300);

      // Template picker should appear
      const picker = page.locator('.squisq-template-picker');
      await expect(picker).toBeVisible();
      // Should have a select element
      await expect(picker.locator('select')).toBeVisible();
    }
  });

  test('template picker is hidden when cursor is in body text', async ({ page }) => {
    const editor = page.locator('.tiptap.ProseMirror');
    // Click on a paragraph (non-heading)
    const para = editor.locator('p').first();
    if (await para.isVisible()) {
      await para.click();
      await page.waitForTimeout(300);

      const picker = page.locator('.squisq-template-picker');
      await expect(picker).not.toBeVisible();
    }
  });
});
