import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from './appReady';
import { selectUseMode, switchView, viewTab, type ViewTab } from './view-tabs';

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

/** Wait for the DocPlayer to be present inside the preview panel */
async function waitForDocPlayer(page: Page) {
  await page.locator('.doc-player').waitFor({ state: 'visible', timeout: 5_000 });
}

/** Start playback and wait for the active block to appear (dismisses cover block) */
async function startPlaybackAndWaitForActiveBlock(page: Page) {
  const slideshowControls = page.getByTestId('slideshow-controls');
  if (await slideshowControls.isVisible()) {
    const counter = page.getByTestId('slide-counter');
    if ((await counter.textContent())?.trim() === 'Cover') {
      await page.getByTestId('slide-next').click();
    }
  } else {
    await page.locator('.doc-player').click();
  }
  // Video covers have a 3s grace period; slideshow covers advance immediately.
  await page.locator('.doc-player__block--active').waitFor({ state: 'visible', timeout: 8_000 });
}

/** Get the active SVG block in the DocPlayer */
function activeBlock(page: Page) {
  return page.locator('.doc-player__block--active');
}

async function activeBlockId(page: Page): Promise<string> {
  return (await activeBlock(page).locator('svg').getAttribute('data-block-id')) ?? '';
}

async function waitForNextActiveBlock(
  page: Page,
  previousId: string,
  timeout = 10_000,
): Promise<string> {
  await expect
    .poll(
      async () => {
        const id = await activeBlockId(page);
        return id && id !== previousId ? id : '';
      },
      { timeout },
    )
    .not.toBe('');
  return activeBlockId(page);
}

// ── Basic Navigation ─────────────────────────────────────────────────

test.describe('Site navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('loads with the default about-squisq sample', async ({ page }) => {
    const select = page.locator('select').first();
    await expect(select).toHaveValue('about-squisq');
  });

  test('sample picker contains all-templates', async ({ page }) => {
    const options = page.locator('select').first().locator('option');
    const values = await options.evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(values).toContain('all-templates');
  });

  test('view switcher has Markdown, Editor, Play tabs', async ({ page }) => {
    for (const label of ['Markdown', 'Editor', 'Play'] as const satisfies readonly ViewTab[]) {
      await expect(viewTab(page, label)).toBeVisible();
    }
  });

  test('switching to Markdown view shows the Monaco editor', async ({ page }) => {
    await switchView(page, 'Markdown');
    await expect(page.locator('[data-testid="raw-editor"]')).toBeVisible();
  });

  test('switching to Play shows the preview panel', async ({ page }) => {
    await switchView(page, 'Play');
    await expect(page.locator('[data-testid="preview-panel"]')).toBeVisible();
  });
});

// ── DocPlayer Preview ──────────────────────────────────────────────

test.describe('DocPlayer preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await selectSample(page, 'all-templates');
    await switchView(page, 'Play');
    await selectUseMode(page, 'Video');
    await waitForDocPlayer(page);
  });

  test('DocPlayer renders an active block SVG', async ({ page }) => {
    // Start playback to dismiss the cover block
    await startPlaybackAndWaitForActiveBlock(page);
    const block = activeBlock(page);
    await expect(block).toBeVisible();
    // Block should contain an SVG with layers
    const svg = block.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('first block has visible layers (not blank)', async ({ page }) => {
    // Start playback to dismiss the cover block and reveal the active block
    await startPlaybackAndWaitForActiveBlock(page);
    const svg = activeBlock(page).locator('svg');
    // Each layer is wrapped in a <g class="block-layer ..."> inside the SVG.
    // We target .block-layer to avoid matching the <rect> inside <clipPath>.
    // Use a single polling assertion so we don't race a block transition —
    // the prior `toBeAttached().first() + .count()` pattern could see zero
    // if React swapped blocks between the two queries.
    await expect(svg.locator('.block-layer')).not.toHaveCount(0, { timeout: 10_000 });
  });

  test('cover displays the title "All Squisq Templates" before playback', async ({ page }) => {
    await expect(page.locator('.doc-player__block--cover')).toContainText('All Squisq Templates');
  });

  test('clicking the player starts playback (block progresses)', async ({ page }) => {
    // Start playback (dismisses cover block after grace period)
    await startPlaybackAndWaitForActiveBlock(page);
    const initialId = await activeBlockId(page);
    expect(await waitForNextActiveBlock(page, initialId, 15_000)).not.toBe(initialId);
  });

  test('DocPlayer renders multiple blocks over time', async ({ page }) => {
    // Start playback
    await startPlaybackAndWaitForActiveBlock(page);

    const firstId = await activeBlockId(page);
    expect(firstId).not.toBe('');
    const secondId = await waitForNextActiveBlock(page, firstId, 15_000);
    expect(secondId).not.toBe(firstId);
  });
});

