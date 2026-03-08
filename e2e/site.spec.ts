import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the Squisq dev site.
 *
 * These tests exercise the editor shell (sample picker, view switching)
 * and the DocPlayer preview (template expansion, block progression, controls).
 *
 * The Vite dev server is launched automatically by playwright.config.ts.
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Select a sample from the dropdown by its key */
async function selectSample(page: Page, key: string) {
  await page.locator('select').first().selectOption(key);
}

/** Switch to a view tab by label text */
async function switchView(page: Page, label: 'Raw' | 'Editor' | 'Preview') {
  await page.getByRole('tab', { name: label }).click();
}

/** Wait for the DocPlayer to be present inside the preview panel */
async function waitForDocPlayer(page: Page) {
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
}

/** Get the active SVG block in the DocPlayer */
function activeBlock(page: Page) {
  return page.locator('.doc-player__block--active');
}

// ── Basic Navigation ─────────────────────────────────────────────────

test.describe('Site navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('loads with the default hello-world sample', async ({ page }) => {
    const select = page.locator('select').first();
    await expect(select).toHaveValue('hello-world');
  });

  test('sample picker contains template-annotations', async ({ page }) => {
    const options = page.locator('select').first().locator('option');
    const values = await options.evaluateAll(opts =>
      opts.map(o => (o as HTMLOptionElement).value),
    );
    expect(values).toContain('template-annotations');
  });

  test('view switcher has Raw, Editor, Preview tabs', async ({ page }) => {
    for (const label of ['Raw', 'Editor', 'Preview']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }
  });

  test('switching to Raw view shows the Monaco editor', async ({ page }) => {
    await switchView(page, 'Raw');
    await expect(page.locator('[data-testid="raw-editor"]')).toBeVisible();
  });

  test('switching to Preview shows the preview panel', async ({ page }) => {
    await switchView(page, 'Preview');
    await expect(page.locator('[data-testid="preview-panel"]')).toBeVisible();
  });
});

// ── DocPlayer Preview ──────────────────────────────────────────────

test.describe('DocPlayer preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await selectSample(page, 'template-annotations');
    await switchView(page, 'Preview');
    await waitForDocPlayer(page);
  });

  test('DocPlayer renders an active block SVG', async ({ page }) => {
    const block = activeBlock(page);
    await expect(block).toBeVisible();
    // Block should contain an SVG with layers
    const svg = block.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('first block has visible layers (not blank)', async ({ page }) => {
    // The first rendered block should have shape + text layers
    const svg = activeBlock(page).locator('svg');
    // foreignObject elements host text layers, rect/circle are shapes
    const layerElements = svg.locator('foreignObject, rect, circle, image');
    await expect(layerElements.first()).toBeVisible();
  });

  test('first block displays the title "Story: Climate Report"', async ({ page }) => {
    // The titleBlock template renders the H1 text
    const block = activeBlock(page);
    await expect(block).toContainText('Story: Climate Report');
  });

  test('clicking the player starts playback (block progresses)', async ({ page }) => {
    // Get the initial block's text content
    const initialText = await activeBlock(page).textContent();

    // Click the player to start playback (tap-to-toggle)
    await page.locator('.doc-player').click();

    // Wait enough time for the fallback timer to advance past the first block (5s default)
    await page.waitForTimeout(6_000);

    // The active block should now show different content
    const newText = await activeBlock(page).textContent();
    expect(newText).not.toEqual(initialText);
  });

  test('DocPlayer renders multiple blocks over time', async ({ page }) => {
    // Start playback
    await page.locator('.doc-player').click();

    // Collect unique block IDs over 12 seconds
    const seenIds = new Set<string>();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2_000);
      const blockId = await activeBlock(page).locator('svg').getAttribute('data-block-id');
      if (blockId) seenIds.add(blockId);
    }

    // Should have seen at least 2 different blocks
    expect(seenIds.size).toBeGreaterThanOrEqual(2);
  });
});

// ── Template Rendering ──────────────────────────────────────────────

test.describe('Template rendering correctness', () => {
  test('all template-annotations blocks render with layers', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await selectSample(page, 'template-annotations');
    await switchView(page, 'Preview');
    await waitForDocPlayer(page);

    // Start playback and check every few seconds that the active block has layers
    await page.locator('.doc-player').click();

    const emptyBlocks: string[] = [];
    for (let i = 0; i < 7; i++) {
      const svg = activeBlock(page).locator('svg');
      const layers = svg.locator('foreignObject, rect, circle, image');
      const count = await layers.count();
      if (count === 0) {
        const blockId = await svg.getAttribute('data-block-id');
        emptyBlocks.push(blockId ?? `unknown-at-${i * 5}s`);
      }
      // Advance to next block
      await page.waitForTimeout(5_200);
    }

    expect(emptyBlocks).toEqual([]);
  });

  test('statHighlight block renders stat text', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await selectSample(page, 'template-annotations');
    await switchView(page, 'Preview');
    await waitForDocPlayer(page);

    // Start playback and advance to find the statHighlight block
    await page.locator('.doc-player').click();

    let foundStat = false;
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(2_500);
      const text = await activeBlock(page).textContent();
      // The statHighlight block shows "Key Finding" as title and "1.5°C" as stat
      if (text && (text.includes('1.5') || text.includes('Key Finding'))) {
        foundStat = true;
        break;
      }
    }

    expect(foundStat).toBe(true);
  });
});

// ── Controls & Interaction ──────────────────────────────────────────

test.describe('DocPlayer controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await selectSample(page, 'template-annotations');
    await switchView(page, 'Preview');
    await waitForDocPlayer(page);
  });

  test('space bar toggles play/pause', async ({ page }) => {
    const player = page.locator('.doc-player');

    // Focus the player area and press space to start
    await player.click();
    await page.waitForTimeout(1_000);

    // Should be playing — content should be at non-zero time
    const textAfterPlay = await activeBlock(page).textContent();

    // Press space to pause
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const textAtPause = await activeBlock(page).textContent();

    // Wait and verify content didn't change (paused)
    await page.waitForTimeout(2_000);
    const textAfterWait = await activeBlock(page).textContent();
    expect(textAfterWait).toEqual(textAtPause);
  });

  test('progress bar is visible during playback', async ({ page }) => {
    await page.locator('.doc-player').click();
    await page.waitForTimeout(1_000);

    // DocPlayer renders a progress bar
    const progressBar = page.locator('.doc-player .doc-progress-bar, .doc-player .doc-player__scrubber');
    // At least one of the progress bar selectors should be visible
    const barCount = await progressBar.count();
    expect(barCount).toBeGreaterThan(0);
  });
});

// ── Sample Switching ─────────────────────────────────────────────────

test.describe('Sample switching', () => {
  test('switching sample updates the preview content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Start with hello-world in preview
    await switchView(page, 'Preview');
    await waitForDocPlayer(page);
    const initialContent = await activeBlock(page).textContent();

    // Switch to template-annotations
    await selectSample(page, 'template-annotations');
    await waitForDocPlayer(page);
    const newContent = await activeBlock(page).textContent();

    expect(newContent).not.toEqual(initialContent);
  });

  test('switching sample in raw view updates editor content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await switchView(page, 'Raw');

    await selectSample(page, 'features-demo');

    // The raw editor should contain the features-demo content
    // Monaco uses a textarea or contenteditable, check the editor container
    const editor = page.locator('[data-testid="raw-editor"]');
    await expect(editor).toBeVisible();

    // Monaco renders text in spans; check for known content
    await expect(editor).toContainText('Features Demo', { timeout: 3_000 });
  });
});