// ── Template Rendering ──────────────────────────────────────────────

test.describe('Template rendering correctness', () => {
  test('all all-templates blocks render with layers', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await waitForAppReady(page);
    await selectSample(page, 'all-templates');
    await switchView(page, 'Play');
    await selectUseMode(page, 'Video');
    await waitForDocPlayer(page);

    // Start playback and verify each newly active block has layers.
    await startPlaybackAndWaitForActiveBlock(page);

    const seenBlocks = new Set<string>();
    let blockId = await activeBlockId(page);
    for (let i = 0; i < 7; i++) {
      expect(blockId).not.toBe('');
      expect(seenBlocks.has(blockId)).toBe(false);
      seenBlocks.add(blockId);
      await expect(activeBlock(page).locator('.block-layer').first()).toBeAttached({
        timeout: 6_000,
      });
      if (i < 6) blockId = await waitForNextActiveBlock(page, blockId, 10_000);
    }

    expect(seenBlocks.size).toBe(7);
  });

  test('statHighlight block renders stat text', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await selectSample(page, 'all-templates');
    await switchView(page, 'Play');
    await selectUseMode(page, 'Video');
    await waitForDocPlayer(page);

    // Start playback and advance to find the statHighlight block
    await startPlaybackAndWaitForActiveBlock(page);

    await expect(activeBlock(page).locator('[data-layer-id="stat"]')).toHaveText('42%', {
      timeout: 40_000,
    });
  });
});

// ── Controls & Interaction ──────────────────────────────────────────

test.describe('DocPlayer controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await selectSample(page, 'all-templates');
    await switchView(page, 'Play');
    await selectUseMode(page, 'Video');
    await waitForDocPlayer(page);
  });

  test('space bar toggles play/pause', async ({ page }) => {
    // Start playback (dismisses cover block after grace period)
    await startPlaybackAndWaitForActiveBlock(page);

    await expect(page.locator('.doc-player')).toHaveAttribute('data-playback-state', 'playing');

    // Press space to pause
    await page.keyboard.press('Space');
    await expect(page.locator('.doc-player')).toHaveAttribute('data-playback-state', 'paused');
  });

  test('progress bar is visible during playback', async ({ page }) => {
    await startPlaybackAndWaitForActiveBlock(page);

    // DocPlayer renders controls (containing the progress bar) via DocControlsOverlay
    const controls = page.locator('.doc-player__controls');
    await expect(controls).toBeVisible({ timeout: 5_000 });
  });
});

// ── Cover Block (startBlock) ────────────────────────────────────────

test.describe('Cover block display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await selectSample(page, 'hello-world');
    await switchView(page, 'Play');
    await waitForDocPlayer(page);
  });

  test('cover block is visible at rest before playback', async ({ page }) => {
    const cover = page.locator('.doc-player__block--cover');
    await expect(cover).toBeVisible({ timeout: 5_000 });
  });

  test('cover block shows the document title', async ({ page }) => {
    const cover = page.locator('.doc-player__block--cover');
    await expect(cover).toContainText('Hello World', { timeout: 5_000 });
  });

  test('cover block is dismissed after playback starts', async ({ page }) => {
    const cover = page.locator('.doc-player__block--cover');
    await expect(cover).toBeVisible({ timeout: 5_000 });

    // Start playback and wait for active block to replace the cover
    await startPlaybackAndWaitForActiveBlock(page);
    await expect(cover).not.toBeVisible({ timeout: 8_000 });
  });
});

// ── Sample Switching ─────────────────────────────────────────────────

test.describe('Sample switching', () => {
  test('switching sample updates the preview content', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Start with hello-world in preview
    await switchView(page, 'Play');
    await waitForDocPlayer(page);
    await startPlaybackAndWaitForActiveBlock(page);
    const initialContent = await activeBlock(page).textContent();

    // Switch to all-templates
    await selectSample(page, 'all-templates');
    // EditorShell remounts when sample changes, resetting to default view
    await switchView(page, 'Play');
    await waitForDocPlayer(page);
    await startPlaybackAndWaitForActiveBlock(page);
    const newContent = await activeBlock(page).textContent();

    expect(newContent).not.toEqual(initialContent);
  });

  test('switching sample in raw view updates editor content', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await switchView(page, 'Markdown');

    await selectSample(page, 'features-demo');
    // EditorShell remounts when sample changes, resetting to default view
    await switchView(page, 'Markdown');

    // The raw editor should contain the features-demo content
    // Monaco uses a textarea or contenteditable, check the editor container
    const editor = page.locator('[data-testid="raw-editor"]');
    await expect(editor).toBeVisible();

    // Monaco renders text in spans; check for known content
    await expect(editor).toContainText('Features Demo', { timeout: 3_000 });
  });
});
